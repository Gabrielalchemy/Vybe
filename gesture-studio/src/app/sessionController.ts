import type { ChordPad } from "../domain/chords";
import { LIVE_SOURCE_BY_HAND, type GestureIntent, type HandRole, type LiveSource, type PerformanceEvent } from "../domain/events";
import { LiveRouter, type IntentOutcome, type LaneState, type LiveConfiguration } from "../domain/liveRouter";
import type { ScenePreset } from "../domain/presets";
import { fail, ok, type Result } from "../domain/result";

export type InputKind = GestureIntent["input"];

/** Receives performance events synchronously, before any UI work. The audio engine implements this. */
export interface PerformanceSink {
  dispatch(events: readonly PerformanceEvent[]): void;
}

export type SessionState = { kind: "ready" } | { kind: "paused"; reason: "hidden" | "camera-failed" | "worker-failed" | "audio-interrupted" };

export interface LaneSnapshot {
  state: LaneState;
  heldTargetId: string | null;
  input: InputKind | null;
  /** True after the Rest strip/control, until the hand's next press. */
  resting: boolean;
}

export interface OutcomeRecord {
  atMs: number;
  hand: HandRole;
  input: InputKind;
  action: GestureIntent["action"];
  targetId: string | null;
  status: IntentOutcome["status"];
  detail: string | null;
  notes: number[];
}

export interface SessionSnapshot {
  session: SessionState;
  configurationRevision: number;
  sceneName: string;
  melodyOctave: number;
  chordSlots: readonly (ChordPad | null)[];
  lanes: Record<HandRole, LaneSnapshot>;
  soundingNotes: { note: number; source: LiveSource; sustained: boolean }[];
  /** One entry per target with live voices: held by the key, or kept by the pedal. */
  soundingTargets: { hand: HandRole; targetId: string; held: boolean; sustained: boolean }[];
  sustainDown: boolean;
  recentOutcomes: readonly OutcomeRecord[];
}

export interface SessionDeps {
  sink: PerformanceSink;
  /** Audio clock in seconds (AudioContext.currentTime once audio exists). */
  nowSec: () => number;
  /** Main-thread monotonic milliseconds (performance.now()). */
  nowMs: () => number;
  newId: () => string;
}

const MAX_OUTCOMES = 100;
const TRACK_BY_HAND = { left: "live-chords", right: "live-melody" } as const;

/**
 * Owns live routing, configuration revisions and lifecycle. Musical work is
 * dispatched to the sink before the immutable UI snapshot is published, and a
 * failing subscriber can never prevent a release or panic from reaching audio.
 */
export class SessionController {
  private readonly deps: SessionDeps;
  private readonly router: LiveRouter;
  private config: LiveConfiguration | null = null;
  private sceneName = "";
  private session: SessionState = { kind: "ready" };
  private sustainDown = false;
  private readonly lanes: Record<HandRole, { heldTargetId: string | null; input: InputKind | null }> = {
    left: { heldTargetId: null, input: null },
    right: { heldTargetId: null, input: null },
  };
  private readonly resting: Record<HandRole, boolean> = { left: false, right: false };
  private outcomes: OutcomeRecord[] = [];
  /** voiceId -> target that produced it, for pad state display. */
  private readonly voiceTargets = new Map<string, { hand: HandRole; targetId: string }>();
  private readonly listeners = new Set<(s: SessionSnapshot) => void>();
  private readonly outcomeListeners = new Set<(o: OutcomeRecord) => void>();
  private current: SessionSnapshot | null = null;

  constructor(deps: SessionDeps) {
    this.deps = deps;
    this.router = new LiveRouter({ nextVoiceId: deps.newId, nowSec: deps.nowSec });
  }

  subscribe(listener: (s: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    if (this.current) this.safeNotify(listener, this.current);
    return () => this.listeners.delete(listener);
  }

  /** Every intent outcome as it happens (trials, practice feedback). Listener failures are isolated. */
  onOutcome(listener: (o: OutcomeRecord) => void): () => void {
    this.outcomeListeners.add(listener);
    return () => this.outcomeListeners.delete(listener);
  }

  /** The latest snapshot, or null before a scene is loaded. */
  peek(): SessionSnapshot | null {
    return this.current;
  }

  snapshot(): SessionSnapshot {
    if (!this.current) throw new Error("No scene loaded.");
    return this.current;
  }

  loadScene(scene: ScenePreset): Result<void> {
    const result = this.applyConfig({
      revision: (this.config?.revision ?? 0) + 1,
      melodyOctave: scene.melodyOctave,
      chordSlots: scene.chordSlots,
      trackIdByHand: TRACK_BY_HAND,
      velocity: scene.velocity,
    });
    if (result.ok) {
      this.sceneName = scene.name;
      this.publish();
    }
    return result;
  }

  setMelodyOctave(octave: number): Result<void> {
    if (!this.config) return fail("No scene loaded.");
    if (!Number.isInteger(octave) || octave < 0 || octave > 8) return fail("Octave must be 0 to 8.");
    const result = this.applyConfig({ ...this.config, revision: this.config.revision + 1, melodyOctave: octave });
    this.publish();
    return result;
  }

  press(hand: HandRole, targetId: string | null, input: InputKind, velocity?: number): IntentOutcome {
    const intent = this.intent(hand, "press", targetId, input, velocity);
    if (this.session.kind !== "ready") return this.finish({ status: "rejected", intent, reason: "paused", events: [] });
    const lane = this.lanes[hand];
    if (lane.input !== null && lane.input !== input) {
      return this.finish({ status: "rejected", intent, reason: "input-busy", events: [] });
    }
    // A fresh key/pointer press is neutral evidence; camera lanes arm only from open-hand evidence.
    if (input !== "camera" && this.router.laneState(hand) === "disarmed") this.router.arm(hand);
    this.resting[hand] = false;
    const outcome = this.router.handle(intent);
    if (outcome.status === "sounded" || outcome.status === "silent") {
      lane.input = input;
      lane.heldTargetId = targetId;
    }
    if (outcome.status === "sounded" && targetId !== null) {
      for (const e of outcome.events) if (e.kind === "note-on") this.voiceTargets.set(e.voiceId, { hand, targetId });
    }
    return this.finish(outcome);
  }

  /** Neutral-open evidence from the camera arms that hand's lane; camera presses never self-arm. */
  armCamera(hand: HandRole): void {
    if (this.session.kind !== "ready") return;
    const lane = this.lanes[hand];
    if (lane.input !== null && lane.input !== "camera") return;
    this.router.arm(hand);
    this.resting[hand] = false;
    this.publish();
  }

  release(hand: HandRole, input: InputKind): IntentOutcome {
    const intent = this.intent(hand, "release", null, input);
    const lane = this.lanes[hand];
    if (lane.input !== null && lane.input !== input) {
      return this.finish({ status: "rejected", intent, reason: "input-busy", events: [] });
    }
    const outcome = this.router.handle(intent);
    if (outcome.status === "released") this.clearLane(hand);
    return this.finish(outcome);
  }

  /** Rest strip or Rest control: release that hand's voices even under sustain; accompaniment continues. */
  rest(hand: HandRole, input: InputKind): IntentOutcome {
    const outcome = this.router.handle(this.intent(hand, "rest", null, input));
    this.clearLane(hand);
    this.resting[hand] = true;
    return this.finish(outcome);
  }

  /** Tracking loss for one hand. */
  lost(hand: HandRole): IntentOutcome {
    const outcome = this.router.handle(this.intent(hand, "lost", null, "camera"));
    this.clearLane(hand);
    return this.finish(outcome);
  }

  /** Keep bookkeeping consistent when the audio engine cuts a voice at the voice limit. */
  voiceStolen(voiceId: string): void {
    this.dispatch(this.router.forgetVoice(voiceId));
    this.publish();
  }

  setSustain(down: boolean): void {
    if (this.sustainDown === down) return;
    this.sustainDown = down;
    const events = (["left", "right"] as const).flatMap((hand) => this.router.setSustain(hand, down));
    this.dispatch(events);
    this.publish();
  }

  /** Escape / Stop all: every live voice stops and the pedal clears. */
  stopAll(): void {
    this.sustainDown = false;
    this.dispatch(this.router.stopAll());
    this.clearLane("left");
    this.clearLane("right");
    this.publish();
  }

  /** Hidden page, camera/worker failure or audio interruption: flush and wait for explicit resume. */
  interrupt(reason: Extract<SessionState, { kind: "paused" }>["reason"]): void {
    this.stopAll();
    this.session = { kind: "paused", reason };
    this.publish();
  }

  resume(): void {
    this.session = { kind: "ready" };
    this.publish();
  }

  private applyConfig(next: LiveConfiguration): Result<void> {
    const result = this.router.applyConfiguration(next);
    if (!result.ok) return result;
    this.config = next;
    this.sustainDown = false;
    this.clearLane("left");
    this.clearLane("right");
    this.dispatch(result.value);
    return ok(undefined);
  }

  private intent(hand: HandRole, action: GestureIntent["action"], targetId: string | null, input: InputKind, velocity?: number): GestureIntent {
    return {
      id: this.deps.newId(),
      configurationRevision: this.config?.revision ?? 0,
      hand,
      action,
      targetId,
      requestedAtMs: this.deps.nowMs(),
      velocity: velocity ?? this.config?.velocity ?? 80,
      input,
    };
  }

  private clearLane(hand: HandRole): void {
    this.lanes[hand] = { heldTargetId: null, input: null };
  }

  private finish(outcome: IntentOutcome): IntentOutcome {
    this.dispatch(outcome.events);
    const { intent } = outcome;
    const record: OutcomeRecord = {
      atMs: intent.requestedAtMs,
      hand: intent.hand,
      input: intent.input,
      action: intent.action,
      targetId: intent.targetId,
      status: outcome.status,
      detail: "reason" in outcome ? outcome.reason : null,
      notes: outcome.status === "sounded" ? outcome.notes : [],
    };
    this.outcomes.push(record);
    for (const l of this.outcomeListeners) {
      try {
        l(record);
      } catch (error) {
        console.error("Outcome listener failed", error);
      }
    }
    if (this.outcomes.length > MAX_OUTCOMES) this.outcomes = this.outcomes.slice(-MAX_OUTCOMES);
    this.publish();
    return outcome;
  }

  private dispatch(events: readonly PerformanceEvent[]): void {
    if (events.length === 0) return;
    try {
      this.deps.sink.dispatch(events);
    } finally {
      for (const e of events) if (e.kind === "voice-release") this.voiceTargets.delete(e.voiceId);
    }
  }

  private soundingTargets(): SessionSnapshot["soundingTargets"] {
    const byTarget = new Map<string, SessionSnapshot["soundingTargets"][number]>();
    for (const v of this.router.voices()) {
      const origin = this.voiceTargets.get(v.voiceId);
      if (!origin) continue;
      const entry = byTarget.get(origin.targetId) ?? { ...origin, held: false, sustained: false };
      entry.held ||= v.keyHeld;
      entry.sustained ||= v.sustained;
      byTarget.set(origin.targetId, entry);
    }
    return [...byTarget.values()];
  }

  private publish(): void {
    if (!this.config) return;
    const lane = (hand: HandRole): LaneSnapshot => ({ state: this.router.laneState(hand), ...this.lanes[hand], resting: this.resting[hand] });
    this.current = Object.freeze({
      session: this.session,
      configurationRevision: this.config.revision,
      sceneName: this.sceneName,
      melodyOctave: this.config.melodyOctave,
      chordSlots: this.config.chordSlots,
      lanes: { left: lane("left"), right: lane("right") },
      soundingNotes: this.router
        .voices()
        .filter((v): v is typeof v & { source: LiveSource } => v.source === LIVE_SOURCE_BY_HAND.left || v.source === LIVE_SOURCE_BY_HAND.right)
        .map((v) => ({ note: v.note, source: v.source, sustained: v.sustained })),
      soundingTargets: this.soundingTargets(),
      sustainDown: this.sustainDown,
      recentOutcomes: [...this.outcomes],
    });
    for (const listener of this.listeners) this.safeNotify(listener, this.current);
  }

  private safeNotify(listener: (s: SessionSnapshot) => void, snapshot: SessionSnapshot): void {
    try {
      listener(snapshot);
    } catch (error) {
      console.error("Session subscriber failed", error);
    }
  }
}

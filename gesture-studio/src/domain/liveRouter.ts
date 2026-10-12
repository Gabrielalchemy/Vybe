import type { ChordPad } from "./chords";
import { LIVE_SOURCE_BY_HAND, type GestureIntent, type HandRole, type PerformanceEvent } from "./events";
import { isPitchedNote } from "./pitch";
import { fail, ok, type Result } from "./result";
import { VoiceRegistry, type ActiveVoice } from "./voices";

/** Mapping applied atomically while hands are idle (architecture.md §4, §7). */
export interface LiveConfiguration {
  revision: number;
  melodyOctave: number;
  chordSlots: readonly (ChordPad | null)[];
  trackIdByHand: Readonly<Record<HandRole, string>>;
  velocity: number;
}

export type LaneState = "disarmed" | "open" | "held" | "held-silent";

export type SilentReason = "gap" | "empty-pad" | "unavailable-note";
export type RejectReason = "not-armed" | "stale-revision" | "wrong-lane" | "no-configuration" | "input-busy" | "paused";

/** What happened to an intent. Silent and rejected attempts stay visible to practice feedback. */
export type IntentOutcome =
  | { status: "sounded"; intent: GestureIntent; notes: number[]; events: PerformanceEvent[] }
  | { status: "silent"; intent: GestureIntent; reason: SilentReason; events: [] }
  | { status: "released" | "flushed"; intent: GestureIntent; events: PerformanceEvent[] }
  | { status: "ignored"; intent: GestureIntent; events: [] }
  | { status: "rejected"; intent: GestureIntent; reason: RejectReason; events: [] };

interface Lane {
  state: LaneState;
  /** Voice ids latched by the current press; released together on key release. */
  voiceIds: string[];
}

export interface LiveRouterDeps {
  nextVoiceId: () => string;
  /** Audio clock (AudioContext.currentTime). Live attacks are never backdated. */
  nowSec: () => number;
}

/** Hand role decides the lane: anatomical left plays chords, right plays melody. */
const LANE_PREFIX: Readonly<Record<HandRole, string>> = { left: "chord-slot-", right: "melody-pc-" };

export class LiveRouter {
  private readonly registry: VoiceRegistry;
  private readonly nowSec: () => number;
  private config: LiveConfiguration | null = null;
  private readonly lanes: Record<HandRole, Lane> = {
    left: { state: "disarmed", voiceIds: [] },
    right: { state: "disarmed", voiceIds: [] },
  };

  constructor(deps: LiveRouterDeps) {
    this.registry = new VoiceRegistry(deps.nextVoiceId);
    this.nowSec = deps.nowSec;
  }

  configuration(): LiveConfiguration {
    if (!this.config) throw new Error("No live configuration applied.");
    return this.config;
  }

  laneState(hand: HandRole): LaneState {
    return this.lanes[hand].state;
  }

  voices(): ActiveVoice[] {
    return this.registry.activeVoices();
  }

  /**
   * Replace the mapping. Refused while any hand holds a key; on success live
   * owners are flushed and both lanes need neutral input before playing again.
   */
  applyConfiguration(next: LiveConfiguration): Result<PerformanceEvent[]> {
    if (this.lanes.left.state === "held" || this.lanes.right.state === "held") {
      return fail("Release both hands before changing the playing setup.");
    }
    if (this.config && next.revision <= this.config.revision) {
      return fail("Configuration revision must increase.");
    }
    const events = this.flushLanes("lifecycle");
    this.config = next;
    return ok(events);
  }

  /** Neutral-open evidence (camera) or a fresh conventional input arms a lane. */
  arm(hand: HandRole): void {
    const lane = this.lanes[hand];
    if (lane.state === "disarmed") lane.state = "open";
  }

  setSustain(hand: HandRole, down: boolean): PerformanceEvent[] {
    return this.registry.setSustain(LIVE_SOURCE_BY_HAND[hand], down, this.nowSec());
  }

  handle(intent: GestureIntent): IntentOutcome {
    switch (intent.action) {
      case "press":
        return this.press(intent);
      case "release":
        return this.release(intent);
      case "rest":
      case "lost":
        return { status: "flushed", intent, events: this.flushHand(intent.hand, intent.action === "rest" ? "rest" : "loss") };
    }
  }

  /** Escape / Stop all: release every live voice, clear pedals, disarm both hands. */
  stopAll(): PerformanceEvent[] {
    return this.flushLanes("stop");
  }

  private press(intent: GestureIntent): IntentOutcome {
    const lane = this.lanes[intent.hand];
    const config = this.config;
    if (!config) return { status: "rejected", intent, reason: "no-configuration", events: [] };
    if (intent.configurationRevision !== config.revision) {
      return { status: "rejected", intent, reason: "stale-revision", events: [] };
    }
    if (lane.state === "disarmed") return { status: "rejected", intent, reason: "not-armed", events: [] };
    if (lane.state === "held" || lane.state === "held-silent") return { status: "ignored", intent, events: [] };

    if (intent.targetId !== null && !intent.targetId.startsWith(LANE_PREFIX[intent.hand])) {
      return { status: "rejected", intent, reason: "wrong-lane", events: [] };
    }
    const resolved = this.resolve(intent.hand, intent.targetId, config);
    if (!resolved.ok) {
      lane.state = "held-silent";
      return { status: "silent", intent, reason: resolved.error, events: [] };
    }

    const now = this.nowSec();
    const source = LIVE_SOURCE_BY_HAND[intent.hand];
    const events = resolved.value.map((note) =>
      this.registry.noteOn({
        source,
        sourceId: source,
        trackId: config.trackIdByHand[intent.hand],
        note,
        velocity: intent.velocity,
        audioTimeSec: now,
        intentId: intent.id,
      }),
    );
    lane.state = "held";
    lane.voiceIds = events.map((e) => e.voiceId);
    return { status: "sounded", intent, notes: resolved.value, events };
  }

  private release(intent: GestureIntent): IntentOutcome {
    const lane = this.lanes[intent.hand];
    if (lane.state !== "held" && lane.state !== "held-silent") return { status: "ignored", intent, events: [] };
    const now = this.nowSec();
    const events = lane.voiceIds.flatMap((id) => this.registry.keyRelease(id, now, intent.id));
    lane.state = "open";
    lane.voiceIds = [];
    return { status: "released", intent, events };
  }

  private resolve(hand: HandRole, targetId: string | null, config: LiveConfiguration): Result<number[], SilentReason> {
    if (targetId === null) return fail("gap");
    const index = Number(targetId.slice(LANE_PREFIX[hand].length));
    if (!Number.isInteger(index)) return fail("gap");
    if (hand === "left") {
      const pad = config.chordSlots[index];
      return pad ? ok([...pad.notes]) : fail("empty-pad");
    }
    const midi = 12 * (config.melodyOctave + 1) + index;
    return isPitchedNote(midi) ? ok([midi]) : fail("unavailable-note");
  }

  private flushHand(hand: HandRole, reason: "rest" | "loss" | "stop" | "lifecycle"): PerformanceEvent[] {
    const lane = this.lanes[hand];
    lane.state = "disarmed";
    lane.voiceIds = [];
    return this.registry.flush(LIVE_SOURCE_BY_HAND[hand], reason, this.nowSec());
  }

  private flushLanes(reason: "stop" | "lifecycle"): PerformanceEvent[] {
    return [...this.flushHand("left", reason), ...this.flushHand("right", reason)];
  }
}

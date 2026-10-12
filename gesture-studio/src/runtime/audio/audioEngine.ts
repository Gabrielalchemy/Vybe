import { LeaseClock, type LeaseRenewal } from "../../domain/audio/lease";
import { chooseVoiceToSteal } from "../../domain/audio/voicePolicy";
import type { EventSource, PerformanceEvent, VoiceReleaseReason } from "../../domain/events";
import type { InstrumentVoices } from "./instrument";

/** PRD §5: pitched polyphony budget. */
export const MAX_VOICES = 128;
/** Master starts at -6 dB headroom (architecture.md §6). */
export const MASTER_GAIN = 0.5;
const VOICE_AMPLITUDE = 0.6;
const ATTACK_SEC = 0.003;
/**
 * Forced releases (rest, loss, stop, voice limit) bypass the pedal with an
 * exponential fade (τ 3.5 ms: below -60 dB within ~25 ms), then stop.
 * Exponential, because a linear ramp after cancelAndHoldAtTime does not start
 * from the held value in Chrome and clicks.
 */
const FORCED_TAU_SEC = 0.0035;
const FORCED_STOP_SEC = 0.03;
const RAMP_BACK_SEC = 0.005;

interface Voice {
  id: string;
  source: EventSource;
  state: "held" | "pedal" | "tail";
  startedAtSec: number;
  env: GainNode;
  nodes: AudioBufferSourceNode[];
}

interface Lane {
  safety: GainNode;
  bus: GainNode;
  lease: LeaseClock;
  mode: "camera" | "off";
}

export interface AudioEngineOptions {
  /** Null while the live instrument loads: notes are not started, never replaced by a stand-in sound. */
  instrument: InstrumentVoices | null;
  /** A held or pedal voice was stolen at the voice limit; the registry must forget it. */
  onVoiceStolen?: (voiceId: string) => void;
  maxVoices?: number;
}

/**
 * Owns the Web Audio graph for performance events. Live attacks start at the
 * current audio time (never backdated). Each voice is identified by voiceId;
 * MIDI pitch is never used to find a voice. Camera lanes pass through a
 * safety gain whose lease fade is scheduled on the audio thread.
 */
export class AudioEngine {
  private readonly ctx: BaseAudioContext;
  private instrument: InstrumentVoices | null;
  private readonly onVoiceStolen: ((voiceId: string) => void) | undefined;
  private readonly maxVoices: number;
  private readonly master: GainNode;
  private readonly compressor: DynamicsCompressorNode;
  readonly analyser: AnalyserNode;
  private readonly lanes = new Map<EventSource, Lane>();
  private readonly voices = new Map<string, Voice>();
  stolenCount = 0;

  constructor(ctx: BaseAudioContext, opts: AudioEngineOptions) {
    this.ctx = ctx;
    this.instrument = opts.instrument;
    this.onVoiceStolen = opts.onVoiceStolen;
    this.maxVoices = opts.maxVoices ?? MAX_VOICES;
    this.master = new GainNode(ctx, { gain: MASTER_GAIN });
    this.compressor = new DynamicsCompressorNode(ctx, { threshold: -6, knee: 6, ratio: 12, attack: 0.003, release: 0.15 });
    this.analyser = new AnalyserNode(ctx, { fftSize: 1024 });
    this.master.connect(this.compressor).connect(this.analyser).connect(ctx.destination);
  }

  setInstrument(instrument: InstrumentVoices | null): void {
    this.instrument = instrument;
  }

  activeVoiceCount(): number {
    return this.voices.size;
  }

  dispatch(events: readonly PerformanceEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case "note-on":
          this.noteOn(e.voiceId, e.source, e.note, e.velocity, e.audioTimeSec);
          break;
        case "key-release": {
          const v = this.voices.get(e.voiceId);
          if (v && v.state === "held") v.state = "pedal";
          break;
        }
        case "voice-release":
          this.release(e.voiceId, e.reason, e.audioTimeSec);
          break;
        case "sustain":
        case "source-flush":
          break;
      }
    }
  }

  /** Camera lanes use leases; conventional input lanes hold the safety gain at 1. */
  setLeaseMode(source: EventSource, mode: "camera" | "off"): void {
    const lane = this.lane(source);
    lane.mode = mode;
    lane.lease.reset();
    const now = this.ctx.currentTime;
    lane.safety.gain.cancelScheduledValues(now);
    lane.safety.gain.setValueAtTime(1, now);
  }

  /** Renew a camera lane's lease from a valid observation (audio-clock seconds). */
  renewLease(source: EventSource, observationSec: number): LeaseRenewal {
    const lane = this.lane(source);
    const now = this.ctx.currentTime;
    const r = lane.lease.renew(Math.min(observationSec, now), now);
    if (!r.ok) return r;
    const g = lane.safety.gain;
    g.cancelAndHoldAtTime(now);
    g.linearRampToValueAtTime(1, now + RAMP_BACK_SEC);
    g.setValueAtTime(1, Math.max(r.fadeStartSec, now + RAMP_BACK_SEC));
    g.linearRampToValueAtTime(0, Math.max(r.zeroSec, now + RAMP_BACK_SEC + 0.001));
    return r;
  }

  leaseExpired(source: EventSource): boolean {
    const lane = this.lanes.get(source);
    return !!lane && lane.mode === "camera" && lane.lease.isExpired(this.ctx.currentTime);
  }

  /** After an expired lease: stop the lane's (already silent) voices and allow a fresh lease. */
  retireLane(source: EventSource): string[] {
    const now = this.ctx.currentTime;
    const retired: string[] = [];
    for (const v of [...this.voices.values()]) {
      if (v.source !== source) continue;
      if (v.state !== "tail") retired.push(v.id);
      this.fastStop(v, now);
    }
    this.lanes.get(source)?.lease.reset();
    return retired;
  }

  /** Stop all: every voice on every lane fades out within FORCED_STOP_SEC. */
  panic(atSec?: number): void {
    const t = Math.max(atSec ?? this.ctx.currentTime, this.ctx.currentTime);
    for (const v of [...this.voices.values()]) this.fastStop(v, t);
  }

  dispose(): void {
    this.panic();
    for (const lane of this.lanes.values()) {
      lane.safety.disconnect();
      lane.bus.disconnect();
    }
    this.lanes.clear();
    this.master.disconnect();
    this.compressor.disconnect();
    this.analyser.disconnect();
  }

  private lane(source: EventSource): Lane {
    let lane = this.lanes.get(source);
    if (!lane) {
      const safety = new GainNode(this.ctx, { gain: 1 });
      const bus = new GainNode(this.ctx, { gain: 1 });
      safety.connect(bus).connect(this.master);
      lane = { safety, bus, lease: new LeaseClock(), mode: "off" };
      this.lanes.set(source, lane);
    }
    return lane;
  }

  private noteOn(voiceId: string, source: EventSource, note: number, velocity: number, requestedSec: number): void {
    if (this.voices.has(voiceId) || !this.instrument) return;
    while (this.voices.size >= this.maxVoices) this.steal();
    const t = Math.max(requestedSec, this.ctx.currentTime);
    const env = new GainNode(this.ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(VOICE_AMPLITUDE, t + ATTACK_SEC);
    env.connect(this.lane(source).safety);
    const nodes = this.instrument.layers(note, velocity).map((layer) => {
      const node = new AudioBufferSourceNode(this.ctx, { buffer: layer.buffer, playbackRate: layer.playbackRate, loop: layer.loop ?? false });
      if (layer.gain === 1) node.connect(env);
      else node.connect(new GainNode(this.ctx, { gain: layer.gain })).connect(env);
      node.start(t, layer.offsetSec);
      return node;
    });
    const voice: Voice = { id: voiceId, source, state: "held", startedAtSec: t, env, nodes };
    this.voices.set(voiceId, voice);
    const last = nodes.at(-1);
    if (last) last.onended = () => this.forget(voice);
    else this.forget(voice);
  }

  private release(voiceId: string, reason: VoiceReleaseReason, requestedSec: number): void {
    const v = this.voices.get(voiceId);
    if (!v || v.state === "tail") return;
    const t = Math.max(requestedSec, this.ctx.currentTime);
    if ((reason === "key" || reason === "pedal-up") && this.instrument) {
      v.state = "tail";
      v.env.gain.cancelAndHoldAtTime(t);
      v.env.gain.setTargetAtTime(0, t, this.instrument.releaseTauSec);
      const end = t + this.instrument.releaseTauSec * 9;
      for (const n of v.nodes) n.stop(end);
    } else {
      this.fastStop(v, t);
    }
  }

  private fastStop(v: Voice, t: number): void {
    v.state = "tail";
    v.env.gain.cancelAndHoldAtTime(t);
    v.env.gain.setTargetAtTime(0, t, FORCED_TAU_SEC);
    for (const n of v.nodes) {
      try {
        n.stop(t + FORCED_STOP_SEC);
      } catch {
        // Already stopped.
      }
    }
  }

  private steal(): void {
    const victimId = chooseVoiceToSteal([...this.voices.values()].map((v) => ({ voiceId: v.id, state: v.state, startedAtSec: v.startedAtSec })));
    const victim = victimId ? this.voices.get(victimId) : undefined;
    if (!victim) return;
    const wasSounding = victim.state !== "tail";
    this.fastStop(victim, this.ctx.currentTime);
    this.forget(victim);
    this.stolenCount += 1;
    if (wasSounding) this.onVoiceStolen?.(victim.id);
  }

  private forget(v: Voice): void {
    if (this.voices.get(v.id) !== v) return;
    this.voices.delete(v.id);
    // Disconnect after the stop time has passed; onended has already fired for the last node.
    setTimeout(() => v.env.disconnect(), 0);
  }
}

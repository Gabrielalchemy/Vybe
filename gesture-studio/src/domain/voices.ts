import type { EventSource, ForcedReleaseReason, NoteOnEvent, PerformanceEvent } from "./events";

export interface ActiveVoice {
  voiceId: string;
  source: EventSource;
  sourceId: string;
  trackId: string;
  note: number;
  velocity: number;
  startedAtSec: number;
  keyHeld: boolean;
  /** True when the key is up but the source's pedal keeps the voice sounding. */
  sustained: boolean;
}

export type NoteOnRequest = Omit<NoteOnEvent, "kind" | "voiceId">;

/**
 * Pure bookkeeping of sounding voices. Every attack gets a unique voice id and
 * every release names that id, so one owner can never stop another owner's
 * copy of the same pitch (AGENTS.md invariant 4). Sustain is per source.
 */
export class VoiceRegistry {
  private readonly voices = new Map<string, ActiveVoice>();
  private readonly sustainDown = new Set<EventSource>();
  private readonly nextId: () => string;

  constructor(nextId: () => string) {
    this.nextId = nextId;
  }

  noteOn(request: NoteOnRequest): NoteOnEvent {
    const voiceId = this.nextId();
    if (this.voices.has(voiceId)) throw new Error(`Voice id reused: ${voiceId}`);
    this.voices.set(voiceId, {
      voiceId,
      source: request.source,
      sourceId: request.sourceId,
      trackId: request.trackId,
      note: request.note,
      velocity: request.velocity,
      startedAtSec: request.audioTimeSec,
      keyHeld: true,
      sustained: false,
    });
    return { kind: "note-on", voiceId, ...request };
  }

  keyRelease(voiceId: string, audioTimeSec: number, intentId?: string): PerformanceEvent[] {
    const voice = this.voices.get(voiceId);
    if (!voice || !voice.keyHeld) return [];
    voice.keyHeld = false;
    const events: PerformanceEvent[] = [
      { kind: "key-release", voiceId, source: voice.source, audioTimeSec, ...(intentId ? { intentId } : {}) },
    ];
    if (this.sustainDown.has(voice.source)) {
      voice.sustained = true;
    } else {
      this.voices.delete(voiceId);
      events.push({ kind: "voice-release", voiceId, source: voice.source, reason: "key", audioTimeSec });
    }
    return events;
  }

  setSustain(source: EventSource, down: boolean, audioTimeSec: number): PerformanceEvent[] {
    if (this.sustainDown.has(source) === down) return [];
    const events: PerformanceEvent[] = [{ kind: "sustain", source, down, audioTimeSec }];
    if (down) {
      this.sustainDown.add(source);
      return events;
    }
    this.sustainDown.delete(source);
    for (const voice of [...this.voices.values()]) {
      if (voice.source === source && voice.sustained) {
        this.voices.delete(voice.voiceId);
        events.push({ kind: "voice-release", voiceId: voice.voiceId, source, reason: "pedal-up", audioTimeSec });
      }
    }
    return events;
  }

  /** Forced release of every voice of one source, bypassing its pedal, which is cleared. */
  flush(source: EventSource, reason: ForcedReleaseReason, audioTimeSec: number): PerformanceEvent[] {
    const events: PerformanceEvent[] = [];
    for (const voice of [...this.voices.values()]) {
      if (voice.source !== source) continue;
      this.voices.delete(voice.voiceId);
      events.push({ kind: "voice-release", voiceId: voice.voiceId, source, reason, audioTimeSec });
    }
    if (this.sustainDown.delete(source)) events.push({ kind: "sustain", source, down: false, audioTimeSec });
    events.push({ kind: "source-flush", source, reason, audioTimeSec });
    return events;
  }

  flushAll(reason: ForcedReleaseReason, audioTimeSec: number): PerformanceEvent[] {
    const sources = new Set<EventSource>([...this.sustainDown, ...[...this.voices.values()].map((v) => v.source)]);
    return [...sources].flatMap((s) => this.flush(s, reason, audioTimeSec));
  }

  /** The audio engine cut this voice (voice limit); keep bookkeeping consistent with what sounds. */
  forget(voiceId: string, reason: ForcedReleaseReason, audioTimeSec: number): PerformanceEvent[] {
    const voice = this.voices.get(voiceId);
    if (!voice) return [];
    this.voices.delete(voiceId);
    return [{ kind: "voice-release", voiceId, source: voice.source, reason, audioTimeSec }];
  }

  isSustainDown(source: EventSource): boolean {
    return this.sustainDown.has(source);
  }

  activeVoices(): ActiveVoice[] {
    return [...this.voices.values()].map((v) => ({ ...v }));
  }
}

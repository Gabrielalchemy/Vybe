/**
 * Shared runtime contracts (architecture.md §4). Units are explicit in names:
 * `Ms` = performance.now() milliseconds, `Sec` = AudioContext seconds.
 */

export type HandRole = "left" | "right";
export type LiveSource = "live-left" | "live-right";
export type EventSource = LiveSource | "clip" | "practice" | "preview";

export const LIVE_SOURCE_BY_HAND: Readonly<Record<HandRole, LiveSource>> = {
  left: "live-left",
  right: "live-right",
};

export type ForcedReleaseReason = "rest" | "loss" | "stop" | "seek" | "loop-boundary" | "voice-limit" | "lifecycle";
export type VoiceReleaseReason = "key" | "pedal-up" | ForcedReleaseReason;

export interface GestureIntent {
  id: string;
  configurationRevision: number;
  hand: HandRole;
  action: "press" | "release" | "rest" | "lost";
  /** Layout target id latched at press time; null for gaps. */
  targetId: string | null;
  requestedAtMs: number;
  /** Integer 1..127, meaningful for press. */
  velocity: number;
  /** Which conventional or camera input produced the intent. */
  input: "camera" | "keyboard" | "pointer" | "simulator";
}

export interface NoteOnEvent {
  kind: "note-on";
  voiceId: string;
  source: EventSource;
  sourceId: string;
  trackId: string;
  note: number;
  velocity: number;
  audioTimeSec: number;
  intentId?: string;
}

/** The key (pinch/keyboard) was let go; the voice may continue under sustain. */
export interface KeyReleaseEvent {
  kind: "key-release";
  voiceId: string;
  source: EventSource;
  audioTimeSec: number;
  intentId?: string;
}

/** The voice actually stops being fed (its release envelope starts). */
export interface VoiceReleaseEvent {
  kind: "voice-release";
  voiceId: string;
  source: EventSource;
  reason: VoiceReleaseReason;
  audioTimeSec: number;
}

export interface SustainEvent {
  kind: "sustain";
  source: EventSource;
  down: boolean;
  audioTimeSec: number;
}

export interface SourceFlushEvent {
  kind: "source-flush";
  source: EventSource;
  reason: ForcedReleaseReason;
  audioTimeSec: number;
}

export type PerformanceEvent = NoteOnEvent | KeyReleaseEvent | VoiceReleaseEvent | SustainEvent | SourceFlushEvent;

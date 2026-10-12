/** One sample layer to play for a note. */
export interface VoiceLayer {
  buffer: AudioBuffer;
  playbackRate: number;
  /** Seconds into the buffer where playback starts (recorded attack offset). */
  offsetSec: number;
  gain: number;
  loop?: boolean;
}

/** A playable instrument: which buffers to start for a note and velocity. */
export interface InstrumentVoices {
  readonly id: string;
  readonly label: string;
  layers(note: number, velocity: number): VoiceLayer[];
  /** Time constant of the ordinary (key/pedal) release, seconds. */
  readonly releaseTauSec: number;
}

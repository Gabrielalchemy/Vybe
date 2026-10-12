export interface StealCandidate {
  voiceId: string;
  /** tail: released and decaying; pedal: key up, held by sustain; held: key down. */
  state: "tail" | "held" | "pedal";
  startedAtSec: number;
}

const ORDER = { tail: 0, pedal: 1, held: 2 } as const;

/**
 * Deterministic voice-limit policy (architecture.md §6): the oldest released
 * tail first, then the oldest pedal-held released key, then the oldest
 * remaining voice. Ties resolve by voice id.
 */
export function chooseVoiceToSteal(voices: readonly StealCandidate[]): string | null {
  let best: StealCandidate | null = null;
  for (const v of voices) {
    if (
      !best ||
      ORDER[v.state] < ORDER[best.state] ||
      (ORDER[v.state] === ORDER[best.state] && (v.startedAtSec < best.startedAtSec || (v.startedAtSec === best.startedAtSec && v.voiceId < best.voiceId)))
    ) {
      best = v;
    }
  }
  return best?.voiceId ?? null;
}

/**
 * Audio lease timing (architecture.md §6). Each valid observation of a hand
 * renews its lane lease on the audio clock: the lane safety gain starts a
 * 20 ms fade 180 ms after the observation and is silent by 200 ms. Because the
 * fade is scheduled on the audio thread, a stalled main thread cannot keep a
 * lost hand's notes sounding.
 */
export const LEASE_FADE_START_SEC = 0.18;
export const LEASE_ZERO_SEC = 0.2;

export type LeaseRenewal =
  | { ok: true; fadeStartSec: number; zeroSec: number }
  | { ok: false; reason: "expired" | "older-observation" };

export class LeaseClock {
  private observationSec: number | null = null;

  /** Renew from an observation time (audio clock). Refused once the previous lease expired. */
  renew(observationSec: number, nowSec: number): LeaseRenewal {
    if (this.isExpired(nowSec)) return { ok: false, reason: "expired" };
    if (this.observationSec !== null && observationSec < this.observationSec) return { ok: false, reason: "older-observation" };
    this.observationSec = observationSec;
    return { ok: true, fadeStartSec: observationSec + LEASE_FADE_START_SEC, zeroSec: observationSec + LEASE_ZERO_SEC };
  }

  isExpired(nowSec: number): boolean {
    return this.observationSec !== null && nowSec >= this.observationSec + LEASE_ZERO_SEC;
  }

  /** After expiry has been handled (voices retired, hand disarmed). */
  reset(): void {
    this.observationSec = null;
  }
}

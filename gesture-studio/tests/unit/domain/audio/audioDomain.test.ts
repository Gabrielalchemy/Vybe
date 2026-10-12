import { describe, expect, it } from "vitest";
import { PIANO_ROOTS, chooseSample, layerWeights } from "../../../../src/domain/audio/sampleMap";
import { LEASE_FADE_START_SEC, LEASE_ZERO_SEC, LeaseClock } from "../../../../src/domain/audio/lease";
import { chooseVoiceToSteal, type StealCandidate } from "../../../../src/domain/audio/voicePolicy";

describe("chooseSample", () => {
  it("roots are every minor third from A0 to C8", () => {
    expect(PIANO_ROOTS[0]).toBe(21);
    expect(PIANO_ROOTS.at(-1)).toBe(108);
    expect(PIANO_ROOTS).toHaveLength(30);
  });

  it("uses the nearest root and a pitch ratio for the remaining semitones", () => {
    expect(chooseSample(60)).toEqual({ rootMidi: 60, playbackRate: 1 });
    const up = chooseSample(61);
    expect(up.rootMidi).toBe(60);
    expect(up.playbackRate).toBeCloseTo(2 ** (1 / 12), 12);
    const down = chooseSample(62);
    expect(down.rootMidi).toBe(63);
    expect(down.playbackRate).toBeCloseTo(2 ** (-1 / 12), 12);
  });

  it("never transposes more than one semitone", () => {
    for (let n = 21; n <= 108; n++) {
      const { rootMidi } = chooseSample(n);
      expect(Math.abs(n - rootMidi)).toBeLessThanOrEqual(1);
    }
  });

  it("rejects notes outside the piano", () => {
    expect(() => chooseSample(20)).toThrow(RangeError);
  });
});

describe("layerWeights", () => {
  const sum = (w: { weight: number }[]) => w.reduce((s, x) => s + x.weight ** 2, 0);

  it("uses one layer for the medium default", () => {
    expect(layerWeights(80)).toEqual([{ layer: 10, weight: 1 }]);
  });

  it("uses the loud layer for 112 and the soft layer for very low velocities", () => {
    expect(layerWeights(112)).toEqual([{ layer: 16, weight: 1 }]);
    expect(layerWeights(20)).toEqual([{ layer: 4, weight: 1 }]);
  });

  it("blends neighbouring layers with equal power near a boundary", () => {
    const w = layerWeights(52);
    expect(w.map((x) => x.layer)).toEqual([4, 10]);
    expect(sum(w)).toBeCloseTo(1, 10);
    expect(w[0]!.weight).toBeCloseTo(w[1]!.weight, 10);
  });

  it("is continuous across velocity", () => {
    let prev = layerWeights(1);
    for (let v = 2; v <= 127; v++) {
      const cur = layerWeights(v);
      const get = (ws: typeof cur, l: number) => ws.find((x) => x.layer === l)?.weight ?? 0;
      for (const l of [4, 10, 16]) expect(Math.abs(get(cur, l) - get(prev, l))).toBeLessThan(0.15);
      prev = cur;
    }
  });
});

describe("LeaseClock", () => {
  it("schedules the fade 180 ms after the observation, silent by 200 ms", () => {
    const lease = new LeaseClock();
    expect(lease.renew(10, 10.001)).toEqual({ ok: true, fadeStartSec: 10 + LEASE_FADE_START_SEC, zeroSec: 10 + LEASE_ZERO_SEC });
    expect(LEASE_FADE_START_SEC).toBeCloseTo(0.18, 10);
    expect(LEASE_ZERO_SEC).toBeCloseTo(0.2, 10);
  });

  it("can be renewed only before the previous lease expired", () => {
    const lease = new LeaseClock();
    lease.renew(10, 10.01);
    expect(lease.renew(10.1, 10.15).ok).toBe(true);
    expect(lease.isExpired(10.29)).toBe(false);
    expect(lease.isExpired(10.31)).toBe(true);
    expect(lease.renew(10.4, 10.41)).toEqual({ ok: false, reason: "expired" });
  });

  it("never extends the lease from an observation older than the current one", () => {
    const lease = new LeaseClock();
    lease.renew(10.1, 10.11);
    expect(lease.renew(10.05, 10.12)).toEqual({ ok: false, reason: "older-observation" });
  });

  it("a reset starts a fresh lease after expiry", () => {
    const lease = new LeaseClock();
    lease.renew(10, 10.01);
    lease.reset();
    expect(lease.renew(11, 11.01).ok).toBe(true);
  });
});

describe("chooseVoiceToSteal", () => {
  const v = (id: string, state: StealCandidate["state"], startedAtSec: number): StealCandidate => ({ voiceId: id, state, startedAtSec });

  it("takes the oldest released tail first", () => {
    expect(chooseVoiceToSteal([v("held", "held", 0), v("tail-new", "tail", 5), v("tail-old", "tail", 2), v("pedal", "pedal", 1)])).toBe("tail-old");
  });

  it("then the oldest pedal-held released key", () => {
    expect(chooseVoiceToSteal([v("held", "held", 0), v("p2", "pedal", 3), v("p1", "pedal", 2)])).toBe("p1");
  });

  it("then the oldest remaining voice, with stable ties", () => {
    expect(chooseVoiceToSteal([v("b", "held", 1), v("a", "held", 1), v("c", "held", 2)])).toBe("a");
  });

  it("returns null when there is nothing to steal", () => {
    expect(chooseVoiceToSteal([])).toBeNull();
  });
});

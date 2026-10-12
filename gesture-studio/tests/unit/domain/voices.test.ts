import { beforeEach, describe, expect, it } from "vitest";
import { VoiceRegistry } from "../../../src/domain/voices";
import type { PerformanceEvent } from "../../../src/domain/events";

let registry: VoiceRegistry;
let n = 0;
beforeEach(() => {
  n = 0;
  registry = new VoiceRegistry(() => `v${++n}`);
});

const on = (source: "live-left" | "live-right" | "preview", note: number, t = 0) =>
  registry.noteOn({ source, sourceId: source, trackId: "t1", note, velocity: 80, audioTimeSec: t });

const releases = (events: PerformanceEvent[]) =>
  events.filter((e) => e.kind === "voice-release").map((e) => (e.kind === "voice-release" ? `${e.voiceId}:${e.reason}` : ""));

describe("VoiceRegistry ownership", () => {
  it("gives every attack a unique voice id even for identical pitches", () => {
    const a = on("live-left", 60);
    const b = on("live-right", 60);
    expect(a.voiceId).not.toBe(b.voiceId);
    expect(registry.activeVoices()).toHaveLength(2);
  });

  it("releasing one owner's copy of a pitch leaves the other owner's copy sounding", () => {
    const left = on("live-left", 60);
    const right = on("live-right", 60);
    const events = registry.keyRelease(left.voiceId, 1);
    expect(releases(events)).toEqual([`${left.voiceId}:key`]);
    expect(registry.activeVoices().map((v) => v.voiceId)).toEqual([right.voiceId]);
  });

  it("ignores a release for an unknown or already released voice", () => {
    const v = on("live-right", 60);
    registry.keyRelease(v.voiceId, 1);
    expect(registry.keyRelease(v.voiceId, 2)).toEqual([]);
    expect(registry.keyRelease("nope", 2)).toEqual([]);
  });
});

describe("VoiceRegistry sustain", () => {
  it("keeps a released key sounding while that source's pedal is down", () => {
    registry.setSustain("live-right", true, 0);
    const v = on("live-right", 64);
    const events = registry.keyRelease(v.voiceId, 1);
    expect(events.map((e) => e.kind)).toEqual(["key-release"]);
    expect(registry.activeVoices()[0]).toMatchObject({ voiceId: v.voiceId, keyHeld: false, sustained: true });
  });

  it("pedal up releases only voices whose keys are no longer held", () => {
    registry.setSustain("live-right", true, 0);
    const held = on("live-right", 60);
    const let_go = on("live-right", 64);
    registry.keyRelease(let_go.voiceId, 1);
    const events = registry.setSustain("live-right", false, 2);
    expect(releases(events)).toEqual([`${let_go.voiceId}:pedal-up`]);
    expect(registry.activeVoices().map((v) => v.voiceId)).toEqual([held.voiceId]);
  });

  it("one source's pedal does not hold another source's voices", () => {
    registry.setSustain("live-left", true, 0);
    const v = on("live-right", 60);
    expect(releases(registry.keyRelease(v.voiceId, 1))).toEqual([`${v.voiceId}:key`]);
  });
});

describe("VoiceRegistry flush", () => {
  it("rest/loss release a source's voices including pedal-held ones, and clear its pedal", () => {
    registry.setSustain("live-left", true, 0);
    const a = on("live-left", 48);
    const b = on("live-left", 55);
    registry.keyRelease(a.voiceId, 1);
    const other = on("live-right", 72);
    const events = registry.flush("live-left", "loss", 2);
    expect(releases(events).sort()).toEqual([`${a.voiceId}:loss`, `${b.voiceId}:loss`].sort());
    expect(events.at(-1)).toMatchObject({ kind: "source-flush", source: "live-left", reason: "loss" });
    expect(events.some((e) => e.kind === "sustain" && e.source === "live-left" && !e.down)).toBe(true);
    expect(registry.isSustainDown("live-left")).toBe(false);
    expect(registry.activeVoices().map((v) => v.voiceId)).toEqual([other.voiceId]);
  });

  it("flushAll stops every source", () => {
    on("live-left", 48);
    on("live-right", 60);
    on("preview", 62);
    const events = registry.flushAll("stop", 3);
    expect(releases(events)).toHaveLength(3);
    expect(registry.activeVoices()).toEqual([]);
  });
});

describe("VoiceRegistry steal", () => {
  it("forgets a voice cut at the voice limit and records why", () => {
    const v = on("live-right", 60);
    expect(registry.forget(v.voiceId, "voice-limit", 2)).toEqual([
      { kind: "voice-release", voiceId: v.voiceId, source: "live-right", reason: "voice-limit", audioTimeSec: 2 },
    ]);
    expect(registry.activeVoices()).toEqual([]);
    expect(registry.forget(v.voiceId, "voice-limit", 3)).toEqual([]);
  });
});


import { expect, test } from "@playwright/test";

// Renders the real AudioEngine in Chromium with OfflineAudioContext. The test
// "instrument" is a set of synthetic sine buffers so results are exact; the
// engine code paths (voices, envelopes, leases, stealing) are the production ones.
// Offline rendering never runs main-thread code unless we suspend the context,
// which is exactly a stalled main thread from the engine's point of view.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

type Probe = Record<string, number | boolean | string[] | number[]>;

async function render(page: import("@playwright/test").Page, scenario: string): Promise<Probe> {
  return page.evaluate(async (scenario) => {
    // Imported by URL inside the page (served by Vite); typed from the source modules.
    const engineUrl = "/src/runtime/audio/audioEngine.ts";
    const toneUrl = "/tests/fixtures/toneBank.ts";
    const { AudioEngine }: typeof import("../../src/runtime/audio/audioEngine") = await import(/* @vite-ignore */ engineUrl);
    const { createToneBank }: typeof import("../fixtures/toneBank") = await import(/* @vite-ignore */ toneUrl);
    const SR = 48000;
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR * 1.5, sampleRate: SR });
    const stolen: string[] = [];
    const engine = new AudioEngine(ctx, { instrument: createToneBank(ctx), onVoiceStolen: (id) => stolen.push(id) });
    const on = (voiceId: string, note: number, t: number, source: "live-left" | "live-right" | "preview" = "live-right") =>
      engine.dispatch([{ kind: "note-on", voiceId, source, sourceId: source, trackId: "t", note, velocity: 80, audioTimeSec: t }]);
    const off = (voiceId: string, t: number, reason: "key" | "loss" | "stop" = "key", source: "live-left" | "live-right" = "live-right") =>
      engine.dispatch([{ kind: "voice-release", voiceId, source, reason, audioTimeSec: t }]);
    const at = (t: number, fn: () => void) => ctx.suspend(t).then(() => { fn(); return ctx.resume(); });

    switch (scenario) {
      case "key-release":
        on("a", 69, 0);
        void at(0.5, () => off("a", 0.5));
        break;
      case "identical-pitch":
        on("left", 69, 0, "live-left");
        on("right", 69, 0, "live-right");
        void at(0.5, () => off("left", 0.5, "key", "live-left"));
        break;
      case "forced-loss":
        on("a", 69, 0);
        void at(0.5, () => off("a", 0.5, "loss"));
        break;
      case "lease-stall":
        engine.setLeaseMode("live-right", "camera");
        engine.renewLease("live-right", 0);
        on("a", 69, 0);
        // No more renewals: the main thread is "stalled". No release is ever sent.
        break;
      case "lease-renewed":
        engine.setLeaseMode("live-right", "camera");
        engine.renewLease("live-right", 0);
        on("a", 69, 0);
        void at(0.1, () => engine.renewLease("live-right", 0.1));
        break;
      case "lease-renewed-during-fade":
        engine.setLeaseMode("live-right", "camera");
        engine.renewLease("live-right", 0);
        on("a", 69, 0);
        // Renewed while the safety gain is already fading (between 180 and 200 ms).
        void at(0.19, () => engine.renewLease("live-right", 0.19));
        break;
      case "lease-off":
        engine.setLeaseMode("live-right", "off");
        on("a", 69, 0);
        break;
      case "steal":
        for (let i = 0; i < 130; i++) on(`v${String(i).padStart(3, "0")}`, 48 + (i % 40), 0);
        break;
      case "panic":
        on("a", 69, 0);
        on("b", 72, 0, "live-left");
        void at(0.5, () => engine.panic(0.5));
        break;
    }
    const out = await ctx.startRendering();
    const x = out.getChannelData(0);
    const rms = (a: number, b: number) => {
      let s = 0;
      const i0 = Math.floor(a * SR), i1 = Math.floor(b * SR);
      for (let i = i0; i < i1; i++) s += x[i]! * x[i]!;
      return Math.sqrt(s / (i1 - i0));
    };
    let maxStep = 0;
    for (let i = 1; i < x.length; i++) maxStep = Math.max(maxStep, Math.abs(x[i]! - x[i - 1]!));
    let peak = 0;
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]!));
    return {
      early: rms(0.05, 0.15),
      beforeRelease: rms(0.3, 0.45),
      at190: rms(0.17, 0.19),
      after210: rms(0.21, 0.3),
      after320: rms(0.32, 0.45),
      after530: rms(0.53, 0.6),
      late: rms(1.2, 1.45),
      maxStep,
      peak,
      stolen,
      activeVoices: engine.activeVoiceCount(),
    };
  }, scenario);
}

const SILENT = 1e-4;

test("a key release decays smoothly to silence", async ({ page }) => {
  const r = await render(page, "key-release");
  expect(r.beforeRelease).toBeGreaterThan(0.05);
  expect(r.late).toBeLessThan(SILENT);
  expect(r.maxStep).toBeLessThan(0.1); // no click-sized discontinuities
});

test("releasing one owner's copy of a pitch leaves the other sounding", async ({ page }) => {
  const r = await render(page, "identical-pitch");
  expect(r.after530 as number).toBeGreaterThan((r.beforeRelease as number) * 0.3);
  expect(r.late as number).toBeGreaterThan(0.01);
});

test("a forced loss release is silent within 30 ms, without a click", async ({ page }) => {
  const r = await render(page, "forced-loss");
  expect(r.after530).toBeLessThan(SILENT);
  expect(r.maxStep).toBeLessThan(0.1);
});

test("an unrenewed camera lease silences the lane by 200 ms even with no release and a stalled main thread", async ({ page }) => {
  const r = await render(page, "lease-stall");
  expect(r.early).toBeGreaterThan(0.05);
  expect(r.at190).toBeGreaterThan(0);
  expect(r.after210).toBeLessThan(SILENT);
  expect(r.late).toBeLessThan(SILENT);
  expect(r.maxStep).toBeLessThan(0.1);
});

test("renewing the lease extends sound until 200 ms after the latest observation", async ({ page }) => {
  const r = await render(page, "lease-renewed");
  expect(r.after210).toBeGreaterThan(0.05);
  expect(r.after320).toBeLessThan(SILENT);
});

test("a renewal during the lease fade recovers without a click", async ({ page }) => {
  const r = await render(page, "lease-renewed-during-fade");
  expect(r.after210).toBeGreaterThan(0.05);
  expect(r.maxStep).toBeLessThan(0.1);
});

test("keyboard lanes are not subject to the camera lease", async ({ page }) => {
  const r = await render(page, "lease-off");
  expect(r.late).toBeGreaterThan(0.05);
});

test("at the 128-voice limit the oldest voice is stolen and reported", async ({ page }) => {
  const r = await render(page, "steal");
  expect(r.activeVoices).toBeLessThanOrEqual(128);
  expect(r.stolen).toEqual(["v000", "v001"]);
});

test("panic stops every lane within 30 ms", async ({ page }) => {
  const r = await render(page, "panic");
  expect(r.beforeRelease).toBeGreaterThan(0.05);
  expect(r.after530).toBeLessThan(SILENT);
});

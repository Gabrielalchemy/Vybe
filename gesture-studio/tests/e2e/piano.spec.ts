import { expect, test } from "@playwright/test";

test("every piano key A0-C8 sounds near its pitch, and loud is louder than soft", { tag: "@dev" }, async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const urls = {
      engine: "/src/runtime/audio/audioEngine.ts",
      bank: "/src/runtime/audio/pianoBank.ts",
      manifest: "/src/runtime/assets/manifest.ts",
      loader: "/src/runtime/assets/assetLoader.ts",
    };
    const { AudioEngine }: typeof import("../../src/runtime/audio/audioEngine") = await import(/* @vite-ignore */ urls.engine);
    const { loadGrandPiano, DECODED_BUDGET_BYTES }: typeof import("../../src/runtime/audio/pianoBank") = await import(/* @vite-ignore */ urls.bank);
    const { loadManifest }: typeof import("../../src/runtime/assets/manifest") = await import(/* @vite-ignore */ urls.manifest);
    const { createAssetLoader }: typeof import("../../src/runtime/assets/assetLoader") = await import(/* @vite-ignore */ urls.loader);
    const SR = 48000;
    const STEP = 0.25;
    const notes = Array.from({ length: 88 }, (_, i) => 21 + i);
    const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: Math.ceil(SR * (notes.length * STEP + 2 * STEP + 1)), sampleRate: SR });
    const manifest = await loadManifest();
    if (!manifest.ok) return { error: manifest.error };
    const piano = await loadGrandPiano(ctx, manifest.value, createAssetLoader({ baseUrl: "/assets/", fetch: (a, b) => fetch(a, b) }), {
      budgetAvailableBytes: DECODED_BUDGET_BYTES,
      onProgress: () => undefined,
    });
    if (!piano.ok) return { error: piano.error.message };
    const engine = new AudioEngine(ctx, { instrument: piano.value.voices });
    const ev = (id: string, note: number, velocity: number, t: number) => {
      engine.dispatch([{ kind: "note-on", voiceId: id, source: "preview", sourceId: "p", trackId: "t", note, velocity, audioTimeSec: t }]);
    };
    // Each key for 0.2 s with a forced release, then a soft and a loud C4.
    notes.forEach((n, i) => ev(`n${n}`, n, 80, i * STEP));
    const tSoft = notes.length * STEP;
    ev("soft", 60, 48, tSoft);
    ev("loud", 60, 112, tSoft + STEP);
    const releaseAt = (id: string, t: number) => ctx.suspend(t).then(() => {
      engine.dispatch([{ kind: "voice-release", voiceId: id, source: "preview", reason: "stop", audioTimeSec: t }]);
      return ctx.resume();
    });
    notes.forEach((n, i) => void releaseAt(`n${n}`, i * STEP + 0.2));
    void releaseAt("soft", tSoft + 0.2);
    const out = await ctx.startRendering();
    const x = out.getChannelData(0);
    const seg = (t: number, d: number) => x.subarray(Math.floor(t * SR), Math.floor((t + d) * SR));
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    // Pitch by autocorrelation over a plausible lag range around the expected period.
    const pitch = (a: Float32Array, expectedHz: number) => {
      const minLag = Math.floor(SR / (expectedHz * 1.12));
      const maxLag = Math.ceil(SR / (expectedHz / 1.12));
      const ac = (lag: number) => {
        let s = 0;
        for (let i = 0; i + lag < a.length; i++) s += a[i]! * a[i + lag]!;
        return s / (a.length - lag);
      };
      let best = -Infinity, bestLag = minLag;
      for (let lag = minLag; lag <= maxLag; lag++) {
        const v = ac(lag);
        if (v > best) { best = v; bestLag = lag; }
      }
      // Parabolic interpolation for sub-sample lag resolution.
      const y0 = ac(bestLag - 1), y1 = best, y2 = ac(bestLag + 1);
      const denom = y0 - 2 * y1 + y2;
      const shift = denom === 0 ? 0 : (0.5 * (y0 - y2)) / denom;
      return SR / (bestLag + shift);
    };
    const perNote = notes.map((n, i) => {
      const a = seg(i * STEP + 0.04, 0.12);
      const hz = 440 * 2 ** ((n - 69) / 12);
      return { n, rms: rms(a), cents: n >= 40 && n <= 96 ? 1200 * Math.log2(pitch(a, hz) / hz) : 0 };
    });
    return {
      table: perNote.filter((p) => p.n >= 40 && p.n <= 96).map((p) => `${p.n}:${p.cents.toFixed(0)}`).join(" "),
      quietest: Math.min(...perNote.map((p) => p.rms)),
      worstCents: Math.max(...perNote.map((p) => Math.abs(p.cents))),
      worstNote: perNote.reduce((w, p) => (Math.abs(p.cents) > Math.abs(w.cents) ? p : w)).n,
      soft: rms(seg(tSoft + 0.02, 0.1)),
      loud: rms(seg(tSoft + STEP + 0.02, 0.1)),
      decodedMb: piano.value.decodedBytes / 2 ** 20,
    };
  });
  expect(r).not.toHaveProperty("error");
  console.log(`cents by note: ${r.table as string}`);
  expect(r.quietest as number).toBeGreaterThan(0.002);
  // Autocorrelation at 48 kHz has ~±15 cents resolution at the top; recordings are tuned to A440.
  expect(r.worstCents as number).toBeLessThan(25);
  expect(r.loud as number).toBeGreaterThan((r.soft as number) * 1.5);
  expect(r.decodedMb as number).toBeLessThan(512);
  console.log(`piano render: quietest ${(r.quietest as number).toFixed(4)}, worst ${(r.worstCents as number).toFixed(1)} cents at ${r.worstNote}, soft ${(r.soft as number).toFixed(3)} loud ${(r.loud as number).toFixed(3)}, ${(r.decodedMb as number).toFixed(0)} MiB`);
});

test("sound never starts on page load; Start sound loads the grand piano", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.locator(".shell__status")).toContainText("Sound off");
  await page.getByRole("button", { name: "Start sound" }).click();
  await expect(page.locator(".shell__status")).toContainText("Sound on · Grand piano", { timeout: 90_000 });
  // A held key is a sounding voice in the engine.
  await page.keyboard.down("KeyA");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog").getByText(/^1 of 128$/)).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Close" }).click();
  await page.keyboard.up("KeyA");
});

test("a missing piano sample fails the instrument visibly, with no substitute sound", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route("**/assets/piano/C4-v10.flac", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  await page.getByRole("button", { name: "Start sound" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /^✕ Grand piano samples did not load \(.*\)\. Retry loading\./ })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".shell__status")).toContainText("Sound problem");
  await expect(page.locator(".shell__status")).not.toContainText("Sound on");
  await expect(page.getByRole("button", { name: "Retry loading" })).toBeVisible();
});

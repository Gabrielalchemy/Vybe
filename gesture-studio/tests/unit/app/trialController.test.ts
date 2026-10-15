import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { SessionController } from "../../../src/app/sessionController";
import { TrialController, TRIALS_PREF } from "../../../src/app/trialController";
import { FACTORY_SCENES } from "../../../src/domain/presets";
import { DUPLICATE_WINDOW_MS, FEEDBACK_MS } from "../../../src/domain/trials/trialSession";
import { openRepository, type ProjectRepository } from "../../../src/persistence/indexedDbRepository";

let now = 0;
let ticks: (() => void)[] = [];
let session: SessionController;
let repo: ProjectRepository;
let trials: TrialController;
let handActive = true;

beforeEach(async () => {
  now = 0;
  ticks = [];
  handActive = true;
  session = new SessionController({ sink: { dispatch: () => undefined }, nowSec: () => now / 1000, nowMs: () => now, newId: (() => { let n = 0; return () => `id${++n}`; })() });
  session.loadScene(FACTORY_SCENES.pop);
  const opened = await openRepository({ factory: new IDBFactory(), nowIso: () => "2026-10-12T20:00:00.000Z" });
  if (!opened.ok) throw new Error("repo");
  repo = opened.value;
  trials = new TrialController({
    session,
    repo: Promise.resolve(opened),
    nowMs: () => now,
    nowIso: () => "2026-10-12T20:00:00.000Z",
    every: (_ms, fn) => { ticks.push(fn); return () => undefined; },
    environment: () => ({ handControlActive: handActive, browser: "Chrome/155", delegate: "GPU", calibratedAt: "2026-10-12T19:00:00.000Z", camera: "HP HD Camera 1280x720 @30", outputLatencyMs: 12 }),
    seed: () => 42,
    cursorFor: (hand) => (hand === "left" ? { x: 0.3, y: 0.2 } : { x: 0.6, y: 0.6 }),
  });
});

const tick = (ms: number) => {
  now += ms;
  ticks.forEach((t) => t());
};
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

function pinchPrompt(correct: boolean) {
  const p = trials.snapshot().running?.prompt;
  if (!p) throw new Error("no prompt");
  session.armCamera(p.hand);
  now += 300;
  const other = p.hand === "left" ? "chord-slot-1" : "melody-pc-11";
  const target = correct ? p.targetId : p.targetId === other ? (p.hand === "left" ? "chord-slot-2" : "melody-pc-10") : other;
  session.press(p.hand, target, "camera");
  now += 100;
  session.release(p.hand, "camera");
  tick(DUPLICATE_WINDOW_MS);
  tick(FEEDBACK_MS);
}

describe("TrialController", () => {
  it("refuses to start unless hand control is active", () => {
    handActive = false;
    trials.startAccuracy({ attempts: 10, conditions: "lamp" });
    expect(trials.snapshot()).toMatchObject({ running: null, message: expect.stringMatching(/Start playing/) });
  });

  it("prompts only filled chord pads and melody keys, scores camera pinches, and saves the finished session", async () => {
    trials.startAccuracy({ attempts: 4, conditions: "desk lamp, built-in speakers" });
    const prompts: string[] = [];
    for (let i = 0; i < 4; i++) {
      prompts.push(trials.snapshot().running!.prompt!.targetId);
      pinchPrompt(i !== 2);
    }
    await settle();
    expect(prompts.every((t) => /^melody-pc-\d+$/.test(t) || ["chord-slot-0", "chord-slot-1", "chord-slot-2", "chord-slot-3"].includes(t))).toBe(true);
    const snap = trials.snapshot();
    expect(snap.running).toBeNull();
    expect(snap.last?.summary).toMatchObject({ kind: "accuracy", attempts: 4, correct: 3, wrong: 1 });
    expect(snap.totals).toMatchObject({ sessions: 1, attempts: 4, correct: 3, wrong: 1, missed: 0, duplicates: 0 });
    const saved = await repo.getPreference(TRIALS_PREF);
    expect(saved.ok && Array.isArray(saved.value) && saved.value[0].attempts[0].cursor).toEqual(
      prompts[0]!.startsWith("chord") ? { x: 0.3, y: 0.2 } : { x: 0.6, y: 0.6 },
    );
    expect(saved.ok && Array.isArray(saved.value) && saved.value[0]).toMatchObject({
      kind: "accuracy",
      conditions: "desk lamp, built-in speakers",
      environment: { delegate: "GPU", calibratedAt: "2026-10-12T19:00:00.000Z" },
      seed: 42,
    });
  });

  it("keyboard presses never count in a trial", () => {
    trials.startAccuracy({ attempts: 2, conditions: "" });
    const p = trials.snapshot().running!.prompt!;
    session.press(p.hand, p.targetId, "keyboard");
    session.release(p.hand, "keyboard");
    tick(DUPLICATE_WINDOW_MS);
    expect(trials.snapshot().running!.prompt!.index).toBe(0);
  });

  it("runs the neutral-movement test and counts sounded notes", async () => {
    trials.startNeutral({ durationMs: 1000, conditions: "evening" });
    session.armCamera("left");
    session.press("left", "chord-slot-0", "camera");
    session.release("left", "camera");
    session.press("left", "chord-slot-7", "camera"); // empty pad: silent
    tick(1000);
    await settle();
    expect(trials.snapshot().last?.summary).toEqual({ kind: "neutral", durationMs: 1000, accidentalNotes: 1, accidentalAttempts: 2 });
  });

  it("stopping early saves nothing and leaves totals unchanged", async () => {
    trials.startAccuracy({ attempts: 5, conditions: "" });
    pinchPrompt(true);
    trials.stop();
    await settle();
    expect(trials.snapshot()).toMatchObject({ running: null, totals: { sessions: 0, attempts: 0 } });
  });

  it("accumulates totals across saved sessions, including after reload", async () => {
    trials.startAccuracy({ attempts: 2, conditions: "" });
    pinchPrompt(true);
    pinchPrompt(true);
    await settle();
    trials.startAccuracy({ attempts: 2, conditions: "" });
    pinchPrompt(true);
    pinchPrompt(false);
    await settle();
    const reloaded = new TrialController({
      session,
      repo: Promise.resolve({ ok: true as const, value: repo }),
      nowMs: () => now,
      nowIso: () => "x",
      every: () => () => undefined,
      environment: () => ({ handControlActive: true, browser: "", delegate: null, calibratedAt: null, camera: null, outputLatencyMs: null }),
      seed: () => 1,
    });
    await reloaded.load();
    expect(reloaded.snapshot().totals).toMatchObject({ sessions: 2, attempts: 4, correct: 3, wrong: 1 });
  });

  it("shows the scored attempt as feedback before the next prompt", () => {
    trials.startAccuracy({ attempts: 3, conditions: "" });
    const p = trials.snapshot().running!.prompt!;
    session.armCamera(p.hand);
    now += 400;
    session.press(p.hand, p.targetId, "camera");
    now += 100;
    session.release(p.hand, "camera");
    tick(DUPLICATE_WINDOW_MS);
    expect(trials.snapshot().running).toMatchObject({ prompt: null, feedback: { result: "correct", intendedTargetId: p.targetId } });
    tick(FEEDBACK_MS);
    expect(trials.snapshot().running).toMatchObject({ feedback: null, prompt: { index: 1 } });
  });
});


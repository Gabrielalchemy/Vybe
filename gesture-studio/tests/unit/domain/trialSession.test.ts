import { describe, expect, it } from "vitest";
import { ANTICIPATION_MS, DUPLICATE_WINDOW_MS, FEEDBACK_MS, PROMPT_TIMEOUT_MS, TrialSession, buildPrompts, type TrialInput } from "../../../src/domain/trials/trialSession";

const press = (hand: "left" | "right", targetId: string | null, atMs: number): Extract<TrialInput, { kind: "press" }> => ({ kind: "press", hand, targetId, atMs, input: "camera" });
const release = (hand: "left" | "right", atMs: number): TrialInput => ({ kind: "release", hand, atMs, input: "camera" });

describe("buildPrompts", () => {
  it("is deterministic for a seed, balanced across hands, and skips empty chord pads", () => {
    const a = buildPrompts({ count: 40, seed: 7, filledChordSlots: [0, 1, 2, 3] });
    const b = buildPrompts({ count: 40, seed: 7, filledChordSlots: [0, 1, 2, 3] });
    expect(a).toEqual(b);
    expect(a.filter((p) => p.hand === "left")).toHaveLength(20);
    expect(a.every((p) => p.hand === "right" || ["chord-slot-0", "chord-slot-1", "chord-slot-2", "chord-slot-3"].includes(p.targetId))).toBe(true);
    expect(new Set(a.filter((p) => p.hand === "right").map((p) => p.targetId)).size).toBe(12);
    expect(buildPrompts({ count: 40, seed: 8, filledChordSlots: [0, 1, 2, 3] })).not.toEqual(a);
  });
});

function session(prompts = [{ hand: "right" as const, targetId: "melody-pc-4" }, { hand: "left" as const, targetId: "chord-slot-1" }]) {
  return new TrialSession({ prompts, startMs: 0 });
}

describe("accuracy trial scoring", () => {
  it("scores a correct press, then advances after the duplicate window", () => {
    const s = session();
    s.input(press("right", "melody-pc-4", 500));
    s.input(release("right", 700));
    expect(s.current()?.index).toBe(0);
    s.tick(700 + DUPLICATE_WINDOW_MS);
    s.tick(700 + DUPLICATE_WINDOW_MS + FEEDBACK_MS);
    expect(s.current()).toMatchObject({ index: 1, hand: "left", targetId: "chord-slot-1" });
    expect(s.attempts()[0]).toMatchObject({ result: "correct", observedTargetId: "melody-pc-4", responseMs: 500, duplicates: 0 });
  });

  it("scores a wrong target, including closing over a gap", () => {
    const s = session();
    s.input(press("right", "melody-pc-5", 300));
    s.input(release("right", 400));
    s.tick(400 + DUPLICATE_WINDOW_MS);
    const next = 400 + DUPLICATE_WINDOW_MS + FEEDBACK_MS;
    s.tick(next);
    s.input(press("left", null, next + 500));
    s.input(release("left", next + 600));
    s.tick(next + 600 + DUPLICATE_WINDOW_MS);
    expect(s.attempts().map((a) => [a.result, a.observedTargetId])).toEqual([["wrong", "melody-pc-5"], ["wrong", null]]);
    expect(s.finished()).toBe(true);
  });

  it("counts an extra press right after the release as a duplicate of that attempt", () => {
    const s = session();
    s.input(press("right", "melody-pc-4", 300));
    s.input(release("right", 400));
    s.input(press("right", "melody-pc-4", 450));
    s.input(release("right", 500));
    s.tick(500 + DUPLICATE_WINDOW_MS);
    expect(s.attempts()[0]).toMatchObject({ result: "correct", duplicates: 1 });
    const sum = s.summary();
    expect(sum.kind === "accuracy" && sum.duplicates).toBe(1);
  });

  it("scores missed after the prompt timeout and moves on", () => {
    const s = session();
    s.tick(PROMPT_TIMEOUT_MS + 1);
    expect(s.attempts()[0]).toMatchObject({ result: "missed", observedTargetId: null });
    s.tick(PROMPT_TIMEOUT_MS + 1 + FEEDBACK_MS);
    expect(s.current()?.index).toBe(1);
  });

  it("counts presses by the other hand separately and does not score them", () => {
    const s = session();
    s.input(press("left", "chord-slot-0", 200));
    s.input(release("left", 300));
    expect(s.current()?.index).toBe(0);
    s.input(press("right", "melody-pc-4", 400));
    s.input(release("right", 500));
    s.tick(500 + DUPLICATE_WINDOW_MS);
    expect(s.attempts()[0]).toMatchObject({ result: "correct", otherHandPresses: 1 });
    const sum = s.summary();
    expect(sum.kind === "accuracy" && sum.otherHandPresses).toBe(1);
  });

  it("ignores keyboard and pointer input", () => {
    const s = session();
    s.input({ ...press("right", "melody-pc-4", 100), input: "keyboard" });
    s.tick(100 + DUPLICATE_WINDOW_MS);
    expect(s.attempts()).toEqual([]);
  });

  it("summarises counts by category and by hand", () => {
    const s = session();
    s.input(press("right", "melody-pc-4", 100));
    s.input(release("right", 200));
    s.tick(200 + DUPLICATE_WINDOW_MS);
    s.tick(200 + DUPLICATE_WINDOW_MS + FEEDBACK_MS);
    s.tick(200 + DUPLICATE_WINDOW_MS + FEEDBACK_MS + PROMPT_TIMEOUT_MS + 1);
    expect(s.summary()).toMatchObject({
      attempts: 2,
      correct: 1,
      wrong: 0,
      missed: 1,
      duplicates: 0,
      correctRate: 0.5,
      byHand: { right: { attempts: 1, correct: 1 }, left: { attempts: 1, missed: 1 } },
    });
  });

  it("can be stopped early, keeping completed attempts only", () => {
    const s = session();
    s.input(press("right", "melody-pc-4", 100));
    s.stop();
    expect(s.finished()).toBe(true);
    expect(s.attempts()).toEqual([]);
  });
});

describe("neutral-movement test", () => {
  it("counts every camera press as an accidental note until the duration ends", () => {
    const s = TrialSession.neutral({ durationMs: 300_000, startMs: 0 });
    s.input(press("left", "chord-slot-2", 10_000));
    s.input(release("left", 10_200));
    s.input(press("right", null, 20_000));
    s.tick(299_999);
    expect(s.finished()).toBe(false);
    s.tick(300_000);
    expect(s.finished()).toBe(true);
    s.input(press("right", "melody-pc-0", 310_000));
    expect(s.summary()).toMatchObject({ accidentalNotes: 1, accidentalAttempts: 2, durationMs: 300_000 });
  });
});

describe("feedback pause between attempts", () => {
  const two = () => new TrialSession({ prompts: [{ hand: "left", targetId: "chord-slot-3" }, { hand: "left", targetId: "chord-slot-0" }], startMs: 0 });

  it("shows the result of an attempt for FEEDBACK_MS before the next prompt appears", () => {
    const s = two();
    s.input(press("left", "chord-slot-2", 1000));
    s.input(release("left", 1200));
    s.tick(1200 + DUPLICATE_WINDOW_MS);
    expect(s.current()).toBeNull();
    expect(s.feedback()).toMatchObject({ intendedTargetId: "chord-slot-3", observedTargetId: "chord-slot-2", result: "wrong" });
    s.tick(1200 + DUPLICATE_WINDOW_MS + FEEDBACK_MS);
    expect(s.feedback()).toBeNull();
    expect(s.current()).toMatchObject({ index: 1, targetId: "chord-slot-0" });
  });

  it("does not score a correction made during the feedback pause against the next prompt", () => {
    const s = two();
    s.input(press("left", "chord-slot-2", 1000));
    s.input(release("left", 1200));
    const shown = 1200 + DUPLICATE_WINDOW_MS;
    s.tick(shown);
    s.input(press("left", "chord-slot-3", shown + 300)); // re-trying the previous target
    s.input(release("left", shown + 500));
    s.tick(shown + FEEDBACK_MS);
    s.input(press("left", "chord-slot-0", shown + FEEDBACK_MS + 900));
    s.input(release("left", shown + FEEDBACK_MS + 1000));
    s.tick(shown + FEEDBACK_MS + 1000 + DUPLICATE_WINDOW_MS);
    expect(s.attempts().map((a) => a.result)).toEqual(["wrong", "correct"]);
    expect(s.attempts()[1]).toMatchObject({ responseMs: 900 });
    const sum = s.summary();
    expect(sum.kind === "accuracy" && sum.betweenAttemptPresses).toBe(1);
  });

  it("flags a press faster than human reaction as anticipatory", () => {
    const s = two();
    s.input(press("left", "chord-slot-3", ANTICIPATION_MS - 1));
    s.input(release("left", 300));
    s.tick(300 + DUPLICATE_WINDOW_MS);
    expect(s.attempts()[0]).toMatchObject({ result: "correct", anticipatory: true });
    const sum = s.summary();
    expect(sum.kind === "accuracy" && sum.anticipatory).toBe(1);
  });

  it("keeps the cursor position reported with a press", () => {
    const s = two();
    s.input({ ...press("left", "chord-slot-2", 1000), cursor: { x: 0.52, y: 0.21 } });
    s.input(release("left", 1100));
    s.tick(1100 + DUPLICATE_WINDOW_MS);
    expect(s.attempts()[0]).toMatchObject({ cursor: { x: 0.52, y: 0.21 } });
  });
});


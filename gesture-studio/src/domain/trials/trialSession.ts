import type { HandRole } from "../events";

/**
 * Instrument-gate trials (PRD §6): prompted accuracy attempts with intended
 * versus observed targets, and a timed neutral-movement test for accidental
 * notes. Only camera input is scored. Pure; timestamps are main-thread ms.
 */

export const PROMPT_TIMEOUT_MS = 8000;
/** A press on the prompted hand this soon after the release is a duplicate trigger. */
export const DUPLICATE_WINDOW_MS = 400;

export interface Prompt {
  hand: HandRole;
  targetId: string;
}

type InputKind = "camera" | "keyboard" | "pointer" | "simulator";

export type TrialInput =
  | {
      kind: "press";
      hand: HandRole;
      targetId: string | null;
      atMs: number;
      input: InputKind;
      /** Whether the press produced sound; defaults to "had a target". */
      sounded?: boolean;
    }
  | { kind: "release"; hand: HandRole; atMs: number; input: InputKind };

export type AttemptResult = "correct" | "wrong" | "missed";

export interface Attempt {
  index: number;
  hand: HandRole;
  intendedTargetId: string;
  observedTargetId: string | null;
  result: AttemptResult;
  /** Prompt shown to press, ms; null when missed. */
  responseMs: number | null;
  duplicates: number;
  otherHandPresses: number;
}

interface HandCounts {
  attempts: number;
  correct: number;
  wrong: number;
  missed: number;
  duplicates: number;
}

export interface AccuracySummary {
  kind: "accuracy";
  attempts: number;
  correct: number;
  wrong: number;
  missed: number;
  duplicates: number;
  otherHandPresses: number;
  correctRate: number | null;
  byHand: Record<HandRole, HandCounts>;
}

export interface NeutralSummary {
  kind: "neutral";
  durationMs: number;
  /** Presses that produced sound. */
  accidentalNotes: number;
  /** All confirmed pinches, including silent ones over gaps. */
  accidentalAttempts: number;
}

/** Small deterministic PRNG (mulberry32) so a trial order can be reproduced from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], next: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Balanced prompts: half per hand, cycling every target in shuffled rounds, interleaved randomly. */
export function buildPrompts(opts: { count: number; seed: number; filledChordSlots: readonly number[] }): Prompt[] {
  const next = rng(opts.seed);
  const cycle = (targets: string[], n: number) => {
    const out: string[] = [];
    while (out.length < n) out.push(...shuffle(targets, next));
    return out.slice(0, n);
  };
  const leftCount = opts.filledChordSlots.length > 0 ? Math.floor(opts.count / 2) : 0;
  const left = cycle(opts.filledChordSlots.map((s) => `chord-slot-${s}`), leftCount).map((targetId) => ({ hand: "left" as const, targetId }));
  const right = cycle(Array.from({ length: 12 }, (_, pc) => `melody-pc-${pc}`), opts.count - leftCount).map((targetId) => ({ hand: "right" as const, targetId }));
  return shuffle([...left, ...right], next);
}

type Phase =
  | { kind: "waiting"; sinceMs: number }
  | { kind: "held"; sinceMs: number; observed: string | null; responseMs: number }
  | { kind: "settling"; releasedMs: number; observed: string | null; responseMs: number; extraHeld: boolean };

const emptyCounts = (): HandCounts => ({ attempts: 0, correct: 0, wrong: 0, missed: 0, duplicates: 0 });

export class TrialSession {
  readonly kind: "accuracy" | "neutral";
  private readonly prompts: readonly Prompt[];
  private index = 0;
  private phase: Phase;
  private duplicates = 0;
  private otherHand = 0;
  private readonly done: Attempt[] = [];
  private ended = false;
  // Neutral mode.
  private readonly startMs: number;
  private readonly durationMs: number;
  private neutralNotes = 0;
  private neutralAttempts = 0;

  /** An accuracy trial over `prompts`. */
  constructor(opts: { prompts: readonly Prompt[]; startMs: number } | { neutralDurationMs: number; startMs: number }) {
    this.startMs = opts.startMs;
    this.phase = { kind: "waiting", sinceMs: opts.startMs };
    if ("prompts" in opts) {
      this.kind = "accuracy";
      this.prompts = opts.prompts;
      this.durationMs = 0;
      this.ended = opts.prompts.length === 0;
    } else {
      this.kind = "neutral";
      this.prompts = [];
      this.durationMs = opts.neutralDurationMs;
    }
  }

  /** A timed neutral-movement test: every camera press counts as accidental. */
  static neutral(opts: { durationMs: number; startMs: number }): TrialSession {
    return new TrialSession({ neutralDurationMs: opts.durationMs, startMs: opts.startMs });
  }

  current(): (Prompt & { index: number; total: number }) | null {
    if (this.ended || this.kind !== "accuracy") return null;
    const p = this.prompts[this.index];
    return p ? { ...p, index: this.index, total: this.prompts.length } : null;
  }

  attempts(): readonly Attempt[] {
    return this.done;
  }

  finished(): boolean {
    return this.ended;
  }

  /** Neutral mode: remaining time. */
  remainingMs(nowMs: number): number {
    return Math.max(0, this.startMs + this.durationMs - nowMs);
  }

  input(e: TrialInput): void {
    if (this.ended || e.input !== "camera") return;
    if (this.kind === "neutral") {
      if (e.kind !== "press" || e.atMs >= this.startMs + this.durationMs) return;
      this.neutralAttempts += 1;
      if (e.sounded ?? e.targetId !== null) this.neutralNotes += 1;
      return;
    }
    const prompt = this.prompts[this.index];
    if (!prompt) return;
    if (e.hand !== prompt.hand) {
      if (e.kind === "press") this.otherHand += 1;
      return;
    }
    const p = this.phase;
    if (e.kind === "press") {
      if (p.kind === "waiting") {
        this.phase = { kind: "held", sinceMs: e.atMs, observed: e.targetId, responseMs: e.atMs - p.sinceMs };
      } else if (p.kind === "settling") {
        this.duplicates += 1;
        this.phase = { ...p, extraHeld: true };
      }
    } else if (p.kind === "held") {
      this.phase = { kind: "settling", releasedMs: e.atMs, observed: p.observed, responseMs: p.responseMs, extraHeld: false };
    } else if (p.kind === "settling" && p.extraHeld) {
      this.phase = { ...p, releasedMs: e.atMs, extraHeld: false };
    }
  }

  tick(nowMs: number): void {
    if (this.ended) return;
    if (this.kind === "neutral") {
      if (nowMs >= this.startMs + this.durationMs) this.ended = true;
      return;
    }
    const prompt = this.prompts[this.index];
    if (!prompt) return;
    const p = this.phase;
    if (p.kind === "waiting" && nowMs - p.sinceMs > PROMPT_TIMEOUT_MS) {
      this.complete(prompt, null, "missed", null, nowMs);
    } else if (p.kind === "settling" && !p.extraHeld && nowMs - p.releasedMs >= DUPLICATE_WINDOW_MS) {
      this.complete(prompt, p.observed, p.observed === prompt.targetId ? "correct" : "wrong", p.responseMs, nowMs);
    }
  }

  /** End early; an unfinished attempt is discarded. */
  stop(): void {
    this.ended = true;
  }

  summary(): AccuracySummary | NeutralSummary {
    if (this.kind === "neutral") {
      return { kind: "neutral", durationMs: this.durationMs, accidentalNotes: this.neutralNotes, accidentalAttempts: this.neutralAttempts };
    }
    const byHand: Record<HandRole, HandCounts> = { left: emptyCounts(), right: emptyCounts() };
    const total = { correct: 0, wrong: 0, missed: 0, duplicates: 0, other: 0 };
    for (const a of this.done) {
      const h = byHand[a.hand];
      h.attempts += 1;
      h[a.result] += 1;
      h.duplicates += a.duplicates;
      total[a.result] += 1;
      total.duplicates += a.duplicates;
      total.other += a.otherHandPresses;
    }
    return {
      kind: "accuracy",
      attempts: this.done.length,
      correct: total.correct,
      wrong: total.wrong,
      missed: total.missed,
      duplicates: total.duplicates,
      otherHandPresses: total.other,
      correctRate: this.done.length ? total.correct / this.done.length : null,
      byHand,
    };
  }

  private complete(prompt: Prompt, observed: string | null, result: AttemptResult, responseMs: number | null, nowMs: number): void {
    this.done.push({
      index: this.index,
      hand: prompt.hand,
      intendedTargetId: prompt.targetId,
      observedTargetId: observed,
      result,
      responseMs,
      duplicates: this.duplicates,
      otherHandPresses: this.otherHand,
    });
    this.index += 1;
    this.duplicates = 0;
    this.otherHand = 0;
    this.phase = { kind: "waiting", sinceMs: nowMs };
    if (this.index >= this.prompts.length) this.ended = true;
  }
}

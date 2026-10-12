import type { Result } from "../domain/result";
import type { StorageError } from "../domain/storageError";
import {
  TrialSession,
  buildPrompts,
  type AccuracySummary,
  type Attempt,
  type NeutralSummary,
  type Prompt,
} from "../domain/trials/trialSession";
import type { ProjectRepository } from "../persistence/indexedDbRepository";
import type { OutcomeRecord, SessionController } from "./sessionController";

export const TRIALS_PREF = "instrumentTrials";
const MAX_SAVED_TRIALS = 100;
const TICK_MS = 100;

export interface TrialEnvironment {
  handControlActive: boolean;
  browser: string;
  delegate: string | null;
  calibratedAt: string | null;
  camera: string | null;
  /** Browser estimate, not a measurement. */
  outputLatencyMs: number | null;
}

export interface SavedTrial {
  id: string;
  kind: "accuracy" | "neutral";
  startedAt: string;
  endedAt: string;
  conditions: string;
  seed: number | null;
  environment: Omit<TrialEnvironment, "handControlActive">;
  summary: AccuracySummary | NeutralSummary;
  attempts: Attempt[];
}

export interface TrialTotals {
  sessions: number;
  attempts: number;
  correct: number;
  wrong: number;
  missed: number;
  duplicates: number;
  otherHandPresses: number;
  correctRate: number | null;
  neutralSessions: number;
  accidentalNotes: number;
}

export interface TrialSnapshot {
  running: { kind: "accuracy" | "neutral"; prompt: (Prompt & { index: number; total: number }) | null; remainingMs: number | null } | null;
  last: SavedTrial | null;
  saved: readonly SavedTrial[];
  totals: TrialTotals;
  message: string | null;
  saveError: StorageError | null;
}

export interface TrialControllerDeps {
  session: SessionController;
  repo: Promise<Result<ProjectRepository, StorageError>>;
  nowMs: () => number;
  nowIso: () => string;
  every: (ms: number, fn: () => void) => () => void;
  environment: () => TrialEnvironment;
  seed: () => number;
}

function totalsOf(saved: readonly SavedTrial[]): TrialTotals {
  const t: TrialTotals = { sessions: 0, attempts: 0, correct: 0, wrong: 0, missed: 0, duplicates: 0, otherHandPresses: 0, correctRate: null, neutralSessions: 0, accidentalNotes: 0 };
  for (const s of saved) {
    if (s.summary.kind === "accuracy") {
      t.sessions += 1;
      t.attempts += s.summary.attempts;
      t.correct += s.summary.correct;
      t.wrong += s.summary.wrong;
      t.missed += s.summary.missed;
      t.duplicates += s.summary.duplicates;
      t.otherHandPresses += s.summary.otherHandPresses;
    } else {
      t.neutralSessions += 1;
      t.accidentalNotes += s.summary.accidentalNotes;
    }
  }
  t.correctRate = t.attempts ? t.correct / t.attempts : null;
  return t;
}

/**
 * Runs instrument-gate trials against live camera outcomes and stores each
 * finished session locally with its conditions. Unfinished sessions are
 * discarded, never partially counted.
 */
export class TrialController {
  private readonly deps: TrialControllerDeps;
  private trial: TrialSession | null = null;
  private meta: { startedAt: string; conditions: string; seed: number | null; environment: Omit<TrialEnvironment, "handControlActive"> } | null = null;
  private unsubscribe: (() => void) | null = null;
  private cancelTimer: (() => void) | null = null;
  private saved: SavedTrial[] = [];
  private last: SavedTrial | null = null;
  private message: string | null = null;
  private saveError: StorageError | null = null;
  private lastPublishedKey = "";
  private readonly listeners = new Set<(s: TrialSnapshot) => void>();
  private current: TrialSnapshot;

  constructor(deps: TrialControllerDeps) {
    this.deps = deps;
    this.current = this.build();
  }

  snapshot(): TrialSnapshot {
    return this.current;
  }

  subscribe(listener: (s: TrialSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  /** Load previously saved sessions. */
  async load(): Promise<void> {
    const repo = await this.deps.repo;
    if (!repo.ok) return;
    const stored = await repo.value.getPreference(TRIALS_PREF);
    if (stored.ok && Array.isArray(stored.value)) this.saved = stored.value as SavedTrial[];
    this.publish();
  }

  startAccuracy(opts: { attempts: number; conditions: string }): void {
    if (!this.canStart()) return;
    const seed = this.deps.seed();
    const filled = (this.deps.session.peek()?.chordSlots ?? []).flatMap((pad, i) => (pad ? [i] : []));
    const prompts = buildPrompts({ count: opts.attempts, seed, filledChordSlots: filled });
    this.begin(new TrialSession({ prompts, startMs: this.deps.nowMs() }), opts.conditions, seed);
  }

  startNeutral(opts: { durationMs: number; conditions: string }): void {
    if (!this.canStart()) return;
    this.begin(TrialSession.neutral({ durationMs: opts.durationMs, startMs: this.deps.nowMs() }), opts.conditions, null);
  }

  /** Stop early: nothing from this session is saved. */
  stop(): void {
    this.trial?.stop();
    this.teardown();
    this.message = "Trial stopped. Nothing from it was saved.";
    this.publish();
  }

  /** All saved sessions as JSON, for the dated evidence file. */
  exportJson(): string {
    return JSON.stringify({ exportedAt: this.deps.nowIso(), totals: totalsOf(this.saved), sessions: this.saved }, null, 2);
  }

  private canStart(): boolean {
    if (this.trial) return false;
    if (!this.deps.environment().handControlActive) {
      this.message = "Turn the camera on, calibrate and press Start playing before running a trial.";
      this.publish();
      return false;
    }
    return true;
  }

  private begin(trial: TrialSession, conditions: string, seed: number | null): void {
    const { handControlActive: _active, ...environment } = this.deps.environment();
    void _active;
    this.trial = trial;
    this.meta = { startedAt: this.deps.nowIso(), conditions, seed, environment };
    this.message = null;
    this.unsubscribe = this.deps.session.onOutcome((o) => this.onOutcome(o));
    this.cancelTimer = this.deps.every(TICK_MS, () => this.onTick());
    this.publish();
  }

  private onOutcome(o: OutcomeRecord): void {
    const trial = this.trial;
    if (!trial) return;
    if (o.action === "press" && (o.status === "sounded" || o.status === "silent")) {
      trial.input({ kind: "press", hand: o.hand, targetId: o.targetId, atMs: o.atMs, input: o.input, sounded: o.status === "sounded" });
    } else if (o.action === "release" && o.status === "released") {
      trial.input({ kind: "release", hand: o.hand, atMs: o.atMs, input: o.input });
    }
  }

  private onTick(): void {
    const trial = this.trial;
    if (!trial) return;
    trial.tick(this.deps.nowMs());
    if (trial.finished()) {
      void this.finish(trial);
      return;
    }
    this.publish();
  }

  private async finish(trial: TrialSession): Promise<void> {
    const meta = this.meta;
    this.teardown();
    if (!meta) return;
    const record: SavedTrial = {
      id: `${meta.startedAt}-${trial.kind}`,
      kind: trial.kind,
      startedAt: meta.startedAt,
      endedAt: this.deps.nowIso(),
      conditions: meta.conditions,
      seed: meta.seed,
      environment: meta.environment,
      summary: trial.summary(),
      attempts: [...trial.attempts()],
    };
    this.saved = [...this.saved, record].slice(-MAX_SAVED_TRIALS);
    this.last = record;
    this.publish();
    const repo = await this.deps.repo;
    const result = repo.ok ? await repo.value.setPreference(TRIALS_PREF, this.saved) : repo;
    this.saveError = result.ok ? null : result.error;
    this.publish();
  }

  private teardown(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.trial = null;
    this.meta = null;
  }

  private build(): TrialSnapshot {
    const t = this.trial;
    const now = this.deps.nowMs();
    return Object.freeze({
      running: t ? { kind: t.kind, prompt: t.current(), remainingMs: t.kind === "neutral" ? t.remainingMs(now) : null } : null,
      last: this.last,
      saved: this.saved,
      totals: totalsOf(this.saved),
      message: this.message,
      saveError: this.saveError,
    });
  }

  private publish(): void {
    const next = this.build();
    // Neutral countdown: publish at most once per displayed second.
    const key = JSON.stringify([next.running?.kind, next.running?.prompt?.index, next.running?.remainingMs !== null && next.running ? Math.ceil((next.running.remainingMs ?? 0) / 1000) : null, this.saved.length, this.message, this.saveError?.code]);
    this.current = next;
    if (key === this.lastPublishedKey) return;
    this.lastPublishedKey = key;
    for (const l of this.listeners) {
      try {
        l(next);
      } catch (error) {
        console.error("Trial listener failed", error);
      }
    }
  }
}

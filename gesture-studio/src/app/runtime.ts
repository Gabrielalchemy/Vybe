import type { PerformanceEvent } from "../domain/events";
import { openRepository } from "../persistence/indexedDbRepository";
import { ProjectSession } from "./projectSession";
import { SessionController, type PerformanceSink } from "./sessionController";

const MAX_LOGGED_EVENTS = 200;

/**
 * Phase 2 sink: there is no audio engine yet, so events are recorded for the
 * diagnostics view only. The UI states plainly that sound is not available.
 */
export class DiagnosticEventLog implements PerformanceSink {
  private events: PerformanceEvent[] = [];
  private readonly listeners = new Set<() => void>();

  dispatch(events: readonly PerformanceEvent[]): void {
    this.events = [...this.events, ...events].slice(-MAX_LOGGED_EVENTS);
    for (const l of this.listeners) l();
  }

  recent(): readonly PerformanceEvent[] {
    return this.events;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export interface AppRuntime {
  session: SessionController;
  eventLog: DiagnosticEventLog;
  project: Promise<ProjectSession>;
  /** Session clock origin; there is no AudioContext before Phase 4. */
  clock: "session-monotonic";
}

const randomId = () => crypto.randomUUID();

export function createAppRuntime(): AppRuntime {
  const eventLog = new DiagnosticEventLog();
  const session = new SessionController({
    sink: eventLog,
    nowSec: () => performance.now() / 1000,
    nowMs: () => performance.now(),
    newId: randomId,
  });
  const nowIso = () => new Date().toISOString();
  const project = openRepository({ factory: globalThis.indexedDB, nowIso }).then((repo) =>
    ProjectSession.open({ repo, nowIso, newId: randomId }),
  );
  void project.then((p) => {
    const { scene } = p.state().project;
    session.loadScene({ ...scene, id: scene.sourcePresetId, name: "" });
  });
  return { session, eventLog, project, clock: "session-monotonic" };
}

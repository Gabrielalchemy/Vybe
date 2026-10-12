import type { PerformanceEvent } from "../domain/events";
import { openRepository } from "../persistence/indexedDbRepository";
import { BrowserTrackingSource } from "../runtime/tracking/browserTrackingSource";
import { AudioRuntime } from "./audioRuntime";
import { HandControl } from "./handControl";
import { ProjectSession } from "./projectSession";
import { SessionController, type PerformanceSink } from "./sessionController";

const MAX_LOGGED_EVENTS = 200;

/**
 * Until the audio engine exists (Phase 4), events are recorded for the
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

/** Delivers each event batch to every sink; a failing sink cannot block the others. */
class FanoutSink implements PerformanceSink {
  constructor(private readonly sinks: PerformanceSink[]) {}
  dispatch(events: readonly PerformanceEvent[]): void {
    for (const sink of this.sinks) {
      try {
        sink.dispatch(events);
      } catch (error) {
        console.error("Performance sink failed", error);
      }
    }
  }
}

export interface AppRuntime {
  session: SessionController;
  audio: AudioRuntime;
  eventLog: DiagnosticEventLog;
  project: Promise<ProjectSession>;
  handControl: HandControl;
  /** Camera preview element owned by the tracking source. */
  cameraVideo: HTMLVideoElement;
  /** Stop all: release every live voice, clear pedals, cut decaying tails. */
  stopEverything: () => void;
}

const randomId = () => crypto.randomUUID();

export function createAppRuntime(): AppRuntime {
  const eventLog = new DiagnosticEventLog();
  // The session is created first; the audio runtime calls back into it.
  let sessionRef: SessionController | null = null;
  const audio = new AudioRuntime({
    onInterrupted: () => sessionRef?.interrupt("audio-interrupted"),
    onVoiceStolen: (id) => sessionRef?.voiceStolen(id),
  });
  const session = new SessionController({
    // Audio is dispatched before the diagnostic log.
    sink: new FanoutSink([audio, eventLog]),
    // The audio clock owns musical time once sound has started.
    nowSec: () => audio.nowSec(),
    nowMs: () => performance.now(),
    newId: randomId,
  });
  sessionRef = session;
  const nowIso = () => new Date().toISOString();
  const repo = openRepository({ factory: globalThis.indexedDB, nowIso });
  const project = repo.then((r) => ProjectSession.open({ repo: r, nowIso, newId: randomId }));
  void project.then((p) => {
    const { scene } = p.state().project;
    session.loadScene({ ...scene, id: scene.sourcePresetId, name: "" });
  });
  const source = new BrowserTrackingSource();
  const handControl = new HandControl({
    session,
    repo,
    source,
    nowMs: () => performance.now(),
    nowIso,
    every: (ms, fn) => {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    },
    audio,
  });
  const stopEverything = () => {
    session.stopAll();
    audio.panic();
  };
  return { session, audio, eventLog, project, handControl, cameraVideo: source.video, stopEverything };
}

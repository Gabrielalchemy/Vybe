import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { CalibrationView } from "../features/camera/CalibrationView";
import { PlayView } from "../features/play/PlayView";
import { useKeyboardInput } from "../features/play/useKeyboardInput";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { SaveIndicator } from "../ui/SaveIndicator";
import type { AudioSnapshot } from "./audioRuntime";
import type { HandControlPhase } from "./handControl";
import type { ProjectSession, ProjectSessionState } from "./projectSession";
import type { AppRuntime } from "./runtime";

type Workspace = "play" | "practice" | "studio";

const PAUSE_TEXT = {
  hidden: "Playing paused because the page was hidden.",
  "camera-failed": "Playing paused because the camera stopped.",
  "worker-failed": "Playing paused because hand tracking stopped.",
  "audio-interrupted": "Playing paused because sound was interrupted.",
} as const;

function AUDIO_STATUS(a: AudioSnapshot): string {
  switch (a.status) {
    case "off":
      return "Sound off";
    case "starting":
      return "Sound starting…";
    case "loading":
      return `Loading grand piano ${a.loaded} of ${a.total || "…"}`;
    case "ready":
      return "Sound on · Grand piano";
    case "error":
      return "Sound problem";
    case "interrupted":
      return "Sound interrupted";
  }
}

const CAMERA_STATUS: Record<HandControlPhase, string> = {
  off: "Camera off",
  starting: "Camera starting…",
  "needs-calibration": "Camera on · calibration needed",
  calibrating: "Camera on · calibrating",
  readiness: "Camera on · readiness check",
  active: "Camera on · hand control on",
  error: "Camera problem",
};
const WORKSPACES: { id: Workspace; label: string }[] = [
  { id: "play", label: "Play" },
  { id: "practice", label: "Practice" },
  { id: "studio", label: "Studio" },
];

function useProject(runtime: AppRuntime) {
  const [project, setProject] = useState<ProjectSession | null>(null);
  const [state, setState] = useState<ProjectSessionState | null>(null);
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    runtime.project.then((p) => {
      if (cancelled) return;
      setProject(p);
      unsubscribe = p.subscribe(setState);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [runtime]);
  return { project, state };
}

export function App({ runtime }: { runtime: AppRuntime }) {
  const { session, handControl, audio, stopEverything } = runtime;
  const snapshot = useSyncExternalStore(
    (notify) => session.subscribe(() => notify()),
    () => session.peek(),
  );
  const handSnapshot = useSyncExternalStore(
    (notify) => handControl.subscribe(() => notify()),
    () => handControl.snapshot(),
  );
  const audioSnapshot = useSyncExternalStore(
    (notify) => audio.subscribe(() => notify()),
    () => audio.snapshot(),
  );
  const { project, state: projectState } = useProject(runtime);
  const [workspace, setWorkspace] = useState<Workspace>("play");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [octaveMessage, setOctaveMessage] = useState<string | null>(null);

  const changeOctave = useCallback(
    (delta: -1 | 1) => {
      const current = session.peek();
      if (!current || !project) return;
      const next = current.melodyOctave + delta;
      const result = session.setMelodyOctave(next);
      if (!result.ok) {
        setOctaveMessage(result.error);
        return;
      }
      setOctaveMessage(null);
      project.update((p) => ({ ...p, scene: { ...p.scene, melodyOctave: next } }));
    },
    [session, project],
  );

  useKeyboardInput(session, changeOctave, stopEverything);

  // A hidden page releases everything and waits for an explicit resume.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        // Stop camera tracks and release everything; returning needs explicit actions.
        handControl.stop();
        session.interrupt("hidden");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [session, handControl]);

  if (!snapshot || !projectState) {
    return (
      <main className="loading" aria-busy="true">
        <p>Opening your project…</p>
      </main>
    );
  }

  const paused = snapshot.session.kind === "paused";

  return (
    <div className="shell">
      <header className="shell__top">
      <div className="shell__header">
        <span className="wordmark">Vybe</span>
        <nav aria-label="Workspaces" className="workspaces">
          {WORKSPACES.map((w) => (
            <button
              key={w.id}
              type="button"
              className="workspaces__tab"
              aria-current={workspace === w.id ? "page" : undefined}
              onClick={() => setWorkspace(w.id)}
            >
              {w.label}
            </button>
          ))}
        </nav>
        <div className="project-status">
          <span className="project-status__name">{projectState.project.name}</span>
          <SaveIndicator status={projectState.save} />
        </div>
        <button type="button" className="button" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </div>

      <div className="shell__transport" role="toolbar" aria-label="Performance controls">
        <span className="transport__item">
          <span className="muted">Tempo</span> <span className="data">{projectState.project.scene.tempoBpm} BPM</span>
        </span>
        <span className={`transport__item sustain ${snapshot.sustainDown ? "is-on" : ""}`}>
          Sustain {snapshot.sustainDown ? "down" : "up"} <kbd>Left Shift</kbd>
        </span>
        <SoundControl snapshot={audioSnapshot} onStart={() => void audio.start()} onRetry={() => void audio.retryLoading()} />
        <span className="transport__spacer" />
        <button type="button" className="button" onClick={() => session.rest("left", "pointer")}>
          Rest left
        </button>
        <button type="button" className="button" onClick={() => session.rest("right", "pointer")}>
          Rest right
        </button>
        <button type="button" className="button button--danger" onClick={stopEverything}>
          <span aria-hidden="true">■ </span>Stop all <kbd>Esc</kbd>
        </button>
      </div>
      </header>

      <main className="shell__workspace" id="workspace">

      {projectState.save.kind === "failed" && (
        <div className="notice notice--danger" role="alert">
          <span aria-hidden="true">✕ </span>
          This project is not saved. {projectState.save.error.message}{" "}
          {project && projectState.save.error.code !== "unavailable" && (
            <button type="button" className="button" onClick={() => void project.saveNow()}>
              Retry save
            </button>
          )}
        </div>
      )}
      {projectState.notice && (
        <p className="notice notice--warning" role="status">
          <span aria-hidden="true">▲ </span>
          {projectState.notice}
        </p>
      )}
      {paused && (
        <div className="notice notice--warning" role="alert">
          <span aria-hidden="true">▲ </span>
          {snapshot.session.kind === "paused" ? PAUSE_TEXT[snapshot.session.reason] : ""} All notes were released.{" "}
          <button type="button" className="button button--primary" onClick={() => session.resume()}>
            Resume
          </button>
        </div>
      )}

        {workspace === "play" && handSnapshot.phase === "calibrating" && (
          <CalibrationView handControl={handControl} snapshot={handSnapshot} video={runtime.cameraVideo} />
        )}
        {workspace === "play" && handSnapshot.phase !== "calibrating" && <h1 className="visually-hidden">Play</h1>}
        {workspace === "play" && handSnapshot.phase !== "calibrating" && (
          <PlayView
            session={session}
            snapshot={snapshot}
            onOctave={changeOctave}
            octaveMessage={octaveMessage}
            handControl={handControl}
            handSnapshot={handSnapshot}
            cameraVideo={runtime.cameraVideo}
          />
        )}
        {workspace === "practice" && (
          <section className="empty-workspace">
            <h1 className="workspace-title">Practice</h1>
            <p>Lessons and song practice are not built yet. Use Play to try the instrument.</p>
          </section>
        )}
        {workspace === "studio" && (
          <section className="empty-workspace">
            <h1 className="workspace-title">Studio</h1>
            <p>Recording and tracks are not built yet. Use Play to try the instrument.</p>
          </section>
        )}
      </main>

      <footer className="shell__status" aria-label="Status">
        <span>
          <span aria-hidden="true">{handSnapshot.phase === "error" ? "✕ " : handSnapshot.phase === "off" ? "○ " : "● "}</span>
          {CAMERA_STATUS[handSnapshot.phase]}
        </span>
        <span>
          <span aria-hidden="true">{audioSnapshot.status === "ready" ? "● " : audioSnapshot.status === "error" ? "✕ " : "○ "}</span>
          {AUDIO_STATUS(audioSnapshot)}
        </span>
        <span>Left → Chords / Right → Melody</span>
        <span>Input: {handSnapshot.phase === "active" ? "hands, keyboard and pointer" : "keyboard and pointer"}</span>
      </footer>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} runtime={runtime} snapshot={snapshot} />
    </div>
  );
}

/** Persistent sound control: sound starts only from this explicit action (R02). */
function SoundControl({ snapshot, onStart, onRetry }: { snapshot: AudioSnapshot; onStart: () => void; onRetry: () => void }) {
  switch (snapshot.status) {
    case "off":
      return (
        <button type="button" className="button button--primary" onClick={onStart}>
          Start sound
        </button>
      );
    case "starting":
    case "loading":
      return (
        <span className="transport__item" role="status">
          {snapshot.status === "starting" ? "Starting sound…" : `Loading grand piano: ${snapshot.loaded} of ${snapshot.total || "…"} samples`}
        </span>
      );
    case "ready":
      return <span className="transport__item">Sound on</span>;
    case "interrupted":
      return (
        <button type="button" className="button button--primary" onClick={onStart}>
          Resume sound
        </button>
      );
    case "error":
      return (
        <span className="transport__item transport__error" role="alert">
          <span aria-hidden="true">✕ </span>
          {snapshot.error}{" "}
          <button type="button" className="button" onClick={onRetry}>
            Retry loading
          </button>
        </span>
      );
  }
}


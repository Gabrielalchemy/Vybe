import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { PlayView } from "../features/play/PlayView";
import { useKeyboardInput } from "../features/play/useKeyboardInput";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { SaveIndicator } from "../ui/SaveIndicator";
import type { ProjectSession, ProjectSessionState } from "./projectSession";
import type { AppRuntime } from "./runtime";

type Workspace = "play" | "practice" | "studio";
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
  const { session } = runtime;
  const snapshot = useSyncExternalStore(
    (notify) => session.subscribe(() => notify()),
    () => session.peek(),
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

  useKeyboardInput(session, changeOctave);

  // A hidden page releases everything and waits for an explicit resume.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") session.interrupt("hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [session]);

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
        <span className="transport__spacer" />
        <button type="button" className="button" onClick={() => session.rest("left", "pointer")}>
          Rest left
        </button>
        <button type="button" className="button" onClick={() => session.rest("right", "pointer")}>
          Rest right
        </button>
        <button type="button" className="button button--danger" onClick={() => session.stopAll()}>
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
          Playing paused because the page was hidden. All notes were released.{" "}
          <button type="button" className="button button--primary" onClick={() => session.resume()}>
            Resume
          </button>
        </div>
      )}

        {workspace === "play" && <h1 className="visually-hidden">Play</h1>}
        {workspace === "play" && (
          <PlayView session={session} snapshot={snapshot} onOctave={changeOctave} octaveMessage={octaveMessage} />
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
          <span aria-hidden="true">○ </span>Camera off (not in this build)
        </span>
        <span>
          <span aria-hidden="true">○ </span>Sound not available in this build
        </span>
        <span>Left → Chords / Right → Melody</span>
        <span>Input: keyboard and pointer</span>
      </footer>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} runtime={runtime} snapshot={snapshot} />
    </div>
  );
}

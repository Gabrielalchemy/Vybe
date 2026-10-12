import { createProject, type ProjectRecord } from "../domain/project";
import { FACTORY_SCENES } from "../domain/presets";
import type { Result } from "../domain/result";
import { SaveTracker, type SaveStatus } from "../domain/saveStatus";
import type { StorageError } from "../domain/storageError";
import type { ProjectRepository } from "../persistence/indexedDbRepository";

export const AUTOSAVE_IDLE_MS = 2000;
const LAST_PROJECT_KEY = "lastProjectId";

export interface ProjectSessionState {
  project: ProjectRecord;
  save: SaveStatus;
  /** A non-fatal problem found while opening, e.g. the last project could not be read. */
  notice: string | null;
}

export interface ProjectSessionDeps {
  repo: Result<ProjectRepository, StorageError>;
  nowIso: () => string;
  newId: () => string;
}

/**
 * The open project: in-memory record plus committed-save tracking. Edits are
 * autosaved after AUTOSAVE_IDLE_MS of idle; a failure keeps the in-memory
 * project and stays visible until a later save commits.
 */
export class ProjectSession {
  private project: ProjectRecord;
  private readonly tracker: SaveTracker;
  private readonly repo: ProjectRepository | null;
  private readonly notice: string | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(s: ProjectSessionState) => void>();
  /** The in-flight commit, if any; later saves queue behind it. */
  private saving: Promise<void> | null = null;

  private constructor(args: { project: ProjectRecord; repo: ProjectRepository | null; tracker: SaveTracker; notice: string | null }) {
    this.project = args.project;
    this.repo = args.repo;
    this.tracker = args.tracker;
    this.notice = args.notice;
  }

  static async open(deps: ProjectSessionDeps): Promise<ProjectSession> {
    const fresh = () => createProject({ id: deps.newId(), name: "Untitled project", scene: FACTORY_SCENES.pop, nowIso: deps.nowIso() });

    if (!deps.repo.ok) {
      const tracker = new SaveTracker(0);
      tracker.markDirty();
      tracker.commitFailed(tracker.beginSave(), deps.repo.error);
      return new ProjectSession({ project: fresh(), repo: null, tracker, notice: null });
    }

    const repo = deps.repo.value;
    let notice: string | null = null;
    const last = await repo.getPreference(LAST_PROJECT_KEY);
    if (last.ok && typeof last.value === "string") {
      const loaded = await repo.loadProject(last.value);
      if (loaded.ok) {
        return new ProjectSession({ project: loaded.value, repo, tracker: new SaveTracker(loaded.value.revision), notice });
      }
      // Never overwrite an unreadable project: start a new one with a new id and say so.
      notice = `Your last project could not be opened (${loaded.error.message}). A new project was started; the old one was left unchanged.`;
    }

    const session = new ProjectSession({ project: fresh(), repo, tracker: new SaveTracker(0), notice });
    session.tracker.markDirty();
    await session.saveNow();
    if (session.tracker.status().kind === "saved") await repo.setPreference(LAST_PROJECT_KEY, session.project.id);
    return session;
  }

  state(): ProjectSessionState {
    return { project: this.project, save: this.tracker.status(), notice: this.notice };
  }

  subscribe(listener: (s: ProjectSessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  update(mutate: (p: ProjectRecord) => ProjectRecord): void {
    this.project = mutate(this.project);
    this.tracker.markDirty();
    this.scheduleSave();
    this.emit();
  }

  /** Save immediately (takes, explicit retry). Resolves after the commit outcome is known. */
  saveNow(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const run = (): Promise<void> => {
      const p = this.commit().finally(() => {
        if (this.saving === p) this.saving = null;
      });
      this.saving = p;
      return p;
    };
    return this.saving ? this.saving.then(run) : run();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  private scheduleSave(): void {
    if (!this.repo) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.saveNow();
    }, AUTOSAVE_IDLE_MS);
  }

  private async commit(): Promise<void> {
    if (!this.repo || !this.tracker.isDirty()) return;
    const attempt = this.tracker.beginSave();
    this.emit();
    const snapshot = this.project;
    const result = await this.repo.saveProject(snapshot, snapshot.revision);
    if (result.ok) {
      this.project = { ...this.project, revision: result.value.revision, updatedAt: result.value.updatedAt };
      this.tracker.commitSucceeded(attempt, result.value.revision);
    } else {
      this.tracker.commitFailed(attempt, result.error);
    }
    this.emit();
  }

  private emit(): void {
    const state = this.state();
    for (const l of this.listeners) {
      try {
        l(state);
      } catch (error) {
        console.error("Project subscriber failed", error);
      }
    }
  }
}

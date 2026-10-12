import { validateProjectRecord, type ProjectRecord } from "../domain/project";
import { fail, ok, type Result } from "../domain/result";
import type { StorageError } from "../domain/storageError";

export const DB_NAME = "vybe";
export const DB_VERSION = 1;

/** Logical stores (architecture.md §10). Later phases fill takes, assets, calibration and trash. */
export const STORES = {
  projects: { keyPath: "id" },
  revisions: { keyPath: ["projectId", "revision"] },
  takes: { keyPath: "id" },
  assets: { keyPath: "sha256" },
  calibration: { keyPath: "id" },
  preferences: { keyPath: "key" },
  trash: { keyPath: "id" },
} as const;

type StoreName = keyof typeof STORES;

export interface ProjectSummary {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
}

export interface ProjectRepository {
  /** Commits `record` only if the stored revision equals `expectedRevision` (0 for a new project). */
  saveProject(record: ProjectRecord, expectedRevision: number): Promise<Result<{ revision: number; updatedAt: string }, StorageError>>;
  loadProject(id: string): Promise<Result<ProjectRecord, StorageError>>;
  loadRevision(id: string, revision: number): Promise<Result<ProjectRecord, StorageError>>;
  listProjects(): Promise<Result<ProjectSummary[], StorageError>>;
  getPreference(key: string): Promise<Result<unknown, StorageError>>;
  setPreference(key: string, value: unknown): Promise<Result<void, StorageError>>;
  close(): void;
}

export interface OpenOptions {
  factory: IDBFactory | undefined;
  nowIso: () => string;
}

function toStorageError(error: unknown, fallback: string): StorageError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError") {
    return { code: "quota-exceeded", message: "Browser storage is full. Export a backup, then free space." };
  }
  const detail = error instanceof Error ? ` (${error.name}: ${error.message})` : "";
  return { code: "transaction-failed", message: `${fallback}${detail}` };
}

/** Resolves when the transaction commits, never earlier. */
function completion(tx: IDBTransaction): Promise<Result<void, StorageError>> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(ok(undefined));
    tx.onabort = () => resolve(fail(toStorageError(tx.error, "The save did not complete.")));
    tx.onerror = (event) => event.preventDefault();
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function openRepository(options: OpenOptions): Promise<Result<ProjectRepository, StorageError>> {
  const { factory } = options;
  if (!factory) {
    return Promise.resolve(fail({ code: "unavailable", message: "This browser does not provide local storage for projects." }));
  }
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(DB_NAME, DB_VERSION);
    } catch (error) {
      resolve(fail({ code: "unavailable", message: `Local storage could not be opened. ${String(error)}` }));
      return;
    }
    req.onupgradeneeded = () => {
      // Only create what is missing. Never delete or clear existing stores.
      const db = req.result;
      for (const [name, options] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: options.keyPath as string | string[] });
      }
    };
    req.onblocked = () =>
      resolve(fail({ code: "locked", message: "Another Vybe tab is upgrading storage. Close other Vybe tabs and reload." }));
    req.onerror = () => resolve(fail({ code: "unavailable", message: `Local storage could not be opened. ${String(req.error)}` }));
    req.onsuccess = () => {
      const db = req.result;
      // A future version in another tab asks us to close rather than block it.
      db.onversionchange = () => db.close();
      resolve(ok(new IndexedDbRepository(db, options.nowIso)));
    };
  });
}

class IndexedDbRepository implements ProjectRepository {
  constructor(
    private readonly db: IDBDatabase,
    private readonly nowIso: () => string,
  ) {}

  private tx(stores: StoreName[], mode: IDBTransactionMode): Result<IDBTransaction, StorageError> {
    try {
      return ok(this.db.transaction(stores, mode));
    } catch (error) {
      return fail(toStorageError(error, "Local storage is not available."));
    }
  }

  async saveProject(record: ProjectRecord, expectedRevision: number) {
    const opened = this.tx(["projects", "revisions"], "readwrite");
    if (!opened.ok) return opened;
    const tx = opened.value;
    const done = completion(tx);
    const projects = tx.objectStore("projects");
    const revisions = tx.objectStore("revisions");
    const updatedAt = this.nowIso();
    let outcome: Result<{ revision: number; updatedAt: string }, StorageError> | null = null;

    const getReq = projects.get(record.id);
    getReq.onsuccess = () => {
      const current = getReq.result as { revision?: unknown } | undefined;
      const storedRevision = typeof current?.revision === "number" ? current.revision : 0;
      if (storedRevision !== expectedRevision) {
        outcome = fail({
          code: "conflict",
          message: `This project changed elsewhere (stored revision ${storedRevision}, expected ${expectedRevision}). Reload before saving.`,
        });
        tx.abort();
        return;
      }
      const next: ProjectRecord = { ...record, revision: expectedRevision + 1, updatedAt };
      try {
        projects.put(next);
        revisions.put({ projectId: next.id, revision: next.revision, committedAt: updatedAt, snapshot: next });
        outcome = ok({ revision: next.revision, updatedAt });
      } catch (error) {
        outcome = fail(toStorageError(error, "The project could not be written."));
        tx.abort();
      }
    };

    const committed = await done;
    if (outcome && !(outcome as Result<unknown, StorageError>).ok) return outcome;
    if (!committed.ok) return committed;
    return outcome ?? fail<StorageError>({ code: "transaction-failed", message: "The save did not complete." });
  }

  async loadProject(id: string): Promise<Result<ProjectRecord, StorageError>> {
    return this.readValidated("projects", id, `Project ${id} was not found.`);
  }

  async loadRevision(id: string, revision: number): Promise<Result<ProjectRecord, StorageError>> {
    const raw = await this.read("revisions", [id, revision]);
    if (!raw.ok) return raw;
    const entry = raw.value as { snapshot?: unknown } | undefined;
    if (!entry) return fail({ code: "not-found", message: `Revision ${revision} of project ${id} was not found.` });
    return validateProjectRecord(entry.snapshot);
  }

  async listProjects(): Promise<Result<ProjectSummary[], StorageError>> {
    const opened = this.tx(["projects"], "readonly");
    if (!opened.ok) return opened;
    try {
      const all = (await request(opened.value.objectStore("projects").getAll())) as unknown[];
      const summaries = all.flatMap((raw) => {
        const v = validateProjectRecord(raw);
        return v.ok ? [{ id: v.value.id, name: v.value.name, revision: v.value.revision, updatedAt: v.value.updatedAt }] : [];
      });
      return ok(summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } catch (error) {
      return fail(toStorageError(error, "Projects could not be listed."));
    }
  }

  async getPreference(key: string): Promise<Result<unknown, StorageError>> {
    const raw = await this.read("preferences", key);
    if (!raw.ok) return raw;
    return ok((raw.value as { value?: unknown } | undefined)?.value);
  }

  async setPreference(key: string, value: unknown): Promise<Result<void, StorageError>> {
    const opened = this.tx(["preferences"], "readwrite");
    if (!opened.ok) return opened;
    const done = completion(opened.value);
    try {
      opened.value.objectStore("preferences").put({ key, value });
    } catch (error) {
      opened.value.abort();
      await done;
      return fail(toStorageError(error, "The preference could not be saved."));
    }
    return done;
  }

  close(): void {
    this.db.close();
  }

  private async read(store: StoreName, key: IDBValidKey): Promise<Result<unknown, StorageError>> {
    const opened = this.tx([store], "readonly");
    if (!opened.ok) return opened;
    try {
      return ok(await request(opened.value.objectStore(store).get(key)));
    } catch (error) {
      return fail(toStorageError(error, "Local storage could not be read."));
    }
  }

  private async readValidated(store: StoreName, key: string, missing: string): Promise<Result<ProjectRecord, StorageError>> {
    const raw = await this.read(store, key);
    if (!raw.ok) return raw;
    if (raw.value === undefined) return fail({ code: "not-found", message: missing });
    return validateProjectRecord(raw.value);
  }
}

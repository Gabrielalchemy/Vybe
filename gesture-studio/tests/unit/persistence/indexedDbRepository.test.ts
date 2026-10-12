import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_NAME, openRepository, type ProjectRepository } from "../../../src/persistence/indexedDbRepository";
import { createProject, type ProjectRecord } from "../../../src/domain/project";
import { FACTORY_SCENES } from "../../../src/domain/presets";

let factory: IDBFactory;
let repo: ProjectRepository;
let clock = 0;
const nowIso = () => new Date(Date.UTC(2026, 9, 12, 10, 0, clock++)).toISOString();

const project = (id = "p1", name = "Idea"): ProjectRecord =>
  createProject({ id, name, scene: FACTORY_SCENES.jazz, nowIso: "2026-10-12T09:00:00.000Z" });

beforeEach(async () => {
  factory = new IDBFactory();
  clock = 0;
  const opened = await openRepository({ factory, nowIso });
  if (!opened.ok) throw new Error(opened.error.message);
  repo = opened.value;
});

afterEach(() => repo.close());

describe("IndexedDB project repository", () => {
  it("commits a new project and increments its revision", async () => {
    const saved = await repo.saveProject(project(), 0);
    expect(saved).toEqual({ ok: true, value: { revision: 1, updatedAt: "2026-10-12T10:00:00.000Z" } });
    const loaded = await repo.loadProject("p1");
    expect(loaded.ok && loaded.value.revision).toBe(1);
    expect(loaded.ok && loaded.value.scene.chordSlots[3]?.notes).toEqual([45, 55, 61, 64]);
  });

  it("rejects a save based on a stale revision instead of overwriting", async () => {
    await repo.saveProject(project(), 0);
    await repo.saveProject({ ...project(), name: "Second tab" }, 1);
    const stale = await repo.saveProject({ ...project(), name: "Stale" }, 1);
    expect(!stale.ok && stale.error.code).toBe("conflict");
    const loaded = await repo.loadProject("p1");
    expect(loaded.ok && loaded.value.name).toBe("Second tab");
  });

  it("keeps a snapshot for every committed revision", async () => {
    await repo.saveProject(project(), 0);
    await repo.saveProject({ ...project(), name: "Renamed" }, 1);
    const r1 = await repo.loadRevision("p1", 1);
    expect(r1.ok && r1.value.name).toBe("Idea");
  });

  it("returns not-found for a missing project", async () => {
    const loaded = await repo.loadProject("missing");
    expect(!loaded.ok && loaded.error.code).toBe("not-found");
  });

  it("reports a corrupt stored record instead of returning it", async () => {
    await repo.saveProject(project(), 0);
    await new Promise<void>((resolve, reject) => {
      const req = factory.open(DB_NAME);
      req.onsuccess = () => {
        const tx = req.result.transaction("projects", "readwrite");
        tx.objectStore("projects").put({ id: "p1", schemaVersion: 1, name: "" });
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    const loaded = await repo.loadProject("p1");
    expect(!loaded.ok && loaded.error.code).toBe("invalid-record");
  });

  it("does not claim success when the transaction fails, and leaves the old revision", async () => {
    await repo.saveProject(project(), 0);
    const bad = { ...project(), name: "Has a function", extra: () => 1 } as unknown as ProjectRecord;
    const result = await repo.saveProject(bad, 1);
    expect(result.ok).toBe(false);
    const loaded = await repo.loadProject("p1");
    expect(loaded.ok && loaded.value.revision).toBe(1);
    expect(loaded.ok && loaded.value.name).toBe("Idea");
  });

  it("maps a quota failure to a quota-exceeded error", async () => {
    const { IDBObjectStore } = await import("fake-indexeddb");
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const result = await repo.saveProject(project(), 0);
    expect(!result.ok && result.error.code).toBe("quota-exceeded");
  });

  it("lists projects newest first", async () => {
    await repo.saveProject(project("a", "Older"), 0);
    await repo.saveProject(project("b", "Newer"), 0);
    const list = await repo.listProjects();
    expect(list.ok && list.value.map((p) => p.name)).toEqual(["Newer", "Older"]);
  });

  it("stores preferences", async () => {
    await repo.setPreference("lastProjectId", "b");
    const value = await repo.getPreference("lastProjectId");
    expect(value).toEqual({ ok: true, value: "b" });
    expect(await repo.getPreference("unknown")).toEqual({ ok: true, value: undefined });
  });

  it("reopening an existing database preserves data (no reset on open)", async () => {
    await repo.saveProject(project(), 0);
    repo.close();
    const reopened = await openRepository({ factory, nowIso });
    if (!reopened.ok) throw new Error("reopen failed");
    repo = reopened.value;
    const loaded = await repo.loadProject("p1");
    expect(loaded.ok && loaded.value.revision).toBe(1);
  });
});

describe("openRepository", () => {
  it("reports unavailable storage with a specific code", async () => {
    const result = await openRepository({ factory: undefined, nowIso });
    expect(!result.ok && result.error.code).toBe("unavailable");
  });
});

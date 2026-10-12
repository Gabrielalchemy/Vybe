import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSession } from "../../../src/app/projectSession";
import { openRepository } from "../../../src/persistence/indexedDbRepository";

const nowIso = () => "2026-10-12T10:00:00.000Z";
let ids = 0;
const newId = () => `proj-${++ids}`;

async function open(factory: IDBFactory | undefined) {
  const repo = await openRepository({ factory, nowIso });
  return ProjectSession.open({ repo, nowIso, newId });
}

afterEach(() => vi.useRealTimers());

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("ProjectSession", () => {
  it("creates and commits a first project, then reopens it", async () => {
    const factory = new IDBFactory();
    const first = await open(factory);
    expect(first.state().save).toEqual({ kind: "saved", revision: 1 });
    expect(first.state().project.name).toBe("Untitled project");
    const id = first.state().project.id;
    first.dispose();
    const second = await open(factory);
    expect(second.state().project.id).toBe(id);
    expect(second.state().save).toEqual({ kind: "saved", revision: 1 });
    second.dispose();
  });

  it("autosaves two seconds after the last edit and only then reports saved", async () => {
    const session = await open(new IDBFactory());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    session.update((p) => ({ ...p, scene: { ...p.scene, melodyOctave: 5 } }));
    expect(session.state().save.kind).toBe("unsaved");
    vi.advanceTimersByTime(1500);
    session.update((p) => ({ ...p, scene: { ...p.scene, melodyOctave: 6 } }));
    vi.advanceTimersByTime(1999);
    expect(session.state().save.kind).toBe("unsaved");
    vi.advanceTimersByTime(1);
    expect(session.state().save.kind).toBe("saving");
    vi.useRealTimers();
    await settle();
    expect(session.state().save).toEqual({ kind: "saved", revision: 2 });
    expect(session.state().project.scene.melodyOctave).toBe(6);
    session.dispose();
  });

  it("keeps the project in memory with a visible failure when storage is unavailable", async () => {
    const session = await open(undefined);
    expect(session.state().project.scene.chordSlots[0]?.label).toBe("C");
    expect(session.state().save).toMatchObject({ kind: "failed", error: { code: "unavailable" } });
    session.update((p) => ({ ...p, name: "Still editable" }));
    expect(session.state().project.name).toBe("Still editable");
    expect(session.state().save.kind).toBe("failed");
    session.dispose();
  });

  it("notifies subscribers on change", async () => {
    const session = await open(new IDBFactory());
    const seen: string[] = [];
    session.subscribe((s) => seen.push(s.save.kind));
    session.update((p) => ({ ...p, name: "Renamed" }));
    await session.saveNow();
    expect(seen).toEqual(["saved", "unsaved", "saving", "saved"]);
    session.dispose();
  });
});

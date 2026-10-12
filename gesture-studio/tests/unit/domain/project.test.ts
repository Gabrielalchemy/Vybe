import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, createProject, validateProjectRecord } from "../../../src/domain/project";
import { FACTORY_SCENES } from "../../../src/domain/presets";

const NOW = "2026-10-12T10:00:00.000Z";

describe("createProject", () => {
  it("creates a versioned project from a scene without sharing mutable pads", () => {
    const p = createProject({ id: "p1", name: "First idea", scene: FACTORY_SCENES.soul, nowIso: NOW });
    expect(p).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, id: "p1", name: "First idea", revision: 0, createdAt: NOW });
    expect(p.scene.chordSlots[0]?.notes).toEqual([48, 52, 59, 62, 67]);
    expect(p.scene.chordSlots[0]).not.toBe(FACTORY_SCENES.soul.chordSlots[0]);
    expect(p.tracks).toEqual([]);
  });
});

describe("validateProjectRecord", () => {
  const valid = () => JSON.parse(JSON.stringify(createProject({ id: "p1", name: "Idea", scene: FACTORY_SCENES.pop, nowIso: NOW })));

  it("accepts a stored project round-tripped through JSON", () => {
    expect(validateProjectRecord(valid())).toMatchObject({ ok: true });
  });

  it("rejects a corrupt chord pad with a path to the problem", () => {
    const record = valid();
    record.scene.chordSlots[1].notes = [43, 43];
    const result = validateProjectRecord(record);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("invalid-record");
    expect(!result.ok && result.error.message).toMatch(/chordSlots\[1\]/);
  });

  it("reports a newer schema separately so the file is kept but not opened for editing", () => {
    const record = valid();
    record.schemaVersion = CURRENT_SCHEMA_VERSION + 1;
    const result = validateProjectRecord(record);
    expect(!result.ok && result.error.code).toBe("newer-schema");
  });

  it("rejects out-of-range numeric settings", () => {
    for (const [field, value] of [["tempoBpm", 39], ["tempoBpm", 241], ["velocity", 0], ["melodyOctave", 9], ["loopBars", 3]] as const) {
      const record = valid();
      record.scene[field] = value;
      expect(validateProjectRecord(record).ok, `${field}=${value}`).toBe(false);
    }
  });

  it("rejects non-integer revisions and missing names", () => {
    const a = valid();
    a.revision = 1.5;
    expect(validateProjectRecord(a).ok).toBe(false);
    const b = valid();
    b.name = "";
    expect(validateProjectRecord(b).ok).toBe(false);
  });
});

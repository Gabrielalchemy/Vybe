import { describe, expect, it } from "vitest";
import { SaveTracker } from "../../../src/domain/saveStatus";

describe("SaveTracker", () => {
  it("only reports saved after the matching commit", () => {
    const t = new SaveTracker(0);
    expect(t.status()).toEqual({ kind: "saved", revision: 0 });
    t.markDirty();
    expect(t.status().kind).toBe("unsaved");
    const attempt = t.beginSave();
    expect(t.status().kind).toBe("saving");
    t.commitSucceeded(attempt, 1);
    expect(t.status()).toEqual({ kind: "saved", revision: 1 });
  });

  it("stays unsaved when edits arrive during an in-flight save", () => {
    const t = new SaveTracker(0);
    t.markDirty();
    const attempt = t.beginSave();
    t.markDirty();
    t.commitSucceeded(attempt, 1);
    expect(t.status()).toEqual({ kind: "unsaved", revision: 1 });
  });

  it("keeps a failure visible until a later save commits", () => {
    const t = new SaveTracker(3);
    t.markDirty();
    t.commitFailed(t.beginSave(), { code: "quota-exceeded", message: "Storage is full." });
    expect(t.status()).toMatchObject({ kind: "failed", revision: 3, error: { code: "quota-exceeded" } });
    t.markDirty();
    expect(t.status().kind).toBe("failed");
    t.commitSucceeded(t.beginSave(), 4);
    expect(t.status()).toEqual({ kind: "saved", revision: 4 });
  });

  it("ignores the result of a superseded save attempt", () => {
    const t = new SaveTracker(0);
    t.markDirty();
    const first = t.beginSave();
    t.markDirty();
    const second = t.beginSave();
    t.commitSucceeded(second, 2);
    t.commitFailed(first, { code: "transaction-failed", message: "x" });
    expect(t.status()).toEqual({ kind: "saved", revision: 2 });
  });
});

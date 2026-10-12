import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionController, type SessionSnapshot } from "../../../src/app/sessionController";
import { FACTORY_SCENES } from "../../../src/domain/presets";
import type { PerformanceEvent } from "../../../src/domain/events";

let dispatched: PerformanceEvent[][];
let order: string[];
let session: SessionController;
let t = 0;

beforeEach(() => {
  dispatched = [];
  order = [];
  t = 0;
  session = new SessionController({
    sink: { dispatch: (events) => { order.push("sink"); dispatched.push([...events]); } },
    nowSec: () => t,
    nowMs: () => t * 1000,
    newId: (() => { let n = 0; return () => `id${++n}`; })(),
  });
  session.loadScene(FACTORY_SCENES.pop);
});

const notesOf = (events: PerformanceEvent[]) => events.flatMap((e) => (e.kind === "note-on" ? [e.note] : []));

describe("SessionController", () => {
  it("routes a keyboard melody press to the sink and publishes the held target", () => {
    let snap: SessionSnapshot | undefined;
    session.subscribe((s) => { order.push("ui"); snap = s; });
    order.length = 0;
    session.press("right", "melody-pc-9", "keyboard");
    expect(notesOf(dispatched.flat())).toEqual([69]);
    expect(order).toEqual(["sink", "ui"]);
    expect(snap?.lanes.right).toMatchObject({ state: "held", heldTargetId: "melody-pc-9", input: "keyboard" });
    expect(snap?.soundingNotes).toEqual([{ note: 69, source: "live-right", sustained: false }]);
  });

  it("a subscriber failure does not block later note-offs", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    session.subscribe(() => { throw new Error("render bug"); });
    session.press("left", "chord-slot-0", "pointer");
    session.release("left", "pointer");
    const releases = dispatched.flat().filter((e) => e.kind === "voice-release");
    expect(releases).toHaveLength(4);
    expect(logged).toHaveBeenCalledWith("Session subscriber failed", expect.any(Error));
  });

  it("one input cannot release or retrigger a lane owned by another input", () => {
    session.press("right", "melody-pc-0", "keyboard");
    expect(session.release("right", "pointer").status).toBe("rejected");
    expect(session.press("right", "melody-pc-2", "pointer").status).toBe("rejected");
    expect(session.release("right", "keyboard").status).toBe("released");
    expect(session.press("right", "melody-pc-2", "pointer").status).toBe("sounded");
  });

  it("stopAll releases everything, including pedal-held notes", () => {
    session.setSustain(true);
    session.press("left", "chord-slot-1", "keyboard");
    session.release("left", "keyboard");
    session.stopAll();
    expect(session.snapshot().soundingNotes).toEqual([]);
    expect(session.snapshot().sustainDown).toBe(false);
  });

  it("loading a scene bumps the revision and invalidates intents from the old mapping", () => {
    const before = session.snapshot().configurationRevision;
    session.loadScene(FACTORY_SCENES.jazz);
    expect(session.snapshot().configurationRevision).toBe(before + 1);
    expect(session.snapshot().chordSlots[3]?.label).toBe("A7");
  });

  it("refuses to load a scene while a key is held", () => {
    session.press("right", "melody-pc-0", "keyboard");
    const result = session.loadScene(FACTORY_SCENES.soul);
    expect(result.ok).toBe(false);
    expect(session.snapshot().chordSlots[0]?.label).toBe("C");
  });

  it("changes octave only while idle, and the held note keeps its pitch", () => {
    session.press("right", "melody-pc-0", "keyboard");
    expect(session.setMelodyOctave(5).ok).toBe(false);
    session.release("right", "keyboard");
    expect(session.setMelodyOctave(5).ok).toBe(true);
    session.press("right", "melody-pc-0", "keyboard");
    expect(notesOf(dispatched.flat())).toEqual([60, 72]);
  });

  it("a lifecycle interruption flushes all lanes and pauses until explicit resume", () => {
    session.press("left", "chord-slot-0", "keyboard");
    session.interrupt("hidden");
    expect(session.snapshot().soundingNotes).toEqual([]);
    expect(session.snapshot().session).toEqual({ kind: "paused", reason: "hidden" });
    expect(session.press("left", "chord-slot-0", "keyboard").status).toBe("rejected");
    session.resume();
    expect(session.press("left", "chord-slot-0", "keyboard").status).toBe("sounded");
  });

  it("keeps a bounded diagnostic log of outcomes including silent attempts", () => {
    session.press("left", "chord-slot-7", "pointer");
    const last = session.snapshot().recentOutcomes.at(-1);
    expect(last).toMatchObject({ hand: "left", status: "silent", detail: "empty-pad" });
    for (let i = 0; i < 300; i++) {
      session.release("left", "pointer");
      session.press("left", "chord-slot-7", "pointer");
    }
    expect(session.snapshot().recentOutcomes.length).toBeLessThanOrEqual(100);
  });

  it("reports which target each live voice came from, distinguishing held from pedal", () => {
    session.setSustain(true);
    session.press("left", "chord-slot-2", "keyboard");
    session.release("left", "keyboard");
    session.press("right", "melody-pc-4", "keyboard");
    expect(session.snapshot().soundingTargets).toEqual([
      { hand: "left", targetId: "chord-slot-2", held: false, sustained: true },
      { hand: "right", targetId: "melody-pc-4", held: true, sustained: false },
    ]);
    session.setSustain(false);
    expect(session.snapshot().soundingTargets).toEqual([{ hand: "right", targetId: "melody-pc-4", held: true, sustained: false }]);
  });

  it("marks a hand as resting only after Rest, until its next press", () => {
    expect(session.snapshot().lanes.left.resting).toBe(false);
    session.rest("left", "pointer");
    expect(session.snapshot().lanes.left.resting).toBe(true);
    expect(session.snapshot().lanes.right.resting).toBe(false);
    session.press("left", "chord-slot-0", "keyboard");
    expect(session.snapshot().lanes.left.resting).toBe(false);
  });

  it("camera input never self-arms; it needs explicit neutral-open arming", () => {
    expect(session.press("right", "melody-pc-0", "camera")).toMatchObject({ status: "rejected", reason: "not-armed" });
    session.armCamera("right");
    expect(session.press("right", "melody-pc-0", "camera").status).toBe("sounded");
  });

  it("camera loss releases a camera-held lane and leaves the other hand alone", () => {
    session.armCamera("right");
    session.press("right", "melody-pc-0", "camera");
    session.press("left", "chord-slot-0", "keyboard");
    session.lost("right");
    expect(session.snapshot().soundingTargets.map((t) => t.hand)).toEqual(["left"]);
  });

  it("forgets a voice the audio engine stole and records the voice-limit release", () => {
    session.press("left", "chord-slot-0", "keyboard");
    const voiceId = dispatched.flat().find((e) => e.kind === "note-on")!.voiceId;
    session.voiceStolen(voiceId);
    expect(dispatched.flat().some((e) => e.kind === "voice-release" && e.voiceId === voiceId && e.reason === "voice-limit")).toBe(true);
    expect(session.snapshot().soundingNotes).toHaveLength(3);
  });

  it("publishes each outcome to outcome listeners as it happens", () => {
    const seen: string[] = [];
    session.onOutcome((o) => seen.push(`${o.hand}:${o.action}:${o.status}:${o.input}`));
    session.armCamera("right");
    session.press("right", "melody-pc-0", "camera");
    session.release("right", "camera");
    expect(seen).toEqual(["right:press:sounded:camera", "right:release:released:camera"]);
  });
});


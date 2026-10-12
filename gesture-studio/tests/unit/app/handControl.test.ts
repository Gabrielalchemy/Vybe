import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { HandControl, type SourceError, type SourceInfo, type SourceStart, type TrackingSource } from "../../../src/app/handControl";
import type { Result } from "../../../src/domain/result";
import { SessionController } from "../../../src/app/sessionController";
import { FACTORY_SCENES } from "../../../src/domain/presets";
import type { CalibrationProfile } from "../../../src/domain/tracking/calibration";
import type { WorkerHand } from "../../../src/domain/tracking/protocol";
import type { FrameResult } from "../../../src/runtime/tracking/trackingClient";
import { openRepository, type ProjectRepository } from "../../../src/persistence/indexedDbRepository";
import { handAtPalm } from "../../fixtures/hands";
import type { PerformanceEvent } from "../../../src/domain/events";
import { CHORD_LAYOUT, MELODY_LAYOUT } from "../../../src/domain/layout";

const MODEL = "d".repeat(64);
const IMAGE = { width: 640, height: 360 };

class FakeSource implements TrackingSource {
  started: SourceStart | null = null;
  stats: NonNullable<TrackingSource["stats"]> = () => null;
  handlers: { onFrame: (r: FrameResult) => void; onFailure: (e: { code: string; message: string }) => void } | null = null;
  stopped = 0;
  async start(opts: SourceStart, handlers: NonNullable<FakeSource["handlers"]>): Promise<Result<SourceInfo, SourceError>> {
    this.started = opts;
    this.handlers = handlers;
    return {
      ok: true as const,
      value: {
        camera: { deviceId: "cam-1", label: "HP HD Camera", width: 1280, height: 720, frameRate: 30 },
        delegate: opts.delegate,
        modelSha256: MODEL,
        processing: { width: 640, height: 360, longEdgePx: 640 },
      },
    };
  }
  stop() {
    this.stopped++;
    this.handlers = null;
  }
  emit(hands: WorkerHand[], tMs: number) {
    this.handlers?.onFrame({ type: "result", epoch: 1, sequence: 1, deliveredAtMs: tMs, inferenceDurationMs: 10, imageSize: IMAGE, hands });
  }
}

const PROFILE: CalibrationProfile = {
  profileVersion: 1,
  createdAt: "2026-10-12T12:00:00.000Z",
  camera: { deviceId: "cam-1", label: "HP HD Camera", width: 1280, height: 720, mirrored: true },
  processing: { longEdgePx: 640, modelSha256: MODEL },
  handednessCorrection: "as-reported",
  hands: {
    left: { region: { x: 0.05, y: 0.1, w: 0.4, h: 0.8 }, pinch: { press: 0.4, release: 0.8, closedHigh: 0.1, openLow: 0.9 } },
    right: { region: { x: 0.55, y: 0.1, w: 0.4, h: 0.8 }, pinch: { press: 0.4, release: 0.8, closedHigh: 0.1, openLow: 0.9 } },
  },
  cursorTauMs: 35,
  recommendedTempoBpm: 70,
};

function handOver(role: "left" | "right", targetId: string, pinch: number): WorkerHand {
  const layout = role === "left" ? CHORD_LAYOUT : MELODY_LAYOUT;
  const tgt = layout.targets.find((x) => x.id === targetId)!;
  const r = PROFILE.hands[role].region;
  const local = { x: tgt.x + tgt.w / 2, y: tgt.y + tgt.h / 2 };
  const display = { x: r.x + local.x * r.w, y: r.y + local.y * r.h };
  return { landmarks: handAtPalm(1 - display.x, display.y, pinch), label: role === "left" ? "Left" : "Right", score: 0.95 };
}

let source: FakeSource;
let session: SessionController;
let events: PerformanceEvent[];
let control: HandControl;
let repo: ProjectRepository;
let now = 0;
let ticks: (() => void)[];

let calibrationFactory: ConstructorParameters<typeof HandControl>[0]["createCalibration"];

class FakeLeases {
  modes: Record<string, "camera" | "off"> = {};
  renewals: [string, number][] = [];
  expired = new Set<string>();
  retired: string[] = [];
  ready = true;
  setLeaseMode(source: string, mode: "camera" | "off") { this.modes[source] = mode; }
  renewLease(source: string, sec: number) { this.renewals.push([source, sec]); }
  leaseExpired(source: string) { return this.expired.has(source); }
  retireLane(source: string) { this.retired.push(source); this.expired.delete(source); return []; }
  audioTimeAt(perfMs: number) { return perfMs / 1000; }
  soundReady() { return this.ready; }
}
let leases: FakeLeases;

async function setup(withProfile: boolean) {
  const opened = await openRepository({ factory: new IDBFactory(), nowIso: () => "2026-10-12T12:00:00.000Z" });
  if (!opened.ok) throw new Error("repo");
  repo = opened.value;
  if (withProfile) await repo.saveCalibration(PROFILE);
  source = new FakeSource();
  events = [];
  now = 0;
  ticks = [];
  session = new SessionController({ sink: { dispatch: (e) => events.push(...e) }, nowSec: () => now / 1000, nowMs: () => now, newId: (() => { let n = 0; return () => `v${++n}`; })() });
  session.loadScene(FACTORY_SCENES.jazz);
  events.length = 0; // Ignore the scene-load flush; assertions cover hand control only.
  control = new HandControl({
    session,
    repo: Promise.resolve(opened),
    source,
    nowMs: () => now,
    nowIso: () => "2026-10-12T12:00:00.000Z",
    every: (_ms, fn) => { ticks.push(fn); return () => undefined; },
    audio: (leases = new FakeLeases()),
    ...(calibrationFactory ? { createCalibration: calibrationFactory } : {}),
  });
  control.setLaneSize("left", { width: 500, height: 400 });
  control.setLaneSize("right", { width: 750, height: 400 });
}

function frame(hands: WorkerHand[], step = 33) {
  now += step;
  source.emit(hands, now);
}

async function goActive() {
  await control.start(null);
  expect(control.snapshot().phase).toBe("readiness");
  frame([handOver("left", "chord-slot-0", 0), handOver("right", "melody-pc-0", 0)]);
  frame([handOver("left", "chord-slot-0", 0), handOver("right", "melody-pc-0", 0)]);
  expect(control.snapshot().readiness).toEqual({ left: true, right: true });
  control.startPlaying();
  expect(control.snapshot().phase).toBe("active");
}

const notes = () => events.flatMap((e) => (e.kind === "note-on" ? [e.note] : []));

describe("HandControl", () => {
  beforeEach(() => setup(true));

  it("does not start the camera until asked", () => {
    expect(source.started).toBeNull();
    expect(control.snapshot().phase).toBe("off");
  });

  it("uses CPU until a benchmark has chosen a delegate", async () => {
    await control.start(null);
    expect(source.started?.delegate).toBe("CPU");
  });

  it("asks for calibration when no profile exists for this camera", async () => {
    await setup(false);
    await control.start(null);
    expect(control.snapshot()).toMatchObject({ phase: "needs-calibration", calibration: { status: "missing" } });
  });

  it("asks for recalibration when the processing model changed", async () => {
    await repo.saveCalibration({ ...PROFILE, processing: { longEdgePx: 640, modelSha256: "e".repeat(64) } });
    await control.start(null);
    expect(control.snapshot()).toMatchObject({ phase: "needs-calibration", calibration: { status: "incompatible", reasons: ["model"] } });
  });

  it("hover is silent and pinches reach the session only after explicit Start playing", async () => {
    await control.start(null);
    frame([handOver("right", "melody-pc-4", 0)]);
    frame([handOver("right", "melody-pc-4", 0)]);
    frame([handOver("right", "melody-pc-4", 1)]);
    frame([handOver("right", "melody-pc-4", 1)]);
    expect(events).toEqual([]);
    control.startPlaying();
    frame([handOver("right", "melody-pc-4", 0)]);
    frame([handOver("right", "melody-pc-4", 0)]);
    frame([handOver("right", "melody-pc-4", 1)]);
    frame([handOver("right", "melody-pc-4", 1)]);
    expect(notes()).toEqual([64]);
  });

  it("routes both hands to their lanes with exact chord pitches", async () => {
    await goActive();
    frame([handOver("left", "chord-slot-3", 0), handOver("right", "melody-pc-0", 0)]);
    frame([handOver("left", "chord-slot-3", 0), handOver("right", "melody-pc-0", 0)]);
    frame([handOver("left", "chord-slot-3", 0), handOver("right", "melody-pc-0", 0)]);
    frame([handOver("left", "chord-slot-3", 1), handOver("right", "melody-pc-0", 0)]);
    frame([handOver("left", "chord-slot-3", 1), handOver("right", "melody-pc-0", 0)]);
    expect(notes()).toEqual([45, 55, 61, 64]);
  });

  it("the watchdog releases a held note when frames stop arriving", async () => {
    await goActive();
    frame([handOver("right", "melody-pc-0", 0)]);
    frame([handOver("right", "melody-pc-0", 1)]);
    frame([handOver("right", "melody-pc-0", 1)]);
    expect(notes()).toEqual([60]);
    now += 200;
    ticks.forEach((t) => t());
    expect(events.some((e) => e.kind === "voice-release" && e.reason === "loss")).toBe(true);
    expect(session.snapshot().soundingNotes).toEqual([]);
  });

  it("a tracker failure interrupts the session and releases everything", async () => {
    await goActive();
    frame([handOver("right", "melody-pc-0", 0)]);
    frame([handOver("right", "melody-pc-0", 1)]);
    frame([handOver("right", "melody-pc-0", 1)]);
    source.handlers?.onFailure({ code: "worker-crashed", message: "Hand tracking stopped unexpectedly." });
    expect(control.snapshot()).toMatchObject({ phase: "error", error: { code: "worker-crashed" } });
    expect(session.snapshot().session).toEqual({ kind: "paused", reason: "worker-failed" });
    expect(session.snapshot().soundingNotes).toEqual([]);
  });

  it("turning the camera off releases camera-held notes and stops the source", async () => {
    await goActive();
    frame([handOver("right", "melody-pc-0", 0)]);
    frame([handOver("right", "melody-pc-0", 1)]);
    frame([handOver("right", "melody-pc-0", 1)]);
    control.stop();
    expect(source.stopped).toBeGreaterThan(0);
    expect(session.snapshot().soundingNotes).toEqual([]);
    expect(control.snapshot().phase).toBe("off");
  });

  it("a configuration change requires neutral hands again", async () => {
    await goActive();
    expect(session.setMelodyOctave(5).ok).toBe(true);
    // A hand that is already closed when the mapping changes cannot press.
    frame([handOver("right", "melody-pc-0", 1)]);
    frame([handOver("right", "melody-pc-0", 1)]);
    frame([handOver("right", "melody-pc-0", 1)]);
    frame([handOver("right", "melody-pc-0", 1)]);
    expect(notes()).toEqual([]);
    frame([handOver("right", "melody-pc-0", 0)]);
    frame([handOver("right", "melody-pc-0", 0)]);
    frame([handOver("right", "melody-pc-0", 1)]);
    frame([handOver("right", "melody-pc-0", 1)]);
    expect(notes()).toEqual([72]);
  });

  it("a lane resize disarms both hands until they open again", async () => {
    await goActive();
    control.setLaneSize("right", { width: 700, height: 380 });
    frame([handOver("right", "melody-pc-0", 1)]);
    frame([handOver("right", "melody-pc-0", 1)]);
    expect(notes()).toEqual([]);
  });

  it("a completed calibration is saved and leads to the readiness check", async () => {
    // A wizard that completes on its first frame stands in for the full sequence (tested separately).
    calibrationFactory = () => ({
      feed: () => undefined,
      step: () => ({ kind: "done", profile: PROFILE }),
      instruction: () => "",
      progress: () => 1,
      retry: () => undefined,
      skipPace: () => undefined,
    });
    await setup(false);
    calibrationFactory = undefined;
    await control.start(null);
    control.beginCalibration();
    expect(control.snapshot().phase).toBe("calibrating");
    frame([handOver("left", "chord-slot-0", 0)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(control.snapshot().phase).toBe("readiness");
    const saved = await repo.loadCalibration("cam-1");
    expect(saved.ok && saved.value?.recommendedTempoBpm).toBe(70);
  });

  it("benchmark keeps the successful delegate with the lower p95 turnaround and saves it", async () => {
    const p95 = { CPU: 80, GPU: 45 };
    source.stats = () => {
      const d = source.started?.delegate ?? "CPU";
      return {
        delegate: d, submitted: 100, skippedBusy: 0, stale: 0, failedFrames: 0, deliveryRate: 30, inferenceRate: 25,
        inferenceMs: { count: 100, p50: 20, p95: p95[d] - 10, max: 90 },
        turnaroundMs: { count: 100, p50: 30, p95: p95[d], max: 100 },
        resultAgeMs: { count: 100, p50: 30, p95: p95[d], max: 100 },
      };
    };
    const origStart = source.start.bind(source);
    source.start = async (opts, handlers) => {
      const r = await origStart(opts, handlers);
      handlers.onFrame({ type: "result", epoch: 1, sequence: 1, deliveredAtMs: 0, inferenceDurationMs: 1, imageSize: IMAGE, hands: [] });
      return r;
    };
    await control.start(null);
    const results = await control.measureDelegates(10, async () => undefined);
    expect(results.map((m) => [m.delegate, m.ok, m.turnaroundP95Ms])).toEqual([["CPU", true, 80], ["GPU", true, 45]]);
    expect(await repo.getPreference("trackingDelegate")).toEqual({ ok: true, value: "GPU" });
    expect(source.started?.delegate).toBe("GPU");
  });

  it("benchmark ignores a delegate that failed to start", async () => {
    const origStart = source.start.bind(source);
    source.start = async (opts, handlers) => {
      if (opts.delegate === "GPU") return { ok: false as const, error: { code: "init-failed", message: "No WebGL2" } };
      const r = await origStart(opts, handlers);
      handlers.onFrame({ type: "result", epoch: 1, sequence: 1, deliveredAtMs: 0, inferenceDurationMs: 1, imageSize: IMAGE, hands: [] });
      return r;
    };
    source.stats = () => ({
      delegate: "CPU", submitted: 10, skippedBusy: 0, stale: 0, failedFrames: 0, deliveryRate: 30, inferenceRate: 20,
      inferenceMs: { count: 10, p50: 30, p95: 50, max: 60 }, turnaroundMs: { count: 10, p50: 35, p95: 60, max: 70 },
      resultAgeMs: { count: 10, p50: 35, p95: 60, max: 70 },
    });
    await control.start(null);
    const results = await control.measureDelegates(10, async () => undefined);
    expect(results[1]).toMatchObject({ delegate: "GPU", ok: false, message: "No WebGL2" });
    expect(await repo.getPreference("trackingDelegate")).toEqual({ ok: true, value: "CPU" });
  });

  it("benchmark reports a delegate whose results all arrived too late, with their real timings", async () => {
    source.stats = () => {
      const cpu = source.started?.delegate === "CPU";
      return {
        delegate: cpu ? "CPU" : "GPU", submitted: 30, skippedBusy: 0, stale: cpu ? 30 : 0, failedFrames: 0, deliveryRate: 15, inferenceRate: cpu ? 5 : 7,
        inferenceMs: { count: 30, p50: cpu ? 150 : 60, p95: cpu ? 180 : 75, max: 200 },
        turnaroundMs: cpu ? null : { count: 30, p50: 65, p95: 80, max: 90 },
        resultAgeMs: cpu ? { count: 30, p50: 160, p95: 190, max: 210 } : { count: 30, p50: 65, p95: 80, max: 90 },
      };
    };
    const origStart = source.start.bind(source);
    source.start = async (opts, handlers) => {
      const r = await origStart(opts, handlers);
      if (opts.delegate === "GPU") handlers.onFrame({ type: "result", epoch: 1, sequence: 1, deliveredAtMs: 0, inferenceDurationMs: 1, imageSize: IMAGE, hands: [] });
      return r;
    };
    await control.start(null);
    const [cpu] = await control.measureDelegates(10, async () => undefined);
    expect(cpu).toMatchObject({ delegate: "CPU", ok: false, turnaroundP50Ms: 160, turnaroundP95Ms: 190 });
    expect(cpu?.message).toMatch(/too late/);
  });

  it("Start playing needs sound to be ready, then puts both lanes under camera leases", async () => {
    await control.start(null);
    frame([handOver("left", "chord-slot-0", 0), handOver("right", "melody-pc-0", 0)]);
    frame([handOver("left", "chord-slot-0", 0), handOver("right", "melody-pc-0", 0)]);
    leases.ready = false;
    control.startPlaying();
    expect(control.snapshot()).toMatchObject({ phase: "readiness", notice: expect.stringMatching(/Start sound/) });
    leases.ready = true;
    control.startPlaying();
    expect(control.snapshot().phase).toBe("active");
    expect(leases.modes).toEqual({ "live-left": "camera", "live-right": "camera" });
    control.stop();
    expect(leases.modes).toEqual({ "live-left": "off", "live-right": "off" });
  });

  it("renews the lease of each validly observed hand at the frame's audio time", async () => {
    await goActive();
    leases.renewals = [];
    frame([handOver("right", "melody-pc-0", 0)]);
    expect(leases.renewals).toEqual([["live-right", now / 1000]]);
  });

  it("an expired lease retires the lane and releases that hand in the session", async () => {
    await goActive();
    frame([handOver("right", "melody-pc-0", 0)]);
    frame([handOver("right", "melody-pc-0", 1)]);
    frame([handOver("right", "melody-pc-0", 1)]);
    expect(notes()).toEqual([60]);
    leases.expired.add("live-right");
    ticks.forEach((tick) => tick());
    expect(leases.retired).toEqual(["live-right"]);
    expect(session.snapshot().soundingNotes).toEqual([]);
  });
});


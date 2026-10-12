import { LIVE_SOURCE_BY_HAND, type HandRole, type LiveSource } from "../domain/events";
import type { SizePx } from "../domain/layout";
import type { Result } from "../domain/result";
import type { StorageError } from "../domain/storageError";
import { checkCompatibility, type CalibrationProfile, type IncompatibilityReason } from "../domain/tracking/calibration";
import { CalibrationSession, type CalibrationFrame, type CalibrationStep } from "../domain/tracking/calibrationSession";
import { palmCenter, toDisplay, type Point2 } from "../domain/tracking/geometry";
import { GestureInterpreter, type HandView, type TrackingEvent } from "../domain/tracking/gestureInterpreter";
import type { Detection } from "../domain/tracking/identity";
import type { Delegate } from "../domain/tracking/protocol";
import type { ProjectRepository } from "../persistence/indexedDbRepository";
import type { CameraInfo } from "../runtime/camera/cameraSession";
import { RollingWindow, type Summary } from "../domain/tracking/rollingStats";
import type { FrameResult, TrackerStats } from "../runtime/tracking/trackingClient";
import type { SessionController } from "./sessionController";

export interface SourceStart {
  deviceId: string | null;
  delegate: Delegate;
}

export interface SourceInfo {
  camera: CameraInfo;
  delegate: Delegate;
  modelSha256: string;
  processing: { width: number; height: number; longEdgePx: number };
}

export interface SourceError {
  code: string;
  message: string;
}

/** Camera + frame pump + vision worker, behind an interface tests can replace. */
export interface TrackingSource {
  start(
    opts: SourceStart,
    handlers: { onFrame: (r: FrameResult) => void; onFailure: (e: SourceError) => void },
  ): Promise<Result<SourceInfo, SourceError>>;
  stop(): void;
  /** Detects a hung worker; called on the watchdog timer. */
  check?(nowMs: number): void;
  stats?(nowMs: number): (TrackerStats & { deliveryRate: number }) | null;
}

export interface DelegateMeasurement {
  delegate: Delegate;
  ok: boolean;
  message: string | null;
  results: number;
  turnaroundP50Ms: number | null;
  turnaroundP95Ms: number | null;
  inferenceP95Ms: number | null;
  inferenceRate: number;
}

/** The calibration wizard surface HandControl uses (CalibrationSession implements it). */
export interface CalibrationWizard {
  feed(frame: CalibrationFrame): void;
  step(): CalibrationStep;
  instruction(): string;
  progress(nowMs?: number): number;
  retry(): void;
  skipPace(): void;
}

/** Audio-side lease control for camera lanes (implemented by the audio runtime). */
export interface AudioLeaseTarget {
  setLeaseMode(source: LiveSource, mode: "camera" | "off"): void;
  renewLease(source: LiveSource, observationSec: number): unknown;
  leaseExpired(source: LiveSource): boolean;
  retireLane(source: LiveSource): unknown;
  /** Map a performance.now() timestamp onto the audio clock. */
  audioTimeAt(perfMs: number): number;
  /** Audio running and the live instrument loaded. */
  soundReady(): boolean;
}

export type HandControlPhase = "off" | "starting" | "needs-calibration" | "calibrating" | "readiness" | "active" | "error";

export interface HandControlSnapshot {
  phase: HandControlPhase;
  error: SourceError | null;
  camera: CameraInfo | null;
  delegate: Delegate | null;
  calibration:
    | { status: "unknown" }
    | { status: "missing" }
    | { status: "incompatible"; reasons: IncompatibilityReason[] }
    | { status: "unreadable"; message: string }
    | { status: "ready"; profile: CalibrationProfile };
  wizard: { step: CalibrationStep; instruction: string; progress: number } | null;
  readiness: Record<HandRole, boolean>;
  saveError: StorageError | null;
  /** A short explanation when an action could not proceed. */
  notice: string | null;
}

export interface HandControlDeps {
  session: SessionController;
  repo: Promise<Result<ProjectRepository, StorageError>>;
  source: TrackingSource;
  nowMs: () => number;
  nowIso: () => string;
  /** Repeating timer; returns a cancel function. */
  every: (ms: number, fn: () => void) => () => void;
  createCalibration?: (setup: ConstructorParameters<typeof CalibrationSession>[0]) => CalibrationWizard;
  audio?: AudioLeaseTarget;
}

const WATCHDOG_MS = 50;
/** Wizard progress reaches React at most this often; step changes publish immediately. */
const WIZARD_PUBLISH_MS = 100;

/** Display-space palm points for the camera preview overlay (transient, never stored). */
export interface PalmPreview {
  palms: (Point2 & { label: "Left" | "Right" })[];
}
const ROLES = ["left", "right"] as const;
export const DELEGATE_PREF = "trackingDelegate";
export const CAMERA_PREF = "cameraDeviceId";

/**
 * Orchestrates hand control: camera/tracker lifecycle, calibration, the
 * readiness check and live gesture routing into the SessionController. Nothing
 * here runs from React renders; React subscribes to semantic snapshots and to
 * per-frame hand views for cursor drawing.
 */
export class HandControl {
  private readonly deps: HandControlDeps;
  private phase: HandControlPhase = "off";
  private error: SourceError | null = null;
  private info: SourceInfo | null = null;
  private profile: CalibrationProfile | null = null;
  private calibration: HandControlSnapshot["calibration"] = { status: "unknown" };
  private wizard: CalibrationWizard | null = null;
  private interpreter: GestureInterpreter | null = null;
  private readiness: Record<HandRole, boolean> = { left: false, right: false };
  private saveError: StorageError | null = null;
  private notice: string | null = null;
  /** Camera frame capture to press dispatched to audio (main thread), ms. */
  private readonly pressLatency = new RollingWindow(200);
  private lanePx: Record<HandRole, SizePx> = { left: { width: 400, height: 320 }, right: { width: 600, height: 320 } };
  private cancelWatchdog: (() => void) | null = null;
  private lastRevision: number | null = null;
  private readonly listeners = new Set<(s: HandControlSnapshot) => void>();
  private readonly handListeners = new Set<(v: Record<HandRole, HandView> | null) => void>();
  private readonly previewListeners = new Set<(p: PalmPreview) => void>();
  private lastWizardPublish = 0;
  private lastWizardKind: string | null = null;
  private current: HandControlSnapshot;

  constructor(deps: HandControlDeps) {
    this.deps = deps;
    this.current = this.build();
    deps.session.subscribe((snap) => {
      if (this.lastRevision !== null && snap.configurationRevision !== this.lastRevision) this.resetHands();
      this.lastRevision = snap.configurationRevision;
    });
  }

  snapshot(): HandControlSnapshot {
    return this.current;
  }

  subscribe(listener: (s: HandControlSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  /** Per-frame cursor/hover views for canvas/DOM drawing (not React state). */
  onHands(listener: (v: Record<HandRole, HandView> | null) => void): () => void {
    this.handListeners.add(listener);
    return () => this.handListeners.delete(listener);
  }

  /** Per-frame palm positions for the camera preview overlay. */
  onPreview(listener: (p: PalmPreview) => void): () => void {
    this.previewListeners.add(listener);
    return () => this.previewListeners.delete(listener);
  }

  stats(): (TrackerStats & { deliveryRate: number; frameToDispatchMs: Summary | null }) | null {
    const base = this.deps.source.stats?.(this.deps.nowMs());
    return base ? { ...base, frameToDispatchMs: this.pressLatency.summary() } : null;
  }

  async start(deviceId: string | null): Promise<void> {
    this.stopSource();
    this.phase = "starting";
    this.error = null;
    this.publish();
    const repo = await this.deps.repo;
    const savedDelegate = repo.ok ? await repo.value.getPreference(DELEGATE_PREF) : null;
    const delegate: Delegate = savedDelegate?.ok && savedDelegate.value === "GPU" ? "GPU" : "CPU";
    let cameraId = deviceId;
    if (cameraId === null && repo.ok) {
      const saved = await repo.value.getPreference(CAMERA_PREF);
      if (saved.ok && typeof saved.value === "string") cameraId = saved.value;
    }

    const started = await this.deps.source.start(
      { deviceId: cameraId, delegate },
      { onFrame: (r) => this.onFrame(r), onFailure: (e) => this.onFailure(e) },
    );
    if (!started.ok) {
      this.phase = "error";
      this.error = started.error;
      this.publish();
      return;
    }
    this.info = started.value;
    if (repo.ok) await repo.value.setPreference(CAMERA_PREF, started.value.camera.deviceId);
    this.cancelWatchdog = this.deps.every(WATCHDOG_MS, () => this.watchdog());
    await this.loadProfile();
    this.publish();
  }

  /** Turn the camera off. Camera-held notes are released. */
  stop(): void {
    this.stopSource();
    this.phase = "off";
    this.publish();
  }

  beginCalibration(): void {
    if (!this.info || this.phase === "off" || this.phase === "starting" || this.phase === "error") return;
    this.releaseCameraLanes();
    this.interpreter = null;
    const setup = {
      camera: { deviceId: this.info.camera.deviceId, label: this.info.camera.label, width: this.info.camera.width, height: this.info.camera.height, mirrored: true },
      processing: { longEdgePx: this.info.processing.longEdgePx, modelSha256: this.info.modelSha256 },
      nowIso: this.deps.nowIso,
      startMs: this.deps.nowMs(),
    };
    this.wizard = this.deps.createCalibration ? this.deps.createCalibration(setup) : new CalibrationSession(setup);
    this.phase = "calibrating";
    this.publish();
  }

  retryCalibrationStep(): void {
    this.wizard?.retry();
    this.publish();
  }

  skipPace(): void {
    this.wizard?.skipPace();
    this.afterWizardFrame();
  }

  cancelCalibration(): void {
    if (this.phase !== "calibrating") return;
    this.wizard = null;
    this.phase = this.profile ? "readiness" : "needs-calibration";
    if (this.profile) this.enterReadiness();
    this.publish();
  }

  /** Explicit start after the readiness check; never automatic. */
  startPlaying(): void {
    if (this.phase !== "readiness" || !this.interpreter) return;
    if (this.deps.audio && !this.deps.audio.soundReady()) {
      this.notice = "Start sound first, then start playing. The grand piano must finish loading.";
      this.publish();
      return;
    }
    this.notice = null;
    for (const role of ROLES) this.deps.audio?.setLeaseMode(LIVE_SOURCE_BY_HAND[role], "camera");
    const view = this.interpreter.view();
    for (const role of ROLES) {
      if (view[role].state === "open") this.deps.session.armCamera(role);
      else this.interpreter.disarm(role);
    }
    this.phase = "active";
    this.publish();
  }

  /** Pause hand control (back to the readiness check) without turning the camera off. */
  pausePlaying(): void {
    if (this.phase !== "active") return;
    this.releaseCameraLanes();
    this.leasesOff();
    this.enterReadiness();
    this.publish();
  }

  /**
   * Feasibility benchmark (architecture A03): run each delegate with the live
   * camera for `durationMs`, keep the successful one with the lower p95
   * turnaround, save it as the preference and restart with it. Results are
   * component measurements on this machine, not physical latency.
   */
  async measureDelegates(durationMs = 6000, wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<DelegateMeasurement[]> {
    const deviceId = this.info?.camera.deviceId ?? null;
    const measurements: DelegateMeasurement[] = [];
    this.stopSource();
    this.phase = "starting";
    this.publish();
    for (const delegate of ["CPU", "GPU"] as const) {
      let failure: SourceError | null = null;
      let results = 0;
      const started = await this.deps.source.start(
        { deviceId, delegate },
        { onFrame: () => (results += 1), onFailure: (e) => (failure = e) },
      );
      if (!started.ok) {
        measurements.push({ delegate, ok: false, message: started.error.message, results: 0, turnaroundP50Ms: null, turnaroundP95Ms: null, inferenceP95Ms: null, inferenceRate: 0 });
        continue;
      }
      await wait(durationMs);
      const stats = this.deps.source.stats?.(this.deps.nowMs()) ?? null;
      this.deps.source.stop();
      const f = failure as SourceError | null;
      // Timings include results discarded as stale, so a too-slow delegate shows how slow it was.
      const produced = (stats?.resultAgeMs?.count ?? 0) > 0;
      measurements.push({
        delegate,
        ok: f === null && results > 0,
        message:
          f?.message ??
          (results > 0 ? null : produced ? "Results arrived too late to use (over 100 ms after the frame)." : "No frames were processed."),
        results,
        turnaroundP50Ms: stats?.resultAgeMs?.p50 ?? null,
        turnaroundP95Ms: stats?.resultAgeMs?.p95 ?? null,
        inferenceP95Ms: stats?.inferenceMs?.p95 ?? null,
        inferenceRate: stats?.inferenceRate ?? 0,
      });
    }
    const best = measurements
      .filter((m) => m.ok && m.turnaroundP95Ms !== null)
      .sort((a, b) => (a.turnaroundP95Ms as number) - (b.turnaroundP95Ms as number))[0];
    const repo = await this.deps.repo;
    if (best && repo.ok) await repo.value.setPreference(DELEGATE_PREF, best.delegate);
    if (repo.ok) await repo.value.setPreference("trackingBenchmark", { at: this.deps.nowIso(), measurements });
    await this.start(deviceId);
    return measurements;
  }

  setLaneSize(hand: HandRole, size: SizePx): void {
    const prev = this.lanePx[hand];
    if (prev.width === size.width && prev.height === size.height) return;
    this.lanePx[hand] = { ...size };
    if (this.interpreter) {
      this.interpreter.setLaneSize(hand, size);
      // Responsive reflow: no stale hit targets; hands must open again.
      this.resetHands();
    }
  }

  private async loadProfile(): Promise<void> {
    const info = this.info;
    if (!info) return;
    const repo = await this.deps.repo;
    if (!repo.ok) {
      this.calibration = { status: "missing" };
      this.phase = "needs-calibration";
      return;
    }
    const loaded = await repo.value.loadCalibration(info.camera.deviceId);
    if (!loaded.ok) {
      this.calibration = { status: "unreadable", message: loaded.error.message };
      this.phase = "needs-calibration";
      return;
    }
    if (!loaded.value) {
      this.calibration = { status: "missing" };
      this.phase = "needs-calibration";
      return;
    }
    const reasons = checkCompatibility(loaded.value, {
      deviceId: info.camera.deviceId,
      width: info.camera.width,
      height: info.camera.height,
      mirrored: true,
      longEdgePx: info.processing.longEdgePx,
      modelSha256: info.modelSha256,
    });
    if (reasons.length > 0) {
      this.calibration = { status: "incompatible", reasons };
      this.phase = "needs-calibration";
      return;
    }
    this.profile = loaded.value;
    this.calibration = { status: "ready", profile: loaded.value };
    this.enterReadiness();
  }

  private enterReadiness(): void {
    if (!this.profile) return;
    this.interpreter = new GestureInterpreter({ profile: this.profile, lanePx: this.lanePx });
    this.readiness = { left: false, right: false };
    this.phase = "readiness";
  }

  private onFrame(r: FrameResult): void {
    const detections: Detection[] = r.hands.map((h) => ({ landmarks: h.landmarks, label: h.label }));
    const frame = { tMs: r.deliveredAtMs, detections, imageSize: r.imageSize };
    if (this.previewListeners.size > 0) {
      const preview: PalmPreview = { palms: detections.map((d) => ({ ...toDisplay(palmCenter(d.landmarks), true), label: d.label })) };
      for (const l of this.previewListeners) l(preview);
    }
    if (this.phase === "calibrating" && this.wizard) {
      this.wizard.feed(frame);
      this.afterWizardFrame();
      return;
    }
    if (!this.interpreter || (this.phase !== "readiness" && this.phase !== "active")) return;
    const { events, observed } = this.interpreter.process(frame);
    // Renew leases before routing, so a press in this frame starts on a live lane.
    if (this.phase === "active" && this.deps.audio) {
      const at = this.deps.audio.audioTimeAt(r.deliveredAtMs);
      for (const role of observed) this.deps.audio.renewLease(LIVE_SOURCE_BY_HAND[role], at);
    }
    this.route(events);
    this.emitHands();
  }

  private afterWizardFrame(): void {
    const step = this.wizard?.step();
    const now = this.deps.nowMs();
    const key = step ? `${step.kind}:${"hand" in step ? step.hand : ""}:${step.kind === "pinch" ? `${step.cycle}${step.phase}` : ""}` : null;
    if (step?.kind !== "done" && key === this.lastWizardKind && now - this.lastWizardPublish < WIZARD_PUBLISH_MS) return;
    this.lastWizardKind = key;
    this.lastWizardPublish = now;
    if (step?.kind === "done") {
      const profile = step.profile;
      this.wizard = null;
      this.profile = profile;
      this.calibration = { status: "ready", profile };
      this.enterReadiness();
      void this.saveProfile(profile);
    }
    this.publish();
  }

  private async saveProfile(profile: CalibrationProfile): Promise<void> {
    const repo = await this.deps.repo;
    const result = repo.ok ? await repo.value.saveCalibration(profile) : repo;
    this.saveError = result.ok ? null : result.error;
    this.publish();
  }

  private route(events: readonly TrackingEvent[]): void {
    const live = this.phase === "active";
    let changed = false;
    for (const e of events) {
      if (this.phase === "readiness" && e.type === "arm") {
        this.readiness[e.hand] = true;
        changed = true;
      }
      if (!live) continue;
      const s = this.deps.session;
      switch (e.type) {
        case "arm":
          s.armCamera(e.hand);
          break;
        case "press":
          s.press(e.hand, e.targetId, "camera");
          this.pressLatency.push(this.deps.nowMs() - e.tMs);
          break;
        case "release":
          s.release(e.hand, "camera");
          break;
        case "rest":
          s.rest(e.hand, "camera");
          break;
        case "lost":
          s.lost(e.hand);
          break;
      }
    }
    if (changed) this.publish();
  }

  private watchdog(): void {
    this.deps.source.check?.(this.deps.nowMs());
    if (!this.interpreter) return;
    // Audio-thread leases are authoritative: an expired lane is retired here
    // as soon as the main thread runs again, and the hand must reopen.
    const audio = this.deps.audio;
    if (this.phase === "active" && audio) {
      for (const role of ROLES) {
        const source = LIVE_SOURCE_BY_HAND[role];
        if (audio.leaseExpired(source)) {
          audio.retireLane(source);
          this.deps.session.lost(role);
          this.interpreter.disarm(role);
        }
      }
    }
    const events = this.interpreter.tick(this.deps.nowMs());
    if (events.length) {
      this.route(events);
      this.emitHands();
    }
  }

  private onFailure(error: SourceError): void {
    this.stopSource();
    this.phase = "error";
    this.error = error;
    this.deps.session.interrupt(error.code.startsWith("worker") || error.code.startsWith("init") ? "worker-failed" : "camera-failed");
    this.publish();
  }

  private resetHands(): void {
    if (!this.interpreter) return;
    this.releaseCameraLanes();
    this.interpreter.reset();
    this.readiness = { left: false, right: false };
    this.emitHands();
  }

  private releaseCameraLanes(): void {
    const snap = this.deps.session.peek();
    for (const role of ROLES) {
      if (snap && (snap.lanes[role].input === "camera" || snap.lanes[role].input === null) && snap.lanes[role].state !== "disarmed") {
        this.deps.session.lost(role);
      }
    }
  }

  private leasesOff(): void {
    for (const role of ROLES) this.deps.audio?.setLeaseMode(LIVE_SOURCE_BY_HAND[role], "off");
  }

  private stopSource(): void {
    this.cancelWatchdog?.();
    this.cancelWatchdog = null;
    if (this.phase === "active") this.leasesOff();
    if (this.interpreter || this.wizard) this.releaseCameraLanes();
    this.deps.source.stop();
    this.interpreter = null;
    this.wizard = null;
    this.readiness = { left: false, right: false };
    this.emitHands();
  }

  private emitHands(): void {
    const view = this.interpreter?.view() ?? null;
    for (const l of this.handListeners) {
      try {
        l(view);
      } catch (error) {
        console.error("Hand view listener failed", error);
      }
    }
  }

  private build(): HandControlSnapshot {
    return Object.freeze({
      phase: this.phase,
      error: this.error,
      camera: this.info?.camera ?? null,
      delegate: this.info?.delegate ?? null,
      calibration: this.calibration,
      wizard: this.wizard
        ? { step: this.wizard.step(), instruction: this.wizard.instruction(), progress: this.wizard.progress(this.deps.nowMs()) }
        : null,
      readiness: { ...this.readiness },
      saveError: this.saveError,
      notice: this.notice,
    });
  }

  private publish(): void {
    this.current = this.build();
    for (const l of this.listeners) {
      try {
        l(this.current);
      } catch (error) {
        console.error("Hand control listener failed", error);
      }
    }
  }
}

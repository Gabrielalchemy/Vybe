/// <reference lib="webworker" />
import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { Delegate, WorkerHand, WorkerMessage, WorkerRequest } from "../domain/tracking/protocol";

/**
 * Hand landmark inference off the UI thread (architecture A03). One frame is
 * processed at a time; the main thread only sends a frame when this worker is
 * idle. Every transferred bitmap is closed. Initialization failure is reported
 * and never silently moved to another thread.
 */
declare const self: DedicatedWorkerGlobalScope;

// Detector thresholds start at 0.6 and are tuned only against labelled trials.
const DETECTION_THRESHOLD = 0.6;

let landmarker: HandLandmarker | null = null;
let epoch = -1;
let lastTimestampMs = -Infinity;

const post = (msg: WorkerMessage) => self.postMessage(msg);

function toHands(result: HandLandmarkerResult): WorkerHand[] {
  return result.landmarks.slice(0, 2).map((landmarks, i) => {
    const category = result.handedness[i]?.[0];
    return {
      landmarks: landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      label: category?.categoryName === "Left" ? "Left" : "Right",
      score: category?.score ?? 0,
    };
  });
}

async function init(req: Extract<WorkerRequest, { type: "init" }>): Promise<void> {
  landmarker?.close();
  landmarker = null;
  epoch = req.epoch;
  lastTimestampMs = -Infinity;
  const delegate: Delegate = req.delegate;
  try {
    const fileset = await FilesetResolver.forVisionTasks("", true);
    fileset.wasmLoaderPath = req.wasmLoaderPath;
    fileset.wasmBinaryPath = req.wasmBinaryPath;
    const created = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: new Uint8Array(req.model), delegate },
      ...(delegate === "GPU" ? { canvas: new OffscreenCanvas(1, 1) } : {}),
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: DETECTION_THRESHOLD,
      minHandPresenceConfidence: DETECTION_THRESHOLD,
      minTrackingConfidence: DETECTION_THRESHOLD,
    });
    if (req.epoch !== epoch) {
      created.close();
      return;
    }
    landmarker = created;
    post({ type: "ready", epoch: req.epoch, delegate });
  } catch (error) {
    post({ type: "init-failed", epoch: req.epoch, delegate, message: error instanceof Error ? error.message : String(error) });
  }
}

function frame(req: Extract<WorkerRequest, { type: "frame" }>): void {
  const { bitmap } = req;
  try {
    if (req.epoch !== epoch || !landmarker) {
      post({ type: "frame-failed", epoch: req.epoch, sequence: req.sequence, message: "Tracker is not ready for this session." });
      return;
    }
    // MediaPipe requires strictly increasing timestamps in VIDEO mode.
    const timestamp = Math.max(req.deliveredAtMs, lastTimestampMs + 0.001);
    lastTimestampMs = timestamp;
    const started = performance.now();
    const result = landmarker.detectForVideo(bitmap, timestamp);
    const inferenceDurationMs = performance.now() - started;
    post({
      type: "result",
      epoch: req.epoch,
      sequence: req.sequence,
      deliveredAtMs: req.deliveredAtMs,
      inferenceDurationMs,
      imageSize: { width: bitmap.width, height: bitmap.height },
      hands: toHands(result),
    });
  } catch (error) {
    post({ type: "frame-failed", epoch: req.epoch, sequence: req.sequence, message: error instanceof Error ? error.message : String(error) });
  } finally {
    bitmap.close();
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  switch (req.type) {
    case "init":
      void init(req);
      break;
    case "frame":
      frame(req);
      break;
    case "close":
      landmarker?.close();
      landmarker = null;
      self.close();
      break;
  }
};

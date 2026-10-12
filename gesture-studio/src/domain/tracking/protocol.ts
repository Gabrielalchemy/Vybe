import { fail, ok, type Result } from "../result";
import type { Landmark } from "./geometry";

export type Delegate = "GPU" | "CPU";

/** Main thread -> vision worker. */
export type WorkerRequest =
  | { type: "init"; epoch: number; delegate: Delegate; wasmLoaderPath: string; wasmBinaryPath: string; model: ArrayBuffer }
  | { type: "frame"; epoch: number; sequence: number; deliveredAtMs: number; bitmap: ImageBitmap }
  | { type: "close" };

export interface WorkerHand {
  landmarks: Landmark[];
  label: "Left" | "Right";
  /** Handedness classification score; not a tracking confidence. */
  score: number;
}

/** Vision worker -> main thread. Validated on receipt. */
export type WorkerMessage =
  | { type: "ready"; epoch: number; delegate: Delegate }
  | { type: "init-failed"; epoch: number; delegate: Delegate; message: string }
  | { type: "frame-failed"; epoch: number; sequence: number; message: string }
  | {
      type: "result";
      epoch: number;
      sequence: number;
      /** Main-thread timestamp passed through unchanged. */
      deliveredAtMs: number;
      /** Elapsed inference time measured inside the worker. */
      inferenceDurationMs: number;
      imageSize: { width: number; height: number };
      hands: WorkerHand[];
    };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isDelegate = (v: unknown): v is Delegate => v === "GPU" || v === "CPU";

function validHand(v: unknown): v is WorkerHand {
  if (!isObj(v) || (v.label !== "Left" && v.label !== "Right") || !isFiniteNum(v.score)) return false;
  return (
    Array.isArray(v.landmarks) &&
    v.landmarks.length === 21 &&
    v.landmarks.every((p: unknown) => isObj(p) && isFiniteNum(p.x) && isFiniteNum(p.y) && isFiniteNum(p.z))
  );
}

export function validateWorkerMessage(raw: unknown): Result<WorkerMessage> {
  if (!isObj(raw) || !isCount(raw.epoch)) return fail("Worker message lacks an epoch.");
  switch (raw.type) {
    case "ready":
      return isDelegate(raw.delegate) ? ok({ type: "ready", epoch: raw.epoch, delegate: raw.delegate }) : fail("Bad delegate.");
    case "init-failed":
      return isDelegate(raw.delegate) && typeof raw.message === "string"
        ? ok({ type: "init-failed", epoch: raw.epoch, delegate: raw.delegate, message: raw.message })
        : fail("Bad init-failed message.");
    case "frame-failed":
      return isCount(raw.sequence) && typeof raw.message === "string"
        ? ok({ type: "frame-failed", epoch: raw.epoch, sequence: raw.sequence, message: raw.message })
        : fail("Bad frame-failed message.");
    case "result": {
      const size = raw.imageSize;
      if (!isCount(raw.sequence) || !isFiniteNum(raw.deliveredAtMs) || !isFiniteNum(raw.inferenceDurationMs) || raw.inferenceDurationMs < 0) {
        return fail("Bad result timing.");
      }
      if (!isObj(size) || !isFiniteNum(size.width) || !isFiniteNum(size.height) || size.width <= 0 || size.height <= 0) {
        return fail("Bad result image size.");
      }
      if (!Array.isArray(raw.hands) || raw.hands.length > 2 || !raw.hands.every(validHand)) return fail("Bad result hands.");
      return ok({
        type: "result",
        epoch: raw.epoch,
        sequence: raw.sequence,
        deliveredAtMs: raw.deliveredAtMs,
        inferenceDurationMs: raw.inferenceDurationMs,
        imageSize: { width: size.width, height: size.height },
        hands: raw.hands as WorkerHand[],
      });
    }
    default:
      return fail(`Unknown worker message type: ${String(raw.type)}`);
  }
}

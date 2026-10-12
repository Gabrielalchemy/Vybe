import { describe, expect, it } from "vitest";
import { validateWorkerMessage } from "../../../../src/domain/tracking/protocol";
import { syntheticHand } from "../../../fixtures/hands";

const result = (overrides: Record<string, unknown> = {}) => ({
  type: "result",
  epoch: 2,
  sequence: 10,
  deliveredAtMs: 1234.5,
  inferenceDurationMs: 18.2,
  imageSize: { width: 640, height: 360 },
  hands: [{ landmarks: syntheticHand({ cx: 0.5, cy: 0.5 }), label: "Left", score: 0.97 }],
  ...overrides,
});

describe("validateWorkerMessage", () => {
  it("accepts a well-formed result", () => {
    const r = validateWorkerMessage(result());
    expect(r.ok && r.value.type).toBe("result");
  });

  it("accepts ready, init-failed and frame-failed messages", () => {
    expect(validateWorkerMessage({ type: "ready", epoch: 1, delegate: "CPU" }).ok).toBe(true);
    expect(validateWorkerMessage({ type: "init-failed", epoch: 1, delegate: "GPU", message: "no WebGL" }).ok).toBe(true);
    expect(validateWorkerMessage({ type: "frame-failed", epoch: 1, sequence: 3, message: "x" }).ok).toBe(true);
  });

  it("rejects unknown types and missing epochs", () => {
    expect(validateWorkerMessage({ type: "hello" }).ok).toBe(false);
    expect(validateWorkerMessage({ ...result(), epoch: undefined }).ok).toBe(false);
  });

  it("rejects hands with the wrong landmark count, non-finite values or labels", () => {
    expect(validateWorkerMessage(result({ hands: [{ landmarks: [], label: "Left", score: 1 }] })).ok).toBe(false);
    const bad = syntheticHand({ cx: 0.5, cy: 0.5 });
    bad[3] = { x: Number.POSITIVE_INFINITY, y: 0, z: 0 };
    expect(validateWorkerMessage(result({ hands: [{ landmarks: bad, label: "Left", score: 1 }] })).ok).toBe(false);
    expect(validateWorkerMessage(result({ hands: [{ landmarks: syntheticHand({ cx: 0.5, cy: 0.5 }), label: "Up", score: 1 }] })).ok).toBe(false);
  });

  it("rejects more than two hands and negative durations", () => {
    const h = { landmarks: syntheticHand({ cx: 0.5, cy: 0.5 }), label: "Left", score: 1 };
    expect(validateWorkerMessage(result({ hands: [h, h, h] })).ok).toBe(false);
    expect(validateWorkerMessage(result({ inferenceDurationMs: -1 })).ok).toBe(false);
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { fitFrame, CaptureGeneration, captureErrorMessage } from "./capture.ts";

test("frame scaling preserves aspect ratio and never upscales", () => {
  assert.deepEqual(fitFrame(1920, 1080), { width: 1280, height: 720 });
  assert.deepEqual(fitFrame(640, 480), { width: 640, height: 480 });
  assert.deepEqual(fitFrame(1, 10000), { width: 1, height: 10000 });
});
test("invalid frame dimensions are rejected", () => {
  for (const n of [0, -1, NaN, Infinity]) assert.throws(() => fitFrame(n, 100));
  assert.throws(() => fitFrame(100, 100, 0));
});
test("stop invalidates an in-flight permission result", () => {
  const generation = new CaptureGeneration();
  const pending = generation.begin();
  generation.invalidate();
  assert.equal(generation.isCurrent(pending), false);
  const resumed = generation.begin();
  assert.equal(generation.isCurrent(resumed), true);
  assert.equal(generation.isCurrent(pending), false);
});
test("permission error is actionable without exposing raw exceptions", () => {
  const error = new Error("private details");
  error.name = "NotAllowedError";
  assert.match(captureErrorMessage(error), /cancelled/);
  assert.equal(captureErrorMessage(error).includes("private details"), false);
});

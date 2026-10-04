import assert from "node:assert/strict";
import test from "node:test";
import { describeSharingSource, formatCaptureTime } from "./sharing-source.ts";
import {
  REMY_CLOSING_GUIDANCE,
  REMY_DIALOGUE_GUIDANCE,
  REMY_SAYINGS,
} from "./remy-dialogue.ts";

test("shared source reports actual browser label/type and updates without guessed monitor numbering", () => {
  assert.equal(
    describeSharingSource({
      label: "Invoice tab",
      getSettings: () => ({
        displaySurface: "browser",
        width: 1280,
        height: 720,
      }),
    }),
    "Tab: Invoice tab · 1280 × 720",
  );
  assert.equal(
    describeSharingSource({
      label: "screen:0:0",
      getSettings: () => ({ displaySurface: "monitor" }),
    }),
    "Screen: screen:0:0",
  );
  assert.equal(
    describeSharingSource({ label: "", getSettings: () => ({}) }),
    "Share",
  );
  assert.ok(
    describeSharingSource({ label: "x".repeat(500), getSettings: () => ({}) })
      .length < 180,
  );
});

test("duration display remains valid beyond two minutes", () => {
  assert.equal(formatCaptureTime(125000), "02:05");
  assert.equal(formatCaptureTime(-5), "00:00");
  assert.equal(formatCaptureTime(3600000), "60:00");
});

test("Remy repertoire has conditions, English default and explicit completion before summary", () => {
  assert.ok(REMY_SAYINGS.every((item) => item.when && item.examples.length));
  assert.match(REMY_DIALOGUE_GUIDANCE, /Default to English/);
  assert.match(REMY_CLOSING_GUIDANCE, /wait for an explicit answer/);
  assert.ok(
    REMY_CLOSING_GUIDANCE.indexOf("confirms the process is complete") <
      REMY_CLOSING_GUIDANCE.indexOf("clarification questions"),
  );
  assert.match(
    REMY_CLOSING_GUIDANCE,
    /stop immediately.*always takes priority/,
  );
});

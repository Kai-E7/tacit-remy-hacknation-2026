import assert from "node:assert/strict";
import test from "node:test";
import { questionTimingFromAnswer, questionTimingChange, questionTimingContext } from "./interview-preference.ts";

test("detects explicit in-process and end-only answers", () => {
  assert.equal(questionTimingFromAnswer("Yes, you can jump in as we go."), "during");
  assert.equal(questionTimingFromAnswer("Please save questions for the end."), "end");
  assert.equal(questionTimingFromAnswer("Frag ruhig zwischendurch."), "during");
  assert.equal(questionTimingFromAnswer("Bitte erst am Ende fragen."), "end");
});

test("does not infer consent from ambiguous process narration", () => {
  assert.equal(questionTimingFromAnswer("First I open Outlook and after that Notion."), "unset");
  assert.equal(questionTimingFromAnswer("You can jump in, but save questions for the end."), "unset");
  assert.equal(questionTimingChange("At the end I send the offer."), "unset");
  assert.equal(questionTimingChange("Please save your questions for the end."), "end");
  assert.match(questionTimingContext("end"), /do not ask any process-related question/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { finishRecording } from "./finish-recording.ts";
import {
  appendRecording,
  attachDraftMap,
  renameRecordedProcess,
  CURRENT_USER,
  type RecordingInput,
} from "./processes.ts";

const input: RecordingInput = {
  processId: "p1",
  versionId: "v1",
  owner: CURRENT_USER,
  title: "Prozess · Test",
  summary: "",
  evidence: [
    {
      id: "f1",
      image: "data:image/jpeg;base64,YQ==",
      time: "12:00",
      capturedAt: "2026-10-03T10:00:00Z",
      note: "",
    },
  ],
  transcript: [],
  now: "2026-10-03T10:01:00Z",
  basedOnVersionId: null,
};
const map = {
  title: "Rechnung prüfen",
  summary: "Eine Rechnung ist sichtbar.",
  steps: [
    {
      id: "s1",
      title: "Rechnung ansehen",
      action: "Rechnung sichtbar",
      decision: "",
      reason: "",
      provenance: "observed",
      frameId: "f1",
      utteranceId: "",
      quote: "",
    },
  ],
  edges: [],
  guardrails: [],
  questions: ["Was prüfst du?"],
};
test("stop commits raw evidence before model requests and marks map as unreviewed", async () => {
  const events: string[] = [];
  let current = appendRecording(undefined, input);
  const result = await finishRecording(input, {
    signal: new AbortController().signal,
    generateMap: true,
    save: async (value) => {
      events.push("save");
      current = appendRecording(undefined, value);
      return current;
    },
    onSaved: () => {
      events.push("saved-ui");
    },
    request: async () => {
      events.push("model");
      return Response.json({ map });
    },
    attach: async (id, owner, version, title, value) => {
      events.push("attach");
      current = attachDraftMap(current, owner, version, title, value);
      return current;
    },
  });
  assert.deepEqual(events, ["save", "saved-ui", "model", "attach"]);
  assert.equal(result.process.versions.length, 1);
  assert.equal(result.process.versions[0].reviewedAt, undefined);
  assert.deepEqual(result.process.versions[0].evidence, input.evidence);
});
test("AI failure leaves saved sources and a warning, not data loss", async () => {
  let saved = false;
  const result = await finishRecording(input, {
    signal: new AbortController().signal,
    generateMap: true,
    save: async () => appendRecording(undefined, input),
    onSaved: () => {
      saved = true;
    },
    request: async () => Response.json({ error: "failed" }, { status: 502 }),
    attach: async () => {
      throw new Error("must not attach");
    },
  });
  assert.equal(saved, true);
  assert.ok(result.warning);
  assert.equal(result.process.versions[0].evidence.length, 1);
});
test("storage failure never starts AI or announces saved", async () => {
  await assert.rejects(
    () =>
      finishRecording(input, {
        signal: new AbortController().signal,
        generateMap: true,
        save: async () => {
          throw new Error("quota");
        },
        onSaved: () => assert.fail("false success"),
        request: async () => {
          assert.fail("paid request");
        },
        attach: async () => {
          assert.fail("attach");
        },
      }),
    /quota/,
  );
});
test("off-record cancellation preserves local save and prevents further model dispatch", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await finishRecording(input, {
    signal: controller.signal,
    generateMap: true,
    save: async () => appendRecording(undefined, input),
    onSaved() {},
    request: async () => {
      assert.fail("no dispatch");
    },
    attach: async () => {
      assert.fail("no attach");
    },
  });
  assert.equal(result.process.id, input.processId);
});
test("rename preserves all evidence and late draft cannot overwrite the new name", () => {
  const original = appendRecording(undefined, input),
    before = JSON.stringify(original);
  const renamed = renameRecordedProcess(
    original,
    CURRENT_USER.id,
    "Mein Ablauf",
  );
  const completed = attachDraftMap(
    renamed,
    CURRENT_USER.id,
    "v1",
    input.title,
    map,
  );
  assert.equal(completed.title, "Mein Ablauf");
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(
    completed.versions[0].evidence,
    original.versions[0].evidence,
  );
  assert.throws(() => renameRecordedProcess(original, "other", "Name"));
  assert.throws(() => renameRecordedProcess(original, CURRENT_USER.id, " "));
  assert.throws(() =>
    attachDraftMap(original, CURRENT_USER.id, "missing", input.title, map),
  );
  assert.equal(
    attachDraftMap(completed, CURRENT_USER.id, "v1", input.title, map),
    completed,
  );
});
test("retry is idempotent and an existing completed map avoids a second API request", async () => {
  const completed = attachDraftMap(
    appendRecording(undefined, input),
    CURRENT_USER.id,
    "v1",
    input.title,
    map,
  );
  const result = await finishRecording(input, {
    signal: new AbortController().signal,
    generateMap: true,
    save: async (value) => appendRecording(completed, value),
    onSaved() {},
    request: async () => {
      assert.fail("duplicate inference");
    },
    attach: async () => {
      assert.fail("duplicate attach");
    },
  });
  assert.equal(result.process.versions.length, 1);
});

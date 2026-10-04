import { test } from "node:test";
import assert from "node:assert/strict";
import { fallbackRedact, privacyScan, validPrivacyResult } from "./privacy.ts";
import { preparePrivateRecording } from "./privacy-recording.ts";
import {
  createPrivacyHandler,
  createPrivacyScanner,
} from "../server/privacy.ts";
import {
  appendRecording,
  CURRENT_USER,
  type RecordingInput,
} from "./processes.ts";
import { finishRecording } from "./finish-recording.ts";
import { createLearningHandler } from "../server/learning.ts";

const sample =
  "Jane Doe emails jane@example.com. Tel +49 30 12345678. IBAN DE89 3704 0044 0532 0130 00.";
test("demo fallback redacts named synthetic examples, email, telephone and IBAN but never claims Presidio", () => {
  const result = fallbackRedact([sample]);
  for (const raw of ["Jane", "jane@", "12345678", "3704"])
    assert.ok(!result.texts[0].includes(raw));
  assert.equal(result.report.status, "manual review required");
  assert.equal(result.report.engine, "demo-fallback");
  assert.equal(
    fallbackRedact(["Open Outlook and Notion. Invoice 5000 EUR."]).texts[0],
    "Open Outlook and Notion. Invoice 5000 EUR.",
  );
  assert.equal(fallbackRedact(result.texts).texts[0], result.texts[0]);
});
test("missing/failing Presidio is explicit fallback; invalid endpoints and forged success are rejected", async () => {
  assert.equal(
    (await createPrivacyScanner({})([sample])).report.engine,
    "demo-fallback",
  );
  let calls = 0;
  const scanner = createPrivacyScanner({
    endpoint: "http://evil.example/redact",
    request: async () => {
      calls++;
      throw new Error("secret raw error");
    },
  });
  assert.equal(
    (await scanner([sample])).report.status,
    "manual review required",
  );
  assert.equal(calls, 0);
  assert.equal(
    validPrivacyResult(
      {
        ...fallbackRedact([sample]),
        report: {
          ...fallbackRedact([sample]).report,
          status: "privacy scan passed",
        },
      },
      1,
    ),
    false,
  );
  assert.equal(
    (
      await privacyScan([sample], undefined, async () => {
        throw new Error("raw private error");
      })
    ).report.engine,
    "demo-fallback",
  );
});
test("privacy endpoint checks access, origin, sizes and no-store without logging raw errors", async () => {
  const handler = createPrivacyHandler({
    authorized: (r) => r.headers.get("cookie") === "test",
    origins: ["http://localhost"],
    scan: async (texts) => fallbackRedact(texts),
  });
  const req = (cookie: string, origin: string, texts: unknown) =>
    new Request("http://localhost/api/privacy", {
      method: "POST",
      headers: { cookie, origin, "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });
  assert.equal(
    (await handler(req("", "http://localhost", [sample]))).status,
    401,
  );
  assert.equal(
    (await handler(req("test", "https://evil.example", [sample]))).status,
    403,
  );
  assert.equal(
    (await handler(req("test", "http://localhost", ["x".repeat(6001)]))).status,
    400,
  );
  const response = await handler(req("test", "http://localhost", [sample]));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.ok(!(await response.text()).includes("jane@example.com"));
});
const input = (): RecordingInput => ({
  processId: "privacy-demo",
  versionId: "v1",
  owner: CURRENT_USER,
  title: "Demo",
  summary: "",
  now: "2026-10-04T00:00:00Z",
  basedOnVersionId: null,
  evidence: [
    {
      id: "raw-frame",
      image: "data:image/jpeg;base64,UkFX",
      time: "now",
      capturedAt: "2026-10-04T00:00:00Z",
      note: "raw",
    },
  ],
  transcript: [
    { id: "u1", role: "user", text: sample, at: "2026-10-04T00:00:00Z" },
  ],
});
test("save gate removes original image and transcript copies; fallback never calls Claude; retry is idempotent", async () => {
  const raw = input();
  const safe = await preparePrivateRecording(raw, async (texts) =>
    fallbackRedact(texts),
  async () => { throw new Error("scanner unavailable"); },
  );
  assert.equal(raw.evidence.length, 1);
  assert.equal(safe.evidence.length, 0);
  assert.equal(safe.privacy?.imagesWithheld, 1);
  assert.ok(!JSON.stringify(safe).includes("jane@example.com"));
  const saved = appendRecording(undefined, safe);
  assert.equal(appendRecording(saved, safe).versions.length, 1);
  const result = await finishRecording(raw, {
    signal: new AbortController().signal,
    generateMap: true,
    save: async () => saved,
    attach: async () => {
      throw new Error("must not attach");
    },
    onSaved: () => {},
    request: async () => {
      throw new Error("must not call Claude");
    },
  });
  assert.match(result.warning!, /manual review required/);
});
test("save gate persists only the image returned by the image scanner", async () => {
  const raw = input();
  const safe = await preparePrivateRecording(
    raw,
    async (texts) => ({ texts, report: { engine: "presidio", status: "privacy scan passed", redactions: 0, imagesWithheld: 0, policy: "text-v1" } }),
    async () => ({ image: "data:image/jpeg;base64,U0FGRQ==", redactions: 1, status: "redaction applied" }),
  );
  assert.equal(safe.evidence[0].image, "data:image/jpeg;base64,U0FGRQ==");
  assert.equal(safe.privacy?.imagesWithheld, 0);
  assert.equal(safe.privacy?.status, "redaction applied");
  assert.ok(!JSON.stringify(safe).includes("UkFX"));
});
test("server learning gate rejects screenshots and unavailable privacy before any Claude dispatch", async () => {
  let calls = 0;
  const handler = createLearningHandler({
    enabled: true,
    origins: ["http://localhost"],
    apiKey: "test",
    mapModel: "test",
    visionModel: "test",
    privacyScan: async (texts) => fallbackRedact(texts),
    request: async () => {
      calls++;
      throw new Error();
    },
  });
  const req = (mode: string, frames: unknown[]) =>
    new Request("http://localhost/api/learning", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({ mode, frames, transcript: input().transcript }),
    });
  assert.equal((await handler(req("observe", input().evidence))).status, 428);
  assert.equal((await handler(req("voice-map", []))).status, 428);
  assert.equal(calls, 0);
});

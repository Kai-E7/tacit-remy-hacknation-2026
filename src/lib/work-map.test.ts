import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorkMap, parseEvidence, type Utterance } from "./work-map.ts";
import { createLearningHandler } from "../server/learning.ts";
import { appendRecording, type Evidence, CURRENT_USER } from "./processes.ts";

const frames: Evidence[] = [
  {
    id: "f1",
    image: "data:image/jpeg;base64,YQ==",
    time: "12:00",
    capturedAt: "2026-10-03T10:00:00Z",
    note: "This is a manual note, not a quote.",
  },
];
const transcript: Utterance[] = [
  {
    id: "u1",
    role: "user",
    text: "Wenn die Bestellnummer fehlt, halte ich an und frage den Einkauf.",
    at: "2026-10-03T10:00:01Z",
  },
];
const source = { frameId: "f1", utteranceId: "u1", quote: transcript[0].text };
const map = {
  title: "Rechnung prüfen",
  summary: "Nummer prüfen, bei fehlender Nummer anhalten.",
  steps: [
    {
      id: "s1",
      title: "Bestellnummer prüfen",
      action: "Bestellnummer ansehen",
      decision: "Nummer vorhanden?",
      reason: "Bei fehlender Nummer Einkauf fragen.",
      provenance: "observed",
      ...source,
    },
  ],
  edges: [],
  guardrails: [
    {
      rule: "Bei fehlender Bestellnummer anhalten und Einkauf fragen.",
      stepId: "s1",
      ...source,
    },
  ],
  questions: ["Wer übernimmt im Vertretungsfall?"],
};
const request = (body: object, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/learning", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("optional application metadata is bounded and legacy maps stay valid", () => {
  const withApps = {
    ...map,
    steps: [{ ...map.steps[0], applications: ["Outlook", "Notion"] }],
  };
  assert.deepEqual(parseWorkMap(withApps, frames, transcript), withApps);
  assert.throws(() =>
    parseWorkMap(
      {
        ...map,
        steps: [{ ...map.steps[0], applications: ["A", "B", "C", "D", "E"] }],
      },
      frames,
      transcript,
    ),
  );
  assert.throws(() =>
    parseWorkMap(
      { ...map, steps: [{ ...map.steps[0], applications: [""] }] },
      frames,
      transcript,
    ),
  );
});

test("voice-only explained steps and named actors need real user quotes", async () => {
  const voiceMap = { ...map, steps: [{ ...map.steps[0], frameId: "", provenance: "explained", actor: { name: "Einkauf", utteranceId: "u1", quote: transcript[0].text } }], guardrails: [] };
  assert.deepEqual(parseWorkMap(voiceMap, [], transcript), voiceMap);
  assert.throws(() => parseWorkMap({ ...voiceMap, steps: [{ ...voiceMap.steps[0], provenance: "observed" }] }, [], transcript));
  assert.throws(() => parseWorkMap({ ...voiceMap, steps: [{ ...voiceMap.steps[0], actor: { name: "Anna", utteranceId: "u1", quote: "Anna performs the step" } }] }, [], transcript));
  assert.throws(() => parseWorkMap(voiceMap, [], [{ ...transcript[0], role: "agent" }]));
  assert.throws(() => parseEvidence([]));
  assert.deepEqual(parseEvidence([], true), []);
  const handler = createLearningHandler({ enabled: true, origins: ["http://localhost:3000"], apiKey: "test", mapModel: "test", request: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.match(body.system, /VOICE-ONLY MODE/);
    assert.ok(!body.messages[0].content.some((c: { type: string }) => c.type === "image"));
    return Response.json({ content: [{ type: "tool_use", name: "document", input: voiceMap }] });
  } });
  assert.equal((await handler(request({ mode: "voice-map", frames: [], transcript }))).status, 200);
  assert.equal((await handler(request({ mode: "voice-map", frames, transcript }))).status, 400);
  assert.equal((await handler(request({ mode: "voice-map", frames: [], transcript: [] }))).status, 400);
});

test("compact live extraction uses low effort, accepts an opening without actions and validates quotes", async () => {
  let result: unknown = { title: "Live", steps: [], edges: [], question: "" };
  const handler = createLearningHandler({ enabled: true, origins: ["http://localhost:3000"], apiKey: "test", liveModel: "claude-sonnet-5-5", request: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.output_config.effort, "low");
    assert.equal(body.max_tokens, 2200);
    return Response.json({ content: [{ type: "tool_use", name: "document", input: result }] });
  } });
  const payload = { mode: "voice-live", frames: [], transcript };
  assert.deepEqual(await (await handler(request(payload))).json(), { map: null });
  result = { title: "Prüfung", steps: [{ id: "s1", title: "Einkauf fragen", application: "", actor: "", utteranceId: "u1", quote: transcript[0].text, decision: "" }], edges: [], question: "Wer ist zuständig?" };
  const r = await handler(request(payload)); assert.equal(r.status, 200);
  const output = (await r.json()).map;
  assert.equal(output.steps[0].provenance, "explained"); assert.equal(output.steps[0].frameId, "");
  assert.equal(output.steps[0].action, "Einkauf fragen"); assert.deepEqual(output.guardrails, []);
  (result as { steps: { quote: string }[] }).steps[0].quote = "invented quote";
  assert.equal((await handler(request(payload))).status, 502);
});

test("Work Map binds actual frames and verbatim expert utterances", () => {
  assert.deepEqual(parseWorkMap(map, frames, transcript), map);
  assert.throws(() =>
    parseWorkMap(
      { ...map, steps: [{ ...map.steps[0], frameId: "fabricated" }] },
      frames,
      transcript,
    ),
  );
  assert.throws(() =>
    parseWorkMap(
      {
        ...map,
        guardrails: [
          { ...map.guardrails[0], quote: "Over 1000 needs approval" },
        ],
      },
      frames,
      transcript,
    ),
  );
  assert.throws(() =>
    parseWorkMap(map, frames, [{ ...transcript[0], role: "agent" }]),
  );
  assert.throws(() =>
    parseWorkMap(
      { ...map, edges: [{ from: "s1", to: "missing", label: "" }] },
      frames,
      transcript,
    ),
  );
});
test("guardrails need expert quotes; unknown steps can remain visibly unresolved", () => {
  assert.throws(() =>
    parseWorkMap(
      {
        ...map,
        guardrails: [{ ...map.guardrails[0], quote: "", utteranceId: "" }],
      },
      frames,
      transcript,
    ),
  );
  const draft = parseWorkMap(
    {
      ...map,
      steps: [{ ...map.steps[0], quote: "", utteranceId: "", reason: "" }],
      guardrails: [],
    },
    frames,
    [],
  );
  assert.equal(draft.steps[0].quote, "");
  assert.throws(() =>
    parseEvidence([
      { ...frames[0], image: "https://private-network/image.jpg" },
    ]),
  );
});
test("recordings persist map and transcript without aliasing mutable drafts", () => {
  const saved = appendRecording(undefined, {
    processId: "p1",
    versionId: "v1",
    title: map.title,
    summary: map.summary,
    owner: CURRENT_USER,
    now: "2026-10-03T10:01:00Z",
    basedOnVersionId: null,
    evidence: frames,
    transcript,
    workMap: parseWorkMap(map, frames, transcript),
    reviewedAt: "2026-10-03T10:01:00Z",
  });
  assert.deepEqual(saved.versions[0].workMap, map);
  assert.notEqual(saved.versions[0].workMap?.steps[0], map.steps[0]);
  assert.notEqual(saved.versions[0].transcript?.[0], transcript[0]);
});
test("learning is opt-in, origin checked, shape bounded and production closed", async () => {
  let calls = 0;
  const handler = createLearningHandler({
    enabled: true,
    origins: ["http://localhost:3000"],
    apiKey: "test-secret",
    visionModel: "test-model",
    request: async () => {
      calls++;
      throw new Error("should not call");
    },
  });
  assert.equal(
    (
      await handler(
        request(
          { mode: "observe", frames, transcript },
          "https://untrusted.test",
        ),
      )
    ).status,
    403,
  );
  assert.equal(
    (await handler(request({ mode: "observe", frames: [], transcript })))
      .status,
    400,
  );
  assert.equal(calls, 0);
  const closed = createLearningHandler({ enabled: false, origins: [] });
  assert.equal((await closed(request({}))).status, 503);
});
test("learning validates generated quotes and sanitizes provider failures", async () => {
  const cfg = {
    enabled: true,
    origins: ["http://localhost:3000"],
    apiKey: "test-secret",
    mapModel: "test-model",
  };
  const good = createLearningHandler({
    ...cfg,
    request: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.messages[0].content[1].source.media_type, "image/jpeg");
      assert.equal(body.tool_choice.type, "auto");
      assert.equal(body.tools[0].strict, true);
      return Response.json({
        content: [{ type: "tool_use", name: "document", input: map }],
      });
    },
  });
  const response = await good(request({ mode: "map", frames, transcript }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual((await response.json()).map, map);
  const bad = createLearningHandler({
    ...cfg,
    request: async () =>
      Response.json({
        content: [
          {
            type: "tool_use",
            name: "document",
            input: {
              ...map,
              guardrails: [{ ...map.guardrails[0], quote: "invented" }],
            },
          },
        ],
      }),
  });
  assert.equal(
    (await bad(request({ mode: "map", frames, transcript }))).status,
    502,
  );
  const denied = createLearningHandler({
    ...cfg,
    request: async () =>
      new Response("private diagnostics test-secret", { status: 401 }),
  });
  assert.deepEqual(
    await (await denied(request({ mode: "map", frames, transcript }))).json(),
    { error: "learning_permission_missing" },
  );
});
test("learning refuses concurrent paid requests and observes client cancellation", async () => {
  let finish!: (r: Response) => void;
  const handler = createLearningHandler({
    enabled: true,
    origins: ["http://localhost:3000"],
    apiKey: "secret",
    visionModel: "test",
    request: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const controller = new AbortController();
  const req = new Request(request({ mode: "observe", frames, transcript }), {
    signal: controller.signal,
  });
  const first = handler(req);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    (await handler(request({ mode: "observe", frames, transcript }))).status,
    429,
  );
  controller.abort();
  finish(
    Response.json({
      content: [
        {
          type: "tool_use",
          name: "document",
          input: {
            description: "Visible invoice",
            question: "",
            changed: true,
          },
        },
      ],
    }),
  );
  assert.equal((await first).status, 408);
});

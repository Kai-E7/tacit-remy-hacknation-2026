import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkTiming,
  toTimingContext,
  type InterruptionState,
} from "./interruptions/policy.ts";
import {
  createTimingDecider,
  type ProviderVerdict,
  type TimingProvider,
} from "./interruptions/decider.ts";
import { createJevProvider, parseJevResponse } from "../server/jev-client.ts";

const NOW = 100000;
const ready = (): InterruptionState => ({
  sessionId: "test-session",
  revision: 1,
  observedAt: NOW,
  captureActive: true,
  offRecord: false,
  manualPause: false,
  userSpeaking: false,
  agentSpeaking: false,
  lastActivityAt: NOW - 5000,
  lastQuestionAt: null,
  candidate: {
    id: "question-1",
    question: "Why did you change this category?",
    screenContext: "Category changed, invoice details stable.",
  },
  modelContextAllowed: true,
});
const yes: ProviderVerdict = {
  choice: "ask",
  confidence: 0.95,
  askProbability: 0.97,
  model: "jev-test",
};
const provider: TimingProvider = { decide: async () => yes };

test("timing gates override Jev without sending any context", async () => {
  const cases: [Partial<InterruptionState>, string][] = [
    [{ offRecord: true }, "off_record"],
    [{ captureActive: false }, "inactive"],
    [{ manualPause: true }, "manual_pause"],
    [{ userSpeaking: null }, "speech_unknown"],
    [{ agentSpeaking: null }, "speech_unknown"],
    [{ userSpeaking: true }, "speaking"],
    [{ agentSpeaking: true }, "speaking"],
    [{ lastActivityAt: NOW - 500 }, "activity"],
    [{ lastQuestionAt: NOW - 1000 }, "question_cooldown"],
    [{ observedAt: NOW - 6000 }, "stale_context"],
    [{ observedAt: NOW + 1 }, "invalid_signals"],
    [{ lastActivityAt: NaN }, "invalid_signals"],
    [{ candidate: null }, "no_question"],
    [{ modelContextAllowed: false }, "context_not_allowed"],
  ];
  for (const [patch, reason] of cases) {
    let calls = 0;
    const decider = createTimingDecider({
      mode: "jev",
      now: () => NOW,
      provider: {
        decide: async () => {
          calls++;
          return yes;
        },
      },
    });
    const result = await decider.evaluate(() => ({ ...ready(), ...patch }));
    assert.equal(result.action, "wait");
    assert.equal(result.reason, reason);
    assert.equal(calls, 0);
  }
});

test("rules mode never calls a provider; missing Jev never bypasses to ask", async () => {
  let calls = 0;
  const decider = createTimingDecider({
    mode: "rules",
    now: () => NOW,
    provider: {
      decide: async () => {
        calls++;
        return yes;
      },
    },
  });
  assert.equal((await decider.evaluate(ready)).reason, "rules_ready");
  assert.equal(calls, 0);
  assert.equal(
    (await createTimingDecider({ mode: "jev", now: () => NOW }).evaluate(ready))
      .reason,
    "provider_unavailable",
  );
});

test("context payload is limited and excludes unapproved extra fields", () => {
  const state = {
    ...ready(),
    secret: "never-send",
    fullTranscript: "never-send",
    screenshot: "never-send",
  };
  state.candidate!.question = "q".repeat(1000);
  state.candidate!.screenContext = "c".repeat(3000);
  const context = toTimingContext(state, NOW);
  assert.equal(context.pendingQuestion.length, 500);
  assert.equal(context.visibleContext.length, 1200);
  assert.deepEqual(Object.keys(context).sort(), [
    "pendingQuestion",
    "quietForMs",
    "timeSinceLastQuestionMs",
    "visibleContext",
  ]);
  assert.equal(JSON.stringify(context).includes("never-send"), false);
});

test("high confidence allows ask; uncertainty and provider wait remain wait", async () => {
  for (const [verdict, reason] of [
    [yes, "provider_ready"],
    [{ ...yes, confidence: 0.7 }, "uncertain"],
    [{ ...yes, askProbability: 0.7 }, "uncertain"],
    [{ ...yes, choice: "wait" }, "provider_wait"],
    [{ ...yes, confidence: NaN }, "provider_unavailable"],
  ] as [ProviderVerdict, string][]) {
    const result = await createTimingDecider({
      mode: "jev",
      now: () => NOW,
      provider: { decide: async () => verdict },
    }).evaluate(ready);
    assert.equal(result.reason, reason);
    assert.equal(result.action, reason === "provider_ready" ? "ask" : "wait");
  }
});

test("off-record, typing and revision changes during inference invalidate permission", async () => {
  for (const patch of [
    { offRecord: true },
    { lastActivityAt: NOW },
    { revision: 2 },
    { sessionId: "other-session" },
    { modelContextAllowed: false },
  ]) {
    let state = ready();
    const decider = createTimingDecider({
      mode: "jev",
      now: () => NOW,
      provider: {
        decide: async () => {
          state = { ...state, ...patch };
          return yes;
        },
      },
    });
    assert.equal((await decider.evaluate(() => state)).action, "wait");
  }
});

test("one in-flight request and bounded evaluation rate per session", async () => {
  let resolve!: (value: ProviderVerdict) => void;
  let calls = 0;
  const decider = createTimingDecider({
    mode: "jev",
    now: () => NOW,
    provider: {
      decide: () => {
        calls++;
        return new Promise((done) => {
          resolve = done;
        });
      },
    },
  });
  const pending = decider.evaluate(ready);
  assert.equal((await decider.evaluate(ready)).reason, "provider_busy");
  resolve(yes);
  assert.equal((await pending).action, "ask");
  assert.equal((await decider.evaluate(ready)).reason, "evaluation_cooldown");
  assert.equal(calls, 1);
});

test("timeout, cancellation and failures wait without leaking provider errors", async () => {
  const never: TimingProvider = { decide: async () => new Promise(() => {}) };
  assert.equal(
    (
      await createTimingDecider({
        mode: "jev",
        now: () => NOW,
        timeoutMs: 10,
        provider: never,
      }).evaluate(ready)
    ).reason,
    "provider_timeout",
  );
  const abort = new AbortController();
  const pending = createTimingDecider({
    mode: "jev",
    now: () => NOW,
    provider: never,
  }).evaluate(ready, abort.signal);
  abort.abort();
  assert.equal((await pending).reason, "cancelled");
  const failed = await createTimingDecider({
    mode: "jev",
    now: () => NOW,
    provider: {
      decide: async () => {
        throw new Error("sensitive-provider-response");
      },
    },
  }).evaluate(ready);
  assert.equal(failed.reason, "provider_unavailable");
  assert.equal(JSON.stringify(failed).includes("sensitive"), false);
});

const responseBody = () => ({
  model: "jev-test",
  answers: {
    timing: {
      type: "choice",
      choice: "ask",
      confidence: 0.9,
      probabilities: { ask: 0.95, wait: 0.05 },
    },
  },
});

test("Jev adapter uses documented endpoint, Bearer auth and bounded choice question", async () => {
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://openrouter.ai/api/alpha/decisions");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer test-only-key",
    );
    assert.equal(init?.redirect, "error");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "typesafe/jev-1.13");
    assert.equal(body.questions.timing.type, "choice");
    assert.deepEqual(Object.keys(body.questions.timing.criteria), [
      "ask",
      "wait",
    ]);
    assert.deepEqual(body.state, toTimingContext(ready(), NOW));
    return Response.json(responseBody());
  };
  const result = await createJevProvider(
    "test-only-key",
    "jev-latest",
    request,
  ).decide(toTimingContext(ready(), NOW), new AbortController().signal);
  assert.equal(result.choice, "ask");
  assert.equal(result.model, "jev-test");
  assert.equal(calls, 1);
});

test("invalid provider outputs are rejected, not coerced to ask", () => {
  for (const bad of [null, {}, { model: "x", answers: {} }])
    assert.throws(() => parseJevResponse(bad));
  for (const bad of [
    { ...responseBody().answers.timing, confidence: "0.99" },
    { ...responseBody().answers.timing, choice: "interrupt-anyway" },
    { ...responseBody().answers.timing, choice: ["ask"] },
    {
      ...responseBody().answers.timing,
      probabilities: { ask: 0.1, wait: 0.9 },
    },
    {
      ...responseBody().answers.timing,
      probabilities: { ask: 0.9, wait: 0.9 },
    },
    {
      ...responseBody().answers.timing,
      probabilities: { ask: 0.95, wait: 0.05, extra: 0 },
    },
  ])
    assert.throws(() =>
      parseJevResponse({ model: "jev-test", answers: { timing: bad } }),
    );
});

test("HTTP failure is not retried and never includes its raw body", async () => {
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    return new Response("sensitive-provider-response", { status: 429 });
  };
  const decider = createTimingDecider({
    mode: "jev",
    now: () => NOW,
    provider: createJevProvider("test-only-key", "jev-latest", request),
  });
  assert.equal((await decider.evaluate(ready)).reason, "provider_unavailable");
  assert.equal(calls, 1);
});

test("hard timing boundaries are explicit", () => {
  assert.equal(
    checkTiming(
      { ...ready(), lastActivityAt: NOW - 4000, lastQuestionAt: NOW - 30000 },
      NOW,
    ).action,
    "ask",
  );
  assert.equal(
    checkTiming({ ...ready(), lastActivityAt: NOW - 3999 }, NOW).action,
    "wait",
  );
});

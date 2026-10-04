import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/guide-confidence/route.ts";

const originalKey = process.env.OPENROUTER_API_KEY;
const originalLegacyKey = process.env.TYPESAFE_API_KEY;
const originalFetch = globalThis.fetch;
afterEach(() => { if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey; if (originalLegacyKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = originalLegacyKey; globalThis.fetch = originalFetch; });
const request = () => new Request("http://localhost:3000/api/guide-confidence", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
  body: JSON.stringify({ question: "How do I send a quote from Notion?", processTitle: "Send quote from Notion", summary: "Check and send a quote" }) });

test("guide relevance fails closed without Jev", async () => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  const response = await POST(request());
  assert.deepEqual((await response.json()).covered, false);
});

test("Jev must return covered choice and both confidence values strictly over 90%", async () => {
  process.env.OPENROUTER_API_KEY = "synthetic-test-key";
  for (const [choice, confidence, probability, expected] of [
    ["covered", .9, .99, false], ["covered", .99, .9, false], ["not_covered", .99, .99, false], ["covered", .91, .92, true],
  ] as const) {
    globalThis.fetch = async (_url, init) => {
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer synthetic-test-key");
      assert.equal(JSON.parse(String(init?.body)).model, "typesafe/jev-1.13");
      return Response.json({ answers: { coverage: { type: "choice", choice, confidence, probabilities: { covered: probability, not_covered: 1 - probability } } } });
    };
    const response = await POST(request());
    assert.equal((await response.json()).covered, expected);
  }
});

test("guide gate rejects cross-origin calls and provider authentication failure", async () => {
  process.env.OPENROUTER_API_KEY = "synthetic-test-key";
  const denied = await POST(new Request("http://localhost:3000/api/guide-confidence", { method: "POST", headers: { Origin: "https://other.example" } }));
  assert.equal(denied.status, 403);
  globalThis.fetch = async () => Response.json({ error: { code: 401 } }, { status: 401 });
  const response = await POST(request());
  assert.equal((await response.json()).covered, false);
});

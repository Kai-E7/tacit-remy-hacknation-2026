import assert from "node:assert/strict";
import test from "node:test";
import { checkInvoiceBeforeSave, deriveInvoiceRules } from "./learned-invoice-rules.ts";
import type { WorkMap } from "./work-map.ts";

function map(quote: string): WorkMap {
  return {
    title: "Synthetic workflow", summary: "", edges: [], questions: [],
    steps: [{ id: "s1", title: "Choose account", action: "Assign account", decision: "", reason: "", provenance: "observed", frameId: "f1", utteranceId: "u1", quote }],
    guardrails: [],
  };
}

test("a threshold comes from the expert quote and a new wrong decision is blocked before save", () => {
  const rules = deriveInvoiceRules(map("Equipment over €5,000 is always capex."));
  assert.equal(rules[0].threshold, 5000);
  const result = checkInvoiceBeforeSave(rules, { amount: 7200, category: "expense", assetNumber: "", equipment: true });
  assert.equal(result.status, "blocked");
  assert.equal(result.source?.quote, "Equipment over €5,000 is always capex.");
  assert.equal(checkInvoiceBeforeSave(rules, { amount: 4500, category: "expense", assetNumber: "", equipment: true }).status, "clear");
});

test("a corrected expert quote changes the rule; no quote means no invented threshold", () => {
  const wrong = deriveInvoiceRules(map("Equipment over €5,000 is always capex."));
  const corrected = deriveInvoiceRules(map("Equipment over €8,000 is always capex."));
  const invoice = { amount: 7200, category: "expense" as const, assetNumber: "", equipment: true };
  assert.equal(checkInvoiceBeforeSave(wrong, invoice).status, "blocked");
  assert.equal(checkInvoiceBeforeSave(corrected, invoice).status, "clear");
  assert.equal(checkInvoiceBeforeSave(deriveInvoiceRules(map("Look at the equipment.")), invoice).status, "unverified");
});

test("missing asset number is blocked only if explicitly quoted by expert", () => {
  const rules = deriveInvoiceRules(map("No asset number, no capex booking."));
  const result = checkInvoiceBeforeSave(rules, { amount: 7200, category: "asset", assetNumber: "", equipment: true });
  assert.equal(result.status, "blocked");
  assert.match(result.message, /asset number/);
});

test("conflicting expert thresholds require human clarification, never first-rule-wins", () => {
  const first = deriveInvoiceRules(map("Equipment over €5,000 is always capex."))[0];
  const second = deriveInvoiceRules(map("Equipment over €8,000 is always capex."))[0];
  const result = checkInvoiceBeforeSave([first, second], {
    amount: 7200, category: "expense", assetNumber: "", equipment: true,
  });
  assert.equal(result.status, "unverified");
  assert.match(result.message, /conflicting thresholds/);
});

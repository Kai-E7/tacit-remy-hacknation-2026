import type { WorkMap } from "./work-map.ts";

export type LearnedRule = {
  kind: "amount-category" | "asset-number";
  threshold?: number;
  inclusive?: boolean;
  quote: string;
  utteranceId: string;
  frameId: string;
};

function currencyAmount(text: string): number | null {
  const match = text.match(/(?:€|EUR|Euro)\s*([0-9][0-9., ]{2,12})|([0-9][0-9., ]{2,12})\s*(?:€|EUR|Euro)/i);
  const raw = (match?.[1] ?? match?.[2])?.trim();
  if (!raw) return null;
  const compact = raw.replace(/\s/g, "");
  const normalized = /^[0-9]{1,3}(?:[.,][0-9]{3})+$/.test(compact)
    ? compact.replace(/[.,]/g, "")
    : compact.replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 && amount < 1_000_000 ? amount : null;
}

/** The number and action are derived only from a real expert quote, never a demo default. */
export function deriveInvoiceRules(map: WorkMap): LearnedRule[] {
  const sources = [
    ...map.guardrails.map((g) => ({ quote: g.quote, utteranceId: g.utteranceId, frameId: g.frameId })),
    ...map.steps.map((s) => ({ quote: s.quote, utteranceId: s.utteranceId, frameId: s.frameId })),
  ];
  const rules: LearnedRule[] = [];
  for (const source of sources) {
    if (!source.quote || !source.utteranceId) continue;
    const quote = source.quote;
    const amount = currencyAmount(quote);
    if (amount !== null && /\b(capex|capitali[sz]|asset|anlagevermögen|aktivier|anlage)\w*/i.test(quote) &&
      /\b(over|above|greater|more than|at least|from|über|mehr als|ab|mindestens)\b/i.test(quote)) {
      rules.push({ ...source, kind: "amount-category", threshold: amount,
        inclusive: /\b(at least|from|ab|mindestens)\b/i.test(quote) });
    }
    if (/(?:no\s+asset\s+number|without\s+(?:an?\s+)?asset\s+number|ohne\s+anlagennummer|anlagennummer\s+fehlt)/i.test(quote) &&
      /capex|asset|anlage|buch/i.test(quote))
      rules.push({ ...source, kind: "asset-number" });
  }
  return rules.filter((rule, index) => rules.findIndex((other) => other.kind === rule.kind && other.quote === rule.quote) === index);
}

export function checkInvoiceBeforeSave(rules: LearnedRule[], input: {
  amount: number;
  category: "expense" | "asset" | "review" | "";
  assetNumber: string;
  equipment: boolean;
}): { status: "blocked" | "unverified" | "clear"; message: string; source?: LearnedRule } {
  if (!Number.isFinite(input.amount) || input.amount <= 0 || !input.category)
    return { status: "unverified", message: "Check the amount and classification." };
  const amountRules = rules.filter((rule) => rule.kind === "amount-category");
  if (amountRules.some((rule) => rule.threshold !== amountRules[0].threshold || rule.inclusive !== amountRules[0].inclusive))
    return { status: "unverified", message: "The approved version contains conflicting thresholds. Ask the expert; no automatic approval." };
  const amountRule = amountRules[0];
  if (amountRule?.threshold !== undefined && input.equipment &&
      (amountRule.inclusive ? input.amount >= amountRule.threshold : input.amount > amountRule.threshold) &&
      input.category !== "asset")
    return { status: "blocked", message: "This classification conflicts with the approved expert rule. Do not save yet.", source: amountRule };
  const numberRule = rules.find((rule) => rule.kind === "asset-number");
  if (numberRule && input.category === "asset" && !input.assetNumber.trim())
    return { status: "blocked", message: "The required asset number is missing. Do not save yet.", source: numberRule };
  if (!amountRule && !numberRule)
    return { status: "unverified", message: "No machine-checkable rule from expert quotes was approved for this case." };
  return { status: "clear", message: "No conflict with the available checkable rules was detected. This is not an overall expert approval." };
}

/** Shared, explicit demo fallback. Not Presidio and not a complete PII detector. */
export type PrivacyReport = {
  engine: "presidio" | "demo-fallback";
  status:
    "privacy scan passed" | "redaction applied" | "manual review required";
  redactions: number;
  imagesWithheld: number;
  policy: "text-v1";
};
export type PrivacyResult = { texts: string[]; report: PrivacyReport };

export function fallbackRedact(texts: string[]): PrivacyResult {
  let redactions = 0;
  const rules: [RegExp, string][] = [
    [/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/gi, "[IBAN]"],
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]"],
    [
      /(?<![\w\d])(?:\+\d{1,3}[ .()-]*|0\d{2,5}[ /().-]+)\d(?:[ .()/-]*\d){5,13}(?!\d)/g,
      "[PHONE]",
    ],
    // Deliberately disclosed synthetic-demo names; never claim general name detection.
    [
      /\b(?:Anna(?: Müller)?|Max Mustermann|Jane Doe|John Smith)\b/giu,
      "[PERSON]",
    ],
  ];
  return {
    texts: texts.map((value) =>
      rules.reduce(
        (s, [pattern, replacement]) =>
          s.replace(pattern, () => {
            redactions++;
            return replacement;
          }),
        value,
      ),
    ),
    report: {
      engine: "demo-fallback",
      status: "manual review required",
      redactions,
      imagesWithheld: 0,
      policy: "text-v1",
    },
  };
}

export function validPrivacyResult(
  value: unknown,
  count: number,
): value is PrivacyResult {
  if (!value || typeof value !== "object") return false;
  const v = value as PrivacyResult;
  return (
    Array.isArray(v.texts) &&
    v.texts.length === count &&
    v.texts.every((t) => typeof t === "string" && t.length <= 10000) &&
    !!v.report &&
    ["presidio", "demo-fallback"].includes(v.report.engine) &&
    [
      "privacy scan passed",
      "redaction applied",
      "manual review required",
    ].includes(v.report.status) &&
    Number.isInteger(v.report.redactions) &&
    v.report.redactions >= 0 &&
    v.report.policy === "text-v1" &&
    (v.report.engine !== "demo-fallback" ||
      v.report.status === "manual review required")
  );
}

/** Only transient text crosses this boundary. No raw images, response cache or recovery copy. */
export async function privacyScan(
  texts: string[],
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<PrivacyResult> {
  try {
    signal?.throwIfAborted();
    const r = await request("/api/privacy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ texts }),
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(20000),
      ]),
    });
    if (!r.ok) throw new Error("privacy_unavailable");
    const body: unknown = await r.json();
    if (!validPrivacyResult(body, texts.length))
      throw new Error("privacy_invalid");
    signal?.throwIfAborted();
    return body;
  } catch {
    signal?.throwIfAborted();
    return fallbackRedact(texts);
  }
}

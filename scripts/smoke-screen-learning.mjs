// Real provider smoke using generated synthetic screen pixels and expert text.
// Logs only status and counts, never credentials, raw pixels or provider payloads.
import sharp from "sharp";

const target = process.env.TACIT_SMOKE_URL ?? "http://127.0.0.1:3100";
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="white"/><text x="40" y="90" font-family="Arial" font-size="40" fill="black">SYNTHETIC INVOICE DEMO-1042</text><text x="40" y="160" font-family="Arial" font-size="40" fill="black">Amount EUR 6400</text><text x="40" y="230" font-family="Arial" font-size="40" fill="black">Account: operating expense</text></svg>');
const jpeg = await sharp(svg).jpeg({ quality: 85 }).toBuffer();
const frame = { id: "synthetic-frame-1", image: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
  capturedAt: new Date().toISOString(), time: "00:01", note: "" };
const transcript = [{ id: "synthetic-utterance-1", role: "user",
  text: "I open invoice DEMO-1042. Equipment over €5,000 is always capex. Without an asset number, I stop before booking.",
  at: new Date().toISOString() }];
for (const mode of ["observe", "map"]) {
  const response = await fetch(`${target}/api/learning`, {
    method: "POST", headers: { origin: target, "Content-Type": "application/json" },
    body: JSON.stringify({ mode, frames: [frame], transcript, previous: "" }),
    signal: AbortSignal.timeout(mode === "observe" ? 40000 : 110000),
  });
  const result = await response.json();
  if (!response.ok) {
    console.error(mode, "failed", response.status, result.error ?? "unknown");
    process.exitCode = 1;
    break;
  }
  if (mode === "observe") {
    const visible = /6400|DEMO-1042|operating expense/i.test(result.observation?.description ?? "");
    console.log("real observation", { visibleSyntheticFact: visible,
      changed: result.observation?.changed, questionSuggested: !!result.observation?.question });
    if (!visible) process.exitCode = 1;
  } else {
    console.log("real map", { steps: result.map?.steps?.length ?? 0,
      guardrails: result.map?.guardrails?.length ?? 0,
      sourced: result.map?.steps?.every((step) => step.frameId === frame.id) ?? false });
    if (!result.map?.steps?.length) process.exitCode = 1;
  }
}

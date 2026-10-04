// Manual, bounded real-provider tutor transport check with synthetic browser data.
// Requires TACIT_FAKE_MIC_WAV; no raw audio or provider transcript is logged.
import { chromium } from "@playwright/test";

const wav = process.env.TACIT_FAKE_MIC_WAV;
if (!wav) throw new Error("TACIT_FAKE_MIC_WAV is required");
const browser = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage({ permissions: ["microphone"] });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1280; canvas.height = 720;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = "black"; ctx.font = "36px Arial";
        ctx.fillText("SYNTHETIC LEARNER CASE DEMO-2087", 40, 100);
        ctx.fillText("Equipment EUR 7200 / selected expense", 40, 160);
        globalThis.__tacitSmokeCanvas = canvas;
        const stream = canvas.captureStream(5);
        globalThis.__tacitSmokeStream = stream;
        return stream;
      },
    });
  });
  const base = process.env.TACIT_SMOKE_URL ?? "http://127.0.0.1:3100";
  await page.goto(`${base}/processes`);
  await page.evaluate(async () => {
    const now = new Date().toISOString();
    const image = document.createElement("canvas");
    image.width = 320; image.height = 180;
    const ctx = image.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = "black"; ctx.font = "18px Arial";
    ctx.fillText("Synthetic equipment invoice", 12, 60);
    const quote = "Equipment over EUR 5000 is always capex.";
    const record = {
      schemaVersion: 1, id: "synthetic-tutor-smoke", ownerId: "local-demo-user",
      title: "Synthetic equipment process", createdAt: now, updatedAt: now,
      versions: [{ id: "synthetic-approved-v1", number: 1, basedOnVersionId: null,
        createdAt: now, reviewedAt: now, recordedBy: { id: "local-demo-user", name: "Demo-User" },
        status: "recorded", summary: "Choose the right account.",
        evidence: [{ id: "f1", image: image.toDataURL("image/jpeg"), time: "03:00", capturedAt: now, note: "" }],
        transcript: [{ id: "u1", role: "user", text: quote, at: now }],
        workMap: { title: "Synthetic equipment process", summary: "Choose the right account.",
          steps: [{ id: "s1", title: "Choose account", action: "Select the account", applications: ["Demo ERP"],
            actor: { name: "", utteranceId: "", quote: "" }, decision: "", reason: quote,
            provenance: "observed", frameId: "f1", utteranceId: "u1", quote }],
          edges: [], guardrails: [], questions: [] },
        privacy: { engine: "presidio", status: "privacy scan passed", redactions: 0,
          imagesWithheld: 0, policy: "text-v1" } }], conflicts: [],
    };
    await new Promise((resolve, reject) => {
      const open = indexedDB.open("apprentice-local-v1", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("processes", { keyPath: "id" });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("processes", "readwrite");
        tx.objectStore("processes").put(record);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  });
  await page.goto(`${base}/teach?process=synthetic-tutor-smoke&version=synthetic-approved-v1`);
  await page.getByLabel("Nur Übungsdaten zeigen und KI-Begleitung erlauben.").check();
  await page.getByRole("button", { name: "Bildschirm teilen & Remy starten" }).click();
  await page.locator('.voice-companion[data-state="connected"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(35000);
  let correctionTriggered = false;
  let agentLinesBeforeCheck = 0;
  if (process.env.TACIT_TUTOR_EVENT === "true") {
    agentLinesBeforeCheck = await page.locator(".voice-transcript p").filter({ hasText: "Remy:" }).count();
    const opened = page.context().waitForEvent("page");
    await page.getByRole("link", { name: "Neuen Übungsfall öffnen" }).click();
    const learner = await opened;
    await learner.waitForLoadState();
    await learner.getByLabel("Zuordnung").selectOption("expense");
    await learner.getByRole("button", { name: "Vor dem Speichern prüfen" }).click();
    await page.getByRole("status").filter({ hasText: "Noch nicht speichern" }).waitFor({ timeout: 10000 });
    correctionTriggered = true;
    await page.waitForTimeout(25000);
  }
  const result = await page.evaluate(() => ({
    state: document.querySelector(".voice-companion")?.getAttribute("data-state"),
    userLines: [...document.querySelectorAll(".voice-transcript p")].filter((n) => n.textContent?.startsWith("Lernende Person:")).length,
    agentLines: [...document.querySelectorAll(".voice-transcript p")].filter((n) => n.textContent?.startsWith("Remy:")).length,
    audioPlaying: [...document.querySelectorAll("audio")].some((a) => !!a.srcObject && !a.muted && !a.paused),
  }));
  console.log("real tutor transport smoke", { ...result, correctionTriggered,
    agentAfterPreSaveEvent: correctionTriggered ? result.agentLines > agentLinesBeforeCheck : "not tested" });
  if (result.state === "connected") await page.getByRole("button", { name: "Stop / Off-record" }).click();
  if (result.state !== "connected" || !result.agentLines || !result.audioPlaying ||
    (process.env.TACIT_TUTOR_EVENT === "true" && (!correctionTriggered || result.agentLines <= agentLinesBeforeCheck))) process.exitCode = 1;
} finally {
  await browser.close();
}

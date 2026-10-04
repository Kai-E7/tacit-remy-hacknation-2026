// Manual real-provider smoke using a verified synthetic WAV as Chrome's fake mic.
// Run only with TACIT_FAKE_MIC_WAV pointing to a local synthetic file.
import { chromium } from "@playwright/test";

const wav = process.env.TACIT_FAKE_MIC_WAV;
if (!wav) throw new Error("TACIT_FAKE_MIC_WAV is required");
const browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage({ permissions: ["microphone"] });
  await page.addInitScript((phases) => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1280; canvas.height = 720;
        const ctx = canvas.getContext("2d");
        const screens = [
          ["SYNTHETIC INVOICE DEMO-1042", "Amount EUR 6400", "Status: new"],
          ["SYNTHETIC INVOICE DEMO-1042", "Account: operating expense", "Approval pending"],
          ["SYNTHETIC INVOICE DEMO-1042", "Asset number: missing", "Save is blocked"],
          ["SYNTHETIC INVOICE DEMO-2087", "Amount EUR 7200", "Supplier: Example Machines"],
        ];
        const started = Date.now();
        let drawn = -1;
        const draw = () => {
          const elapsed = Date.now() - started;
          const phase = !phases ? 0 : elapsed < 20000 ? 0 : elapsed < 55000 ? 1 : elapsed < 90000 ? 2 : 3;
          if (phase === drawn) return;
          drawn = phase;
          ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1280, 720);
          ctx.fillStyle = "black"; ctx.font = "36px Arial";
          screens[phase].forEach((line, i) => ctx.fillText(line, 40, 100 + i * 60));
        };
        draw();
        if (phases) globalThis.__tacitSmokeDrawTimer = setInterval(draw, 1000);
        globalThis.__tacitSmokeCanvas = canvas;
        const stream = canvas.captureStream(5);
        globalThis.__tacitSmokeStream = stream;
        return stream;
      },
    });
  }, process.env.TACIT_SCREEN_PHASES === "true");
  const url = process.env.TACIT_SMOKE_URL ?? "http://127.0.0.1:3100/capture";
  const voiceOnly = new URL(url).pathname === "/interview";
  await page.goto(url);
  await page.getByLabel(voiceOnly ? "I’m using synthetic practice data only." : "I’m sharing synthetic practice data only.").check();
  await page.getByLabel(voiceOnly ? "Allow AI voice interview." : "Allow AI voice and screen analysis.", { exact: false }).check();
  await page.getByRole("button", { name: voiceOnly ? "Start interview" : "Start recording" }).click();
  await page.locator('.voice-companion[data-state="connected"]').waitFor({ timeout: 30000 });
  if (process.env.TACIT_QUESTION_TIMING === "during" || process.env.TACIT_QUESTION_TIMING === "end") {
    await page.getByRole("button", { name: process.env.TACIT_QUESTION_TIMING === "during" ? "As we go" : "At the end" }).click();
  }
  const duration = Math.min(180000, Math.max(10000, Number(process.env.TACIT_VOICE_DURATION_MS ?? 45000)));
  const debrief = process.env.TACIT_DEBRIEF === "true";
  if (debrief) {
    await page.waitForTimeout(35000);
    await page.getByRole("button", { name: "Finished? Ask Remy to wrap up" }).click();
    await page.waitForTimeout(Math.max(15000, duration - 35000));
  } else {
    await page.waitForTimeout(duration);
  }
  const result = await page.evaluate(() => ({
    state: document.querySelector(".voice-companion")?.getAttribute("data-state"),
    userLines: [...document.querySelectorAll(".voice-transcript p")].filter((n) => n.textContent?.startsWith("Demo-User:")).length,
    agentLines: [...document.querySelectorAll(".voice-transcript p")].filter((n) => n.textContent?.startsWith("Remy:")).length,
    agentQuestions: [...document.querySelectorAll(".voice-transcript p")].filter((n) => n.textContent?.startsWith("Remy:") && n.textContent.includes("?")).length,
    screenQuestions: [...document.querySelectorAll(".voice-transcript p")].filter((n) => n.textContent?.startsWith("Remy:") && n.textContent.includes("?") && /invoice|amount|account|cost center|asset|capex|screen/i.test(n.textContent)).length,
    observations: Number(document.querySelector('[data-testid="screen-observation-count"]')?.textContent?.match(/\d+/)?.[0] ?? 0),
    screenPromptReady: document.querySelector(".voice-companion")?.getAttribute("data-screen-question-ready"),
    screenPromptsSent: Number(document.querySelector(".voice-companion")?.getAttribute("data-screen-questions-sent") ?? 0),
    questionTiming: document.querySelector(".voice-companion")?.getAttribute("data-question-timing"),
    openingChoiceQuestion: (() => {
      const first = [...document.querySelectorAll(".voice-transcript p")].find((n) => n.textContent?.startsWith("Remy:"));
      return !!first && /jump in|questions as we go|questions for the end|save (?:them|questions) for the end/i.test(first.textContent ?? "");
    })(),
    questionAfterExpertTurn: (() => {
      const lines = [...document.querySelectorAll(".voice-transcript p")];
      const firstExpert = lines.findIndex((n) => n.textContent?.startsWith("Demo-User:"));
      return firstExpert >= 0 && lines.slice(firstExpert + 1).some((n) => n.textContent?.startsWith("Remy:") && n.textContent.includes("?"));
    })(),
    completionQuestion: [...document.querySelectorAll(".voice-transcript p")].some((n) =>
      n.textContent?.startsWith("Remy:") && n.textContent.includes("?") &&
      /complete|finished|done|entire|everything|full process|anything else to show|end of the process|that's it/i.test(n.textContent)),
    agentAfterConfirmation: (() => {
      const lines = [...document.querySelectorAll(".voice-transcript p")];
      const yes = lines.findIndex((n) => n.textContent?.startsWith("Demo-User:") && /yes|entire process|whole process/i.test(n.textContent));
      return yes >= 0 && lines.slice(yes + 1).some((n) => n.textContent?.startsWith("Remy:"));
    })(),
    audioPlaying: [...document.querySelectorAll("audio")].some((a) => !!a.srcObject && !a.muted && !a.paused),
  }));
  console.log("real voice smoke", result);
  if (process.env.TACIT_SHOW_AGENT_LINES === "true") {
    // Only enable with the verified synthetic WAV; never log real participant speech.
    console.log("synthetic agent lines", await page.evaluate(() => [...document.querySelectorAll(".voice-transcript p")]
      .filter((n) => n.textContent?.startsWith("Remy:"))
      .map((n) => n.textContent?.slice(0, 300))));
  }
  if (result.state === "connected" && process.env.TACIT_SAVE_AND_VERIFY === "true" && !voiceOnly) {
    await page.getByRole("button", { name: "Stop & save", exact: true }).click();
    await page.getByRole("link", { name: "Open process" }).waitFor({ timeout: 90000 });
    await page.locator(".saved-map").waitFor({ timeout: 90000 });
    const saved = await page.evaluate(async () => {
      const url = document.querySelector('.saved-message a[href^="/processes?"]')?.getAttribute("href");
      const id = url ? new URL(url, location.href).searchParams.get("process") : null;
      if (!id) return null;
      return new Promise((resolve, reject) => {
        const open = indexedDB.open("apprentice-local-v1", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("processes", "readonly");
          const request = tx.objectStore("processes").get(id);
          request.onsuccess = () => {
            const version = request.result?.versions?.at(-1);
            resolve(version ? {
              versions: request.result.versions.length,
              frames: version.evidence.length,
              userLines: version.transcript.filter((u) => u.role === "user").length,
              privacyEngine: version.privacy?.engine,
              imageWithheld: version.privacy?.imagesWithheld,
              mapSteps: version.workMap?.steps.length ?? 0,
              sourceLinkedSteps: version.workMap?.steps.filter((s) => s.frameId && s.utteranceId && s.quote).length ?? 0,
            } : null);
            db.close();
          };
          request.onerror = () => { db.close(); reject(request.error); };
        };
      });
    });
    console.log("real saved-cycle metrics", saved);
    if (!saved || saved.versions !== 1 || !saved.frames || !saved.userLines ||
      saved.privacyEngine !== "presidio" || !saved.mapSteps || !saved.sourceLinkedSteps)
      process.exitCode = 1;
  } else if (result.state === "connected") {
    await page.getByRole("button", { name: "Pause / Off-record" }).click();
  }
  if (result.state !== "connected" || !result.userLines || !result.agentLines || !result.audioPlaying)
    process.exitCode = 1;
  if (debrief && (result.userLines < 2 || !result.completionQuestion || !result.agentAfterConfirmation))
    process.exitCode = 1;
} finally {
  await browser.close();
}

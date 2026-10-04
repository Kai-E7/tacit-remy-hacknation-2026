import { expect, test } from "@playwright/test";

test("expert approves a sourced version; new learner case is blocked before save", async ({ page }) => {
  await page.goto("/processes");
  await page.evaluate(async () => {
    const now = "2026-10-04T03:00:00.000Z";
    const image = document.createElement("canvas");
    image.width = 320; image.height = 180;
    const ctx = image.getContext("2d")!;
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = "#193c32"; ctx.font = "18px sans-serif";
    ctx.fillText("Synthetic invoice", 12, 60);
    const quote = "Equipment over €5,000 is always capex.";
    const frame = { id: "f1", image: image.toDataURL("image/jpeg"), time: "03:00", capturedAt: now, note: "" };
    const version = {
      id: "v1", number: 1, basedOnVersionId: null, createdAt: now,
      recordedBy: { id: "local-demo-user", name: "Demo-User" }, status: "recorded",
      summary: "Synthetic invoice process", evidence: [frame],
      transcript: [{ id: "u1", role: "user", text: quote, at: now }],
      workMap: { title: "Synthetic invoice process", summary: "Choose the right account.",
        steps: [{ id: "s1", title: "Choose account", action: "Select the account", applications: ["Demo ERP"],
          actor: { name: "", utteranceId: "", quote: "" }, decision: "", reason: quote,
          provenance: "observed", frameId: "f1", utteranceId: "u1", quote }],
        edges: [], guardrails: [], questions: [] },
      privacy: { engine: "presidio", status: "privacy scan passed", redactions: 0,
        imagesWithheld: 0, policy: "text-v1" },
    };
    const record = { schemaVersion: 1, id: "synthetic-teach", ownerId: "local-demo-user",
      title: "Synthetic invoice process", createdAt: now, updatedAt: now,
      versions: [version], conflicts: [] };
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open("apprentice-local-v1", 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore("processes", { keyPath: "id" });
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result;
        const tx = db.transaction("processes", "readwrite");
        tx.objectStore("processes").put(record);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  });
  await page.reload();
  await page.locator(".process-item").filter({ hasText: "Synthetic invoice process" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Approve process for Remy" }).click();
  const start = page.getByRole("link", { name: "Walk me through while I share my screen." });
  await expect(start).toBeVisible();
  await page.route("**/api/guide-confidence", (route) => route.fulfill({ json: { covered: true, confidence: 0.96, reason: "Reviewed process matched." } }));
  await start.click();
  await expect(page).toHaveURL(/\/guide\?process=synthetic-teach/);
  await expect(page.getByLabel("Reviewed process")).toHaveValue("synthetic-teach");
  await page.getByLabel("What do you need help with?").fill("I need to classify this synthetic invoice.");
  await page.getByRole("button", { name: "Check coverage" }).click();
  await page.getByRole("link", { name: "Continue with Remy" }).click();
  await expect(page.getByRole("heading", { name: "Follow with Remy." })).toBeVisible();
  const opened = page.context().waitForEvent("page");
  await page.getByRole("link", { name: "Open practice case" }).click();
  const learner = await opened;
  await learner.waitForLoadState();
  await expect(learner.getByText("Practice case using approved version", { exact: false })).toBeVisible();
  await learner.getByLabel("Classification").selectOption("expense");
  await learner.getByRole("button", { name: "Check before saving" }).click();
  await expect(learner.getByRole("status")).toContainText("Do not save yet");
  await expect(learner.getByRole("status")).toContainText("Equipment over €5,000");
  await expect(page.getByRole("status")).toContainText("Do not save yet");

  await page.goto("/processes?process=synthetic-teach");
  await page.getByRole("button", { name: "Correct an expert rule" }).click();
  await page.getByLabel("Your corrected expert statement").fill("Equipment over €8,000 is always capex.");
  await page.getByRole("button", { name: "Save correction as sub-version" }).click();
  await expect(page.getByLabel("Recording version").locator("option")).toHaveCount(2);
  await expect(page.getByText("AI draft · not reviewed yet")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Approve process for Remy" }).click();
  const correctedLink = page.getByRole("link", { name: "Walk me through while I share my screen." });
  await expect(correctedLink).toBeVisible();
  await correctedLink.click();
  await expect(page.getByLabel("Reviewed process")).toHaveValue("synthetic-teach");
  await page.getByLabel("What do you need help with?").fill("I need to classify this synthetic invoice.");
  await page.getByRole("button", { name: "Check coverage" }).click();
  await page.getByRole("link", { name: "Continue with Remy" }).click();
  const openedAgain = page.context().waitForEvent("page");
  await page.getByRole("link", { name: "Open practice case" }).click();
  const correctedLearner = await openedAgain;
  await correctedLearner.waitForLoadState();
  await correctedLearner.getByLabel("Classification").selectOption("expense");
  await correctedLearner.getByRole("button", { name: "Check before saving" }).click();
  await expect(correctedLearner.getByRole("status")).toContainText("No conflict");
});

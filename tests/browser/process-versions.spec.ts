import { test, expect } from "@playwright/test";

test("join recordings, revise an old version and retain both original sources", async ({ page }) => {
  await page.goto("/processes");
  await page.evaluate(async () => {
    const at = "2026-10-04T08:00:00Z";
    const transcript = [{ id: "u1", role: "user", text: "I create the quote in Notion.", at }];
    const map = { title: "Quote", summary: "Create a quote", steps: [{ id: "s1", title: "Create quote", action: "Create in Notion", frameId: "", utteranceId: "u1", quote: transcript[0].text, provenance: "explained", decision: "", reason: "" }], edges: [], guardrails: [], questions: [] };
    const process = (id: string, title: string) => ({ schemaVersion: 1, id, ownerId: "local-demo-user", title, createdAt: at, updatedAt: at, conflicts: [], versions: [{ id: `${id}-v1`, number: 1, basedOnVersionId: null, createdAt: at, recordedBy: { id: "local-demo-user", name: "Demo-User" }, status: "recorded", recordingMode: "voice", summary: map.summary, evidence: [], transcript, workMap: map }] });
    await new Promise<void>((resolve, reject) => { const r = indexedDB.open("apprentice-local-v1", 1); r.onupgradeneeded = () => r.result.createObjectStore("processes", { keyPath: "id" }); r.onsuccess = () => { const db = r.result, tx = db.transaction("processes", "readwrite"), store = tx.objectStore("processes"); store.put(process("one", "Angebot erstellen")); store.put(process("two", "Angebotsprozess zweiter Run")); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = reject; }; });
  });
  await page.goto("/processes?process=two");
  await page.getByRole("button", { name: "Merge as a version" }).click();
  await page.getByLabel("Which process does this belong to?").selectOption("one");
  await page.getByRole("button", { name: "Merge versions" }).click();
  await expect(page.locator(".process-item:not(.demo)")).toHaveCount(1);
  await expect(page.getByLabel("Recording version").locator("option")).toHaveCount(2);
  await page.getByRole("button", { name: "V1", exact: true }).click();
  await page.getByRole("button", { name: "Revise this version" }).click();
  await page.getByLabel("Step title").fill("Angebot prüfen");
  await page.getByRole("textbox", { name: "Action", exact: true }).fill("Angebot in Outlook prüfen");
  await page.getByLabel("What changed and why?").fill("Die Freigabe fehlt in der ursprünglichen Beschreibung.");
  await page.getByRole("button", { name: "Save as new sub-version" }).click();
  await expect(page.getByLabel("Recording version").locator("option")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /^Step 1: Angebot prüfen/ })).toBeVisible();
  await page.getByRole("button", { name: "V1", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Step 1: Create quote/ })).toBeVisible();
  await page.goto("/processes?process=two"); // old links resolve to the shared parent
  await expect(page.locator(".process-detail h2")).toHaveText("Angebot erstellen");
  await expect(page.getByLabel("Recording version").locator("option")).toHaveCount(3);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".process-item:not(.demo)")).toHaveCount(0);
  const remaining = await page.evaluate(() => new Promise<number>((resolve) => { const r = indexedDB.open("apprentice-local-v1", 1); r.onsuccess = () => { const db = r.result; const q = db.transaction("processes").objectStore("processes").getAll(); q.onsuccess = () => { db.close(); resolve((q.result as { demo?: boolean }[]).filter((p) => !p.demo).length); }; }; }));
  expect(remaining).toBe(0); // archived source copies are deleted too
});

test("voice-only start has two consents and never requests a screen", async ({ page }) => {
  let starts = 0;
  await page.route("**/api/voice-token", (route) => { starts++; return route.fulfill({ status: 502, json: { error: "voice_permission_missing" } }); });
  await page.addInitScript(() => { Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { value: () => { throw new Error("Screen must not be requested in voice mode"); } }); });
  await page.goto("/interview");
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Start interview" })).toBeDisabled();
  await page.getByLabel("I have permission to share the information I discuss.").check();
  await page.getByLabel("Allow AI voice interview.", { exact: false }).check();
  await page.getByRole("button", { name: "Start interview" }).click();
  await expect(page.locator(".voice-companion").getByRole("alert")).toContainText("ElevenLabs access is missing");
  expect(starts).toBe(1);
  await expect(page.getByRole("button", { name: "Start interview" })).toBeEnabled();
});

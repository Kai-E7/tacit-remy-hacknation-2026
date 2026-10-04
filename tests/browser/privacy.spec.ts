import { test, expect } from "@playwright/test";
import { mockScreen, startScreen } from "./capture-fixture";

test("reviewed screen evidence persists; real text gate cleans library rename and reload", async ({
  page,
}) => {
  await mockScreen(page);
  await page.goto("/capture");
  await startScreen(page);
  await page
    .getByRole("button", { name: "Stop & save", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  await page.getByRole("link", { name: "Open process" }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("textbox", { name: "New process name", exact: true })
    .fill("Jane Doe jane.doe@example.com");
  await page
    .getByRole("button", { name: "Save name", exact: true })
    .click();
  await expect(page.locator(".process-detail h2")).toContainText(
    "[PERSON]", // Overlapping PERSON/email spans are merged by Presidio.
  );
  await page.reload();
  const records = await page.evaluate(
    () =>
      new Promise<any[]>((resolve) => {
        const r = indexedDB.open("apprentice-local-v1", 1);
        r.onsuccess = () => {
          const db = r.result;
          const q = db
            .transaction("processes")
            .objectStore("processes")
            .getAll();
          q.onsuccess = () => {
            db.close();
            resolve(q.result);
          };
        };
      }),
  );
  const recording = records.find((record) => !record.demo);
  expect(recording.versions[0].evidence.length).toBeGreaterThan(0);
  expect(recording.versions[0].evidence[0].image).toMatch(/^data:image\/jpeg;base64,/);
  expect(recording.versions[0].privacy.engine).toBe("presidio");
  expect(recording.versions[0].privacy.imagesWithheld).toBe(0);
  expect(JSON.stringify(records)).not.toContain("Jane Doe");
  expect(JSON.stringify(records)).not.toContain("jane.doe@example.com");
  await expect(page.getByTestId("privacy-status")).toContainText("Presidio text and image OCR");
});

test("privacy outage saves only explicit local fallback, never invokes Claude and remains reloadable", async ({
  page,
}) => {
  await page.route("**/api/privacy", (r) =>
    r.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  let learning = 0;
  await page.route("**/api/learning", (r) => {
    learning++;
    return r.abort();
  });
  await mockScreen(page);
  await page.goto("/capture");
  await startScreen(page, true);
  await page
    .getByRole("button", { name: "Stop & save", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "manual review required",
  );
  await page.getByRole("link", { name: "Open process" }).click();
  await page.reload();
  await expect(page.getByTestId("privacy-status")).toContainText("Demo text filter");
  expect(learning).toBe(0);
  await expect(
    page.getByLabel("Recording version").locator("option"),
  ).toHaveCount(1);
});

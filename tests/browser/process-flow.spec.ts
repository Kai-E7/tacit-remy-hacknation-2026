import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

async function seed(page: Page, branch = false) {
  await page.goto("/processes");
  await page.evaluate(async (branch) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 620;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#eff2e9";
    ctx.fillRect(0, 0, 1000, 620);
    ctx.fillStyle = "#173e2d";
    ctx.font = "32px sans-serif";
    ctx.fillText("Synthetic demo evidence · Notion", 60, 90);
    const titles = [
      "Kontaktliste in Notion öffnen",
      "E-Mail-Vorlage in Notion auswählen",
      "Neue Outlook-Mail erstellen",
      "Freigabe in Outlook prüfen",
      "Text in Outlook anpassen",
      "E-Mail in Outlook senden",
      "Kontaktstatus in Notion aktualisieren",
    ];
    const actions = [
      "Den nächsten Kontakt auswählen",
      "Die passende Vorlage kopieren",
      "Empfänger und Vorlage einfügen",
      "Liegt die Freigabe vor?",
      "Persönlichen Einstieg ergänzen",
      "Die Nachricht versenden",
      "Den Kontakt als angeschrieben markieren",
    ];
    const frame = {
      id: "f1",
      image: canvas.toDataURL("image/jpeg"),
      time: "10:42:03",
      capturedAt: "2026-10-04T08:42:03Z",
      note: "Synthetic fixture",
    };
    const steps = titles.map((title, i) => ({
      id: `s${i}`,
      title,
      action: actions[i],
      decision: i === 3 ? "Freigabe vorhanden?" : "",
      reason: "",
      frameId: "f1",
      quote: i === 1 ? "Ich kopiere die Vorlage." : "",
      utteranceId: i === 1 ? "u1" : "",
      provenance: i === 1 ? "explained" : "observed",
    }));
    const edges = steps
      .slice(1)
      .map((s, i) => ({
        from: `s${i}`,
        to: s.id,
        label: i === 3 ? "Freigabe liegt vor" : "danach",
      }));
    if (branch)
      edges.push({ from: "s3", to: "s1", label: "Keine Freigabe: zurück" });
    const map = {
      title: "Kontaktaufnahme",
      summary: "Synthetischer Testprozess mit Notion und Outlook.",
      steps,
      edges,
      guardrails: [],
      questions: [],
    };
    const process = {
      schemaVersion: 1,
      id: "flow-fixture",
      ownerId: "local-demo-user",
      title: map.title,
      createdAt: frame.capturedAt,
      updatedAt: frame.capturedAt,
      conflicts: [],
      versions: [
        {
          id: "v1",
          number: 1,
          basedOnVersionId: null,
          recordedBy: { id: "local-demo-user", name: "Demo-User" },
          createdAt: frame.capturedAt,
          status: "recorded",
          summary: map.summary,
          evidence: [frame],
          transcript: [
            {
              id: "u1",
              role: "user",
              text: "Ich kopiere die Vorlage.",
              at: frame.capturedAt,
            },
          ],
          workMap: map,
        },
      ],
    };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("apprentice-local-v1", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("processes", { keyPath: "id" });
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("processes", "readwrite");
        tx.objectStore("processes").put(process);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = reject;
      };
      request.onerror = reject;
    });
  }, branch);
  await page.goto("/processes?process=flow-fixture");
}

test("selected process downloads a real local PDF handbook", async ({ page }, testInfo) => {
  await seed(page);
  await page.getByText("More options", { exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download handbook PDF" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/V1-Handbook\.pdf$/);
  const path = testInfo.outputPath("handbook.pdf");
  await download.saveAs(path);
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getTitle()).toContain("Kontaktaufnahme");
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(9);
  expect(pdf.getPages()[0].getWidth()).toBeGreaterThan(pdf.getPages()[0].getHeight());
  await expect(page.getByRole("status")).toContainText("PDF download started");
});

test("legacy map becomes connected overview with apps and click-to-open real source", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await seed(page);
  const graph = page.getByRole("region", {
    name: "Process flow diagram",
    exact: true,
  });
  await expect(graph.locator(".flow-step")).toHaveCount(7);
  await expect(graph.locator(".react-flow__edge-path")).toHaveCount(6);
  const embeddedXs = await graph.locator(".flow-step").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().x));
  expect(embeddedXs.every((x, i) => i === 0 || x > embeddedXs[i - 1])).toBe(true);
  await expect(
    graph.locator(".flow-app").filter({ hasText: "Outlook" }).first(),
  ).toBeVisible();
  await graph.screenshot({ path: "test-results/flow-default-lr.png" });
  await graph.getByRole("button", { name: "Show all" }).click();
  await expect
    .poll(async () => {
      const area = await graph.locator(".flow-canvas").boundingBox();
      const boxes = await graph.locator(".flow-step").evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        }),
      );
      return boxes.every(
        (r) =>
          r.x >= area!.x - 1 &&
          r.y >= area!.y - 1 &&
          r.right <= area!.x + area!.width + 1 &&
          r.bottom <= area!.y + area!.height + 1,
      );
    })
    .toBe(true);
  await graph.screenshot({ path: "test-results/flow-overview.png" });
  await graph.getByRole("button", { name: /^Step 2:/ }).click();
  const detail = page.getByRole("dialog", {
    name: "Step and screen evidence",
  });
  await expect(detail).toBeVisible();
  await expect(
    detail.getByAltText("Screen evidence: E-Mail-Vorlage in Notion auswählen"),
  ).toBeVisible();
  await expect(
    detail.getByText("Explained, not shown", { exact: false }),
  ).toBeVisible();
  await expect(detail.locator("blockquote")).toContainText(
    "Ich kopiere die Vorlage.",
  );
  await detail.getByRole("button", { name: "Enlarge screenshot" }).click();
  await expect(detail.locator(".flow-evidence-zoomed")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).not.toBeVisible();
  await graph.getByRole("button", { name: "Expand" }).click();
  const large = page.getByRole("dialog", { name: "Expanded process view" });
  await expect(large).toBeVisible();
  const expandedXs = await large.locator(".flow-step").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().x));
  expect(expandedXs.every((x, i) => i === 0 || x > expandedXs[i - 1])).toBe(true);
  await large.screenshot({ path: "test-results/flow-expanded.png" });
  await large.getByRole("button", { name: /^Step 3:/ }).click();
  await expect(
    detail.getByAltText("Screen evidence: Neue Outlook-Mail erstellen"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(large).not.toBeVisible();
});

test("branch loop stays connected and mobile has no page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, true);
  const graph = page.getByRole("region", {
    name: "Process flow diagram",
    exact: true,
  });
  await expect(graph.locator(".react-flow__edge-path")).toHaveCount(7);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await graph.getByRole("button", { name: "Expand" }).click();
  const large = page.getByRole("dialog", { name: "Expanded process view" });
  await large.getByRole("button", { name: /^Step 4:/ }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Step and screen evidence" }),
  ).toBeVisible();
});

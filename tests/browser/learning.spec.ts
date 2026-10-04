import { expect, test } from "@playwright/test";
import { mockScreen, startScreen } from "./capture-fixture";
function mapFor(frameId: string) {
  return {
    title: "Rechnungsprüfung",
    summary: "Die Rechnung wird angezeigt.",
    steps: [
      {
        id: "s1",
        title: "Rechnung ansehen",
        action: "Rechnung sichtbar",
        decision: "",
        reason: "",
        provenance: "observed",
        frameId,
        utteranceId: "",
        quote: "",
      },
    ],
    edges: [],
    guardrails: [],
    questions: ["Wann würdest du stoppen?"],
  };
}

test("stop automatically produces map and source-linked library entry without approval checkbox", async ({
  page,
}) => {
  const modes: string[] = [];
  await page.route("**/api/learning", async (route) => {
    const data = route.request().postDataJSON();
    modes.push(data.mode);
    await route.fulfill({
      json:
        data.mode === "observe"
          ? {
              observation: {
                description: "Rechnung sichtbar",
                question: "Was prüfst du?",
                changed: true,
              },
            }
          : { map: mapFor(data.frames[0].id) },
    });
  });
  await mockScreen(page);
  await page.goto("/capture");
  await startScreen(page, true);
  await page
    .getByRole("button", { name: "Stop & save", exact: true })
    .click();
  await expect(page.getByLabel("Process flow diagram")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Step 1: Rechnung ansehen — open evidence",
    })
    .click();
  await expect(
    page.getByAltText("Screen evidence: Rechnung ansehen"),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Step and screen evidence" })
    .getByRole("button", { name: "Close" })
    .click();
  await page.getByRole("link", { name: "Open process" }).click();
  await page.reload();
  await expect(page.locator(".process-detail h2")).toHaveText(
    "Rechnungsprüfung",
  );
  await expect(page.getByText("AI draft · not reviewed yet")).toBeVisible();
  await expect(page.getByText("Wann würdest du stoppen?")).toBeVisible();
  expect(modes.filter((m) => m === "map")).toHaveLength(1);
});

test("a privacy-reencoded first frame keeps one source ID through map save", async ({ page }) => {
  let ids: string[] = [];
  await page.route("**/api/learning", async (route) => {
    const data = route.request().postDataJSON();
    if (data.mode === "observe")
      return route.fulfill({ json: { observation: {
        description: "Synthetic invoice visible", question: "Why this account?", changed: true,
      } } });
    ids = data.frames.map((frame: { id: string }) => frame.id);
    await route.fulfill({ json: { map: mapFor(data.frames[0].id) } });
  });
  await mockScreen(page);
  await page.goto("/capture");
  await startScreen(page, true);
  await expect(page.getByTestId("screen-observation-count")).toContainText("1 relevant screen moment");
  await page.getByRole("button", { name: "Stop & save", exact: true }).click();
  await expect(page.getByLabel("Process flow diagram")).toBeVisible();
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
});

test("AI failure preserves raw capture; retry attaches only one map to the same version", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/learning", (route) => {
    const data = route.request().postDataJSON();
    if (data.mode === "observe")
      return route.fulfill({
        json: {
          observation: { description: "Test", question: "", changed: false },
        },
      });
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 502, json: { error: "unavailable" } })
      : route.fulfill({ json: { map: mapFor(data.frames[0].id) } });
  });
  await mockScreen(page);
  await page.goto("/capture");
  await startScreen(page, true);
  await page
    .getByRole("button", { name: "Stop & save", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Recording saved. Process map not available yet.",
  );
  await page
    .getByRole("button", { name: "Retry process map" })
    .click();
  await expect(page.getByLabel("Process flow diagram")).toBeVisible();
  await page.getByRole("link", { name: "Open process" }).click();
  await expect(
    page.getByLabel("Recording version").locator("option"),
  ).toHaveCount(1);
});

test("rename while map is pending is preserved", async ({ page, context }) => {
  let arrived!: () => void, release!: () => void;
  const pending = new Promise<void>((r) => {
      arrived = r;
    }),
    ready = new Promise<void>((r) => {
      release = r;
    });
  await page.route("**/api/learning", async (route) => {
    const data = route.request().postDataJSON();
    if (data.mode === "observe")
      return route.fulfill({
        json: {
          observation: { description: "Test", question: "", changed: false },
        },
      });
    arrived();
    await ready;
    await route.fulfill({ json: { map: mapFor(data.frames[0].id) } });
  });
  await mockScreen(page);
  await page.goto("/capture");
  await startScreen(page, true);
  await page
    .getByRole("button", { name: "Stop & save", exact: true })
    .click();
  await pending;
  const link = await page
    .getByRole("link", { name: "Open process" })
    .getAttribute("href");
  const library = await context.newPage();
  await library.goto(link!);
  await library.getByRole("button", { name: "Rename" }).click();
  await library.getByLabel("New process name").fill("Rechnungsprüfung 2026");
  await library.getByRole("button", { name: "Save name" }).click();
  await expect(library.locator(".process-detail h2")).toHaveText(
    "Rechnungsprüfung 2026",
  );
  release();
  await expect(page.getByLabel("Process flow diagram")).toBeVisible();
  await library.reload();
  await expect(library.locator(".process-detail h2")).toHaveText(
    "Rechnungsprüfung 2026",
  );
  await expect(library.getByLabel("Process flow diagram")).toBeVisible();
});

test("deleting during map generation never resurrects the process", async ({
  page,
  context,
}) => {
  let arrived!: () => void, release!: () => void;
  const pending = new Promise<void>((r) => {
      arrived = r;
    }),
    ready = new Promise<void>((r) => {
      release = r;
    });
  await page.route("**/api/learning", async (route) => {
    const data = route.request().postDataJSON();
    if (data.mode === "observe")
      return route.fulfill({
        json: {
          observation: { description: "Test", question: "", changed: false },
        },
      });
    arrived();
    await ready;
    await route.fulfill({ json: { map: mapFor(data.frames[0].id) } });
  });
  await mockScreen(page);
  await page.goto("/capture");
  await startScreen(page, true);
  await page
    .getByRole("button", { name: "Stop & save", exact: true })
    .click();
  await pending;
  const library = await context.newPage();
  await library.goto(
    (await page
      .getByRole("link", { name: "Open process" })
      .getAttribute("href"))!,
  );
  library.once("dialog", (d) => d.accept());
  await library.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(library.locator(".process-item:not(.demo)")).toHaveCount(0);
  release();
  await expect(
    page.getByRole("button", { name: "Retry process map" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry process map" })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "deleted" }),
  ).toBeVisible();
  await library.reload();
  await expect(library.locator(".process-item:not(.demo)")).toHaveCount(0);
});

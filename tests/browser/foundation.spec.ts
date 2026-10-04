import { expect, test } from "@playwright/test";
import { mockScreen, startScreen } from "./capture-fixture";

test("compact startup has two boxes, one main action and fits mobile", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/health")).ok()).toBeTruthy();
  await page.goto("/capture");
  await expect(
    page.getByRole("heading", { name: "Teach Remy a process." }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Start recording", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Selected user")).toHaveValue("local-demo-user");
  await page.screenshot({
    path: "test-results/capture-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/capture-mobile.png",
    fullPage: true,
  });
});

test("stop auto-saves; library rename, version lineage, export and delete survive reload", async ({
  page,
}) => {
  await mockScreen(page);
  await page.goto("/capture");
  await startScreen(page);
  await page
    .getByRole("button", { name: "Stop & save", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  await expect(page.getByRole("link", { name: "Open process" })).toBeVisible();
  await page.getByRole("link", { name: "Open process" }).click();
  await expect(
    page.getByText("Shared by: Demo-User", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("New process name").fill("Rechnung prüfen");
  await page.getByRole("button", { name: "Save name" }).click();
  await page.reload();
  await expect(page.locator(".process-detail h2")).toHaveText(
    "Rechnung prüfen",
  );
  await page.locator(".process-detail details.stored-evidence:has(img)").first().locator("summary").click();
  await expect(page.getByAltText("Saved evidence 1")).toBeVisible();
  await page
    .getByRole("link", { name: "New run using this reference" })
    .click();
  await expect(
    page.getByText("Reference: Rechnung prüfen · version 1", { exact: true }),
  ).toBeVisible();
  await startScreen(page);
  await page
    .getByRole("button", { name: "Stop & save", exact: true })
    .click();
  await page.getByRole("link", { name: "Open process" }).click();
  await expect(
    page.getByLabel("Recording version").locator("option"),
  ).toHaveCount(2);
  await page.getByText("Version & comparison context").click();
  await expect(
    page.getByText(/This run references version 1/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Export JSON" })).toBeHidden();
  await page.getByText("More options", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".process-item:not(.demo)")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".process-item:not(.demo)")).toHaveCount(0);
});

test("failed auto-save retains evidence and can retry exactly once", async ({
  page,
}) => {
  await mockScreen(page);
  await page.goto("/capture");
  await startScreen(page);
  await page.evaluate(() => {
    const open = indexedDB.open.bind(indexedDB);
    let first = true;
    indexedDB.open = (...args: Parameters<IDBFactory["open"]>) => {
      if (first) {
        first = false;
        throw new Error("storage unavailable");
      }
      return open(...args);
    };
  });
  await page
    .getByRole("button", { name: "Stop & save", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry saving" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open process" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Retry saving" })
    .click();
  await page.getByRole("link", { name: "Open process" }).click();
  await expect(
    page.getByLabel("Recording version").locator("option"),
  ).toHaveCount(1);
});

test("missing reference blocks a new recording", async ({ page }) => {
  await page.goto("/capture?process=missing&version=missing");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Reference process not found" }),
  ).toBeVisible();
  await page.getByLabel("I have permission to show the data on my screen.").check();
  await page.getByLabel("Allow AI voice and screen analysis.", { exact: false }).check();
  await expect(
    page.getByRole("button", { name: "Start recording", exact: true }),
  ).toBeDisabled();
});

test("browser-ended screen saves captured evidence", async ({ page }) => {
  await mockScreen(page);
  await page.goto("/capture");
  await startScreen(page);
  await page.evaluate(() => {
    const t = (
      window as unknown as { testScreen: MediaStream }
    ).testScreen.getVideoTracks()[0];
    t.stop();
    t.dispatchEvent(new Event("ended"));
  });
  await expect(page.getByRole("status")).toContainText("Saved.");
  await expect(page.getByAltText("Current shared screen")).toHaveCount(0);
});

test("late picker result cannot restart or create an empty saved process", async ({
  page,
}) => {
  await mockScreen(page);
  await page.goto("/capture");
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getDisplayMedia.bind(
      navigator.mediaDevices,
    );
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: () =>
        new Promise((resolve) => {
          (window as unknown as { allow: () => void }).allow = () => {
            void original().then(resolve);
          };
        }),
    });
  });
  await page.getByLabel("I have permission to show the data on my screen.").check();
  await page.getByLabel("Allow AI voice and screen analysis.", { exact: false }).check();
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Stop & save", exact: true })
    .click();
  await page.evaluate(() =>
    (window as unknown as { allow: () => void }).allow(),
  );
  await expect(page.getByAltText("Current shared screen")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { testScreen: MediaStream }).testScreen
          ?.getTracks()
          .every((t) => t.readyState === "ended"),
      ),
    )
    .toBeTruthy();
  await expect(page.getByRole("link", { name: "Open process" })).toHaveCount(
    0,
  );
});

test("no fixed mask control remains and excluded frame is not silently saved", async ({
  page,
}) => {
  await mockScreen(page);
  await page.goto("/capture");
  await page.getByText("Options & recording details", { exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await startScreen(page);
  const pixel = await page
    .getByAltText("Current shared screen")
    .evaluate((img: HTMLImageElement) => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const x = c.getContext("2d")!;
      x.drawImage(img, 0, 0);
      return [...x.getImageData(c.width - 10, 10, 1, 1).data];
    });
  expect(pixel[0]).toBeGreaterThan(200);
  await page.getByRole("button", { name: "Pause / Off-record" }).click();
  await page.getByText(/Image 1 ·/).click();
  await page.getByRole("button", { name: "Exclude this frame" }).click();
  await expect(
    page.getByRole("button", { name: "Stop & save", exact: true }),
  ).toBeDisabled();
});

test("sandbox does not claim a learned rule is already connected", async ({
  page,
}) => {
  await page.goto("/sandbox");
  await page.getByLabel("Classification").selectOption("expense");
  await page.getByRole("button", { name: "Check before saving" }).click();
  await expect(page.getByRole("status")).toContainText("Not saved");
});

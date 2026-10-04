import { expect, test, type Page } from "@playwright/test";
import { mockScreen, startScreen } from "./capture-fixture";

async function sourceFixture(page: Page) {
  await mockScreen(page);
  await page.addInitScript(() => {
    const state = { label: "Übungs-ERP", surface: "browser" };
    Object.assign(window, { sharingFixture: state });
    const original = navigator.mediaDevices.getDisplayMedia.bind(
      navigator.mediaDevices,
    );
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const stream = await original();
        const track = stream.getVideoTracks()[0];
        Object.defineProperty(track, "label", { get: () => state.label });
        track.getSettings = () => ({
          displaySurface: state.surface,
          width: 1280,
          height: 720,
        });
        return stream;
      },
    });
  });
}

// UI/lifecycle fixture, not proof that the browser makes a native always-on-top window.
async function pipFixture(page: Page, deferred = false) {
  await page.addInitScript((deferred) => {
    Object.defineProperty(window, "documentPictureInPicture", {
      configurable: true,
      value: {
        requestWindow: async () => {
          const child = window.open(
            "about:blank",
            "sharing-test",
            "width=360,height=265",
          )!;
          if (!deferred) return child;
          return new Promise<Window>((resolve) =>
            Object.assign(window, { resolveMini: () => resolve(child) }),
          );
        },
      },
    });
  }, deferred);
}

test("shared source, preview border and duration remain clear past 120 seconds", async ({
  page,
}) => {
  await sourceFixture(page);
  await page.clock.install();
  await page.goto("/capture");
  await startScreen(page);
  await expect(page.getByTestId("sharing-source")).toHaveText(
    "Tab: Übungs-ERP · 1280 × 720",
  );
  await expect(page.locator(".screen-preview-sharing")).toHaveCSS(
    "border-top-width",
    "3px",
  );
  await page.clock.fastForward(125000);
  await expect(
    page.getByRole("region", { name: "Current screen sharing" }),
  ).toContainText("02:05");
  await expect(page.getByAltText("Current shared screen")).toBeVisible();
  await page.evaluate(() =>
    Object.assign(
      (window as unknown as { sharingFixture: object }).sharingFixture,
      { label: "Rechnungen", surface: "window" },
    ),
  );
  await page.clock.fastForward(1000);
  await expect(page.getByTestId("sharing-source")).toHaveText(
    "Window: Rechnungen · 1280 × 720",
  );
  await page
    .getByRole("button", { name: "Stop sharing & save", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  await expect(
    page.getByRole("region", { name: "Current screen sharing" }),
  ).toHaveCount(0);
});

test("mini controls stop and save the same recording, releasing the screen", async ({
  page,
}) => {
  await sourceFixture(page);
  await pipFixture(page);
  await page.goto("/capture");
  await startScreen(page);
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open mini controls" }).click();
  const popup = await popupPromise;
  await expect(
    popup.getByText("Tab: Übungs-ERP · 1280 × 720", { exact: true }),
  ).toBeVisible();
  await popup
    .getByRole("button", { name: "Stop & save", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(
    await page.evaluate(() =>
      (window as unknown as { testScreen: MediaStream }).testScreen
        .getTracks()
        .every((t) => t.readyState === "ended"),
    ),
  ).toBe(true);
});

test("mini pause is off-record, not auto-save", async ({ page }) => {
  await sourceFixture(page);
  await pipFixture(page);
  await page.goto("/capture");
  await startScreen(page);
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open mini controls" }).click();
  const popup = await popupPromise;
  await popup.getByRole("button", { name: "Pause / Off-record" }).click();
  await expect(page.getByAltText("Current shared screen")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Prozess öffnen" })).toHaveCount(
    0,
  );
  await expect.poll(() => popup.isClosed()).toBe(true);
});

test("late mini result cannot survive Stop", async ({ page }) => {
  await sourceFixture(page);
  await pipFixture(page, true);
  await page.goto("/capture");
  await startScreen(page);
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open mini controls" }).click();
  const popup = await popupPromise;
  await page
    .getByRole("button", { name: "Stop & save", exact: true })
    .click();
  await page.evaluate(() =>
    (window as unknown as { resolveMini(): void }).resolveMini(),
  );
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(page.getByRole("status")).toContainText("Saved.");
});

test("closing mini alone keeps the capture active", async ({ page }) => {
  await sourceFixture(page);
  await pipFixture(page);
  await page.goto("/capture");
  await startScreen(page);
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open mini controls" }).click();
  const popup = await popupPromise;
  await expect(
    popup.getByRole("button", { name: "Pause / Off-record" }),
  ).toBeVisible();
  await popup.close();
  await expect(page.getByAltText("Current shared screen")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open mini controls" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Stop sharing & save" })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved.");
});

test("unsupported browser keeps the main stop action and native-stop guidance", async ({
  page,
}) => {
  await sourceFixture(page);
  await page.addInitScript(() =>
    Object.defineProperty(window, "documentPictureInPicture", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/capture");
  await startScreen(page);
  await expect(
    page.getByRole("button", { name: "Open mini controls" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Stop sharing & save" }),
  ).toBeEnabled();
  await expect(page.getByText(/Stopping sharing from your browser also stops and saves/)).toBeVisible();
});

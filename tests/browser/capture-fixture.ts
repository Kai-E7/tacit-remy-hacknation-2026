import { expect, type Page } from "@playwright/test";
export async function mockScreen(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#efeaff";
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = "black";
        ctx.font = "36px sans-serif";
        ctx.fillText("SYNTHETIC INVOICE", 40, 100);
        const stream = canvas.captureStream(5);
        (window as unknown as { testScreen: MediaStream }).testScreen = stream;
        return stream;
      },
    });
  });
}
export async function startScreen(page: Page, ai = false) {
  await page.getByLabel("I have permission to show the data on my screen.").check();
  if (ai)
    await page.getByLabel("Allow AI voice and screen analysis.", { exact: false }).check();
  if (
    (await page.locator("details.capture-options").getAttribute("open")) ===
    null
  )
    await page.getByText("Options & recording details", { exact: true }).click();
  await page.getByRole("button", { name: "Start screen only" }).click();
  await expect(page.getByAltText("Current shared screen")).toBeVisible();
}

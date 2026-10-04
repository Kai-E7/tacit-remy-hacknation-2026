import { expect, test } from "@playwright/test";

test("Remy offers two clear journeys after the welcome screen", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByRole("heading", { name: "Hi, I’m Remy." })).toBeVisible();
  await expect(page.getByRole("img", { name: "Remy, your AI apprentice" })).toBeVisible();
  await page.getByRole("button", { name: /I want to teach you how I do something/ }).click();
  await expect(page.getByRole("link", { name: /Share your screen and walk me through a process/ })).toHaveAttribute("href", "/capture");
  await expect(page.getByRole("link", { name: /Talk me through a process/ })).toHaveAttribute("href", "/interview");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("link", { name: /I would like you to guide me through a process/ }).click();
  await expect(page).toHaveURL(/\/processes$/);
  await expect(page.getByRole("link", { name: /Walk me through while I share my screen/ })).toHaveAttribute("href", "/guide");
});

test("Remy's portrait loads on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/start");
  const portrait = page.getByRole("img", { name: "Remy, your AI apprentice" });
  await expect(portrait).toBeVisible();
  await expect(portrait).toHaveJSProperty("complete", true);
  await expect.poll(() => portrait.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

test("three synthetic process maps have labelled screenshots; deleting one stays deleted", async ({ page }) => {
  await page.goto("/processes");
  await expect(page.locator(".process-item.demo")).toHaveCount(3);
  await page.locator(".process-item.demo").filter({ hasText: "proposal email" }).click();
  await expect(page.getByText("Synthetic example only.", { exact: false })).toBeVisible();
  await expect(page.locator(".process-detail .flow-step:visible")).toHaveCount(4);
  await page.locator(".process-detail .flow-step:visible").first().click();
  await expect(page.getByText("Synthetic mock screenshot", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Close" }).last().click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".process-item.demo")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".process-item.demo")).toHaveCount(2);
});

test("unreviewed example cannot become operational guidance", async ({ page }) => {
  await page.goto("/guide");
  const consent = page.getByLabel("I agree to share my screen and voice with Remy for analysis of the data I choose to show.");
  await expect(consent).toBeVisible();
  await expect(page.getByText("automatic redaction may miss it.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share my screen with Remy" })).toBeDisabled();
  await consent.check();
  await expect(page.getByRole("button", { name: "Share my screen with Remy" })).toBeEnabled();
  await expect(page.getByText("No reviewed processes yet.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check coverage" })).toBeDisabled();
});

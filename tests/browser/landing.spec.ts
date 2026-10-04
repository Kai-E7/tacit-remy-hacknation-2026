import { expect, test } from "@playwright/test";

test("open invitation needs no password or media permission", async ({ page }) => {
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(access|voice-token|learning)/.test(request.url()))
      providerRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole("heading", { name: "Capture tacit knowledge. Meet Remy." })).toBeVisible();
  await expect(page.getByRole("img", { name: "Remy, your AI apprentice" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Meet Remy" })).toHaveAttribute("href", "/start");
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(providerRequests).toEqual([]);
});

test("Meet Remy opens the app directly without an access request", async ({ page }) => {
  const accessRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/access")) accessRequests.push(request.url());
  });
  await page.goto("/welcome");
  await page.getByRole("link", { name: "Meet Remy" }).click();
  await expect(page).toHaveURL(/\/start$/);
  await expect(page.getByRole("heading", { name: "Hi, I’m Remy." })).toBeVisible();
  expect(accessRequests).toEqual([]);
});

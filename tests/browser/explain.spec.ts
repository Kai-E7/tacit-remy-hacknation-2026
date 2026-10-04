import { expect, test } from "@playwright/test";

test("a process has a no-screen explanation with visible expert insight and boundaries", async ({ page }) => {
  await page.goto("/processes");
  await page.locator(".process-item.demo").first().click();
  await expect(page.getByRole("link", { name: "Explain it to me" })).toBeVisible();
  await page.getByRole("link", { name: "Explain it to me" }).click();
  await expect(page.getByRole("heading", { name: "Let me explain." })).toBeVisible();
  await expect(page.getByText("No screen or microphone needed.")).toBeVisible();
  await expect(page.getByText("Synthetic example · illustration only", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The process, in order" })).toBeVisible();
  const graph = page.getByRole("region", { name: "Process flow diagram" });
  await expect(graph.locator(".flow-step")).toHaveCount(4);
  await expect(graph.getByText("Expert know-how", { exact: true }).first()).toBeVisible();
  await expect(graph.getByText("MUST · example", { exact: true }).first()).toBeVisible();
  await expect(graph.getByText("Human judgment", { exact: true }).first()).toBeVisible();
});

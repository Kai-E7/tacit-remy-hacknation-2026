import { expect, test, type Page } from "@playwright/test";

async function prepare(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const c = document.createElement("canvas");
        c.width = 1280;
        c.height = 720;
        c.getContext("2d")!.fillRect(0, 0, 1280, 720);
        return c.captureStream(5);
      },
    });
  });
  await page.route("**/api/learning", (route) =>
    route.fulfill({
      json: {
        observation: {
          description: "Synthetic blank screen",
          question: "",
          changed: false,
        },
      },
    }),
  );
  await page.goto("/capture");
}
async function consent(page: Page) {
  await page.getByLabel("I have permission to show the data on my screen.").check();
  await page.getByLabel("Allow AI voice and screen analysis.", { exact: false }).check();
}

test("two consent boxes and one start automatically request the interviewer; failure can retry", async ({
  page,
}) => {
  const roles: string[] = [];
  await page.route("**/api/voice-token", (route) => {
    roles.push(route.request().postDataJSON().role);
    return route.fulfill({
      status: 502,
      json: { error: "voice_permission_missing" },
    });
  });
  await prepare(page);
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  const start = page.getByRole("button", {
    name: "Start recording",
  });
  await expect(start).toBeDisabled();
  await consent(page);
  expect(roles).toEqual([]);
  await start.click();
  await expect(
    page.locator(".voice-companion").getByRole("alert"),
  ).toContainText("ElevenLabs access is missing");
  expect(roles).toEqual(["interviewer"]);
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect.poll(() => roles.length).toBe(2);
});

test("off-record cancels the automatic voice start and screen sharing", async ({
  page,
}) => {
  let entered!: () => void;
  const pending = new Promise<void>((r) => {
    entered = r;
  });
  await page.route("**/api/voice-token", () => {
    entered();
  });
  await prepare(page);
  await consent(page);
  await page.getByRole("button", { name: "Start recording" }).click();
  await pending;
  await page.getByText("Options & recording details", { exact: true }).click();
  await page.getByRole("button", { name: "Pause / Off-record" }).click();
  await expect(
    page.getByRole("button", { name: "Start recording" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Pause / Off-record" }),
  ).toBeDisabled();
  await expect(page.getByText("Recording paused.")).toBeVisible();
});

test("cancelled picker does not start the interviewer", async ({ page }) => {
  let calls = 0;
  await prepare(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        throw new DOMException("cancelled", "NotAllowedError");
      },
    });
  });
  await page.route("**/api/voice-token", (route) => {
    calls++;
    return route.abort();
  });
  await consent(page);
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.locator(".quick-start").getByRole("alert")).toContainText(
    "Screen permission was cancelled",
  );
  expect(calls).toBe(0);
});

test("revoking combined consent ends a pending interview", async ({ page }) => {
  let entered!: () => void;
  const pending = new Promise<void>((r) => {
    entered = r;
  });
  await page.route("**/api/voice-token", () => {
    entered();
  });
  await prepare(page);
  await consent(page);
  await page.getByRole("button", { name: "Start recording" }).click();
  await pending;
  await page.getByLabel("Allow AI voice and screen analysis.", { exact: false }).uncheck();
  await expect(page.getByText("Recording paused.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start recording" }),
  ).toBeDisabled();
});

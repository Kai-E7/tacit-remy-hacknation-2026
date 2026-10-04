import { defineConfig } from "@playwright/test";
const externalServer = process.env.PLAYWRIGHT_BASE_URL;
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: externalServer ?? "http://127.0.0.1:3100",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: externalServer
    ? undefined
    : {
        command: "npm run dev -- --port 3100",
        url: "http://127.0.0.1:3100/api/health",
        reuseExistingServer: false,
        timeout: 60000,
      },
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "weather.test.ts",
  outputDir: "../../.playwright/test-results-live-providers",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    launchOptions: { args: ["--host-resolver-rules=MAP tv-sdk.test 127.0.0.1"] },
    trace: "retain-on-failure",
  },
  projects: [{
    name: "chromium",
    use: { browserName: "chromium" },
  }],
});

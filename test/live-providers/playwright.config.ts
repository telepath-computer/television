import { defineConfig } from "@playwright/test";

const baseURL = requiredURL("TV_WEB_E2E_URL");

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
    baseURL,
    launchOptions: { args: ["--host-resolver-rules=MAP tv-sdk.test 127.0.0.1"] },
    trace: "retain-on-failure",
  },
  projects: [{
    name: "chromium",
    use: { browserName: "chromium" },
  }],
});

function requiredURL(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be published by the test runner`);
  return new URL(value).href.replace(/\/$/, "");
}

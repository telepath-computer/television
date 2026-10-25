import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "*-conformance.test.ts",
  outputDir: "../../.playwright/test-results-conformance",
  // One product server for every template test; each worker has its own browser.
  globalSetup: "./test/e2e/conformance-setup.ts",
  fullyParallel: true,
  // The comparisons are CPU-bound, so one worker per core. TV_PW_WORKERS sets
  // another count, as on a host short of memory.
  workers: process.env.TV_PW_WORKERS ? Number(process.env.TV_PW_WORKERS) : "100%",
  retries: 0,
  reporter: "list",
  use: {
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

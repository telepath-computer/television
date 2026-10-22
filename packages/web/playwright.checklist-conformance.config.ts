import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "template-checklist-conformance.test.ts",
  outputDir: "../../.playwright/test-results-checklist-conformance",
  // One product server for every worker; each worker has its own browser and proxy.
  globalSetup: "./test/e2e/checklist-conformance-setup.ts",
  fullyParallel: true,
  // The comparisons are CPU-bound, so one worker per core.
  workers: "100%",
  retries: 0,
  reporter: "list",
  use: {
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

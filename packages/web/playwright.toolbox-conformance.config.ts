import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "toolbox-conformance.test.ts",
  outputDir: "../../.playwright/test-results-toolbox-conformance",
  fullyParallel: true,
  workers: "100%",
  retries: 0,
  reporter: "list",
  use: { trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

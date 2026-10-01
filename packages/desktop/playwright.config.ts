import { defineConfig } from "@playwright/test";

requiredURL("TV_DESKTOP_E2E_URL");

export default defineConfig({
  testDir: "./test/e2e",
  outputDir: "../../.playwright/test-results-electron",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  globalSetup: "./test/e2e/global-setup.ts",
});

function requiredURL(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be published by the test runner`);
  return new URL(value).href.replace(/\/$/, "");
}

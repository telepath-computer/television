import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: "playwright.fixture.ts",
  workers: 1,
  fullyParallel: false,
  // The parent acceptance owns retries; this fixture observes exactly two cases.
  retries: 0,
  timeout: 90_000,
  reporter: "line",
  outputDir: process.env.TV_WORKER_BUILD_OUTPUT,
});

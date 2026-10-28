import fs from "node:fs";
import { defineConfig, firefox, webkit } from "@playwright/test";

const firefoxAvailable = fs.existsSync(firefox.executablePath());
// Mirrors scripts/playwright-webkit-availability.mjs for the preflight path.
const webkitAvailable = fs.existsSync(webkit.executablePath());

if (process.env.CI && (!firefoxAvailable || !webkitAvailable)) {
  throw new Error("Weather artwork requires Playwright Firefox and WebKit in CI.");
}

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "template-weather-artwork.test.ts",
  outputDir: "../../.playwright/test-results-weather-artwork",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { trace: "on-first-retry" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    ...(firefoxAvailable ? [{ name: "firefox", use: { browserName: "firefox" as const } }] : []),
    ...(webkitAvailable ? [{ name: "webkit", use: { browserName: "webkit" as const } }] : []),
  ],
});

import fs from "node:fs";
import { defineConfig, firefox } from "@playwright/test";

const baseURL = requiredURL("TV_WEB_E2E_URL");
const firefoxAvailable = fs.existsSync(firefox.executablePath());
if (!firefoxAvailable && process.env.GITHUB_ACTIONS) {
  throw new Error(
    "Playwright Firefox is required in GitHub CI; setup-playwright must install it.",
  );
}
if (!firefoxAvailable) {
  console.warn("Playwright Firefox is unavailable; skipping the Firefox project.");
}

// The e2e:browser-app-real-stack surface serializes browser acceptances that
// boot product servers; those servers starve when the files share a two-worker
// invocation on 2-vCPU CI runners
// (specs/arch/test-runner/github-ci.md#ci-worker-counts).
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: [
    "**/appearance-delivery.test.ts",
    "**/onboarding-browser.test.ts",
    "**/path-artifact-real-stack-coverage.test.ts",
    "**/sidebar-collapse.test.ts",
    "**/sidebar-resize.test.ts",
    "**/theme-product-acceptance.test.ts",
  ],
  outputDir: "../../.playwright/test-results-web-real-stack",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
    ...(firefoxAvailable
      ? [{
          name: "firefox-theme-selection",
          testMatch: "theme-product-acceptance.test.ts",
          grep: /real dropdown renders its selected built-shell theme|theme-relative wallpaper|Firefox refreshes a ready Markdown editor from a fixed-dark theme to light/,
          use: { browserName: "firefox" as const },
        }]
      : []),
  ],
});

function requiredURL(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be published by the test runner`);
  return new URL(value).href.replace(/\/$/, "");
}

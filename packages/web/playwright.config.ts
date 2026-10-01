import fs from "node:fs";
import { defineConfig, firefox } from "@playwright/test";

const baseURL = requiredURL("TV_WEB_E2E_URL");
// Mirrors scripts/playwright-firefox-availability.mjs for the preflight path.
const firefoxAvailable = fs.existsSync(firefox.executablePath());
if (!firefoxAvailable && process.env.GITHUB_ACTIONS) {
  throw new Error(
    "Playwright Firefox is required in GitHub CI; setup-playwright must install it.",
  );
}
if (!firefoxAvailable) {
  console.warn("Playwright Firefox is unavailable; skipping the Firefox project.");
}

// Owned by e2e:browser-app-real-stack (playwright.real-stack.config.ts),
// which serializes tests that boot product servers.
const realStackTests = [
  "**/appearance-delivery.test.ts",
  "**/onboarding-browser.test.ts",
  "**/path-artifact-real-stack-coverage.test.ts",
  "**/sidebar-collapse.test.ts",
  "**/sidebar-resize.test.ts",
  "**/theme-product-acceptance.test.ts",
];
export default defineConfig({
  testDir: "./test/e2e",
  testIgnore: realStackTests,
  outputDir: "../../.playwright/test-results-web",
  timeout: 30_000,
  fullyParallel: false,
  // CI runners are 2-core; Playwright's default (~half the cores) resolves to a
  // single worker there, running files serially. Pin to 2 so each sharded job
  // uses both cores. Local runs keep the default (undefined).
  // TV_PW_WORKERS allows controlled CI worker-count measurements.
  // (specs/arch/test-runner/github-ci.md#ci-worker-counts).
  workers: process.env.CI ? Number(process.env.TV_PW_WORKERS ?? "2") : undefined,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: realStackTests,
      use: { browserName: "chromium" },
    },
    ...(firefoxAvailable
      ? [
          {
            name: "firefox",
            testMatch: ["tab-strip.test.ts", "item-edge-fade.test.ts"],
            grep: /tab label overflow|tab compression stability|tab-strip overflow|edge masks|updates after item|cleanup cancels|zero distance|explicit refresh|refreshes overflow after/,
            use: { browserName: "firefox" as const },
          },
          {
            name: "firefox-appearance",
            testMatch: "appearance-frame.test.ts",
            use: { browserName: "firefox" as const },
          },
        ]
      : []),
  ],
});

function requiredURL(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be published by the test runner`);
  return new URL(value).href.replace(/\/$/, "");
}

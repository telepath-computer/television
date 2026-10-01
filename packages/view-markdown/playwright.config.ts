import { defineConfig, devices } from "@playwright/test";

const BASE_URL = requiredURL("TV_VIEW_MARKDOWN_E2E_URL");
const ACTION_TIMEOUT_MS = 10_000;

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    actionTimeout: ACTION_TIMEOUT_MS,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Tall viewport so the entire seed.md fixture renders without
        // CM6's line virtualization hiding off-screen content.
        viewport: { width: 1280, height: 2400 },
      },
    },
  ],
});

function requiredURL(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be published by the test runner`);
  return new URL(value).href.replace(/\/$/, "");
}

import { defineConfig, devices } from "@playwright/test";

// Real-browser surface for the server's read-only Markdown styling. Unlike the
// view-markdown e2e surface there is no app to boot — each spec builds a static
// HTML document (canonical tokens + MARKDOWN_DOC_CSS + `marked` output) and
// loads it with `page.setContent()`, then reads computed styles and layout. The
// layout/cascade sensitivity of the marker-alignment work is exactly what JSDOM
// can't model, so it has to run in Chromium (AGENTS.md component-testing rule).

const ACTION_TIMEOUT_MS = 10_000;

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    actionTimeout: ACTION_TIMEOUT_MS,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

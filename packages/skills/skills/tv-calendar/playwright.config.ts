import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const baseURL = requiredURL("TV_CALENDAR_E2E_URL");

export default defineConfig({
  testDir: path.resolve(here, "test/e2e"),
  outputDir: path.resolve(here, ".playwright/test-results"),
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    browserName: "chromium",
    baseURL,
    trace: "on-first-retry",
  },
});

function requiredURL(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be published by the test runner`);
  return new URL(value).href.replace(/\/$/, "");
}

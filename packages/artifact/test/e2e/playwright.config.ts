import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { readPublishedArtifactE2EURLs } from "./artifact-e2e-urls.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const { hostURL } = readPublishedArtifactE2EURLs();

export default defineConfig({
  testDir: here,
  outputDir: path.resolve(here, "../../.playwright/test-results"),
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    browserName: "chromium",
    baseURL: hostURL,
    trace: "on-first-retry",
  },
});

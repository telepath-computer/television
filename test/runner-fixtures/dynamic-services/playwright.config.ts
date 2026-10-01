import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const firstURL = process.env.TV_DYNAMIC_FIRST_URL;
const secondURL = process.env.TV_DYNAMIC_SECOND_URL;
if (!firstURL) throw new Error("TV_DYNAMIC_FIRST_URL is required");
if (!secondURL) throw new Error("TV_DYNAMIC_SECOND_URL is required");

export default defineConfig({
  testDir: fixtureDir,
  testMatch: "dynamic-services.spec.ts",
  outputDir: path.join(fixtureDir, ".playwright"),
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    browserName: "chromium",
    baseURL: secondURL,
  },
});

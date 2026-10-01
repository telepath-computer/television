import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
const testDir = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({ testDir, testMatch: "playwright*.fixture.ts", workers: 1, use: { headless: true } });

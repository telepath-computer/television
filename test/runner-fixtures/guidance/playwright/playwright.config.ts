import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "*.test.ts", retries: 7, workers: 1 });

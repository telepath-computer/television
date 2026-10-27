import { defineConfig } from "vitest/config";
export default defineConfig({ root: import.meta.dirname, test: { include: ["*.test.ts"], maxWorkers: 1, fileParallelism: false, testTimeout: 1_200_000, hookTimeout: 120_000 } });

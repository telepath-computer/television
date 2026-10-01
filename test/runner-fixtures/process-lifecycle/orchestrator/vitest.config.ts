import { defineConfig } from "vitest/config";

export default defineConfig({ root: import.meta.dirname, test: { include: ["orchestrator.test.ts"], testTimeout: 60_000, hookTimeout: 15_000, retry: 0 } });

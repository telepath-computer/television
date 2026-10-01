import { defineConfig } from "vitest/config";

export default defineConfig({ root: import.meta.dirname, test: { include: ["active.fixture.test.ts"], testTimeout: 60_000, retry: 0 } });

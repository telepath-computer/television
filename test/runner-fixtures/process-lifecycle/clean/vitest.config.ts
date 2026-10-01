import { defineConfig } from "vitest/config";

export default defineConfig({ root: import.meta.dirname, test: { include: ["clean.fixture.test.ts"], retry: 0 } });

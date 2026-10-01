import { defineConfig } from "vitest/config";

export default defineConfig({ root: import.meta.dirname, test: { include: ["leak.fixture.test.ts"], retry: 0 } });

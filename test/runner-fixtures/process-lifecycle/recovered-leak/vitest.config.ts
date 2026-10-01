import { defineConfig } from "vitest/config";

export default defineConfig({ root: import.meta.dirname, test: { include: ["recovered-leak.fixture.test.ts"], retry: 1 } });

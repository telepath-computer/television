import { defineConfig } from "vitest/config";

export default defineConfig({ root: import.meta.dirname, test: { include: ["precommand.fixture.test.ts"], retry: 0 } });

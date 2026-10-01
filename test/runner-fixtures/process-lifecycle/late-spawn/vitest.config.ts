import { defineConfig } from "vitest/config";

export default defineConfig({ root: import.meta.dirname, test: { include: ["late-spawn.fixture.test.ts"], retry: 0 } });

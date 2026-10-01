import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["vitest-one.fixture.ts"], retry: 0 } });

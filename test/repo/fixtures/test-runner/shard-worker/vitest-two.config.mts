import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["vitest-two.fixture.ts"], retry: 0 } });

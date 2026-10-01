import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    retry: 0,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["test/telemetry-posthog.integration.test.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 30_000,
  },
});

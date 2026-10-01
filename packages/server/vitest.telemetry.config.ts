import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    retry: 0,
    include: ["test/telemetry-posthog.integration.test.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 240_000,
  },
});

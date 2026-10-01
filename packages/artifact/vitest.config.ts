import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    retry: 0,
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 30_000,
  },
});

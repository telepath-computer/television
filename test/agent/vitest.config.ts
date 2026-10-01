import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    retry: 0,
    include: ["test/agent/**/*.test.ts"],
    testTimeout: 300_000,
  }
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    retry: 0,
    include: ["test/repo/build-config-integrity.test.ts"],
    testTimeout: 180_000,
  },
});

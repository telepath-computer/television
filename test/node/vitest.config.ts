import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    retry: 0,
    include: ["test/node/**/*.test.ts"],
    exclude: ["test/node/daemon-acceptance.test.ts"],
    testTimeout: 300_000,
  },
});

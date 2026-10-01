import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    retry: 0,
    include: ["test/node/daemon-acceptance.test.ts"],
    fileParallelism: false,
    testTimeout: 600_000,
  },
});

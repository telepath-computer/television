import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/fixtures/worker-builds/vitest.fixture.ts"],
    maxWorkers: 1,
    fileParallelism: false,
    // The parent acceptance owns retries; this fixture observes exactly two cases.
    retry: 0,
    testTimeout: 90_000,
  },
});

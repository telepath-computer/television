import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests for the runner — pure logic (config parsing, line
// rendering) plus process-level tests that spawn cheap real shell commands.
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  test: {
    retry: 0,
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
  },
});

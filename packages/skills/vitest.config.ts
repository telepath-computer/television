import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests for the skills package — any `*.test.ts` colocated under a skill's
// `src/`.
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  test: {
    retry: 0,
    include: ["skills/*/src/**/*.test.ts"],
  },
});

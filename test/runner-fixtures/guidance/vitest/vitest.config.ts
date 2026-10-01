import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({ root: fileURLToPath(new URL(".", import.meta.url)), test: { include: ["*.test.ts"], retry: 7, maxWorkers: 1 } });

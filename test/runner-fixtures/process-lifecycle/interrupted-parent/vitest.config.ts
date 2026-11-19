import "../../../../scripts/test/native-entrypoint.mjs";
import { defineConfig } from "vitest/config";

export default defineConfig({ root: import.meta.dirname, test: { include: ["interrupted-parent.test.ts"], retry: 0 } });

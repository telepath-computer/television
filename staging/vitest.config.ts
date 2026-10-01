import { defineConfig } from "vitest/config";
import { liquidTemplates } from "../config/liquid/plugin.ts";

export default defineConfig({
  plugins: [liquidTemplates()],
  test: {
    retry: 0,
    include: ["test/**/*.test.ts"],
  },
});

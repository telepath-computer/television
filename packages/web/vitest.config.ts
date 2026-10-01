import { defineConfig } from "vitest/config";
import { liquidTemplates } from "../../config/liquid/plugin.ts";
import { cssModuleScripts } from "../../config/css-module-scripts.ts";

export default defineConfig({
  // Spec templates import as render functions in tests (markup-identity
  // conformance against specs/ui/). Attributed CSS imports compile to
  // shared CSSStyleSheet modules (code-owned mechanics; the stylesheet-modules spec was retired with arch/ui.md "Stylesheet modules").
  plugins: [liquidTemplates(), cssModuleScripts()],
  test: {
    retry: 0,
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["test/e2e/**"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 30_000,
  },
});

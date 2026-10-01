import { defineConfig } from "vite";
import type { Plugin } from "vite";
import frameset from "frameset/vite";
import { liquidTemplates } from "./config/liquid/plugin.ts";
import { cssModuleScripts } from "./config/css-module-scripts.ts";

function rootLiquidTemplates(): Plugin {
  const plugin = liquidTemplates();
  const transform = plugin.transform;
  if (typeof transform !== "function") return plugin;

  return {
    ...plugin,
    transform(code, id, options) {
      const [file] = id.split("?");
      if (file?.endsWith(".yml") || file?.endsWith(".yaml")) return null;
      return transform.call(this, code, id, options);
    },
  };
}

// The repo-root Vite config, for tools that serve the whole tree rather than
// one workspace. Frameset 0.16 roots at the manifest root and uses this config;
// Storybook keeps its own config because its root is `storybook/`.
export default defineConfig({
  server: {
    watch: {
      ignored: ["**/.test-runs/**", "**/.playwright/**"],
    },
  },
  // Frameset owns YAML in this combined pipeline. The existing Liquid plugin
  // still compiles templates, without parsing Frameset's generated JS again.
  plugins: [frameset(), rootLiquidTemplates(), cssModuleScripts()],
});

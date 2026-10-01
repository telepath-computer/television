import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { StorybookConfig } from "@storybook/web-components-vite";
import { liquidTemplates } from "../../config/liquid/plugin.ts";
import { cssModuleScripts } from "../../config/css-module-scripts.ts";
import { skillbenchMiddleware } from "../../packages/skillbench/middleware.mjs";

const config: StorybookConfig = {
  stories: [
    // Any story in the storybook workspace tree (spec staging under specs/,
    // design workshops under design/, future trees alike). Legacy colocated
    // *.stories.ts under packages/ live outside this workspace and are
    // deliberately not loaded (see specs/spec-ui.md).
    { directory: "..", files: "**/*.stories.ts" },
  ],
  // Pre-configured documents a story renders into, served verbatim: a story
  // names one with its `frame` parameter and the decorator points an iframe
  // at it. Static rather than a Vite entry, so anything a frame loads must be
  // a URL that resolves at runtime.
  staticDirs: [
    { from: "../frames", to: "/frames" },
    // The canonical package build must have run before Storybook starts.
    { from: "../../packages/canonical/dist/canonical", to: "/canonical" },
  ],
  addons: [getAbsolutePath("@storybook/addon-docs")],
  framework: {
    name: getAbsolutePath("@storybook/web-components-vite"),
    options: {},
  },
  core: {
    disableTelemetry: true,
    disableWhatsNewNotifications: true,
  },
  viteFinal(config) {
    config.plugins = [
      ...(config.plugins ?? []),
      liquidTemplates(),
      // Attributed CSS imports compile to shared CSSStyleSheet modules
      // (specs/arch/ui.md "Stylesheet modules").
      cssModuleScripts(),
      {
        // The skillbench page + API (specs/arch/skillbench.md),
        // embedded per skill as its Preview story leaf.
        name: "skillbench",
        configureServer(server) {
          server.middlewares.use("/skillbench", skillbenchMiddleware());
        },
      },
    ];
    return config;
  },
};

export default config;

function getAbsolutePath(value: string): any {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

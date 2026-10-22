import { createRequire } from "node:module";
import { hostname } from "node:os";
import type { StorybookConfig } from "@storybook/html-vite";
import frameset from "frameset/vite";
import { mergeConfig } from "vite";

const require = createRequire(import.meta.url);

// With TAILSCALE_REMOTE set, the dev script listens on the machine's
// Tailscale address, and other tailnet devices reach it by hostname.
const tailscaleRemote = process.env.TAILSCALE_REMOTE === "1";

const config: StorybookConfig = {
  stories: ["../../specs/**/*.mdx", "../spec/**/*.mdx", "../spec/**/*.stories.@(js|ts)", "../production/**/*.stories.@(js|ts)", "../experiments/**/*.stories.@(js|ts)", "../prototypes/**/*.stories.@(js|ts)"],
  // The docs add-on renders each spec's .mdx prose beside its stories.
  addons: ["@storybook/addon-docs"],
  framework: {
    name: "@storybook/html-vite",
    options: {},
  },
  // Existing specs are .frame files; the plugin compiles each import into a
  // module whose render(params) returns the frame's markup.
  viteFinal: (config) => mergeConfig(config, {
    plugins: [frameset()],
    resolve: {
      // MDX specs outside this workspace still use its docs add-on.
      alias: { "@storybook/addon-docs/blocks": require.resolve("@storybook/addon-docs/blocks") },
    },
  }),
  core: {
    disableTelemetry: true,
    disableWhatsNewNotifications: true,
    allowedHosts: tailscaleRemote ? [hostname()] : undefined,
  },
  // Keep the interface to the sidebar, the canvas, viewports and controls.
  // Change detection is what marks and filters new stories in the sidebar.
  features: {
    changeDetection: false,
    sidebarOnboardingChecklist: false,
    menuOnboardingChecklist: false,
    actions: false,
    backgrounds: false,
    highlight: false,
    interactions: false,
    measure: false,
    outline: false,
  },
};

export default config;

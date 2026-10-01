import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTelevisionLicensePlugin } from "../../scripts/licenses/vite-plugin.mjs";
import { cssModuleScripts } from "../../config/css-module-scripts.ts";
// @ts-expect-error — repository build helper has no declaration file
import { contentAddressedName } from "../canonical/scripts/content-addressed-name.mjs";
import { appearanceResolverScriptSource } from "../artifact/src/browser/appearance-resolver.ts";
import { appearanceBootstrapScriptSource } from "./src/appearance.ts";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const tailscaleRemote = process.env.TAILSCALE_REMOTE === "1";

// The bundle's version stamp (specs/arch/updates/version-advertisement.md
// ^web-version-stamp): the workspace package version, or TV_TEST_WEB_VERSION
// when set — a build input for test harnesses building fixture bundles at
// chosen versions (^hook-web-version); publish never sets it. Applied only
// for `vite build`: under the dev server the constant stays undefined and the
// client resolves its bundle version to "0.0.0" (src/version.ts).
function webBundleVersion(): string {
  const override = process.env.TV_TEST_WEB_VERSION;
  if (override !== undefined && override.length > 0) return override;
  return (JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")) as { version: string }).version;
}

function appearanceBootstrap() {
  const shellEntry = path.join(packageDir, "src/index.html");
  return {
    name: "television-appearance-bootstrap",
    transformIndexHtml: {
      order: "pre" as const,
      handler(_html: string, context: { filename: string }) {
        if (path.resolve(context.filename) !== shellEntry) return [];
        return [{
          tag: "script",
          children: appearanceBootstrapScriptSource(),
          injectTo: "head-prepend" as const,
        }];
      },
    },
  };
}

function artifactDocumentAppearanceBootstrap() {
  const entries = new Set([
    path.join(packageDir, "src/views/artifact-missing/index.html"),
    path.join(packageDir, "src/views/url-unsupported/index.html"),
  ]);
  return {
    name: "television-artifact-document-appearance-bootstrap",
    transformIndexHtml: {
      order: "pre" as const,
      handler(_html: string, context: { filename: string }) {
        if (!entries.has(path.resolve(context.filename))) return [];
        return [{
          tag: "script",
          children: appearanceResolverScriptSource('"system"'),
          injectTo: "head-prepend" as const,
        }];
      },
    },
  };
}

function canonicalFontPreload() {
  const fontPath = path.join(
    packageDir,
    "src/foundation/fonts/Hind-Variable.woff2",
  );
  const fontName = contentAddressedName(
    path.basename(fontPath),
    readFileSync(fontPath),
  );
  const shellEntry = path.join(packageDir, "src/index.html");

  return {
    name: "television-canonical-font-preload",
    transformIndexHtml: {
      order: "post" as const,
      handler(_html: string, context: { filename: string }) {
        if (path.resolve(context.filename) !== shellEntry) return [];
        return [{
          tag: "link",
          attrs: {
            rel: "preload",
            as: "font",
            crossorigin: "",
            href: `/canonical/v2/fonts/${fontName}`,
          },
          injectTo: "head" as const,
        }];
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  root: path.resolve(packageDir, "src"),
  base: "./",
  define: command === "build" ? { __TV_VERSION__: JSON.stringify(webBundleVersion()) } : undefined,
  server: {
    host: tailscaleRemote ? "0.0.0.0" : "127.0.0.1",
    allowedHosts: tailscaleRemote ? true : undefined,
    port: 5173,
    strictPort: true,
    watch: {
      followSymlinks: true,
    },
  },
  resolve: {
    preserveSymlinks: false,
  },
  // Attributed CSS imports compile to shared CSSStyleSheet modules
  // (code-owned mechanics; the stylesheet-modules spec was retired with arch/ui.md "Stylesheet modules").
  plugins: [
    appearanceBootstrap(),
    artifactDocumentAppearanceBootstrap(),
    cssModuleScripts(),
    createTelevisionLicensePlugin({ surface: "web" }),
    canonicalFontPreload(),
  ],
  build: {
    outDir: path.resolve(packageDir, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(packageDir, "src/index.html"),
        artifactMissing: path.resolve(packageDir, "src/views/artifact-missing/index.html"),
        urlUnsupported: path.resolve(packageDir, "src/views/url-unsupported/index.html"),
      },
    },
  },
}));

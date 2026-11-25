import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { createTelevisionLicensePlugin } from "../../scripts/licenses/vite-plugin.mjs";
import { createPackagedMarkdownEditorOutputPlugin } from "./packaged-markdown-editor-build.mjs";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(packageDir, "../..");

const outputDir = requireEnvironmentPath("TV_PACKAGED_MARKDOWN_EDITOR_OUTPUT_DIR");
const recordOutputPath = requireEnvironmentPath("TV_PACKAGED_MARKDOWN_EDITOR_RECORD_OUTPUT");
const inventoryRoot = requireEnvironmentPath("TV_PACKAGED_MARKDOWN_EDITOR_INVENTORY_ROOT");

function isolateEditorScript(): Plugin {
  return {
    name: "view-markdown-isolate-editor-script",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (item) => item.type === "chunk" && item.isEntry,
      );
      if (!entry || entry.type !== "chunk") {
        throw new Error("Markdown editor entry chunk was not emitted");
      }
      // Vite's minifier may lift helper declarations out of Rollup's IIFE.
      // Wrap the final chunk so the internal mount assignment is its only global.
      entry.code = `(() => {\n${entry.code}\n})();\n`;
    },
  };
}

// Build the packaged Markdown editor as a classic, self-contained script. Keeping
// this entry separate from the file view excludes its start-up code and
// Vite's HTML module-preload polyfill.
export default defineConfig({
  publicDir: false,
  plugins: [
    createTelevisionLicensePlugin({
      surface: "view:markdown",
      mode: "verify",
      root: repositoryRoot,
      inventoryRoot,
      recordOutputPath,
      requiredAssetSurfaces: ["view:markdown", "source"],
      verificationFailureHint:
        "Run `npm run refresh:packaged-markdown-editor` to rebuild the Markdown file view inventory and packaged Markdown editor.",
    }),
    isolateEditorScript(),
    createPackagedMarkdownEditorOutputPlugin(),
  ],
  build: {
    outDir: outputDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(packageDir, "src/editor-entry.ts"),
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "editor.js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.names.some((name) => name.endsWith(".css"))) {
            return "editor.css";
          }
          throw new Error(`Unexpected Markdown editor asset: ${assetInfo.names.join(", ")}`);
        },
      },
    },
  },
});

function requireEnvironmentPath(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required; run \`node scripts/check-packaged-markdown-editor.mjs\` `
        + "or `npm run refresh:packaged-markdown-editor`",
    );
  }
  return path.resolve(value);
}

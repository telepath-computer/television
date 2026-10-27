import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

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
      // Wrap the final chunk so the public assignment is its only global.
      entry.code = `(() => {\n${entry.code}\n})();\n`;
    },
  };
}

// Build the versioned editor as a classic, self-contained script. Keeping
// this entry separate from the file view excludes its start-up code and
// Vite's HTML module-preload polyfill.
export default defineConfig({
  publicDir: false,
  plugins: [isolateEditorScript()],
  build: {
    outDir: path.resolve(packageDir, "dist/v1"),
    emptyOutDir: false,
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

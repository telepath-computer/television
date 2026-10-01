import path from "node:path";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createTelevisionLicensePlugin } from "../../../../scripts/licenses/vite-plugin.mjs";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: packageDir,
  plugins: [
    createTelevisionLicensePlugin({ surface: "skill:tv-calendar" }),
    {
      name: "copy-skill-markdown",
      closeBundle() {
        copyFileSync(
          path.join(packageDir, "SKILL.md"),
          path.join(packageDir, "dist", "SKILL.md"),
        );
      },
    },
  ],
  build: {
    outDir: path.resolve(packageDir, "dist"),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(packageDir, "src/calendar-elements.ts"),
      formats: ["es"],
      fileName: () => "calendar.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css") ? "calendar.css" : "[name][extname]",
      },
    },
  },
});

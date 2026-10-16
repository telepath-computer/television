import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createTelevisionLicensePlugin } from "../../../../scripts/licenses/vite-plugin.mjs";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.resolve(process.env.TV_ONBOARDING_COMPONENTS_DIST_DIR ?? path.join(packageDir, "../../onboarding-dist"));

export default defineConfig({
  root: packageDir,
  plugins: [
    createTelevisionLicensePlugin({ surface: "onboarding:calendar" }),
  ],
  build: {
    outDir: path.join(outputRoot, "tv-calendar"),
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

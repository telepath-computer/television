import path from "node:path";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createTelevisionLicensePlugin } from "../../../../scripts/licenses/vite-plugin.mjs";

// Bundles the task browser components for the onboarding bake. task.css is a
// standalone stylesheet the components do not import, so it is copied beside
// task.js.
const packageDir = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.resolve(process.env.TV_ONBOARDING_COMPONENTS_DIST_DIR ?? path.join(packageDir, "../../onboarding-dist"));

export default defineConfig({
  root: packageDir,
  plugins: [
    createTelevisionLicensePlugin({ surface: "onboarding:tasks" }),
    {
      name: "copy-skill-assets",
      closeBundle() {
        copyFileSync(
          path.join(packageDir, "src", "task.css"),
          path.join(outputRoot, "tv-tasks/task.css"),
        );
      },
    },
  ],
  build: {
    outDir: path.join(outputRoot, "tv-tasks"),
    emptyOutDir: true,
    // Skill output ships as readable source — agents and humans read these
    // files (and may inline them into artifacts); no minification.
    minify: false,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(packageDir, "src/task.ts"),
      formats: ["es"],
      fileName: () => "task.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});

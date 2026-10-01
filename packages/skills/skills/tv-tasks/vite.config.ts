import path from "node:path";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createTelevisionLicensePlugin } from "../../../../scripts/licenses/vite-plugin.mjs";

// Bundles the skill-local web components (src/task.ts, which pulls in due.ts and
// @rupertsworld/event-target) into dist/task.js. task.css is a standalone
// stylesheet the components don't import, so it's copied — not bundled —
// alongside SKILL.md.
const packageDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: packageDir,
  plugins: [
    createTelevisionLicensePlugin({ surface: "skill:tv-tasks" }),
    {
      name: "copy-skill-assets",
      closeBundle() {
        copyFileSync(
          path.join(packageDir, "SKILL.md"),
          path.join(packageDir, "dist", "SKILL.md"),
        );
        copyFileSync(
          path.join(packageDir, "src", "task.css"),
          path.join(packageDir, "dist", "task.css"),
        );
      },
    },
  ],
  build: {
    outDir: path.resolve(packageDir, "dist"),
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

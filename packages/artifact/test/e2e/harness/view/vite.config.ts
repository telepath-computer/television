import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  server: {
    watch: { followSymlinks: true },
  },
  resolve: {
    preserveSymlinks: false,
  },
});

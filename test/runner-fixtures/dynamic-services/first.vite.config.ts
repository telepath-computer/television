import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(fixtureDir, "first"),
  // Static HTML fixtures have no dependencies to optimize into the shared cache.
  optimizeDeps: { noDiscovery: true, include: [] },
});

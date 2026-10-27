import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(fixtureDir, "first"),
  // Static HTML fixtures have no dependencies to optimize into the shared cache.
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{
    name: "conditional-header-report",
    configureServer(server) {
      // Reports the validators that reached Vite's middleware stack.
      server.middlewares.use("/__conditional-headers", (req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          ifNoneMatch: req.headers["if-none-match"] ?? null,
          ifModifiedSince: req.headers["if-modified-since"] ?? null,
        }));
      });
    },
  }],
});

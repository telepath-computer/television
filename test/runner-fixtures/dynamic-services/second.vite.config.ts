import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const firstURL = process.env.TV_DYNAMIC_FIRST_URL;
if (!firstURL) throw new Error("TV_DYNAMIC_FIRST_URL must be published before the second service config loads");

export default defineConfig({
  root: path.join(fixtureDir, "second"),
  // Static HTML fixtures have no dependencies to optimize into the shared cache.
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{
    name: "dynamic-service-publication-probe",
    configureServer(server) {
      server.middlewares.use("/__first_url", (_request, response) => {
        response.setHeader("content-type", "text/plain");
        response.end(firstURL);
      });
    },
  }],
});

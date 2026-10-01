import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const viewURL = requiredURL("TV_ARTIFACT_E2E_VIEW_URL");

export default defineConfig({
  root: here,
  define: {
    __TV_ARTIFACT_E2E_VIEW_URL__: JSON.stringify(viewURL),
  },
  server: {
    watch: { followSymlinks: true },
  },
  resolve: {
    preserveSymlinks: false,
  },
});

function requiredURL(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be published before the artifact host config loads`);
  return new URL(value).href.replace(/\/$/, "");
}

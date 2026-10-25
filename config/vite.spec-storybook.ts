import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("../storybook/dist", import.meta.url)),
  publicDir: false,
});

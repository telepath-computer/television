import { defineConfig } from "vite";
import { liquidTemplates } from "./liquid/plugin.ts";

export default defineConfig({
  root: ".",
  plugins: [
    liquidTemplates(),
    {
      name: "television-web-view-directory-indexes",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const path = req.url?.split("?", 1)[0];
          if (path === "/views/url-unsupported/") {
            req.url = req.url.replace("/views/url-unsupported/", "/packages/web/src/views/url-unsupported/index.html");
          } else if (path === "/views/url-unsupported/main.ts") {
            req.url = req.url.replace("/views/url-unsupported/main.ts", "/packages/web/src/views/url-unsupported/main.ts");
          } else if (path === "/views/markdown/") {
            req.url = req.url.replace("/views/markdown/", "/packages/view-markdown/src/index.html");
          } else if (path === "/views/markdown/main.ts") {
            req.url = req.url.replace("/views/markdown/main.ts", "/packages/view-markdown/src/main.ts");
          }
          next();
        });
      },
    },
  ],
  server: {
    watch: {
      followSymlinks: true,
      ignored: ["**/.test-runs/**", "**/.playwright/**"],
    },
  },
  // Fixture pages import Stage's keyed directive outside Vite's cold-start
  // entry crawl. Pre-bundle it before tests run so dependency discovery cannot
  // reload Playwright workers sharing the fixture server.
  optimizeDeps: {
    include: ["lit-html/directives/keyed.js"],
  },
  resolve: {
    preserveSymlinks: false,
  },
});

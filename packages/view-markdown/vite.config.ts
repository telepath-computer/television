import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { createTelevisionLicensePlugin } from "../../scripts/licenses/vite-plugin.mjs";
import { appearanceResolverScriptSource } from "../artifact/src/browser/appearance-resolver.ts";
import { canonicalWrapper } from "../server/src/canonical.ts";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

// Inline-asset budget: 64 KiB. Generous enough to absorb the Hind variable
// font woff2 (~23 KB) sourced from `packages/canonical` plus any future
// view-owned assets, while still capping the bundle from runaway
// growth. See `build` config below for why everything must be inlined.
const ASSETS_INLINE_LIMIT_BYTES = 65_536;
const CANONICAL_V2_SOURCE = path.resolve(
  packageDir,
  "../canonical/styles/canonical/v2",
);
const CANONICAL_WRAPPER = canonicalWrapper("v2");
const CANONICAL_CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".woff2": "font/woff2",
};

/**
 * Inline every `<script type="module" src="...">` tag in the entry HTML so
 * the hosted view remains self-contained. The same bundle is also emitted at
 * the versioned path used by Markdown template pages.
 */
function appearanceBootstrap(): Plugin {
  return {
    name: "view-markdown-appearance-bootstrap",
    transformIndexHtml: {
      order: "pre",
      handler() {
        return [{
          tag: "script",
          children: appearanceResolverScriptSource('"system"'),
          injectTo: "head-prepend",
        }];
      },
    },
  };
}

function developmentStyles(): Plugin {
  return {
    name: "view-markdown-development-styles",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/canonical/v2", async (req, res) => {
        const relativePath = (req.url ?? "").replace(/^\/+/, "").split("?", 1)[0];
        if (relativePath === "styles.css") {
          sendDevelopmentStyle(res, "text/css", CANONICAL_WRAPPER);
          return;
        }

        const filePath = relativePath === "base.css"
          ? path.join(CANONICAL_V2_SOURCE, "index.css")
          : path.resolve(CANONICAL_V2_SOURCE, relativePath);
        if (!filePath.startsWith(`${CANONICAL_V2_SOURCE}${path.sep}`)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        try {
          if (!(await stat(filePath)).isFile()) throw new Error("not a file");
          sendDevelopmentStyle(
            res,
            CANONICAL_CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream",
            await readFile(filePath),
          );
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
      server.middlewares.use("/theme/theme.css", (_req, res) => {
        sendDevelopmentStyle(res, "text/css", "");
      });
    },
  };
}

function developmentTestHook(): Plugin {
  return {
    name: "view-markdown-development-test-hook",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        "<body data-television-markdown-hosted>",
        '<body data-television-markdown-hosted data-television-markdown-test-hook>',
      );
    },
  };
}

function sendDevelopmentStyle(
  res: { setHeader(name: string, value: string): void; end(body?: string | Buffer): void },
  contentType: string,
  body: string | Buffer,
): void {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-cache");
  res.end(body);
}

function inlineScripts(): Plugin {
  return {
    name: "view-markdown-inline-scripts",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".html")) continue;
        const html = typeof asset.source === "string" ? asset.source : asset.source.toString();
        const scriptTag =
          /<script\b([^>]*?)\ssrc="([^"]+)"([^>]*)><\/script>/g;
        const consumedChunks: string[] = [];
        const rewritten = html.replace(scriptTag, (match, pre: string, src: string, post: string) => {
          const normalized = src.startsWith("./") ? src.slice(2) : src;
          const chunk = bundle[normalized];
          if (!chunk || chunk.type !== "chunk") return match;
          bundle["v1/editor.js"] = {
            type: "asset",
            fileName: "v1/editor.js",
            name: "editor.js",
            source: chunk.code,
          };
          consumedChunks.push(normalized);
          const attrs = `${pre} ${post}`
            .replace(/\scrossorigin(="[^"]*")?/g, "")
            .replace(/\s+/g, " ")
            .trim();
          return `<script ${attrs}>${chunk.code}</script>`;
        });
        asset.source = rewritten;
        for (const key of consumedChunks) {
          delete bundle[key];
        }
      }
    },
  };
}

function inlineStyles(): Plugin {
  return {
    name: "view-markdown-inline-styles",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".html")) continue;
        const html = typeof asset.source === "string" ? asset.source : asset.source.toString();
        const linkTag = /<link\b[^>]*\srel="stylesheet"[^>]*\shref="([^"]+)"[^>]*>/g;
        const consumed: string[] = [];
        const rewritten = html.replace(linkTag, (match, href: string) => {
          const normalized = href.startsWith("./") ? href.slice(2) : href;
          const chunk = bundle[normalized];
          if (!chunk || chunk.type !== "asset") return match;
          const source = typeof chunk.source === "string" ? chunk.source : chunk.source.toString();
          bundle["v1/editor.css"] = {
            type: "asset",
            fileName: "v1/editor.css",
            name: "editor.css",
            source,
          };
          consumed.push(normalized);
          return `<style>${source}</style>`;
        });
        asset.source = rewritten;
        for (const key of consumed) {
          delete bundle[key];
        }
      }
    },
  };
}

// View build config.
//
// `root` is `src/` so `src/index.html` is the entry. `publicDir` is absolute
// so `public/manifest.json` is copied verbatim into `dist/` during build and
// served at `/manifest.json` during dev.
//
// Dev server port is 5182. The bundled view iframe and the reusable v1 editor
// are served from the fixed unauthenticated `/views/markdown/` route. The
// hosted `index.html` keeps its own copy of the editor inline.
export default defineConfig({
  root: path.resolve(packageDir, "src"),
  base: "./",
  publicDir: path.resolve(packageDir, "public"),
  server: {
    port: 5182,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(packageDir, "dist"),
    emptyOutDir: true,
    cssCodeSplit: false,
    // Inline every binary asset (the Hind font woff2 from
    // `packages/canonical` is ~23 KB) as a `data:` URL so the bundle
    // remains a single self-contained `index.html`.
    assetsInlineLimit: ASSETS_INLINE_LIMIT_BYTES,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  plugins: [
    appearanceBootstrap(),
    developmentStyles(),
    developmentTestHook(),
    createTelevisionLicensePlugin({ surface: "view:markdown" }),
    inlineScripts(),
    inlineStyles(),
  ],
});

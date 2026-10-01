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
 * the built view has no external JS/CSS assets. The view bundle is a fixed
 * Television-shipped static asset under `/views/markdown/` with no auth and
 * no user-specific content. Inlining keeps that asset self-contained and
 * avoids extra HTTP fetches from the iframe.
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
      const htmlEntries = Object.entries(bundle).filter(
        ([, asset]) => asset.type === "asset" && asset.fileName.endsWith(".html"),
      );
      for (const [, asset] of htmlEntries) {
        if (asset.type !== "asset") continue;
        const html = typeof asset.source === "string" ? asset.source : asset.source.toString();
        let rewritten = html;
        const scriptTag =
          /<script\b([^>]*?)\ssrc="([^"]+)"([^>]*)><\/script>/g;
        const consumedChunks: string[] = [];
        rewritten = rewritten.replace(scriptTag, (match, pre: string, src: string, post: string) => {
          const normalized = src.startsWith("./") ? src.slice(2) : src;
          const chunkKey = Object.keys(bundle).find((key) => key === normalized);
          if (!chunkKey) return match;
          const chunk = bundle[chunkKey];
          if (!chunk || chunk.type !== "chunk") return match;
          consumedChunks.push(chunkKey);
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
      const htmlEntries = Object.entries(bundle).filter(
        ([, asset]) => asset.type === "asset" && asset.fileName.endsWith(".html"),
      );
      for (const [, asset] of htmlEntries) {
        if (asset.type !== "asset") continue;
        const html = typeof asset.source === "string" ? asset.source : asset.source.toString();
        let rewritten = html;
        const linkTag = /<link\b[^>]*\srel="stylesheet"[^>]*\shref="([^"]+)"[^>]*>/g;
        const consumed: string[] = [];
        rewritten = rewritten.replace(linkTag, (match, href: string) => {
          const normalized = href.startsWith("./") ? href.slice(2) : href;
          const chunk = bundle[normalized];
          if (!chunk || chunk.type !== "asset") return match;
          const source = typeof chunk.source === "string" ? chunk.source : chunk.source.toString();
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
// Dev server port is 5182. The bundled view iframe is served from the fixed
// unauthenticated `/views/markdown/` route. The inline plugins below keep the
// shipped editor as a single self-contained `index.html`.
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
    createTelevisionLicensePlugin({ surface: "view:markdown" }),
    inlineScripts(),
    inlineStyles(),
  ],
});

/* CSS module scripts for Vite (code-owned mechanics; the stylesheet-modules spec was retired with arch/ui.md "Stylesheet modules").
 *
 * `import sheet from "./x.css" with { type: "css" }` yields a constructed
 * `CSSStyleSheet` holding the file's rules, and every importer of the same
 * file receives the same instance. The transform compiles the platform's
 * CSS module script syntax so those semantics hold across the app build,
 * tests, and Storybook regardless of native browser support.
 *
 * Two stages:
 *
 * 1. A pre-transform rewrites attributed imports in JS/TS modules to a
 *    `?sheet` query import (`./x.css?sheet`), leaving plain and `?inline`
 *    CSS imports untouched.
 * 2. `?sheet` imports resolve to a virtual module (id shaped so Vite's own
 *    CSS pipeline ignores it) whose code constructs a `CSSStyleSheet`,
 *    `replaceSync`s the file's text into it, and default-exports it.
 *    Module caching gives all importers the one instance.
 *
 * HMR: the sheet module self-accepts, and persists its sheet on
 * `import.meta.hot.data` so re-execution `replaceSync`s the edited CSS
 * into the *same* instance every adopter already holds.
 *
 * Static import statements only: the dynamic form
 * `import("./x.css", { with: { type: "css" } })` is not rewritten and
 * would fall through to Vite's CSS pipeline. No caller uses it.
 */

import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

const SHEET_QUERY = "?sheet";

// Virtual module id for a sheet: `\0<abs css path>.sheet`. The `.sheet`
// suffix keeps the id from matching Vite's CSS request regex (which would
// route our emitted JS through the CSS pipeline); `\0` marks it virtual.
const VIRTUAL_PREFIX = "\0";
const VIRTUAL_SUFFIX = ".sheet";

const SCRIPT_FILE_RE = /\.[cm]?[jt]sx?$/;

// `import x from "./y.css" with { type: "css" }` — default-import or
// side-effect form, either quote style. Named/namespace forms don't exist
// for CSS module scripts (the platform only defines a default export).
// Textual rewrite: a literal occurrence inside a string or comment matches
// too — acceptable for a build transform over our own sources.
const ATTRIBUTED_CSS_IMPORT_RE =
  /(\bimport(?:\s+[A-Za-z_$][\w$]*\s+from)?\s*)(["'])([^"'\n]+\.css)\2\s*with\s*\{\s*type\s*:\s*(["'])css\4\s*,?\s*\}/g;

/** Rewrites attributed CSS imports to `?sheet` imports; null if none. */
export function rewriteCssModuleImports(code: string): string | null {
  if (!code.includes("with")) return null;
  const rewritten = code.replace(
    ATTRIBUTED_CSS_IMPORT_RE,
    (_match, head: string, quote: string, specifier: string) =>
      `${head}${quote}${specifier}${SHEET_QUERY}${quote}`,
  );
  return rewritten === code ? null : rewritten;
}

/** The JS module emitted for a stylesheet, with its CSS text baked in. */
export function sheetModuleSource(css: string): string {
  return [
    // `data` is optional-chained because some hosts (vitest's web-mode
    // module runner) provide a hot context without a `data` object.
    `const css = ${JSON.stringify(css)};`,
    `const sheet = import.meta.hot?.data?.sheet ?? new CSSStyleSheet();`,
    `sheet.replaceSync(css);`,
    `export default sheet;`,
    `if (import.meta.hot) {`,
    `  if (import.meta.hot.data) import.meta.hot.data.sheet = sheet;`,
    `  import.meta.hot.accept();`,
    `}`,
    ``,
  ].join("\n");
}

function virtualId(file: string): string {
  return `${VIRTUAL_PREFIX}${file}${VIRTUAL_SUFFIX}`;
}

export function cssModuleScripts(): Plugin {
  return {
    name: "css-module-scripts",
    enforce: "pre",

    transform(code, id) {
      const [file] = id.split("?");
      if (!file || !SCRIPT_FILE_RE.test(file)) return null;
      const rewritten = rewriteCssModuleImports(code);
      return rewritten === null ? null : { code: rewritten, map: null };
    },

    async resolveId(source, importer) {
      if (!source.endsWith(SHEET_QUERY)) return null;
      const resolved = await this.resolve(
        source.slice(0, -SHEET_QUERY.length),
        importer,
        { skipSelf: true },
      );
      if (!resolved || resolved.external) return null;
      return virtualId(resolved.id);
    },

    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX) || !id.endsWith(VIRTUAL_SUFFIX)) return null;
      const file = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_SUFFIX.length);
      this.addWatchFile(file);
      return { code: sheetModuleSource(readFileSync(file, "utf8")), map: null };
    },

    // A sheet module's CSS file isn't in its module graph node (the module
    // is virtual), so map edits back to it here; its self-accept then
    // re-executes with the fresh text.
    handleHotUpdate({ file, modules, server }) {
      const mod = server.moduleGraph.getModuleById(virtualId(file));
      return mod ? [...modules, mod] : undefined;
    },
  };
}

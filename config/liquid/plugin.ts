import { resolve } from "node:path";
import type { Plugin } from "vite";
import { isYml, REPO_ROOT, transformLiquid, transformYml } from "./transform.ts";

// The queries that ask for a file in some form other than its own.
const FORM_QUERY_RE = /[?&](raw|url|inline)(?:&|$)/;

/**
 * Imports of .liquid templates become compiled render functions:
 *
 *   import template from ".../template.liquid";
 *   template({ open: true })  // -> { markup, styles }
 *
 * All file resolution happens in the transform; see transform.ts.
 */
export function liquidTemplates(): Plugin {
  return {
    name: "liquid-templates",
    // The spec tree usually sits outside the consuming project's Vite root
    // (e.g. Storybook's root is storybook/), and files outside the root are
    // not reliably watched: an edit to a spec yml or template then serves a
    // stale transform until the server restarts. Watch specs/ explicitly.
    configureServer(server) {
      server.watcher.add(resolve(REPO_ROOT, "specs"));
    },
    transform(code, id) {
      const [file] = id.split("?");
      if (!file) return null;
      // A request asking for another form of the file is vite's to answer, not
      // this plugin's: `?raw` means the bytes uninterpreted, which is what
      // {% import './x.yml' as x, raw %} asks for. Interpreting anyway would
      // override an explicit instruction. Vite's own cache-busting queries
      // (?t=, ?v=) ask for nothing of the sort and are left alone.
      if (FORM_QUERY_RE.test(id)) return null;
      if (isYml(file)) return { code: transformYml(code), map: null };
      if (file.endsWith(".liquid")) return { code: transformLiquid(code, file), map: null };
      return null;
    },
  };
}

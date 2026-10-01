import type { Context, Liquid, TagToken } from "liquidjs";
import { currentFrame } from "./frames.ts";

// {% import 'ref' as name %} or {% import 'ref' as name, raw %}
const ARGS_RE = /^(['"])(.+?)\1\s+as\s+([A-Za-z_]\w*)\s*(?:,\s*(\w+)\s*)?$/;

const KINDS = new Set(["raw"]);

/**
 * {% import './content.yml' as content %} — binds a referenced file into the
 * template's scope. What binds is whatever that file resolves to: parsed data
 * for YAML, a URL for an image, and so on. The reference is written in full,
 * extension included, because the extension is what tells a reader which of
 * those they are getting.
 *
 * A YAML string value is itself Liquid, rendered against the template's
 * scope (spec-ui.md, Templating) — so a content line can interpolate an
 * argument ("Reattempting in {{ seconds }}s…"). Values carrying no Liquid
 * pass through untouched; `raw` imports are exempt.
 *
 * {% import './glyph.svg' as glyph, raw %} binds the file's *text* instead —
 * what inline markup needs, since a URL placed in an <img> cannot take
 * `currentColor` and so cannot follow the text it sits beside.
 *
 * The reference is a dependency handed to compile() exactly as written; the
 * transform resolves it and the runtime resolves nothing.
 */
export function registerImport(engine: Liquid): void {
  engine.registerTag("import", {
    parse(token: TagToken) {
      const match = ARGS_RE.exec(token.args.trim());
      if (!match) {
        throw new Error(`import expects 'file' as name[, kind], got: {% import ${token.args} %}`);
      }
      const [, , file, name, kind] = match;
      if (kind !== undefined && !KINDS.has(kind)) {
        throw new Error(`import: unknown kind '${kind}' — expected one of: ${[...KINDS].join(", ")}`);
      }
      this.file = file;
      this.name = name;
      this.kind = kind;
    },
    render(ctx: Context) {
      const { deps } = currentFrame();
      const bucket = this.kind === "raw" ? deps.raw : deps.imports;
      const value = bucket?.[this.file];
      if (value === undefined) {
        throw new Error(
          `import: '${this.file}' is not among the dependencies of ${deps.name ?? "this template"}`,
        );
      }
      ctx.bottom()[this.name] = this.kind === "raw" ? value : interpolate(engine, value, ctx.getAll());
    },
  });
}

function interpolate(engine: Liquid, value: unknown, scope: object): unknown {
  if (typeof value === "string") {
    return value.includes("{{") || value.includes("{%") ? engine.parseAndRenderSync(value, scope) : value;
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(engine, v, scope));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(engine, v, scope)]));
  }
  return value;
}

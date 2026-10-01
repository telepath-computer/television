import type { Context, Liquid, TagToken } from "liquidjs";
import { currentFrame } from "./frames.ts";

// {% import_map 'ref' as name %} or {% import_map 'ref' as name, raw %}
const ARGS_RE = /^(['"])(.+?)\1\s+as\s+([A-Za-z_]\w*)\s*(?:,\s*(\w+)\s*)?$/;

const KINDS = new Set(["raw"]);

/**
 * {% import_map './icons.yml' as icons, raw %} — binds a whole set of files
 * under one name, from a manifest that maps each name to a reference:
 *
 *   check: "@phosphor-icons/core/assets/regular/check.svg"
 *
 * The template then places one by name — `{{ icons.check }}` — which is what a
 * surface drawing on a shared set needs, since restating an import per glyph
 * puts the set's membership in every template that touches it instead of in
 * the one file that owns it.
 *
 * The kind applies to every entry: `, raw` binds each file's text, exactly as
 * it does on `{% import %}`. The manifest's own references resolve against the
 * manifest's directory, not the importing template's — they are written in
 * that file, so they mean there, and the set reads the same from wherever it
 * is imported.
 */
export function registerImportMap(engine: Liquid): void {
  engine.registerTag("import_map", {
    parse(token: TagToken) {
      const match = ARGS_RE.exec(token.args.trim());
      if (!match) {
        throw new Error(
          `import_map expects 'manifest' as name[, kind], got: {% import_map ${token.args} %}`,
        );
      }
      const [, , file, name, kind] = match;
      if (kind !== undefined && !KINDS.has(kind)) {
        throw new Error(
          `import_map: unknown kind '${kind}' — expected one of: ${[...KINDS].join(", ")}`,
        );
      }
      this.file = file;
      this.name = name;
    },
    render(ctx: Context) {
      const { deps } = currentFrame();
      const value = deps.maps?.[this.file];
      if (value === undefined) {
        throw new Error(
          `import_map: '${this.file}' is not among the dependencies of ${deps.name ?? "this template"}`,
        );
      }
      ctx.bottom()[this.name] = value;
    },
  });
}

import { Liquid } from "liquidjs";
import { clearParams, paramsFor, registerDoc } from "./doc.ts";
import { popFrame, pushFrame } from "./frames.ts";
import type { CompiledTemplate, LiquidRendering, TemplateDeps } from "./frames.ts";
import { registerAttachStyles } from "./attach-styles.ts";
import { registerImport } from "./import.ts";
import { registerImportMap } from "./import-map.ts";
import { registerRenderTag } from "./render.ts";

export type { CompiledTemplate, LiquidRendering, TemplateDeps } from "./frames.ts";

// One shared engine. It owns no filesystem and resolves nothing: every file
// a template references arrives pre-resolved in compile()'s deps, so './x'
// in a template means exactly what the transform (or a caller) handed in.
const engine = new Liquid({ cache: false });
registerDoc(engine);
registerImport(engine);
  registerImportMap(engine);
registerAttachStyles(engine);
registerRenderTag(engine);

let anonymous = 0;

export function compile(source: string, deps: TemplateDeps = {}): CompiledTemplate {
  const name = deps.name ?? `anonymous-${++anonymous}.liquid`;
  clearParams(name);
  const template = engine.parse(source, name);
  const declared = paramsFor(name);
  const names = new Set(declared.map((decl) => decl.name));
  const fn = (data: Record<string, unknown> = {}): LiquidRendering => {
    for (const decl of declared) {
      if (!decl.optional && data[decl.name] === undefined) {
        throw new Error(`no argument for required parameter '${decl.name}' rendering ${name}`);
      }
    }
    for (const passed of Object.keys(data)) {
      if (!names.has(passed)) throw new Error(`argument '${passed}' matches no declared parameter of ${name}`);
    }
    // Every declared parameter starts nil, so an omitted optional one is
    // absent rather than inheriting Liquid's meaning for its name. `size` is
    // the case that forced this: bare `size` is Liquid's collection length, so
    // an unpassed `size` resolved to 0 — and 0 is truthy in Liquid, making
    // `{% if size %}` render `size="0"` where the template omits the attribute.
    const scope: Record<string, unknown> = {};
    for (const decl of declared) scope[decl.name] = null;
    Object.assign(scope, data);

    pushFrame(deps);
    let markup: string;
    let styles: string[];
    try {
      markup = engine.renderSync(template, scope) as string;
    } finally {
      styles = popFrame();
    }
    // `doc`, `import`, `import_map`, and `attach_styles` are declarations that
    // render nothing but leave their lines' newlines behind, so a template's
    // markup would open with one blank line per declaration. That whitespace is
    // authoring layout, not markup, and composing a partial would otherwise
    // inject it between the caller's own nodes.
    return { markup: markup.trim(), styles };
  };
  return Object.assign(fn, { params: declared });
}

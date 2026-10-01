import { Hash } from "liquidjs";
import type { Context, Emitter, Liquid, TagToken } from "liquidjs";
import { currentFrame } from "./frames.ts";

const REF_RE = /^(['"])([^'"]+)\1\s*,?\s*([\s\S]*)$/;

/**
 * {% render 'popover/panel', open: open %} — composes another template.
 * Overrides LiquidJS's built-in render tag: instead of a filesystem lookup,
 * the reference names a compiled template handed to compile() as a
 * dependency. Arguments are passed explicitly and evaluated in the current
 * scope; the composed template sees only what it is handed (standard render
 * isolation). Its markup splices in place; its styles join this render's
 * collection.
 */
export function registerRenderTag(engine: Liquid): void {
  engine.registerTag("render", {
    parse(token: TagToken) {
      const match = REF_RE.exec(token.args.trim());
      if (!match) {
        throw new Error(`render expects a quoted template reference, got: {% render ${token.args} %}`);
      }
      const [, , file, argsText] = match;
      this.file = file;
      const args = argsText ?? "";
      // Hash stops silently at the first token it can't read; refuse the
      // forms it would drop rather than render a wrong state quietly.
      if (/[|]|\bwith\b|\bfor\b/.test(args)) {
        throw new Error(`render arguments support simple "name: value" pairs only, got: {% render ${token.args} %}`);
      }
      this.hash = new Hash(args);
    },
    *render(ctx: Context, emitter: Emitter) {
      const frame = currentFrame();
      const partial = frame.deps.partials?.[this.file];
      if (!partial) {
        throw new Error(
          `render: '${this.file}' is not among the dependencies of ${frame.deps.name ?? "this template"}`,
        );
      }
      const args = (yield this.hash.render(ctx)) as Record<string, unknown>;
      const rendering = partial(args);
      frame.styles.push(...rendering.styles);
      emitter.write(rendering.markup);
    },
  });
}

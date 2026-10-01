import type { Liquid, TagToken } from "liquidjs";
import { currentFrame } from "./frames.ts";

/**
 * {% attach_styles './styles.css' %} — adds a stylesheet to the rendering's
 * style collection. It binds nothing and renders nothing: styling travels
 * alongside the markup in `{ markup, styles }`, not inside it. That is why it
 * is not an `import` — nothing lands in the template's scope.
 */
export function registerAttachStyles(engine: Liquid): void {
  engine.registerTag("attach_styles", {
    parse(token: TagToken) {
      const match = /^(['"])(.+?)\1$/.exec(token.args.trim());
      if (!match) {
        throw new Error(
          `attach_styles expects a quoted file reference, got: {% attach_styles ${token.args} %}`,
        );
      }
      this.file = match[2];
    },
    render() {
      const frame = currentFrame();
      const text = frame.deps.styles?.[this.file];
      if (text === undefined) {
        throw new Error(
          `attach_styles: '${this.file}' is not among the dependencies of ${frame.deps.name ?? "this template"}`,
        );
      }
      frame.styles.push(text);
    },
  });
}

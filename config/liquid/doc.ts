import { TokenKind } from "liquidjs";
import type { Liquid, TagToken, TopLevelToken } from "liquidjs";

export interface ParamDecl {
  name: string;
  type: string;
  optional: boolean;
  description: string;
}

// Declarations collected at parse time, keyed by template name.
const declarations = new Map<string, ParamDecl[]>();

export function clearParams(key: string): void {
  declarations.delete(key);
}

export function paramsFor(key: string): ParamDecl[] {
  return declarations.get(key) ?? [];
}

// JSDoc grammar: @param {type} name - description, brackets marking optional.
const PARAM_RE = /^\s*@param\s+\{([^}]+)\}\s+(?:\[(\w+)\]|(\w+))\s+-\s+(.+?)\s*$/;

/**
 * {% doc %} — Shopify Liquid's documentation tag (the LiquidDoc convention,
 * https://shopify.dev/docs/storefronts/themes/tools/liquid-doc), which
 * LiquidJS doesn't ship, registered here. The body is free documentation; lines with JSDoc
 * @param annotations declare the template's parameters. Renders nothing.
 * The compiled template validates arguments against the declared parameters
 * and exposes them as `template.params`.
 *
 * {% doc %}
 *   @param {boolean} open - whether the notice popover is open
 *   @param {string} [label] - optional button label
 * {% enddoc %}
 */
export function registerDoc(engine: Liquid): void {
  engine.registerTag("doc", {
    parse(token: TagToken, remainTokens: TopLevelToken[]) {
      if (token.file === undefined) return; // e.g. a doc block inside a YAML micro-template
      const key = token.file;
      const list = declarations.get(key) ?? [];
      let closed = false;
      while (remainTokens.length > 0) {
        const next = remainTokens.shift()!;
        if (next.kind === TokenKind.Tag && (next as TagToken).name === "enddoc") {
          closed = true;
          break;
        }
        for (const line of next.getText().split("\n")) {
          const match = PARAM_RE.exec(line);
          if (match) {
            const [, type, optionalName, requiredName, description] = match;
            list.push({
              type: type!,
              optional: optionalName !== undefined,
              name: (optionalName ?? requiredName)!,
              description: description!,
            });
          } else if (/^\s*@param\b/.test(line)) {
            throw new Error(`malformed @param (expected "@param {type} name - description"): ${line.trim()}`);
          }
        }
      }
      if (!closed) throw new Error("tag {% doc %} not closed");
      declarations.set(key, list);
    },
    render() {
      // documentation only
    },
  });
}

// Parses the foundation's token files into their own comment-delimited
// groups, so the foundation frames draw the set without restating it: a
// short capitalized comment opens a section ("Neutral", "Color roles — …"),
// each --token line joins the open one, prose lines match neither shape.
import colors from "../../specs/ui/foundation/tokens/colors.css?raw";
import text from "../../specs/ui/foundation/tokens/text.css?raw";
import spacing from "../../specs/ui/foundation/tokens/spacing.css?raw";

const css = [spacing, colors, text].join("\n");

export interface Token {
  name: string;
  value: string;
}

export const groups: Record<string, Token[]> = {};

let open: string | undefined;
for (const line of css.split("\n")) {
  const section = line.match(/^\s*\/\* ([A-Z][\w ]*?)(?: —.*| \*\/)/);
  if (section) {
    open = section[1];
    continue;
  }
  const token = line.match(/^\s*--([\w-]+):\s*([^;]+);/);
  if (token && open) (groups[open] ??= []).push({ name: token[1]!, value: token[2]!.trim() });
}

export const named = (inner: string, name: string): string =>
  `<div class="staging-named">${inner}<small>${name}</small></div>`;

export const swatchRow = (tokens: Token[]): string =>
  `<div class="staging-group">${tokens
    .map((t) => named(`<div class="staging-swatch" style="background: var(--${t.name})"></div>`, t.name))
    .join("")}</div>`;

import postcss from "postcss";

const PLACEHOLDER_SELECTOR = /^tv-icon:not\(:defined\)(?:\[size="[^"]+"\])?$/;

export function extractIconPlaceholders(css) {
  const placeholders = postcss
    .parse(css)
    .nodes.flatMap((node) => {
      if (node.type !== "rule") return [];
      const selectors = node.selectors.filter((selector) =>
        PLACEHOLDER_SELECTOR.test(selector.trim()));
      if (selectors.length === 0) return [];
      const rule = node.clone();
      rule.selectors = selectors;
      return [rule.toString()];
    });
  return placeholders.length === 0 ? "" : `${placeholders.join("\n\n")}\n`;
}

// Canonical markup serialization for spec-conformance comparison
// (specs/spec-ui.md, Verification): parses both sides to DOM and
// re-serializes with comments dropped, whitespace-only text removed,
// text collapsed, and attributes sorted — so template authoring style
// (indentation, attribute order) never masks or fakes a difference.
export interface NormalizeOptions {
  /**
   * Behavior-written attributes per tag: attributes a composed component
   * stamps on itself at runtime (for example, an environment-sampled `tone`).
   * They arrive when code runs and are not template content, so conformance
   * comparison drops them.
   */
  dropAttrs?: Record<string, string[]>;
}

export function normalizeMarkup(html: string, options: NormalizeOptions = {}): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  return [...container.childNodes].map((n) => serialize(n, options)).filter(Boolean).join("");
}

function serialize(node: Node, options: NormalizeOptions): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    return text;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ""; // comments (incl. lit markers)
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const dropped = options.dropAttrs?.[tag] ?? [];
  const attrs = [...el.attributes]
    .filter((a) => !dropped.includes(a.name))
    .map((a) => ({ name: a.name, value: a.value }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ` ${a.name}="${a.value}"`)
    .join("");
  const children = [...el.childNodes].map((n) => serialize(n, options)).filter(Boolean).join("");
  return `<${tag}${attrs}>${children}</${tag}>`;
}

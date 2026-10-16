// Shared DOM helpers keep grid markup small and use Television glyphs.

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  label?: string,
): HTMLElementTagNameMap[K];
export function element(tag: string, className?: string, label?: string): HTMLElement;
export function element(tag: string, className?: string, label?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (label != null) node.textContent = label;
  return node;
}

export function icon(name: string): HTMLElement {
  const node = document.createElement("tv-icon");
  node.setAttribute("name", name);
  return node;
}

export function button(label: string, iconName?: string, className?: string): HTMLButtonElement {
  const node = element("button", className);
  node.type = "button";
  node.setAttribute("variant", "ghost");
  node.setAttribute("aria-label", label);
  node.title = label;
  if (iconName) node.append(icon(iconName));
  const iconOnly = Boolean(className &&
    /tg-header-menu|tg-row-menu-trigger|tg-insert-column|tg-icon-tool|tg-pill-remove/.test(className)) ||
    label === "Add column";
  if (!iconOnly) node.append(document.createTextNode(label));
  return node;
}

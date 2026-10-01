// Menu prototyping: shared staging behavior for any prototype that opens
// tv-menu markup — never a conformance target; the production elements own
// opening, dismissal, and placement for real.

const anchors = new WeakMap<HTMLElement, HTMLElement>();
const authoredHeightLimits = new WeakMap<HTMLElement, { value: string; priority: string }>();

/** Staging-only placement: pose the shared default and window-edge flips.
 * This is a preview of the authored behavior, not the production engine. */
export const placePanel = (
  panel: HTMLElement,
  trigger?: HTMLElement,
): void => {
  if (trigger) anchors.set(panel, trigger);
  const anchorElement = anchors.get(panel)
    ?? document.getElementById(panel.getAttribute("trigger") ?? "")
    ?? panel.previousElementSibling;
  if (!anchorElement) return;
  const gap = parseFloat(getComputedStyle(panel).getPropertyValue("--popover-distance"));
  if (!Number.isFinite(gap)) throw new Error("Panel staging requires the authored --popover-distance");
  const bounds = anchorElement.closest("#app")?.getBoundingClientRect()
    ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  const anchor = anchorElement.getBoundingClientRect();
  panel.style.removeProperty("translate");
  panel.style.position = "fixed";
  panel.style.margin = "0";
  panel.style.left = "0";
  panel.style.top = "0";
  panel.style.removeProperty("min-width");
  panel.style.maxWidth = `${Math.max(0, bounds.right - bounds.left - 2 * gap)}px`;
  // Measure under the authored cap, not the viewport limit from the last placement.
  if (!authoredHeightLimits.has(panel)) {
    authoredHeightLimits.set(panel, {
      value: panel.style.getPropertyValue("max-height"),
      priority: panel.style.getPropertyPriority("max-height"),
    });
  }
  const authoredHeight = authoredHeightLimits.get(panel)!;
  if (authoredHeight.value) panel.style.setProperty("max-height", authoredHeight.value, authoredHeight.priority);
  else panel.style.removeProperty("max-height");
  const naturalWidth = panel.getBoundingClientRect().width;
  const minimumWidth = parseFloat(getComputedStyle(panel).minWidth) || 0;
  const leadingRoom = Math.max(0, bounds.right - gap - anchor.left);
  const trailingRoom = Math.max(0, anchor.right - bounds.left - gap);
  const trailing = naturalWidth > leadingRoom && trailingRoom > leadingRoom;
  const width = Math.min(naturalWidth, trailing ? trailingRoom : leadingRoom);
  panel.style.minWidth = `${Math.min(minimumWidth, width)}px`;
  panel.style.maxWidth = `${width}px`;
  // Width can wrap the contents, so judge vertical room after narrowing.
  const rect = panel.getBoundingClientRect();
  const below = Math.max(0, bounds.bottom - anchor.bottom - 2 * gap);
  const above = Math.max(0, anchor.top - bounds.top - 2 * gap);
  const opensAbove = rect.height > below && above > below;
  const height = Math.min(rect.height, opensAbove ? above : below);
  panel.style.maxHeight = `${height}px`;
  panel.style.overflowY = "auto";
  const left = trailing ? anchor.right - rect.width : anchor.left;
  const top = opensAbove ? anchor.top - gap - height : anchor.bottom + gap;
  panel.style.left = `${Math.max(bounds.left + gap, Math.min(left, bounds.right - gap - rect.width))}px`;
  panel.style.top = `${Math.max(bounds.top + gap, Math.min(top, bounds.bottom - gap - height))}px`;
};

/** Remove every menu in the scope (prototypes render menus on demand). */
export const closeMenus = (scope: ParentNode = document) =>
  scope.querySelectorAll<HTMLElement>("tv-menu").forEach((menu) => {
    anchors.get(menu)?.setAttribute("aria-expanded", "false");
    menu.remove();
  });

/**
 * Insert rendered menu markup after its trigger and place it at the resting
 * position the popover spec states, flipping at the window edges.
 */
export const openMenu = (
  trigger: HTMLElement,
  markup: string,
): HTMLElement => {
  const holder = document.createElement("div");
  holder.setHTMLUnsafe(markup);
  const menu = holder.querySelector<HTMLElement>("tv-menu")!;
  trigger.after(menu);
  trigger.setAttribute("aria-expanded", "true");
  placePanel(menu, trigger);
  return menu;
};

/** Light dismiss: a click outside any menu, or Escape, closes the scope's
 *  menus. Returns a disposer. */
export const wireMenuDismiss = (scope: HTMLElement): (() => void) => {
  const onClick = (e: Event) => {
    if (!(e.target as HTMLElement).closest("tv-menu, .channel-menu-trigger, [class$='-menu-trigger']")) closeMenus(scope);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeMenus(scope);
  };
  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKey);
  return () => {
    document.removeEventListener("click", onClick);
    document.removeEventListener("keydown", onKey);
  };
};

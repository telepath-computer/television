// App-document workshop basics ([[frameset.json]] imports this into app
// frames and boards, embeds included, beside the foundation stylesheet):
// appearance and theme on the document root, the button focus convention,
// selection off, and the display rules below — injected here so the
// app-only staging rules stay separate from the shared environment.

// Icon styling document-scope for the workshop: unregistered tv-icon
// markup in frames reserves its box via the placeholder rules; the :host
// rules are inert outside a shadow root. Production delivery is canonical's
// seam, not this import.
import "../../specs/ui/foundation/icons/styles.css";

import { wireSelects } from "./select";
import { placePanel } from "./menu";
import { tabLabelsPrototype, tabStripPrototype } from "./tab-strip";
import { documentEnvironment } from "./environment";

// Vite can evaluate this module twice in one document — the frameset global
// import uses the bare URL while a board's own import chain can carry an
// HMR-timestamped one. The document basics must apply once: the first
// evaluation wins, and later ones delegate to it through the window.
const FIRST_EVALUATION = !("__stagingFoundation" in window);

const STAGING_STYLES = `
/* App-document staging styles, imported into app frames beside
   environment.ts. Not a conformance target. */

/* A posed-open panel floats at its static position — below the markup that
   precedes it, clear of any ancestor clip — standing in for the placement
   the production element computes ([[specs/ui/foundation/popover/index.md]],
   Placement). */
:where(tv-popover[open], tv-menu[open]) {
  position: fixed;
  z-index: var(--layer-panel);
  margin-top: var(--popover-distance);
}

/* The select's panel floats the same way; its seat over the trigger is the
   select wiring's ([[specs/ui/foundation/select/index.md]], Placement). */
:where(tv-select[open]) {
  position: fixed;
  z-index: var(--layer-panel);
}

/* Selection, off across the app ([[ui/app/index.md]], Selection) — the app
   document supplies this, so the stage supplies it too. Surfaces that offer
   text opt back in, as in production. */
body {
  user-select: none;
}
`;

if (FIRST_EVALUATION) {
  const style = document.createElement("style");
  style.setAttribute("data-staging-foundation", "");
  style.textContent = STAGING_STYLES;
  document.head.append(style);
}

documentEnvironment("app");

// ---- posed-panel placement ------------------------------------------------
// Both posed popovers and interactive menus use the same staging placement:
// below the trigger, leading edges aligned, with independent window-edge
// flips. The production element owns its eventual placement implementation.
const placePanels = () => {
  for (const panel of document.querySelectorAll<HTMLElement>("tv-popover[open], tv-menu[open]")) {
    placePanel(panel);
  }
};
// The element maintains `aria-expanded` on the trigger while its panel is
// open; the button sheet keys the pressed look on it
// ([[specs/ui/foundation/popover/index.md]], Trigger). Synced here for posed
// and stand-in toggled panels alike.
const syncTriggers = () => {
  for (const panel of document.querySelectorAll("tv-popover[trigger]")) {
    const trigger = document.getElementById(panel.getAttribute("trigger") ?? "");
    trigger?.setAttribute("aria-expanded", panel.hasAttribute("open") ? "true" : "false");
  }
};

// The filmstrip is a programmatically moved viewport; production's crossing
// centres the selected page. This rests each filmstrip with its selected
// page centred — the resting position, standing in for the movement.
const restFilmstrips = () => {
  for (const strip of document.querySelectorAll<HTMLElement>(".filmstrip")) {
    const page = strip.querySelector<HTMLElement>(".page[selected]");
    if (!page) continue;
    const stripBox = strip.getBoundingClientRect();
    const pageBox = page.getBoundingClientRect();
    strip.scrollLeft += pageBox.left + pageBox.width / 2 - (stripBox.left + stripBox.width / 2);
  }
};

// The select elements' behavior stand-in, rewired whenever a render
// replaces the staged markup — like the popover stand-ins above, element
// behavior the production custom elements will own.
let disposeSelects: (() => void) | null = null;
let disposeTabStrips: Array<() => void> = [];
let disposeTabLabels: (() => void) | null = null;

const settlePanels = () => {
  syncTriggers();
  placePanels();
  restFilmstrips();
  disposeSelects?.();
  disposeSelects = wireSelects(document);
  disposeTabStrips.forEach((dispose) => dispose());
  disposeTabStrips = [...document.querySelectorAll<HTMLElement>(".tab-strip")]
    .map(tabStripPrototype);
  disposeTabLabels?.();
  disposeTabLabels = tabLabelsPrototype(document);
};

if (FIRST_EVALUATION) {
  settlePanels();
  window.addEventListener("frameset:rendered", settlePanels);
  window.addEventListener("resize", placePanels);
  window.addEventListener("resize", restFilmstrips);
  (window as unknown as { __stagingFoundation: () => void }).__stagingFoundation = settlePanels;
}

/**
 * Settle the document after markup it staged was replaced outside a
 * frameset render — a prototype's own state-driven re-render. The same
 * pass frameset:rendered runs: trigger sync, panel placement, filmstrips,
 * select wiring. Routed through the first evaluation's instance, so a
 * second module instance never double-wires.
 */
export const settleDocument = (): void => {
  (window as unknown as { __stagingFoundation?: () => void }).__stagingFoundation?.();
};

// ---- popover trigger behavior --------------------------------------------
// Production's popover element self-wires its `trigger` reference; this is
// the workshop stand-in for that element behavior, document-wide. A click on
// a trigger toggles its panel and closes the others; Escape closes every
// panel; a press outside dismisses panels not declared `manual`
// ([[specs/ui/foundation/popover/index.md]], Dismissal).
if (FIRST_EVALUATION) document.addEventListener("click", (e) => {
  const target = e.target as Element;
  const labelled = target.closest?.("[id]");
  const panel = labelled?.id
    ? document.querySelector<HTMLElement>(`tv-popover[trigger="${CSS.escape(labelled.id)}"]`)
    : null;
  if (panel) {
    const wasOpen = panel.hasAttribute("open");
    // Manual panels stand outside the one-open rule.
    for (const other of document.querySelectorAll("tv-popover[open]:not([manual])")) {
      if (other !== panel) other.removeAttribute("open");
    }
    if (wasOpen) panel.removeAttribute("open");
    else panel.setAttribute("open", "");
    settlePanels();
    return;
  }
  let dismissed = false;
  for (const open of document.querySelectorAll("tv-popover[open]:not([manual])")) {
    if (!open.contains(target)) {
      open.removeAttribute("open");
      dismissed = true;
    }
  }
  if (dismissed) syncTriggers();
});
if (FIRST_EVALUATION) document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const open = document.querySelectorAll("tv-popover[open]:not([manual])");
  if (open.length === 0) return;
  for (const panel of open) panel.removeAttribute("open");
  syncTriggers();
});

// ---- the button focus convention ------------------------------------------
// A pointer press activates a button without taking focus — the Mac
// convention ([[specs/ui/foundation/button/index.md]], Focus).
document.addEventListener("pointerdown", (e) => {
  const button = (e.target as Element).closest?.("button");
  if (button && !button.disabled) e.preventDefault();
});

// Select prototyping: staging behavior for the select specimen, so the
// highlight, commit, and dismissal choreography can be felt before the
// elements exist — never a conformance target; the production elements own
// opening, placement, selection, and the keyboard for real
// ([[ui/foundation/select/index.md]]).

// Staging's own: the pause that resets the type-ahead string. The spec states
// the reset, not its length; the element owns the real value.
const TYPEAHEAD_RESET_MS = 600;

/**
 * Wire one staged trigger/panel pair: trigger press and keys open, arrows and
 * pointer move the `highlighted` attribute, Enter/Space/Tab and a press
 * commit `selected` and rewrite the trigger label, Escape and outside
 * presses dismiss. Returns a disposer that removes every listener.
 */
const wireSelect = (trigger: HTMLButtonElement, select: HTMLElement): (() => void) => {

  const options = () => Array.from(select.querySelectorAll<HTMLElement>("tv-option"));
  const labelOf = (option: HTMLElement) => option.textContent?.trim() ?? "";
  const isOpen = () => select.hasAttribute("open");

  const highlight = (option: HTMLElement) => {
    for (const other of options()) if (other !== option) other.removeAttribute("highlighted");
    option.setAttribute("highlighted", "");
  };

  const setTriggerLabel = (label: string) => {
    // The staged trigger holds a text node then the caret icon; a different
    // shape means the pose drifted from the spec's trigger content.
    const node = trigger.firstChild;
    if (!(node instanceof Text)) throw new Error("select prototype: trigger label text node not found");
    node.nodeValue = `${label} `;
  };

  // Staging stand-in for the shared placement machinery
  // ([[ui/foundation/select/index.md]], Placement): seat the panel over the
  // trigger with the selected row where the trigger is; fall back to top- or
  // bottom-edge alignment when that seat would cross a window edge. Edge
  // clearance beyond that and re-placement stay production's.
  const placePanel = () => {
    const rect = trigger.getBoundingClientRect();
    const gapRead = parseFloat(getComputedStyle(select).getPropertyValue("--popover-distance"));
    const gap = Number.isFinite(gapRead) ? gapRead : 0;
    // A transformed ancestor (a placed popover) contains fixed descendants,
    // so viewport coordinates cannot be written directly: park the panel at
    // its containing block's origin, measure where that lands, and offset.
    select.style.minWidth = `${rect.width}px`;
    select.style.left = "0px";
    select.style.top = "0px";
    const origin = select.getBoundingClientRect();
    const height = select.offsetHeight;
    const selected = options().find((option) => option.hasAttribute("selected"));
    const selectedOffset = selected
      ? selected.getBoundingClientRect().top + selected.getBoundingClientRect().height / 2 - origin.top
      : height / 2;
    const centred = rect.top + rect.height / 2 - selectedOffset;
    const fits = (top: number) => top >= gap && top + height <= window.innerHeight - gap;
    const top = fits(centred) ? centred : fits(rect.top) ? rect.top : rect.bottom - height;
    select.style.left = `${rect.left - origin.left}px`;
    select.style.top = `${top - origin.top}px`;
  };

  const openPanel = () => {
    select.setAttribute("open", "");
    trigger.setAttribute("aria-expanded", "true");
    placePanel();
    const start = options().find((option) => option.hasAttribute("selected")) ?? options()[0];
    if (start) highlight(start);
  };

  const closePanel = () => {
    select.removeAttribute("open");
    trigger.setAttribute("aria-expanded", "false");
    for (const option of options()) option.removeAttribute("highlighted");
  };

  const commit = (option: HTMLElement) => {
    for (const other of options()) if (other !== option) other.removeAttribute("selected");
    option.setAttribute("selected", "");
    setTriggerLabel(labelOf(option));
    closePanel();
  };

  const move = (delta: number) => {
    const list = options();
    const current = list.findIndex((option) => option.hasAttribute("highlighted"));
    const next = Math.min(Math.max(current + delta, 0), list.length - 1);
    if (list[next]) highlight(list[next]);
  };

  let typed = "";
  let typedTimer: number | undefined;
  const typeAhead = (key: string) => {
    typed += key.toLowerCase();
    window.clearTimeout(typedTimer);
    typedTimer = window.setTimeout(() => {
      typed = "";
    }, TYPEAHEAD_RESET_MS);
    const match = options().find((option) => labelOf(option).toLowerCase().startsWith(typed));
    if (match) highlight(match);
  };

  // Staging simulation of the widest-option width rule
  // ([[ui/foundation/select/index.md]], Markup): pose each label in the
  // trigger, keep the widest as min-width. Production reserves this for real.
  const reserveTriggerWidth = () => {
    const node = trigger.firstChild;
    if (!(node instanceof Text)) throw new Error("select prototype: trigger label text node not found");
    const original = node.nodeValue;
    let widest = 0;
    for (const option of options()) {
      node.nodeValue = `${labelOf(option)} `;
      widest = Math.max(widest, trigger.offsetWidth);
    }
    node.nodeValue = original;
    trigger.style.minWidth = `${widest}px`;
  };

  const onTriggerClick = () => {
    // Staging shim for the viewer's iframe boundary: the button focus
    // convention prevents the press from focusing this frame's document, so
    // keys would stay with the viewer. Production is one document and needs
    // none of this.
    window.focus();
    if (isOpen()) closePanel();
    else openPanel();
  };

  // Document-level, like the element's own delivery ([[arch/ui/elements.md]],
  // tv-select): a pointer press opens without focusing the trigger, so keys
  // cannot ride on trigger focus. While open, the select owns its keys.
  const onKeydown = (e: KeyboardEvent) => {
    if (!isOpen()) {
      if (document.activeElement !== trigger) return;
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        // preventDefault also suppresses the native button activation, so the
        // click handler cannot re-toggle what this open just did.
        e.preventDefault();
        openPanel();
      }
      return;
    }
    const consume = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "ArrowDown") {
      consume();
      move(1);
    } else if (e.key === "ArrowUp") {
      consume();
      move(-1);
    } else if (e.key === "Home") {
      consume();
      move(-options().length);
    } else if (e.key === "End") {
      consume();
      move(options().length);
    } else if (e.key === "Enter" || e.key === " ") {
      consume();
      const current = options().find((option) => option.hasAttribute("highlighted"));
      if (current) commit(current);
    } else if (e.key === "Tab") {
      // Commits only from the focused trigger, and the focus move proceeds.
      if (document.activeElement !== trigger) return;
      const current = options().find((option) => option.hasAttribute("highlighted"));
      if (current) commit(current);
    } else if (e.key === "Escape") {
      consume();
      closePanel();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      consume();
      typeAhead(e.key);
    }
  };

  // pointermove, not pointerover: the panel opens covering the trigger, so a
  // resting pointer suddenly sits on an option — only movement is pointing
  // ([[ui/foundation/select/index.md]], Keyboard).
  const onPanelPointermove = (e: Event) => {
    const option = (e.target as HTMLElement).closest<HTMLElement>("tv-option");
    if (option) highlight(option);
  };

  const onPanelClick = (e: Event) => {
    const option = (e.target as HTMLElement).closest<HTMLElement>("tv-option");
    if (option) commit(option);
  };

  const onDocumentClick = (e: Event) => {
    const target = e.target as HTMLElement;
    if (isOpen() && !target.closest("tv-select") && !trigger.contains(target)) closePanel();
  };

  reserveTriggerWidth();
  if (isOpen()) placePanel();
  trigger.addEventListener("click", onTriggerClick);
  select.addEventListener("pointermove", onPanelPointermove);
  select.addEventListener("click", onPanelClick);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("click", onDocumentClick);
  return () => {
    trigger.style.minWidth = "";
    select.style.left = "";
    select.style.top = "";
    select.style.minWidth = "";
    trigger.removeEventListener("click", onTriggerClick);
    select.removeEventListener("pointermove", onPanelPointermove);
    select.removeEventListener("click", onPanelClick);
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("click", onDocumentClick);
    window.clearTimeout(typedTimer);
  };
};

/**
 * Wire every `tv-select` in the scope to its trigger, tolerating none —
 * the document-wide stand-in the foundation applies, re-applied after any
 * render that replaces the markup.
 */
export const wireSelects = (scope: ParentNode): (() => void) => {
  const disposers: (() => void)[] = [];
  for (const select of scope.querySelectorAll<HTMLElement>("tv-select[trigger]")) {
    const trigger = document.getElementById(select.getAttribute("trigger") ?? "");
    if (trigger instanceof HTMLButtonElement) disposers.push(wireSelect(trigger, select));
  }
  return () => {
    for (const dispose of disposers) dispose();
  };
};

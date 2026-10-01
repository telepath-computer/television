/** Shared document interaction and placement for the portable panel elements. */
export interface PanelBehavior {
  select?: boolean;
  refresh?(): void;
  opened?(keyboard: boolean): void;
  closed?(): void;
  keydown?(event: KeyboardEvent): boolean;
  click?(target: Element): void;
  pointermove?(target: Element): void;
  unpair?(trigger: HTMLButtonElement): void;
  selectedRow?(): HTMLElement | undefined;
}

const documents = new WeakMap<Document, PanelDocument>();

export function setAttributeValue(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

class PanelDocument {
  readonly document: Document;
  readonly panels = new Set<PanelController>();
  readonly #parents = new Map<PanelController, PanelController | null>();
  readonly #clickState = new WeakMap<MouseEvent, {
    inside: Set<PanelController>;
    open: PanelController[];
  }>();
  readonly #abort = new AbortController();
  readonly #observer: MutationObserver;
  #frame = 0;

  constructor(document: Document) {
    this.document = document;
    const options = { signal: this.#abort.signal };
    document.addEventListener("click", this.#captureClick, { ...options, capture: true });
    document.addEventListener("click", this.#click, options);
    document.addEventListener("keydown", this.#keydown, { ...options, capture: true });
    document.addEventListener("keydown", this.#escape, options);
    document.addEventListener("pointermove", this.#pointermove, options);
    this.#observer = new MutationObserver(() => {
      for (const panel of [...this.panels]) panel.refresh();
    });
    this.#observer.observe(document, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["id", "trigger", "selected", "value", "aria-expanded", "role", "aria-haspopup", "aria-controls", "aria-activedescendant"],
    });
  }

  animate(): void {
    if (this.#frame) return;
    const tick = (): void => {
      this.#frame = 0;
      for (const panel of this.panels) if (panel.open) panel.place();
      if ([...this.panels].some(panel => panel.open)) this.#frame = this.document.defaultView!.requestAnimationFrame(tick);
    };
    this.#frame = this.document.defaultView!.requestAnimationFrame(tick);
  }

  remove(panel: PanelController): void {
    this.closed(panel);
    this.panels.delete(panel);
    if (this.panels.size) return;
    this.#abort.abort();
    this.#observer.disconnect();
    this.document.defaultView!.cancelAnimationFrame(this.#frame);
    documents.delete(this.document);
  }

  prepareOpen(panel: PanelController): void {
    let parent: PanelController | null = null;
    for (const candidate of this.panels) {
      if (candidate === panel || !candidate.open || !panel.trigger ||
          !candidate.host.contains(panel.trigger)) continue;
      if (parent === null || parent.host.contains(candidate.host)) parent = candidate;
    }
    // Retain ancestry until closure, including when a parent is removed from the DOM.
    this.#parents.set(panel, parent);
    if (panel.manual || panel.behavior.select) return;
    for (const other of this.panels) {
      if (other.open && other !== panel && !other.manual && !other.behavior.select &&
          !this.isDescendant(panel, other)) other.close();
    }
  }

  isDescendant(panel: PanelController, ancestor: PanelController): boolean {
    for (let parent = this.#parents.get(panel); parent; parent = this.#parents.get(parent)) {
      if (parent === ancestor) return true;
    }
    return false;
  }

  contains(panel: PanelController, target: Node | null): boolean {
    if (!target) return false;
    return panel.host.contains(target) || [...this.panels].some(child =>
      this.isDescendant(child, panel) && child.host.contains(target));
  }

  closeDescendants(panel: PanelController): void {
    for (const child of [...this.panels]) {
      if (this.isDescendant(child, panel)) child.close(false);
    }
  }

  closed(panel: PanelController): void {
    this.#parents.delete(panel);
  }

  #openDeepestFirst(): PanelController[] {
    const depth = (panel: PanelController): number => {
      let result = 0;
      for (let parent = this.#parents.get(panel); parent; parent = this.#parents.get(parent)) result++;
      return result;
    };
    return [...this.panels].filter(panel => panel.open).reverse().sort((left, right) => depth(right) - depth(left));
  }

  #captureClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const target = event.target;
    // Actions may remove their panel before the event reaches document bubble.
    this.#clickState.set(event, {
      inside: new Set([...this.panels].filter(panel =>
        this.contains(panel, target) || panel.trigger?.contains(target))),
      open: [...this.panels].filter(panel => panel.open),
    });
  };

  #click = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const target = event.target;
    const state = this.#clickState.get(event);
    const invoker = [...this.panels].find(panel => panel.trigger?.contains(target));
    // A target action may open another panel; the original press cannot dismiss it.
    for (const panel of state?.open ?? []) {
      if (panel.open && !panel.manual && panel !== invoker && !state?.inside.has(panel)) panel.close();
    }
    if (invoker && !invoker.trigger?.disabled) invoker.toggle(event.detail === 0);
    else for (const panel of [...this.panels]) if (panel.open && panel.host.contains(target)) panel.behavior.click?.(target);
  };

  #pointermove = (event: PointerEvent): void => {
    if (!(event.target instanceof Element)) return;
    for (const panel of this.panels) if (panel.open && panel.host.contains(event.target)) panel.behavior.pointermove?.(event.target);
  };

  #keydown = (event: KeyboardEvent): void => {
    const open = this.#openDeepestFirst();
    const select = open.find(panel => panel.behavior.select);
    const active = select ?? open.find(panel => panel.behavior.keydown);
    if (active?.behavior.keydown?.(event)) return;
    // Selects own Escape before their contents; ordinary popovers let a field
    // handle it first (for example, cancelling an in-place rename).
    if (event.key === "Escape" && select) {
      this.#dismissEscape(event, open, select);
      return;
    }
    for (const panel of this.panels) {
      if (!panel.open && panel.trigger === this.document.activeElement && panel.behavior.keydown?.(event)) return;
    }
  };

  #escape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const open = this.#openDeepestFirst();
    this.#dismissEscape(event, open);
  };

  #dismissEscape(event: KeyboardEvent, open: PanelController[], select?: PanelController): void {
    if (!select && open.some(panel => panel.manual && event.composedPath().includes(panel.host))) return;
    const dismiss = select ?? open.find(panel => !panel.manual);
    if (dismiss && !dismiss.manual) {
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss.close();
    }
  }
}

/** The authored panel stays in place; opening only changes its fixed seat. */
export class PanelController {
  readonly host: HTMLElement;
  readonly behavior: PanelBehavior;
  trigger: HTMLButtonElement | null = null;
  #document: PanelDocument | undefined;
  #shown = false;
  #keyboard = false;
  #returnFocus = true;
  #style = new Map<string, { value: string; priority: string }>();
  readonly #scrollers = new Set<HTMLElement>();

  constructor(host: HTMLElement, behavior: PanelBehavior = {}) {
    this.host = host;
    this.behavior = behavior;
  }

  get open(): boolean { return this.host.hasAttribute("open") && this.#shown; }
  get manual(): boolean { return this.host.hasAttribute("manual"); }

  connect(): void {
    if (this.#document) return;
    const doc = this.host.ownerDocument;
    this.#document = documents.get(doc);
    if (!this.#document) {
      this.#document = new PanelDocument(doc);
      documents.set(doc, this.#document);
    }
    this.#document.panels.add(this);
    this.refresh();
  }

  disconnect(): void {
    if (!this.#document) return;
    const hadFocus = this.#document.contains(this, this.host.ownerDocument.activeElement);
    this.#shown = false;
    this.#document.closeDescendants(this);
    this.#document.closed(this);
    this.host.removeAttribute("open");
    this.behavior.closed?.();
    this.#stopTrackingScrollers();
    this.#restoreStyles();
    if (hadFocus && this.trigger?.isConnected) this.trigger.focus({ preventScroll: true });
    this.#unpair();
    this.#document?.remove(this);
    this.#document = undefined;
  }

  refresh(): void {
    if (!this.#document) return;
    const found = this.host.ownerDocument.getElementById(this.host.getAttribute("trigger") ?? "");
    const trigger = found instanceof HTMLButtonElement ? found : null;
    if (trigger !== this.trigger) {
      this.#unpair();
      this.trigger = trigger;
    }
    if (this.trigger) setAttributeValue(this.trigger, "aria-expanded", this.host.hasAttribute("open") ? "true" : "false");
    this.behavior.refresh?.();
    if (this.host.hasAttribute("open") && !this.trigger) {
      this.host.removeAttribute("open");
      return;
    }
    if (this.host.hasAttribute("open") === this.#shown) return;
    if (this.host.hasAttribute("open")) {
      this.#document.prepareOpen(this);
      this.#shown = true;
      this.#startTrackingScrollers();
      this.#prepareStyles();
      this.place();
      this.behavior.opened?.(this.#keyboard);
      this.#keyboard = false;
      this.#document.animate();
    } else {
      const hadFocus = this.#document.contains(this, this.host.ownerDocument.activeElement);
      this.#shown = false;
      this.#document.closeDescendants(this);
      this.#document.closed(this);
      this.behavior.closed?.();
      this.#stopTrackingScrollers();
      this.#restoreStyles();
      if (hadFocus && this.#returnFocus && this.trigger?.isConnected) this.trigger.focus({ preventScroll: true });
    }
  }

  toggle(keyboard = false): void {
    this.#keyboard = keyboard;
    this.host.toggleAttribute("open");
  }

  show(keyboard = false): void {
    this.#keyboard = keyboard;
    this.host.setAttribute("open", "");
  }

  close(returnFocus = true): void {
    this.#returnFocus = returnFocus;
    this.host.removeAttribute("open");
    this.refresh();
    this.#returnFocus = true;
  }

  #unpair(): void {
    if (!this.trigger) return;
    this.trigger.removeAttribute("aria-expanded");
    this.behavior.unpair?.(this.trigger);
    this.trigger = null;
  }

  #startTrackingScrollers(): void {
    this.#scrollers.clear();
    this.host.addEventListener("scroll", this.#recordScroller, true);
  }

  #stopTrackingScrollers(): void {
    this.host.removeEventListener("scroll", this.#recordScroller, true);
    this.#scrollers.clear();
  }

  readonly #recordScroller = (event: Event): void => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target !== this.host &&
      this.host.contains(target)
    ) this.#scrollers.add(target);
  };

  #prepareStyles(): void {
    const host = this.host;
    for (const property of ["position", "z-index", "left", "top", "margin", "max-width", "max-height", "min-width", "overflow", "--_panel-edge-position", "--_panel-edge-inset", "--_panel-edge-width", "--_panel-edge-height"]) {
      this.#style.set(property, { value: host.style.getPropertyValue(property), priority: host.style.getPropertyPriority(property) });
    }
    host.style.position = "fixed";
    host.style.zIndex = "var(--layer-panel)";
    host.style.margin = "0";
    host.style.overflow = "auto";
    host.style.setProperty("--_panel-edge-position", "fixed");
  }

  #restoreStyles(): void {
    for (const [property, { value, priority }] of this.#style) {
      if (value) this.host.style.setProperty(property, value, priority);
      else this.host.style.removeProperty(property);
    }
    this.#style.clear();
  }

  place(): void {
    if (!this.open || !this.trigger) return;
    const panel = this.host;
    const view = panel.ownerDocument.defaultView!;
    const trigger = this.trigger.getBoundingClientRect();
    if (!this.trigger.isConnected) { this.close(); return; }
    const gap = Number.parseFloat(view.getComputedStyle(panel).getPropertyValue("--popover-distance"));
    if (!Number.isFinite(gap)) return;
    const scrollTop = panel.scrollTop;
    const scrollLeft = panel.scrollLeft;
    const descendantScrollPositions: Array<{
      element: HTMLElement;
      scrollTop: number;
      scrollLeft: number;
    }> = [];
    for (const element of this.#scrollers) {
      if (!element.isConnected || !panel.contains(element)) {
        this.#scrollers.delete(element);
        continue;
      }
      descendantScrollPositions.push({
        element,
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
      });
    }
    panel.style.maxWidth = "none";
    const authoredHeight = this.#style.get("max-height");
    if (authoredHeight?.value) panel.style.setProperty("max-height", authoredHeight.value, authoredHeight.priority);
    else panel.style.removeProperty("max-height");
    const heightCap = view.getComputedStyle(panel).maxHeight;
    panel.style.minWidth = this.behavior.select ? `${Math.min(trigger.width, view.innerWidth - 2 * gap)}px` : this.#style.get("min-width")?.value ?? "";
    const natural = panel.getBoundingClientRect();
    const roomRight = Math.max(0, view.innerWidth - gap - trigger.left);
    const roomLeft = Math.max(0, trigger.right - gap);
    const rightAligned = natural.width > roomRight && roomLeft > roomRight;
    const availableWidth = Math.min(view.innerWidth - 2 * gap, rightAligned ? roomLeft : roomRight);
    const minimumWidth = Number.parseFloat(view.getComputedStyle(panel).minWidth) || 0;
    panel.style.minWidth = `${Math.max(0, Math.min(minimumWidth, availableWidth))}px`;
    panel.style.maxWidth = `${Math.max(0, availableWidth)}px`;
    const sized = panel.getBoundingClientRect();
    const width = sized.width;
    const height = sized.height;
    const left = Math.max(gap, Math.min(rightAligned ? trigger.right - width : trigger.left, view.innerWidth - gap - width));
    let top: number;
    let availableHeight: number;
    if (this.behavior.select) {
      const row = this.behavior.selectedRow?.();
      const offset = row ? row.getBoundingClientRect().top + row.offsetHeight / 2 - sized.top : 0;
      const seat = trigger.top + trigger.height / 2 - offset;
      if (seat >= gap && seat + height <= view.innerHeight - gap) {
        top = seat;
        availableHeight = view.innerHeight - gap - seat;
      } else {
        const below = view.innerHeight - gap - trigger.top;
        const above = trigger.bottom - gap;
        const upward = height > below && above > below;
        availableHeight = upward ? above : below;
        top = upward ? trigger.bottom - Math.min(height, availableHeight) : trigger.top;
      }
    } else {
      const below = Math.max(0, view.innerHeight - gap - trigger.bottom - gap);
      const above = Math.max(0, trigger.top - 2 * gap);
      const upward = height > below && above > below;
      availableHeight = upward ? above : below;
      top = upward ? trigger.top - gap - Math.min(height, above) : trigger.bottom + gap;
    }
    const viewportHeight = `${Math.max(0, availableHeight)}px`;
    panel.style.maxHeight = heightCap === "none" ? viewportHeight : `min(${heightCap}, ${viewportHeight})`;
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.max(gap, Math.min(top, view.innerHeight - gap - Math.min(height, availableHeight)))}px`;
    // Fixed paint pseudos escape the scroll clip and share the host's fixed
    // containing block, including transformed ancestors. Use local CSS sizes:
    // viewport subtraction includes scrollbars, and client rects include scale.
    const box = view.getComputedStyle(panel);
    const borderBox = box.boxSizing === "border-box";
    const edgeWidth = parseFloat(box.width) + (borderBox ? 0 : parseFloat(box.paddingLeft) + parseFloat(box.paddingRight) + parseFloat(box.borderLeftWidth) + parseFloat(box.borderRightWidth));
    const edgeHeight = parseFloat(box.height) + (borderBox ? 0 : parseFloat(box.paddingTop) + parseFloat(box.paddingBottom) + parseFloat(box.borderTopWidth) + parseFloat(box.borderBottomWidth));
    panel.style.setProperty("--_panel-edge-inset", `${panel.style.top} auto auto ${panel.style.left}`);
    panel.style.setProperty("--_panel-edge-width", `${edgeWidth}px`);
    panel.style.setProperty("--_panel-edge-height", `${edgeHeight}px`);
    panel.scrollTop = scrollTop;
    panel.scrollLeft = scrollLeft;
    for (const position of descendantScrollPositions) {
      position.element.scrollTop = position.scrollTop;
      position.element.scrollLeft = position.scrollLeft;
    }
  }
}

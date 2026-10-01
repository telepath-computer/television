import "./popover.css";
import "./select.css";
import "./icon.js";
import { PanelController, setAttributeValue } from "./panel-controller.js";

const TYPEAHEAD_RESET_MS = 600;

let identity = 0;
const identities = new WeakMap<HTMLElement, string>();
const identify = (element: HTMLElement): string => {
  if (element.id) return element.id;
  let id = identities.get(element);
  if (!id) {
    do { id = `tv-select-${++identity}`; } while (element.ownerDocument.getElementById(id));
    identities.set(element, id);
  }
  element.id = id;
  return id;
};
const label = (option: HTMLElement): string => option.textContent?.trim() ?? "";

export class OptionElement extends HTMLElement {
  static observedAttributes = ["selected"];
  readonly #internals = this.attachInternals();
  constructor() {
    super();
    this.#internals.role = "option";
  }
  connectedCallback(): void { this.attributeChangedCallback(); }
  attributeChangedCallback(): void { this.#internals.ariaSelected = String(this.hasAttribute("selected")); }
}

export class SelectElement extends HTMLElement {
  static observedAttributes = ["open", "trigger", "manual"];
  readonly #panel = new PanelController(this, {
    select: true,
    refresh: () => this.#refresh(),
    opened: () => { this.#typed = ""; this.#highlight(this.#selected()); },
    closed: () => { this.#highlight(undefined); this.#typed = ""; },
    keydown: event => this.#keydown(event),
    pointermove: target => { const option = this.#option(target); if (option) this.#highlight(option); },
    click: target => { const option = this.#option(target); if (option) this.#commit(option); },
    selectedRow: () => this.#selected(),
    unpair: trigger => this.#unpair(trigger),
  });
  #widthSheet: HTMLStyleElement | undefined;
  #widthSignature = "";
  #widthObserver: ResizeObserver | undefined;
  #typed = "";
  #typedAt = 0;

  constructor() {
    super();
    this.attachInternals().role = "listbox";
  }
  connectedCallback(): void { this.#panel.connect(); }
  disconnectedCallback(): void { this.#panel.disconnect(); }
  attributeChangedCallback(): void { this.#panel.refresh(); }

  get value(): string { return this.#selected()?.getAttribute("value") ?? ""; }
  set value(value: string) {
    const option = this.#options().find(item => item.getAttribute("value") === value);
    if (option) { this.#choose(option); this.#refresh(); }
  }

  #options(): HTMLElement[] { return [...this.querySelectorAll<HTMLElement>("tv-option")].filter(option => option.closest("tv-select") === this); }
  #selected(): HTMLElement | undefined { return this.#options().find(option => option.hasAttribute("selected")); }
  #option(target: Element): HTMLElement | undefined {
    const option = target.closest<HTMLElement>("tv-option");
    return option?.closest("tv-select") === this ? option : undefined;
  }

  #choose(option: HTMLElement): void {
    for (const item of this.#options()) item.toggleAttribute("selected", item === option);
  }

  #highlight(option: HTMLElement | undefined): void {
    for (const item of this.#options()) item.toggleAttribute("highlighted", item === option);
    if (this.#panel.trigger) setAttributeValue(this.#panel.trigger, "aria-activedescendant", option ? identify(option) : null);
    if (option) {
      const row = option.getBoundingClientRect();
      const panel = this.getBoundingClientRect();
      if (row.top < panel.top + this.clientTop) this.scrollTop -= panel.top + this.clientTop - row.top;
      else if (row.bottom > panel.top + this.clientTop + this.clientHeight) this.scrollTop += row.bottom - panel.top - this.clientTop - this.clientHeight;
    }
  }

  #refresh(): void {
    const options = this.#options();
    const selected = this.#selected() ?? options[0];
    if (selected) this.#choose(selected);
    const trigger = this.#panel.trigger;
    if (!trigger) return;
    setAttributeValue(trigger, "role", "combobox");
    setAttributeValue(trigger, "aria-haspopup", "listbox");
    setAttributeValue(trigger, "aria-controls", identify(this));
    for (const option of options) identify(option);
    const highlighted = options.find(option => option.hasAttribute("highlighted"));
    setAttributeValue(trigger, "aria-activedescendant", this.hasAttribute("open") && highlighted ? highlighted.id : null);
    const text = selected ? label(selected) : "";
    if (!(trigger.firstChild instanceof Text) || trigger.firstChild.nodeValue !== `${text} ` || trigger.childNodes.length !== 2 || trigger.lastElementChild?.getAttribute("name") !== "select") {
      const icon = this.ownerDocument.createElement("tv-icon");
      icon.setAttribute("name", "select");
      icon.setAttribute("aria-hidden", "true");
      trigger.replaceChildren(`${text} `, icon);
    }
    this.#reserveWidth(trigger, options);
  }

  #reserveWidth(trigger: HTMLButtonElement, options: HTMLElement[]): void {
    if (!this.#widthObserver) {
      this.#widthObserver = new ResizeObserver(() => {
        const current = this.#panel.trigger;
        if (current) this.#reserveWidth(current, this.#options());
      });
      this.#widthObserver.observe(trigger);
    }
    // A hidden ancestor supplies no measurement; retry when it becomes visible.
    if (!trigger.getClientRects().length) return;
    const computed = this.ownerDocument.defaultView!.getComputedStyle(trigger);
    const signature = JSON.stringify([trigger.id, options.map(label), computed.font, computed.letterSpacing, computed.padding, computed.borderWidth, computed.gap]);
    if (signature === this.#widthSignature) return;
    this.#widthSignature = signature;
    const measure = trigger.cloneNode(true) as HTMLButtonElement;
    measure.removeAttribute("id");
    measure.style.cssText += ";position:absolute;visibility:hidden;pointer-events:none;width:max-content;min-width:0;max-width:none;";
    measure.style.font = computed.font;
    measure.style.letterSpacing = computed.letterSpacing;
    trigger.after(measure);
    let width = 0;
    for (const option of options) {
      measure.firstChild!.nodeValue = `${label(option)} `;
      width = Math.max(width, measure.getBoundingClientRect().width);
    }
    measure.remove();
    this.#widthSheet ??= this.ownerDocument.createElement("style");
    // Zero specificity means an ordinary authored width declaration wins.
    this.#widthSheet.textContent = `:where(button[id="${CSS.escape(trigger.id)}"]) { width: ${width}px; }`;
    if (!this.#widthSheet.isConnected) this.ownerDocument.head.append(this.#widthSheet);
  }

  #unpair(trigger: HTMLButtonElement): void {
    for (const attribute of ["role", "aria-haspopup", "aria-controls", "aria-activedescendant"]) trigger.removeAttribute(attribute);
    this.#widthObserver?.disconnect();
    this.#widthObserver = undefined;
    this.#widthSheet?.remove();
    this.#widthSheet = undefined;
    this.#widthSignature = "";
  }

  #commit(option: HTMLElement): void {
    const changed = this.#selected() !== option;
    this.#choose(option);
    this.#refresh();
    this.#panel.close();
    if (changed) this.dispatchEvent(new Event("change", { bubbles: true }));
  }

  #keydown(event: KeyboardEvent): boolean {
    if (!this.#panel.open) {
      if (this.ownerDocument.activeElement !== this.#panel.trigger || !["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#panel.show(true);
      return true;
    }
    const options = this.#options();
    const current = options.findIndex(option => option.hasAttribute("highlighted"));
    if (event.key === "Tab") {
      event.stopImmediatePropagation();
      if (this.ownerDocument.activeElement !== this.#panel.trigger) {
        event.preventDefault();
        return true;
      }
      if (options[current]) this.#commit(options[current]);
      return true;
    }
    if (event.key === "Escape") return false;
    const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key) && !printable) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === "Enter" || event.key === " ") {
      if (options[current]) this.#commit(options[current]);
    } else if (event.key === "Home") this.#highlight(options[0]);
    else if (event.key === "End") this.#highlight(options.at(-1));
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      this.#highlight(options[Math.max(0, Math.min(options.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))]);
    } else {
      const now = performance.now();
      this.#typed = now - this.#typedAt > TYPEAHEAD_RESET_MS ? event.key.toLowerCase() : this.#typed + event.key.toLowerCase();
      this.#typedAt = now;
      const candidates = [...options.slice(current + 1), ...options.slice(0, current + 1)];
      const match = candidates.find(option => label(option).toLowerCase().startsWith(this.#typed));
      if (match) this.#highlight(match);
    }
    return true;
  }
}

if (!customElements.get("tv-option")) customElements.define("tv-option", OptionElement);
if (!customElements.get("tv-select")) customElements.define("tv-select", SelectElement);

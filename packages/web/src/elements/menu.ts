import "./popover.css";
import "./menu.css";
import { focusOption, navigateOptions } from "./option-navigation.js";
import { PanelController } from "./panel-controller.js";

export class MenuItemElement extends HTMLElement {
  constructor() {
    super();
    this.attachInternals().role = "menuitem";
  }
  connectedCallback(): void { this.tabIndex = -1; }
}

export class MenuElement extends HTMLElement {
  static observedAttributes = ["open", "trigger", "manual"];
  readonly #panel = new PanelController(this, {
    opened: keyboard => { if (keyboard) focusOption(this.#items()[0]); },
    keydown: event => this.#keydown(event),
    pointermove: target => focusOption(this.#item(target) ?? undefined),
    click: target => { if (this.#item(target)) this.#panel.close(); },
  });

  constructor() {
    super();
    this.attachInternals().role = "menu";
  }
  connectedCallback(): void { this.#panel.connect(); }
  disconnectedCallback(): void { this.#panel.disconnect(); }
  attributeChangedCallback(): void { this.#panel.refresh(); }

  #items(): HTMLElement[] { return [...this.querySelectorAll<HTMLElement>("tv-menu-item")]; }
  #item(target: Element): HTMLElement | null {
    const item = target.closest<HTMLElement>("tv-menu-item");
    return item?.closest("tv-menu") === this ? item : null;
  }
  #keydown(event: KeyboardEvent): boolean {
    if (!this.#panel.open) return false;
    const items = this.#items();
    const index = items.indexOf(this.ownerDocument.activeElement as HTMLElement);
    if (navigateOptions(event, items)) return true;
    if (event.key === "Enter" && index >= 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      items[index]!.click();
      return true;
    }
    return false;
  }
}

if (!customElements.get("tv-menu-item")) customElements.define("tv-menu-item", MenuItemElement);
if (!customElements.get("tv-menu")) customElements.define("tv-menu", MenuElement);

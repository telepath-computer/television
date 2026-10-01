import "./popover.css";
import { PanelController } from "./panel-controller.js";

export class PopoverElement extends HTMLElement {
  static observedAttributes = ["open", "trigger", "manual"];
  readonly #panel = new PanelController(this);
  connectedCallback(): void { this.#panel.connect(); }
  disconnectedCallback(): void { this.#panel.disconnect(); }
  attributeChangedCallback(): void { this.#panel.refresh(); }
}

if (!customElements.get("tv-popover")) customElements.define("tv-popover", PopoverElement);

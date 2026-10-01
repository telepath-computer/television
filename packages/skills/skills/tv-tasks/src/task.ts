/*
 * tv-tasks web components (skill-local — shipped by the skill, not canonical).
 *
 * Only the parts that need real behavior / accessibility live here as registered
 * elements. Pure structure stays as unregistered `tv-task-*` styling elements in
 * task.css.
 */

import { defineEvent } from "@rupertsworld/event-target";

import { dueState, formatDue, isValidDueDate } from "./due.ts";

/**
 * <tv-task-checkbox>: the user toggled the checkbox (click or keyboard). Fires
 * only on genuine user interaction — not when `.checked` is set programmatically
 * (matching native `<input>.checked = x`). Bubbles, so a list can delegate.
 * Read the new state from `e.checked`.
 */
export interface ToggleEvent extends Event {
  type: "toggle";
  checked: boolean;
}
export const ToggleEvent = defineEvent<ToggleEvent>();

/* ---- <tv-task-checkbox> ----
 * A real, accessible checkbox. Encapsulates the <input>, the styled circular mark,
 * the pop animation, and the keyboard focus ring. Because the <input> is in shadow
 * DOM (where the row's :has() can't reach it), the element reflects a `checked`
 * attribute on its host so the row can style completion via
 * `:has(tv-task-checkbox[checked])`.
 *
 * The accessible name is derived from the row's <tv-task-title> on connect, so
 * the author never repeats the title and a screen-reader user hears which task
 * each checkbox belongs to.
 *
 *   <tv-task-checkbox></tv-task-checkbox>
 *   <tv-task-checkbox checked></tv-task-checkbox>
 *   <tv-task-checkbox disabled></tv-task-checkbox>
 */

const CHECKBOX_STYLES = `
  :host {
    display: inline-block;
    position: relative;
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
  :host([disabled]) { cursor: default; }

  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }

  .mark {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    overflow: hidden;
    border: 1.5px solid var(--color-border);
    border-radius: 9999px;
    pointer-events: none;
    transition:
      border-color 90ms ease-out,
      transform 120ms cubic-bezier(0.2, 1.6, 0.35, 1);
  }
  .mark::before {
    content: "";
    position: absolute;
    inset: -1.5px;
    border-radius: inherit;
    background: var(--color-primary);
    transform: scale(0);
    transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .mark::after {
    content: "";
    width: 4px;
    height: 7px;
    border: solid var(--color-primary-text);
    border-width: 0 1.5px 1.5px 0;
    opacity: 0;
    transform: translateY(-0.5px) rotate(45deg) scale(0.75);
    transition:
      opacity 70ms ease-out 55ms,
      transform 100ms cubic-bezier(0.2, 1.6, 0.35, 1) 55ms;
    z-index: 1;
  }

  input:checked ~ .mark {
    border-color: var(--color-primary);
    animation: pop 180ms cubic-bezier(0.2, 1.7, 0.35, 1);
  }
  input:checked ~ .mark::before { transform: scale(1); }
  input:checked ~ .mark::after {
    opacity: 1;
    transform: translateY(-0.5px) rotate(45deg) scale(1);
  }
  input:active ~ .mark { transform: scale(0.9); }
  input:focus-visible ~ .mark {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  @keyframes pop {
    0% { transform: scale(0.9); }
    55% { transform: scale(1.12); }
    100% { transform: scale(1); }
  }
`;

export class TaskCheckboxElement extends HTMLElement {
  static observedAttributes = ["checked", "disabled"];

  #root: ShadowRoot;
  #input: HTMLInputElement;
  #syncing = false;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    this.#root.innerHTML = `<style>${CHECKBOX_STYLES}</style><input type="checkbox" /><span class="mark" aria-hidden="true"></span>`;
    this.#input = this.#root.querySelector("input") as HTMLInputElement;

    // User toggles the inner input → reflect to the host attribute (so the row's
    // :has(tv-task-checkbox[checked]) sees it) and emit a bubbling `toggle` event.
    this.#input.addEventListener("change", () => {
      if (this.#syncing) return;
      this.#syncing = true;
      this.toggleAttribute("checked", this.#input.checked);
      this.#syncing = false;
      this.dispatchEvent(
        new ToggleEvent("toggle", { checked: this.#input.checked, bubbles: true }),
      );
    });
  }

  // Programmatic state. Reading reflects the host attribute; writing toggles it,
  // which drives #sync() through attributeChangedCallback. The #syncing guard
  // means this never emits a `toggle` event — only user interaction does.
  get checked(): boolean {
    return this.hasAttribute("checked");
  }

  set checked(v: boolean) {
    this.toggleAttribute("checked", Boolean(v));
  }

  connectedCallback(): void {
    // Upgrade-property guard: a `checked` set before this element's definition
    // was loaded lands as an own instance property that shadows the class
    // accessor. Capture it, delete the shadowing property, and replay the value
    // through the real setter.
    if (Object.prototype.hasOwnProperty.call(this, "checked")) {
      const value = (this as { checked?: unknown }).checked;
      delete (this as { checked?: unknown }).checked;
      this.checked = Boolean(value);
    }
    this.#sync();
    this.#deriveAccessibleName();
  }

  attributeChangedCallback(): void {
    this.#sync();
  }

  // Host attributes → inner input.
  #sync(): void {
    if (this.#syncing) return;
    this.#syncing = true;
    this.#input.checked = this.hasAttribute("checked");
    this.#input.disabled = this.hasAttribute("disabled");
    this.#syncing = false;
  }

  // Accessible name comes from the row's title, not a `label` attribute, so the
  // author never repeats the title text.
  #deriveAccessibleName(): void {
    const title = this.closest("tv-task")
      ?.querySelector("tv-task-title")
      ?.textContent?.trim();
    this.#input.setAttribute("aria-label", title ?? "");
  }
}

if (!customElements.get("tv-task-checkbox")) {
  customElements.define("tv-task-checkbox", TaskCheckboxElement);
}

/* ---- <tv-task-meta-due> ----
 * A due date chip. Takes a machine `date` (ISO date-only), computes its urgency
 * vs the current clock (today / overdue / upcoming), formats a human label, and
 * renders the calendar glyph + label. It reflects the computed urgency as a
 * `state` host attribute so light-DOM CSS can color it later
 * (`tv-task-meta-due[state="…"]`). All color is `currentColor` — coloring is
 * task.css's job in a later slice, not this component's.
 *
 *   <tv-task-meta-due date="2026-06-26"></tv-task-meta-due>
 */

// The calendar glyph is the canonical <tv-icon> element (registered globally via
// /canonical/v2/components.js). It upgrades inside this shadow root and defaults
// to currentColor, so it inherits the surrounding text color.
const CALENDAR_ICON = `<tv-icon name="calendar" size="sm" aria-hidden="true"></tv-icon>`;

const DUE_STYLES = `
  :host {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: currentColor;
  }
`;

export class TaskMetaDueElement extends HTMLElement {
  static observedAttributes = ["date"];

  #root: ShadowRoot;
  #label: HTMLSpanElement;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    this.#root.innerHTML = `<style>${DUE_STYLES}</style>${CALENDAR_ICON}<span class="label"></span>`;
    this.#label = this.#root.querySelector(".label") as HTMLSpanElement;
  }

  connectedCallback(): void {
    this.#render();
  }

  attributeChangedCallback(): void {
    this.#render();
  }

  #render(): void {
    // The attribute contract is a date-only ISO string. A missing date renders
    // as nothing; a malformed one renders a visible "Invalid date" so the
    // author can spot and fix it.
    const date = this.getAttribute("date");
    if (!date || !isValidDueDate(date)) {
      this.removeAttribute("state");
      this.#label.textContent = date ? "Invalid date" : "";
      return;
    }
    const now = new Date();
    this.setAttribute("state", dueState(date, now));
    this.#label.textContent = formatDue(date, now);
  }
}

if (!customElements.get("tv-task-meta-due")) {
  customElements.define("tv-task-meta-due", TaskMetaDueElement);
}

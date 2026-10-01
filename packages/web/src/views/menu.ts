import { View, view } from "@telepath-computer/utils/lit-view";
import { html, nothing, type TemplateResult } from "lit-html";
import "../elements/menu.ts";

let menuCounter = 0;

export interface MenuAction {
  label: string;
  action(): void;
  destructive?: boolean;
}

export interface MenuSeparator {
  separator: true;
}

export type MenuEntry = MenuAction | MenuSeparator;

export interface MenuOptions {
  trigger(id: string): TemplateResult;
}

/** Declarative menu composition with a stable, position-owned trigger id. */
class Menu extends View<[readonly MenuEntry[], MenuOptions]> {
  readonly #triggerId = `menu-trigger-${++menuCounter}`;

  template(entries: readonly MenuEntry[], { trigger }: MenuOptions): TemplateResult {
    return html`${trigger(this.#triggerId)}<tv-menu trigger=${this.#triggerId}>
      ${entries.map((entry) => "separator" in entry
        ? html`<hr>`
        : html`<tv-menu-item intent=${entry.destructive ? "danger" : nothing} @click=${entry.action}>${entry.label}</tv-menu-item>`)}
    </tv-menu>`;
  }
}

export const MenuView = view(Menu);

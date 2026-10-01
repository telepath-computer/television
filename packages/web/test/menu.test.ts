// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { html, render } from "lit-html";
import {
  MenuView,
  type MenuEntry,
} from "../src/views/menu.ts";

afterEach(() => document.body.replaceChildren());

type ItemFixture =
  | { label: string; destructive?: boolean }
  | { separator: true };

interface MenuFixture {
  name: string;
  items: ItemFixture[];
}

const fixtures: MenuFixture[] = [
  {
    name: "a separator and destructive action",
    items: [
      { label: "Rename" },
      { separator: true },
      { label: "Delete", destructive: true },
    ],
  },
  {
    name: "ordinary actions",
    items: [{ label: "Reload" }, { label: "Open externally" }],
  },
];

describe("MenuView (^mn-ac-markup-smoke)", () => {
  it.each(fixtures)(
    "renders $name and invokes its supplied actions",
    ({ items }) => {
      const calls: string[] = [];
      const entries: MenuEntry[] = items.map((item) =>
        "separator" in item
          ? item
          : {
              ...item,
              action: () => calls.push(item.label),
            },
      );
      const siblingEntries: MenuEntry[] = [{ label: "Sibling", action: () => {} }];
      const host = document.createElement("main");
      document.body.append(host);

      const menuPair = (renderState: string) => html`
        ${MenuView(entries, {
          trigger: (id) => html`
            <button
              class="menu-trigger"
              data-position="primary"
              data-render-state=${renderState}
              id=${id}
            >Primary</button>
          `,
        })}
        ${MenuView(siblingEntries, {
          trigger: (id) => html`
            <button
              class="menu-trigger"
              data-position="sibling"
              data-render-state=${renderState}
              id=${id}
            >Sibling</button>
          `,
        })}
      `;

      render(menuPair("first"), host);

      const initialTriggers = [...host.querySelectorAll<HTMLButtonElement>(".menu-trigger")];
      const initialPanels = [...host.querySelectorAll<HTMLElement>("tv-menu")];
      expect(host.children).toHaveLength(4);
      expect(initialTriggers).toHaveLength(2);
      expect(initialPanels).toHaveLength(2);
      for (const [index, trigger] of initialTriggers.entries()) {
        const panel = initialPanels[index];
        if (!panel) throw new Error("Expected menu panel");
        expect(trigger.nextElementSibling).toBe(panel);
        expect(trigger.id).not.toBe("");
        expect(panel.getAttribute("trigger")).toBe(trigger.id);
      }
      const initialPairings = initialPanels.map((panel) => panel.getAttribute("trigger"));
      expect(new Set(initialPairings).size).toBe(2);

      render(menuPair("second"), host);

      const rerenderedTriggers = [...host.querySelectorAll<HTMLButtonElement>(".menu-trigger")];
      const rerenderedPanels = [...host.querySelectorAll<HTMLElement>("tv-menu")];
      expect(rerenderedPanels.map((panel) => panel.getAttribute("trigger"))).toEqual(initialPairings);
      expect(rerenderedTriggers.map((trigger) => trigger.dataset.renderState))
        .toEqual(["second", "second"]);

      const panel = rerenderedPanels[0];
      if (!panel) throw new Error("Expected primary menu panel");
      expect(panel.hasAttribute("placement")).toBe(false);
      expect(panel.hasAttribute("popover")).toBe(false);

      const rendered = [...panel.children].map((element) => {
        if (element.matches("hr")) return { separator: true };
        expect(element.matches("tv-menu-item")).toBe(true);
        return {
          label: element.textContent?.trim(),
          destructive: element.getAttribute("intent") === "danger",
        };
      });
      expect(rendered).toEqual(
        items.map((item) =>
          "separator" in item
            ? { separator: true }
            : { label: item.label, destructive: item.destructive ?? false },
        ),
      );

      const actions = panel.querySelectorAll<HTMLButtonElement>(
        "tv-menu-item",
      );
      expect(actions).toHaveLength(items.filter((item) => !("separator" in item)).length);
      for (const action of actions) action.click();
      expect(calls).toEqual(
        items.flatMap((item) => ("separator" in item ? [] : [item.label])),
      );
    },
  );
});

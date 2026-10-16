// The Checklist template's spec: each story is one state of its page, with its
// markup written here. The prose is checklist.mdx and the styles are
// styles.css, both beside this file.

import "../../../../specs/ui/foundation/index.css";
import "./styles.css";
import { html, Html } from "../../../lib/html.ts";
import iconFrame from "../../../../specs/ui/foundation/icons/icon.frame";

const icon = (params: { name: string; size?: string }): Html =>
  new Html(iconFrame.render(params, { serializableShadowRoots: true }));

interface Item {
  text: string;
  done: boolean;
}

interface Args {
  theme: "light" | "dark";
  // An empty title shows its placeholder.
  title: string;
  items: Item[];
  // The index of the item whose text is being edited, or null.
  editing: number | null;
  // The text typed into the add field.
  adding: string;
  // The page's access to its store is read-only, as through a read-only
  // share link.
  readOnly: boolean;
}

const item = ({ text, done }: Item, index: number, editing: boolean, readOnly: boolean) => readOnly
  ? html`
  <li class="checklist-item"${done ? html` data-done` : ""}>
    <input type="checkbox" class="checklist-check" aria-label="Done" disabled${done ? html` checked` : ""}>
    <span class="checklist-text">${text}</span>
  </li>`
  : html`
  <li class="checklist-item"${done ? html` data-done` : ""}${editing ? html` data-editing` : ""}>
    <input type="checkbox" class="checklist-check" aria-label="Done"${done ? html` checked` : ""}>
    <span class="checklist-text" contenteditable="plaintext-only" role="textbox" aria-label="Item ${index + 1}">${text}</span>
    <button class="checklist-remove" variant="ghost" icon aria-label="Remove item" title="Remove item">${icon({ name: "close" })}</button>
  </li>`;

const render = ({ theme, title, items, editing, adding, readOnly }: Args) => {
  // Stories share one document, so each sets the theme it shows.
  document.documentElement.dataset.theme = theme;
  return html`
  <main class="checklist-page">
    <article class="checklist-sheet"${readOnly ? html` data-read-only` : ""}>
      ${readOnly
        ? html`<h1 class="checklist-title" data-placeholder="Untitled">${title}</h1>`
        : html`<h1 class="checklist-title" contenteditable="plaintext-only" role="textbox" aria-label="Title" data-placeholder="Untitled">${title}</h1>`}
      <ul class="checklist-items">${items.map((it, i) => item(it, i, i === editing, readOnly))}</ul>
      ${readOnly ? "" : html`
      <label class="checklist-add">
        ${icon({ name: "add" })}
        <input class="checklist-add-input" type="text" placeholder="Add an item" aria-label="Add an item" value="${adding}">
      </label>`}
    </article>
  </main>`;
};

const groceries: Item[] = [
  { text: "Sourdough loaf", done: true },
  { text: "Oat milk", done: false },
  { text: "Lemons", done: true },
  { text: "Parmesan, the good one from the deli counter", done: false },
  { text: "Basil", done: false },
  { text: "Coffee beans", done: false },
];

export default {
  title: "Spec/Templates/Checklist",
  parameters: { layout: "fullscreen" },
  render,
  args: { theme: "light", title: "Groceries", items: groceries, editing: null, adding: "", readOnly: false } satisfies Args,
};

// What a person sees after creating a Checklist from the Templates popover.
export const New = { args: { title: "Checklist", items: [] } };

export const WithItems = { name: "With items" };

// The second item's text has the caret.
export const EditingItem = { name: "Editing an item", args: { editing: 1 } };

// Text typed into the add field, before Return adds it.
export const Adding = { args: { adding: "Tomatoes" } };

// The title was cleared.
export const Untitled = { args: { title: "" } };

export const LongItems = {
  name: "Long items",
  args: {
    title: "Before the trip",
    items: [
      { text: "Book the airport transfer for the early flight, and confirm the pickup time the night before", done: false },
      { text: "Passports", done: true },
      { text: "Ask the neighbours to water the tomatoes and take in any parcels that arrive while we're away", done: false },
    ],
  },
};

export const ManyItems = {
  name: "Many items",
  args: {
    title: "Spring cleaning",
    items: Array.from({ length: 28 }, (_, i) => ({ text: `Task ${i + 1}`, done: i % 3 === 0 })),
  },
};

// Opened through a read-only share link.
export const ReadOnly = { name: "Read-only", args: { readOnly: true } };

export const Dark = { args: { theme: "dark" } };

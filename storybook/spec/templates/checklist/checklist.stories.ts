// The Checklist template's spec: each story is one state of its page, with its
// markup written here. The prose is specs/ui/templates/checklist.mdx;
// the styles are styles.css, beside this file.

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
  // A note at the top of the sheet: while the page cannot reach its server,
  // or briefly after a save was refused. Null shows none.
  status: string | null;
  // The stored data as a whole cannot be read.
  unreadable: boolean;
  // The checklist's data has not arrived yet.
  loading: boolean;
}

// Each control is named after its item's text, so assistive technology can
// tell which item a box or button belongs to; a blank item is "Empty item".
const item = ({ text, done }: Item, index: number, editing: boolean, readOnly: boolean) => {
  const name = text.trim() === "" ? "Empty item" : text;
  return readOnly
    ? html`
  <li class="checklist-item"${done ? html` data-done` : ""}>
    <input type="checkbox" class="checklist-check" aria-label="${name}" disabled${done ? html` checked` : ""}>
    <span class="checklist-text">${text}</span>
  </li>`
    : html`
  <li class="checklist-item"${done ? html` data-done` : ""}${editing ? html` data-editing` : ""}>
    <input type="checkbox" class="checklist-check" aria-label="${name}"${done ? html` checked` : ""}>
    <span class="checklist-text" contenteditable="plaintext-only" role="textbox" aria-label="Item ${index + 1}">${text}</span>
    <button class="checklist-remove" variant="ghost" icon aria-label="Remove ${name}" title="Remove item">${icon({ name: "close" })}</button>
  </li>`;
};

const render = ({ theme, title, items, editing, adding, readOnly, status, unreadable, loading }: Args) => {
  // The theme goes on the document, as in an artifact. Docs pages render each
  // story in its own frame, so stories don't share it.
  document.documentElement.dataset.theme = theme;
  if (loading) return html`
  <main class="checklist-page">
    <article class="checklist-sheet"></article>
  </main>`;
  if (unreadable) return html`
  <main class="checklist-page">
    <article class="checklist-sheet" data-read-only>
      <h1 class="checklist-title">This checklist can't be shown</h1>
      <p class="checklist-unreadable">Its saved data isn't in the form this page reads. Ask your agent to check it.</p>
    </article>
  </main>`;
  return html`
  <main class="checklist-page">
    <article class="checklist-sheet"${readOnly ? html` data-read-only` : ""}>
      ${status === null ? "" : html`<p class="checklist-status" role="status">${status}</p>`}
      ${readOnly
        ? html`<h1 class="checklist-title"><span class="checklist-title-text" data-placeholder="Untitled">${title}</span></h1>`
        : html`<h1 class="checklist-title"><span class="checklist-title-text" contenteditable="plaintext-only" role="textbox" aria-label="Title" data-placeholder="Untitled">${title}</span></h1>`}
      <ul class="checklist-items">${items.map((it, i) => item(it, i, i === editing, readOnly))}</ul>
      ${readOnly && items.length === 0 ? html`<p class="checklist-empty">No items</p>` : ""}
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
  // On the docs page each story renders in its own frame, as a page of its own.
  parameters: { layout: "fullscreen", docs: { story: { inline: false, height: "720px" } } },
  render,
  args: { theme: "light", title: "Groceries", items: groceries, editing: null, adding: "", readOnly: false, status: null, unreadable: false, loading: false } satisfies Args,
};

// What a person sees after creating a Checklist from the Templates popover.
export const New = { args: { title: "Checklist", items: [] } };

export const WithItems = { name: "With items" };

// Before the checklist's data first arrives.
export const Loading = { args: { loading: true } };

// The second item's text has the caret.
export const EditingItem = { name: "Editing an item", args: { editing: 1 } };

// Return in "Oat milk" added an empty item below it, which has the caret.
export const NewEmptyItem = {
  name: "A new, empty item",
  args: {
    editing: 2,
    items: [groceries[0], groceries[1], { text: "", done: false }, ...groceries.slice(2)],
  },
};

// A done item's text has the caret; it stays muted and struck through.
export const EditingDoneItem = { name: "Editing a done item", args: { editing: 0 } };

// The pointer is over the second item, which shows its remove button. Stories
// cannot hold the pointer, so a story-only class stands in for :hover.
export const Hovering = {
  name: "Pointer over an item",
  decorators: [(story: () => Html) => html`<div class="checklist-story-hover">${story()}</div>`],
};

// The second item's box has the keyboard focus, as after Tab.
export const KeyboardFocus = {
  name: "Keyboard focus on a box",
  play: ({ canvasElement }: { canvasElement: HTMLElement }) => {
    canvasElement.querySelectorAll<HTMLInputElement>(".checklist-check")[1]?.focus();
  },
};

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

// A read-only checklist with no items.
export const EmptyReadOnly = { name: "Empty, read-only", args: { readOnly: true, items: [] } };

// The page cannot reach its server: read-only until it reconnects.
export const Disconnected = { args: { readOnly: true, status: "Reconnecting…" } };

// A save was refused and its change reverted.
export const SaveFailed = { name: "Save failed", args: { status: "Couldn't save that change." } };

// The stored data is not in the form the page reads, as after an agent
// overwrote it with something else.
export const Unreadable = { args: { unreadable: true } };

// Some items, left out, break the store contract; the title is fine.
export const PartlyUnreadable = { name: "Partly unreadable", args: { status: "Part of this checklist can't be shown." } };

export const Dark = { args: { theme: "dark" } };

// An artifact narrower than the sheet and its margins. The page follows the
// width of its nearest size container, which in an artifact is the body; the
// wrapper here stands in for a narrow artifact and is not part of the markup.
export const Narrow = {
  decorators: [(story: () => Html) => html`<div class="checklist-story-narrow">${story()}</div>`],
};

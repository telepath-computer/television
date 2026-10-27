import "../../../specs/ui/foundation/index.css";
import "../../../specs/ui/foundation/tokens/app.css";
import "./styles.css";
import { html, Html } from "../../lib/html.ts";
import iconFrame from "../../../specs/ui/foundation/icons/icon.frame";

const icon = (params: { name: string; size?: string }): Html =>
  new Html(iconFrame.render(params, { serializableShadowRoots: true }));

interface Item {
  id: string;
  name: string;
  icon?: string;
}

interface FolderError {
  folder: string;
  error: string;
}

interface Args {
  open: boolean;
  hasList: boolean;
  search: string;
  items: Item[];
  highlighted: number | null;
  pressed: number | null;
  invalid: FolderError[];
  folderError: string | null;
}

const palette = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "neutral"];
const HASH_START = 7;
const HASH_MULTIPLIER = 31;
const TOOLBOX_COLUMNS = 3;
const letterIcon = ({ id, name }: Item) => {
  const hash = [...id].reduce((value, character) => (value * HASH_MULTIPLIER + character.codePointAt(0)!) >>> 0, HASH_START);
  const color = `var(--${palette[hash % palette.length]}-600)`;
  return html`<span class="toolbox-icon toolbox-letter" aria-hidden="true" style="background: ${color}">${[...name][0].toUpperCase()}</span>`;
};

const tile = (item: Item, index: number, highlighted: boolean, pressed: boolean) => html`
  <div role="gridcell" id="toolbox-item-${index}" class="toolbox-tile" aria-selected="${highlighted ? "true" : "false"}"${highlighted ? html` data-highlighted` : ""}${pressed ? html` data-pressed` : ""}>
    ${item.icon ? html`<img class="toolbox-icon" src="${item.icon}" alt="" draggable="false">` : letterIcon(item)}
    <span class="toolbox-name">${item.name}</span>
  </div>`;

const gridRows = (items: Item[]) => Array.from(
  { length: Math.ceil(items.length / TOOLBOX_COLUMNS) },
  (_, rowIndex) => items.slice(rowIndex * TOOLBOX_COLUMNS, rowIndex * TOOLBOX_COLUMNS + TOOLBOX_COLUMNS),
);

// Invalid folders are summarized as a count; the agent reads each folder and
// its errors from `tv templates list`.
const invalidSummary = (invalid: FolderError[]) => html`
  <div class="toolbox-invalid" role="note">
    ${icon({ name: "warning", size: "sm" })}
    <span class="toolbox-error-text">
      <span class="toolbox-error-folder">${invalid.length === 1 ? "1 template had errors" : `${invalid.length} templates had errors`}</span>
      <span>Ask your agent to read the Television skill and fix ${invalid.length === 1 ? "it" : "them"}.</span>
    </span>
  </div>`;

const render = ({ open, hasList, search, items, highlighted, pressed, invalid, folderError }: Args) => {
  const showGrid = hasList && folderError === null && items.length > 0;
  return html`
  <div style="display: flex; flex-direction: column; align-items: flex-end; gap: var(--popover-distance)">
    <button class="toolbox-trigger" id="toolbox-trigger" icon variant="ghost" aria-label="Toolbox" title="Toolbox" aria-expanded="${open ? "true" : "false"}">${icon({ name: "skills", size: "sm" })}</button>
    <tv-popover class="toolbox-popover" trigger="toolbox-trigger" role="region" aria-label="Toolbox"${open ? html` open` : ""}>
      <label class="toolbox-search">
        ${icon({ name: "search" })}
        <input type="text" role="combobox" placeholder="Search toolbox…" aria-label="Search toolbox" autocomplete="off" aria-haspopup="grid" aria-autocomplete="list"${showGrid ? html` aria-expanded="true" aria-controls="toolbox-grid"` : html` aria-expanded="false"`}${showGrid && highlighted !== null ? html` aria-activedescendant="toolbox-item-${highlighted}"` : ""} value="${search}">
      </label>
      <div class="toolbox-body">
        ${!hasList
          ? ""
          : folderError !== null
            ? html`<div class="toolbox-folder-error">${icon({ name: "warning", size: "sm" })}<span class="toolbox-error-text"><span class="toolbox-error-folder">Could not read the templates folder.</span><span>${folderError}</span></span></div>`
            : items.length > 0
              ? html`<div class="toolbox-grid" id="toolbox-grid" role="grid" aria-label="Toolbox">${gridRows(items).map((itemsInRow, rowIndex) => html`
                  <div class="toolbox-grid-row" role="row">${itemsInRow.map((item, columnIndex) => {
                    const index = rowIndex * TOOLBOX_COLUMNS + columnIndex;
                    return tile(item, index, index === highlighted, index === pressed);
                  })}</div>
                `)}</div>`
              : search.trim() !== ""
                ? html`<p class="toolbox-empty">Nothing matches “${search}”.</p>`
                : invalid.length > 0
                  ? ""
                  : html`<p class="toolbox-empty">Nothing here yet.</p>`}
        ${hasList && folderError === null && invalid.length > 0
          ? html`${items.length > 0 || search.trim() !== "" ? html`<hr class="toolbox-divider">` : ""}${invalidSummary(invalid)}`
          : ""}
      </div>
      <p class="toolbox-footer">Saved artifacts, ready to reuse anywhere. Ask your agent to add one.</p>
    </tv-popover>
  </div>`;
};

// Local sample artwork, not a site request or a bundled-template declaration.
const calendarIcon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect x="1.5" y="3" width="17" height="15.5" rx="3" fill="#fff" stroke="#d4d4d4"/><path d="M1.5 6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v1.5h-17z" fill="#ef4444"/><text x="10" y="15.8" font-family="Helvetica,Arial,sans-serif" font-size="8" font-weight="700" fill="#262626" text-anchor="middle">22</text></svg>');
const mailIcon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect x="1" y="3" width="18" height="14" rx="2" fill="#2563eb"/><path d="m2 5 8 6 8-6" fill="none" stroke="#fff" stroke-width="1.5"/></svg>');
const calendar: Item = { id: "calendar", name: "Calendar", icon: calendarIcon };
const mailCompose: Item = { id: "mail-compose", name: "Mail compose", icon: mailIcon };
const byDiscoveryOrder = (a: Item, b: Item) =>
  a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en");
const items: Item[] = [
  { id: "agent-tasks", name: "Agent Tasks" },
  calendar,
  { id: "checklist", name: "Checklist" },
  { id: "code", name: "Code" },
  { id: "color-study", name: "Color study" },
  { id: "day-calendar", name: "Day calendar" },
  { id: "email", name: "Email" },
  { id: "email-draft", name: "Email draft" },
  mailCompose,
].sort(byDiscoveryOrder);
const invalid: FolderError[] = [{ folder: "my-template", error: "manifest.json is missing a description." }];

export default {
  title: "Spec/Toolbox",
  render,
  args: { open: true, hasList: true, search: "", items, highlighted: null, pressed: null, invalid: [], folderError: null } satisfies Args,
  play: ({ canvasElement, args }: { canvasElement: HTMLElement; args: Args }) => {
    if (args.open) canvasElement.querySelector<HTMLInputElement>(".toolbox-search input")?.focus();
  },
};

export const Closed = { args: { open: false } };
export const BeforeFirstList = { args: { hasList: false, items: [] } };
export const Open = {};
export const Highlighted = { args: { highlighted: 1 } };
export const Pressed = { args: { highlighted: 1, pressed: 1 } };
export const Searching = { args: { search: "calendar", items: items.filter(item => /calendar/i.test(item.name)), highlighted: 0 } };
export const NoMatches = { args: { search: "spreadsheet", items: [] } };
export const NoTemplates = { args: { items: [] } };
export const OnlyErrors = { args: { items: [], invalid } };
export const FolderUnreadable = { args: { items: [], folderError: "EACCES: permission denied, scandir '/home/me/.television/templates'" } };
export const SuppliedIcons = { args: { items: [calendar, mailCompose].sort(byDiscoveryOrder) } };
export const DefaultIcons = { args: { items: items.filter(item => !item.icon) } };
// The failed request has settled; the tile now displays its default icon.
export const FailedIcon = { args: { items: [{ id: calendar.id, name: calendar.name }] } };
export const LongName = { args: { items: [calendar, { id: "long-name", name: "An item with a much longer name than usual" }].sort(byDiscoveryOrder) } };
export const WithErrors = { args: { invalid } };
export const SearchWithErrors = { args: { search: "spreadsheet", items: [], invalid } };
export const MultipleErrors = {
  args: {
    invalid: [
      ...invalid,
      { folder: "weekly-review", error: "index.html is missing." },
      { folder: "old-dashboard", error: "manifest.json is not valid JSON." },
    ],
  },
};
export const ManyItems = {
  args: {
    items: [
      ...items,
      { id: "image-comparison", name: "Image comparison" },
      { id: "image-gallery", name: "Image gallery" },
      { id: "map", name: "Map with POIs" },
      { id: "news", name: "News top 10" },
      { id: "priorities", name: "Priorities board" },
      { id: "sticky-note", name: "Sticky note" },
      { id: "table", name: "Table" },
      { id: "todo-list", name: "To-do list" },
      { id: "trip", name: "Trip" },
    ].sort(byDiscoveryOrder),
  },
};

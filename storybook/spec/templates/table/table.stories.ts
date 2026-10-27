// Each story is one state of the bundled Table page. Behaviour is specified
// in specs/ui/templates/table.mdx; this file owns independent story markup.

import "../../../../specs/ui/foundation/index.css";
import "./styles.css";
import { html, Html } from "../../../lib/html.ts";
import iconFrame from "../../../../specs/ui/foundation/icons/icon.frame";

const icon = (params: { name: string; size?: string; spinning?: boolean }): Html =>
  new Html(iconFrame.render(params, { serializableShadowRoots: true }));

type Value = string | number | boolean | null | Record<string, unknown> | unknown[];
interface Row { key: string; cells: Record<string, Value> }
interface Sort { column: string; direction: "ascending" | "descending" }
interface Args {
  theme: "light" | "dark";
  rows: Row[];
  filter: string;
  sort: Sort | null;
  selected: string | null;
  loading: boolean;
  unreadable: boolean;
}

const parks: Row[] = [
  { key: "acadia", cells: { Park: "Acadia", State: "Maine", Open: true, Rating: 4.9, Notes: "Granite peaks, woodland paths and the rocky Atlantic coast.", Details: { region: "Northeast" } } },
  { key: "arches", cells: { Park: "Arches", State: "Utah", Open: true, Rating: 4.8, Notes: "More than two thousand natural sandstone arches.", Details: { region: "West" } } },
  { key: "everglades", cells: { Park: "Everglades", State: "Florida", Open: false, Rating: 4.6, Notes: "A slow river of grass, mangroves and coastal prairie.", Details: { region: "South" } } },
  { key: "olympic", cells: { Park: "Olympic", State: "Washington", Open: true, Rating: 4.8, Notes: "Glacier-capped mountains, old-growth rainforest and a wild Pacific shoreline.", Details: { region: "West" } } },
  { key: "yosemite", cells: { Park: "Yosemite", State: "California", Open: true, Rating: 4.9, Notes: "Waterfalls, deep valleys, grand meadows and ancient giant sequoias.", Details: { region: "West" } } },
  { key: "zion", cells: { Park: "Zion", State: "Utah", Open: true, Rating: null, Notes: "Sandstone cliffs above a narrow canyon.", Details: { region: "West" } } },
];

const textOf = (value: Value) => typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
const empty = (value: Value | undefined) => value === undefined || value === null || value === "";
const cellValue = (cells: Record<string, Value>, name: string) => Object.hasOwn(cells, name) ? cells[name] : undefined;

function columnsOf(rows: Row[]) {
  const names: string[] = [];
  for (const row of rows) for (const name of Object.keys(row.cells)) if (!names.includes(name)) names.push(name);
  return names.map(name => {
    const values = rows.map(row => cellValue(row.cells, name)).filter(value => !empty(value));
    return {
      name,
      numeric: values.length > 0 && values.every(value => typeof value === "number"),
      long: values.some(value => typeof value === "string" && value.length > 40),
    };
  });
}

function compare(left: Value | undefined, right: Value | undefined) {
  if (empty(left) || empty(right)) return Number(empty(left)) - Number(empty(right));
  if (typeof left === "number" && typeof right === "number") return left - right;
  return textOf(left!).localeCompare(textOf(right!), undefined, { numeric: true, sensitivity: "base" });
}

function shownRows(rows: Row[], filter: string, sort: Sort | null) {
  const query = filter.trim().toLowerCase();
  let shown = query
    ? rows.filter(row => Object.values(row.cells).some(value => value != null && textOf(value).toLowerCase().includes(query)))
    : [...rows];
  if (sort) {
    const sign = sort.direction === "descending" ? -1 : 1;
    shown = shown.sort((left, right) => {
      const a = cellValue(left.cells, sort.column);
      const b = cellValue(right.cells, sort.column);
      const result = compare(a, b);
      return empty(a) || empty(b) ? result : sign * result;
    });
  }
  return shown;
}

function cell(value: Value | undefined, long: boolean) {
  if (empty(value)) return html`<span class="table-muted">—</span>`;
  if (typeof value === "boolean") return value
    ? html`<span class="table-yes" aria-label="Yes">${icon({ name: "check" })}</span>`
    : html`<span class="table-muted">No</span>`;
  if (typeof value === "number") {
    const shown = Number.isInteger(value) && Math.abs(value) < 10000 ? String(value) : value.toLocaleString();
    return html`${shown}`;
  }
  if (typeof value === "object") return html`<span class="table-text table-code">${textOf(value)}</span>`;
  return html`<span class="table-text${long ? " table-text-long" : ""}" title="${value}">${value}</span>`;
}

function placeholder(filter: string, loading: boolean) {
  if (loading) return html`<div class="table-placeholder">${icon({ name: "spinner", size: "md", spinning: true })}</div>`;
  const query = filter.trim();
  if (query) return html`
    <div class="table-placeholder">
      ${icon({ name: "search", size: "xl" })}
      <strong>No results</strong>
      <span>No rows match “${query}”.</span>
    </div>`;
  return html`
    <div class="table-placeholder">
      ${icon({ name: "table", size: "xl" })}
      <strong>No rows</strong>
      <span>This table is empty.</span>
    </div>`;
}

const render = ({ theme, rows, filter, sort, selected, loading, unreadable }: Args) => {
  document.documentElement.dataset.theme = theme;
  if (unreadable) return html`
  <main class="table-page">
    <section class="table-unreadable" role="alert">
      <span class="table-unreadable-icon">${icon({ name: "warning", size: "xl" })}</span>
      <h1 class="table-unreadable-title">This table can't be shown</h1>
      <p class="table-unreadable-text">Its saved data isn't in the form this page reads. Ask your agent to check it.</p>
    </section>
  </main>`;

  const shown = loading ? [] : shownRows(rows, filter, sort);
  const columns = loading ? [] : columnsOf(rows);
  const count = !loading && rows.length > 0 ? rows.length === 1 ? "1 row" : `${rows.length.toLocaleString()} rows` : "";
  return html`
  <main class="table-page">
    <header class="table-bar">
      <span class="table-count" id="count">${count}</span>
      <label class="table-search">
        ${icon({ name: "search", size: "sm" })}
        <input id="filter" type="search" placeholder="Search" aria-label="Search rows" spellcheck="false" value="${filter}">
      </label>
    </header>
    <div class="table-frame" id="frame">
      <div class="table-scroll" id="scroll" tabindex="0">
        <table id="table">
          <thead id="head">${columns.length === 0 ? "" : html`
            <tr>${columns.map(column => {
              const active = sort?.column === column.name;
              return html`
              <th class="${column.numeric ? "numeric" : ""}" aria-sort="${active ? sort!.direction : "none"}">
                <button class="table-sort" data-column="${column.name}"${active ? html` data-active data-direction="${sort!.direction}"` : ""}>${column.name}${icon({ name: "collapse-up" })}</button>
              </th>`;
            })}</tr>`}</thead>
          <tbody id="body">${shown.map(row => html`
            <tr data-key="${row.key}" aria-selected="${row.key === selected}">${columns.map(column => html`
              <td class="${column.numeric ? "numeric" : ""}">${cell(cellValue(row.cells, column.name), column.long)}</td>`)}</tr>`)}</tbody>
        </table>
        <div id="placeholder">${shown.length === 0 ? placeholder(filter, loading) : ""}</div>
      </div>
      <div class="table-edge table-edge-start"></div>
      <div class="table-edge table-edge-end"></div>
    </div>
  </main>`;
};

type Play = { canvasElement: HTMLElement };
function setEdges(frame: HTMLElement, scroll: HTMLElement) {
  const more = scroll.scrollWidth - scroll.clientWidth;
  frame.toggleAttribute("data-more-start", more > 1 && scroll.scrollLeft > 1);
  frame.toggleAttribute("data-more-end", more > 1 && scroll.scrollLeft < more - 1);
}

const settle = ({ canvasElement }: Play) => {
  const frame = canvasElement.querySelector<HTMLElement>(".table-frame");
  const scroll = canvasElement.querySelector<HTMLElement>(".table-scroll");
  if (frame && scroll) setEdges(frame, scroll);
};

const focusSelection = ({ canvasElement }: Play) => {
  settle({ canvasElement });
  canvasElement.querySelector<HTMLElement>(".table-scroll")?.focus();
};

const scrollSideways = ({ canvasElement }: Play) => {
  const frame = canvasElement.querySelector<HTMLElement>(".table-frame");
  const scroll = canvasElement.querySelector<HTMLElement>(".table-scroll");
  if (!frame || !scroll) return;
  scroll.scrollLeft = 180;
  setEdges(frame, scroll);
};

const manyRows: Row[] = Array.from({ length: 80 }, (_, index) => {
  const park = parks[index % parks.length]!;
  return { key: `${park.key}-${index}`, cells: { ...park.cells, Visit: index + 1 } };
});

const viewports = {
  artifact: { name: "Artifact, shared starting size", styles: { width: "760px", height: "770px" }, type: "desktop" },
  narrow: { name: "Narrow artifact", styles: { width: "400px", height: "600px" }, type: "mobile" },
};

export default {
  title: "Spec/Templates/Table",
  parameters: {
    layout: "fullscreen",
    viewport: { options: viewports },
    docs: { story: { inline: false, height: "770px" } },
  },
  globals: { viewport: { value: "artifact", isRotated: false } },
  render,
  args: { theme: "light", rows: parks, filter: "", sort: null, selected: null, loading: false, unreadable: false } satisfies Args,
};

export const WithRows = { name: "With rows", play: settle };
export const New = { args: { rows: [] }, play: settle };
export const Filtered = { args: { filter: "Utah" }, play: settle };
export const NoResults = { name: "No results", args: { filter: "Redwood" }, play: settle };
export const Sorted = { args: { sort: { column: "Rating", direction: "ascending" } }, play: settle };
export const Selected = { args: { selected: "olympic" }, play: focusSelection };
export const ManyRows = { name: "Many rows", args: { rows: manyRows }, play: settle };
export const Narrow = {
  globals: { viewport: { value: "narrow", isRotated: false } },
  play: scrollSideways,
};
export const Loading = { args: { rows: [], loading: true }, play: settle };
export const Unreadable = { args: { unreadable: true } };
export const Dark = { args: { theme: "dark" }, play: settle };
export const UnreadableDark = { name: "Unreadable, dark", args: { theme: "dark", unreadable: true } };

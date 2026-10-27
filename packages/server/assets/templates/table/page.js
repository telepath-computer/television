import { getStore, onConnectionStatusChanged, onValue, ref } from "/sdk/v1/resources.js";
import { cellValue, columnsOf, orderedRows, textOf, visibleRows } from "./model.js";

const main = document.querySelector(".table-page");
const bar = document.querySelector(".table-bar");
const frame = document.getElementById("frame");
const scroll = document.getElementById("scroll");
const head = document.getElementById("head");
const body = document.getElementById("body");
const placeholder = document.getElementById("placeholder");
const count = document.getElementById("count");
const filterInput = document.getElementById("filter");
const unreadable = document.importNode(document.getElementById("table-unreadable").content.firstElementChild, true);

const state = {
  rows: undefined,
  received: false,
  unavailable: false,
  sort: null,
  selected: null,
  filter: "",
};

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

function showTable() {
  if (!main.contains(frame)) main.replaceChildren(bar, frame);
}

function showError() {
  if (!main.contains(unreadable)) main.replaceChildren(unreadable);
}

function cellHtml(value, column) {
  if (value === undefined || value === null || value === "") return '<span class="table-muted">—</span>';
  if (typeof value === "boolean") {
    return value
      ? '<span class="table-yes" aria-label="Yes"><tv-icon name="check"></tv-icon></span>'
      : '<span class="table-muted">No</span>';
  }
  if (typeof value === "number") {
    const shown = Number.isInteger(value) && Math.abs(value) < 10000 ? String(value) : value.toLocaleString();
    return escapeHtml(shown);
  }
  if (typeof value === "object") return `<span class="table-text table-code">${escapeHtml(textOf(value))}</span>`;
  return `<span class="table-text${column.long ? " table-text-long" : ""}" title="${escapeHtml(value)}">${escapeHtml(value)}</span>`;
}

function placeholderHtml(current, shown) {
  if (current === "loading") {
    return '<div class="table-placeholder"><tv-icon name="spinner" size="md" spinning></tv-icon></div>';
  }
  if (shown.length > 0) return "";
  const query = state.filter.trim();
  if (query) {
    return `<div class="table-placeholder"><tv-icon name="search" size="xl"></tv-icon><strong>No results</strong><span>No rows match “${escapeHtml(query)}”.</span></div>`;
  }
  return '<div class="table-placeholder"><tv-icon name="table" size="xl"></tv-icon><strong>No rows</strong><span>This table is empty.</span></div>';
}

function showSelection() {
  for (const row of body.rows) row.setAttribute("aria-selected", String(row.dataset.key === state.selected));
}

/** Shows a fade at each edge of the table that has more beyond it. */
function showEdges() {
  const more = scroll.scrollWidth - scroll.clientWidth;
  frame.toggleAttribute("data-more-start", more > 1 && scroll.scrollLeft > 1);
  frame.toggleAttribute("data-more-end", more > 1 && scroll.scrollLeft < more - 1);
}

let drawn = "";
function render() {
  if (state.received && (!state.rows || state.unavailable)) {
    showError();
    return;
  }
  showTable();
  const current = state.rows ? "live" : "loading";
  const rows = state.rows ?? [];
  const columns = columnsOf(rows);
  const shown = current === "live" ? visibleRows(rows, state) : [];

  count.textContent = current === "live" && rows.length > 0
    ? rows.length === 1 ? "1 row" : `${rows.length.toLocaleString()} rows`
    : "";

  head.innerHTML = columns.length === 0 ? "" : `<tr>${columns.map(column => {
    const active = state.sort?.column === column.key;
    return `<th class="${column.numeric ? "numeric" : ""}" aria-sort="${active ? state.sort.direction : "none"}">
      <button class="table-sort" data-column="${escapeHtml(column.key)}" ${active ? `data-active data-direction="${state.sort.direction}"` : ""}>${escapeHtml(column.key)}<tv-icon name="collapse-up"></tv-icon></button>
    </th>`;
  }).join("")}</tr>`;

  const html = shown.map(({ row, key }) => `<tr data-key="${escapeHtml(key)}">${columns
    .map(column => `<td class="${column.numeric ? "numeric" : ""}">${cellHtml(cellValue(row, column.key), column)}</td>`)
    .join("")}</tr>`).join("");
  if (html !== drawn) {
    body.innerHTML = html;
    drawn = html;
  }
  showSelection();
  placeholder.innerHTML = placeholderHtml(current, shown);
  showEdges();
}

function select(key) {
  state.selected = key;
  showSelection();
  body.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}

head.addEventListener("click", event => {
  const button = event.target.closest("[data-column]");
  if (!button) return;
  const { column } = button.dataset;
  const current = state.sort?.column === column ? state.sort.direction : null;
  if (current === null) state.sort = { column, direction: "ascending" };
  else if (current === "ascending") state.sort = { column, direction: "descending" };
  else state.sort = null;
  render();
});

body.addEventListener("click", event => {
  const row = event.target.closest("tr");
  select(row?.dataset.key ?? null);
});

scroll.addEventListener("keydown", event => {
  if (event.target !== scroll) return;
  const keys = visibleRows(state.rows ?? [], state).map(({ key }) => key);
  const at = keys.indexOf(state.selected);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = at === -1 ? (step === 1 ? 0 : keys.length - 1) : Math.min(keys.length - 1, Math.max(0, at + step));
    if (keys[next] !== undefined) select(keys[next]);
  } else if (event.key === "Escape") select(null);
});

filterInput.addEventListener("input", () => {
  state.filter = filterInput.value;
  render();
});
filterInput.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  filterInput.value = "";
  state.filter = "";
  render();
});
scroll.addEventListener("scroll", showEdges, { passive: true });
new ResizeObserver(showEdges).observe(scroll);

render();

// A listener that ends on access loss leaves the last table in place. Other
// terminal errors mean the saved value cannot be read and show the standard
// error page. A later connection starts a new listener and can recover.
let listening = false;
function listen() {
  listening = true;
  onValue(ref(getStore()), snapshot => {
    const rows = orderedRows(snapshot.val());
    state.received = true;
    state.unavailable = false;
    if (rows) {
      if (state.selected !== null && !rows.some(row => row.key === state.selected)) state.selected = null;
      state.rows = rows;
    } else state.rows = undefined;
    render();
  }, error => {
    listening = false;
    if (error.code === "no-store") return;
    state.received = true;
    state.unavailable = true;
    render();
  });
}
listen();
onConnectionStatusChanged(status => {
  if (status === "connected" && !listening) listen();
});

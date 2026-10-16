// A Table template prototype on RevoGrid, meant to feel like a table app:
// a toolbar, row numbers, editable cells and column names, adding and
// deleting rows and columns, typed columns, sorting and filtering.
// Television's tokens are mapped onto RevoGrid's custom properties. The rows
// stand in for the artifact's store; nothing is saved.

import "../../../specs/ui/foundation/index.css";
import "./revogrid.css";
import { defineCustomElements } from "@revolist/revogrid/loader";

defineCustomElements();

type Row = Record<string, string | number>;
type ColumnType = "text" | "number" | "date";
interface Column {
  prop: string;
  name: string;
  type: ColumnType;
  size: number;
}

const startColumns: Column[] = [
  { prop: "title", name: "Title", type: "text", size: 340 },
  { prop: "status", name: "Status", type: "text", size: 130 },
  { prop: "owner", name: "Owner", type: "text", size: 120 },
  { prop: "points", name: "Points", type: "number", size: 90 },
  { prop: "due", name: "Due", type: "date", size: 120 },
];

const startRows: Row[] = [
  { title: "Wire /canonical/v2/ stylesheet", status: "In progress", owner: "Rupert", points: 3, due: "2026-04-30" },
  { title: "Land artifacts skill", status: "In progress", owner: "Rupert", points: 5, due: "2026-04-30" },
  { title: "Hermes ACP regression suite", status: "In progress", owner: "Josh", points: 8, due: "2026-05-05" },
  { title: "Promote canonical bundle to production server", status: "To do", owner: "Stephen", points: 2, due: "2026-05-07" },
  { title: "CLI distribution for skills", status: "To do", owner: "Josh", points: 3, due: "2026-05-12" },
  { title: "Token curation pass for v2", status: "To do", owner: "Stephen", points: 5, due: "2026-05-21" },
  { title: "Bundle-on-export for downloadable artifacts", status: "Blocked", owner: "Rupert", points: 8, due: "2026-05-14" },
  { title: "Migrate tasks template to a table", status: "Done", owner: "Rupert", points: 2, due: "2026-04-30" },
  { title: "Fix iframe blob base href resolution", status: "Done", owner: "Rupert", points: 1, due: "2026-04-30" },
  { title: "v0.1 spec — runtime manifest", status: "Shipped", owner: "Rupert", points: 3, due: "2026-04-28" },
  { title: "Drag controller refactor", status: "Shipped", owner: "Stephen", points: 5, due: "2026-04-22" },
  { title: "Markdown view scroll bridge", status: "Shipped", owner: "Josh", points: 2, due: "2026-04-18" },
];

// RevoGrid's column definition for one of ours. Numbers are right-aligned,
// sort numerically and are stored as numbers.
const gridColumn = (column: Column) => ({
  prop: column.prop,
  name: column.name,
  size: column.size,
  sortable: true,
  filter: true,
  ...(column.type === "number"
    ? {
        cellCompare: (prop: string, a: Row, b: Row) => Number(a[prop] ?? 0) - Number(b[prop] ?? 0),
        cellProperties: () => ({ class: { "cell-number": true } }),
        columnProperties: () => ({ class: { "cell-number": true } }),
      }
    : {}),
});

interface Args {
  theme: "light" | "dark";
  // Every two seconds, change one cell as an agent writing to the store would.
  liveUpdates: boolean;
}

let liveTimer: ReturnType<typeof setInterval> | undefined;

const toolbarButton = (label: string, action: string) =>
  `<button variant="ghost" target data-action="${action}">${label}</button>`;

const render = ({ theme, liveUpdates }: Args) => {
  clearInterval(liveTimer);
  document.documentElement.dataset.theme = theme;

  const columns = startColumns.map((column) => ({ ...column }));
  const rows = startRows.map((row) => ({ ...row }));

  const page = document.createElement("div");
  page.className = "table-page";
  page.innerHTML = `
    <div class="table-toolbar">
      ${toolbarButton("Add row", "add-row")}
      ${toolbarButton("Add column", "add-column")}
      ${toolbarButton("Delete row", "delete-row")}
      <span class="table-count"></span>
    </div>`;

  const grid = document.createElement("revo-grid") as HTMLElement & Record<string, any>;
  grid.theme = theme === "dark" ? "darkCompact" : "compact";
  grid.rowHeaders = true;
  grid.rowSize = 34;
  grid.resize = true;
  grid.range = true;
  grid.filter = true;
  grid.canMoveColumns = true;
  page.append(grid);

  const count = page.querySelector(".table-count") as HTMLElement;
  const show = () => {
    grid.columns = columns.map(gridColumn);
    grid.source = [...rows];
    count.textContent = `${rows.length} rows`;
  };
  show();

  // Typed cells: a number column keeps numbers.
  grid.addEventListener("beforeedit", (event: any) => {
    const column = columns.find((c) => c.prop === event.detail.prop);
    if (column?.type === "number") {
      const value = Number(event.detail.val);
      event.detail.val = Number.isFinite(value) ? value : event.detail.model[column.prop];
    }
  });

  // A click on a column name sorts after a short wait; a double-click renames
  // the column instead.
  let pendingSort: ReturnType<typeof setTimeout> | undefined;
  const order = new Map<string, "asc" | "desc" | undefined>();
  grid.addEventListener("beforesorting", (event: Event) => event.preventDefault());
  grid.addEventListener("headerclick", (event: any) => {
    clearTimeout(pendingSort);
    const prop = event.detail.prop as string;
    pendingSort = setTimeout(() => {
      const next = order.get(prop) === "asc" ? "desc" : order.get(prop) === "desc" ? undefined : "asc";
      order.clear();
      order.set(prop, next);
      void grid.updateColumnSorting({ prop, cellCompare: gridColumn(columns.find((c) => c.prop === prop)!).cellCompare }, next, false);
    }, 250);
  });
  grid.addEventListener("dblclick", (event: MouseEvent) => {
    const header = (event.target as Element).closest("[data-rgcol]");
    if (!header || !header.closest("revogr-header")) return;
    clearTimeout(pendingSort);
    const column = columns[Number(header.getAttribute("data-rgcol"))];
    if (!column) return;
    const box = header.getBoundingClientRect();
    const input = document.createElement("input");
    input.className = "column-rename";
    input.value = column.name;
    Object.assign(input.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    document.body.append(input);
    input.select();
    let finished = false;
    const finish = (save: boolean) => {
      if (finished) return;
      finished = true;
      if (save && input.value.trim()) column.name = input.value.trim();
      input.remove();
      show();
    };
    input.addEventListener("keydown", (key) => {
      if (key.key === "Enter") finish(true);
      if (key.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true), { once: true });
  });

  page.querySelector(".table-toolbar")!.addEventListener("click", async (event) => {
    const action = (event.target as Element).closest("button")?.dataset.action;
    if (action === "add-row") {
      rows.push(Object.fromEntries(columns.map((c) => [c.prop, c.type === "number" ? 0 : ""])));
      // A new row goes at the end, so leave any sort first.
      order.clear();
      await grid.clearSorting();
      show();
      // Wait for the grid to draw the new row before editing it.
      await new Promise((resolve) => grid.addEventListener("aftergridrender", resolve, { once: true }));
      await grid.scrollToRow(rows.length - 1);
      await grid.setCellEdit(rows.length - 1, columns[0].prop);
    }
    if (action === "add-column") {
      const prop = `column${columns.length + 1}`;
      columns.push({ prop, name: `Column ${columns.length + 1}`, type: "text", size: 140 });
      show();
    }
    if (action === "delete-row") {
      const focused = await grid.getFocused();
      if (focused) {
        rows.splice(focused.cell.y, 1);
        show();
      }
    }
  });

  if (liveUpdates) {
    const statuses = ["To do", "In progress", "Blocked", "Done"];
    const statusColumn = columns.findIndex((column) => column.prop === "status");
    let tick = 0;
    liveTimer = setInterval(() => {
      tick += 1;
      // One cell at a time, so a cell being edited elsewhere is left alone.
      void grid.setDataAt({ row: tick % rows.length, col: statusColumn, val: statuses[tick % statuses.length], rowType: "rgRow", colType: "rgCol" });
    }, 2000);
  }

  return page;
};

export default {
  title: "Experiments/Table/RevoGrid",
  parameters: { layout: "fullscreen" },
  render,
  args: { theme: "light", liveUpdates: false },
};

export const Table = {};

export const Dark = { args: { theme: "dark" } };

export const LiveUpdates = { name: "Live updates", args: { liveUpdates: true } };

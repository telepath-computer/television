// A Table template prototype on RevoGrid: editable cells, sortable columns,
// and Television's tokens mapped onto RevoGrid's custom properties. The rows
// stand in for the artifact's store; nothing is saved.

import "../../../specs/ui/foundation/index.css";
import "./revogrid.css";
import { defineCustomElements } from "@revolist/revogrid/loader";

defineCustomElements();

type Row = { title: string; status: string; owner: string; area: string; due: string };

const rows: Row[] = [
  { title: "Wire /canonical/v2/ stylesheet", status: "In progress", owner: "Rupert", area: "skills", due: "Apr 30" },
  { title: "Land artifacts skill", status: "In progress", owner: "Rupert", area: "skills", due: "Apr 30" },
  { title: "Hermes ACP regression suite", status: "In progress", owner: "Josh", area: "acp", due: "May 5" },
  { title: "Promote canonical bundle to production server", status: "To do", owner: "Stephen", area: "server", due: "May 7" },
  { title: "CLI distribution for skills", status: "To do", owner: "Josh", area: "cli", due: "May 12" },
  { title: "Token curation pass for v2", status: "To do", owner: "Stephen", area: "design", due: "May 21" },
  { title: "Bundle-on-export for downloadable artifacts", status: "Blocked", owner: "Rupert", area: "spec", due: "May 14" },
  { title: "Migrate tasks template to a table", status: "Done", owner: "Rupert", area: "skills", due: "Apr 30" },
  { title: "Fix iframe blob base href resolution", status: "Done", owner: "Rupert", area: "web", due: "Apr 30" },
  { title: "v0.1 spec — runtime manifest", status: "Shipped", owner: "Rupert", area: "spec", due: "Apr 28" },
  { title: "Drag controller refactor", status: "Shipped", owner: "Stephen", area: "layout", due: "Apr 22" },
  { title: "Markdown view scroll bridge", status: "Shipped", owner: "Josh", area: "views", due: "Apr 18" },
];

const columns = [
  { prop: "title", name: "Title", size: 360, sortable: true },
  { prop: "status", name: "Status", size: 140, sortable: true },
  { prop: "owner", name: "Owner", size: 140, sortable: true },
  { prop: "area", name: "Area", size: 120, sortable: true },
  { prop: "due", name: "Due", size: 100, sortable: true },
];

interface Args {
  theme: "light" | "dark";
  // Every two seconds, change one cell as an agent writing to the store would.
  liveUpdates: boolean;
}

let liveTimer: ReturnType<typeof setInterval> | undefined;

const render = ({ theme, liveUpdates }: Args) => {
  clearInterval(liveTimer);
  document.documentElement.dataset.theme = theme;

  const page = document.createElement("div");
  page.className = "table-page";
  page.innerHTML = `
    <header>
      <h1>Tasks</h1>
      <p class="lede">12 in-flight items across the Television workstream. Double-click a cell to edit it; click a column heading to sort.</p>
    </header>`;

  const grid = document.createElement("revo-grid") as HTMLElement & Record<string, unknown>;
  grid.columns = columns;
  grid.source = rows.map((row) => ({ ...row }));
  grid.theme = theme === "dark" ? "darkCompact" : "compact";
  grid.rowSize = 36;
  grid.resize = true;
  grid.range = true;
  page.append(grid);

  if (liveUpdates) {
    const statuses = ["To do", "In progress", "Blocked", "Done"];
    let tick = 0;
    const statusColumn = columns.findIndex((column) => column.prop === "status");
    const setDataAt = grid.setDataAt as (cell: { row: number; col: number; val: string; rowType: "rgRow"; colType: "rgCol" }) => Promise<void>;
    liveTimer = setInterval(() => {
      tick += 1;
      // One cell at a time, so a cell being edited elsewhere is left alone.
      void setDataAt({ row: tick % rows.length, col: statusColumn, val: statuses[tick % statuses.length], rowType: "rgRow", colType: "rgCol" });
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

export const Editable = {};

export const Dark = { args: { theme: "dark" } };

export const LiveUpdates = { name: "Live updates", args: { liveUpdates: true } };

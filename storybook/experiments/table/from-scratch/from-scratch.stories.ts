// Comparable sample tables for a framework-free, event-driven table grid.
// Each story receives a fresh in-memory copy; no browser storage is used.

import "../../../../specs/ui/foundation/index.css";
import "../../../../packages/canonical/canonical-components.ts";
import "./table-grid.css";
import "./table-grid.ts";
import { copyTable, empty, expenses, largeTable, projectTracker, wideTable, type TableData } from "../data.ts";
import type { TableGrid, GridOptions } from "./table-grid.ts";

interface Args {
  theme: "light" | "dark";
  readOnly: boolean;
  rowHeight: number;
}

function story(table: TableData, args: Args, options: GridOptions = {}): HTMLElement {
  document.documentElement.dataset.theme = args.theme;
  const grid = document.createElement("table-grid") as TableGrid;
  grid.configure(copyTable(table), { readOnly: args.readOnly, rowHeight: args.rowHeight, ...options });
  return grid;
}

const defaultArgs: Args = { theme: "light", readOnly: false, rowHeight: 34 };

export default {
  title: "Experiments/Table/From scratch",
  parameters: { layout: "fullscreen" },
  args: defaultArgs,
  argTypes: {
    theme: { control: "inline-radio", options: ["light", "dark"] },
    readOnly: { control: "boolean" },
    rowHeight: { control: { type: "range", min: 28, max: 44, step: 2 } },
  },
};

/** All supported cell types in the regular light view. */
export const ProjectTracker = { name: "Project tracker", render: (args: Args) => story(projectTracker, args) };
/** The same table under Television's dark tokens. */
export const Dark = { name: "Dark", args: { theme: "dark" }, render: (args: Args) => story(projectTracker, args) };
/** Expense types with a configurable summary footer. */
export const Expenses = { name: "Expenses with totals", render: (args: Args) => story(expenses, args, { summary: true }) };
/** Status groups can be collapsed without modifying stored rows. */
export const Grouped = { name: "Grouped by status", render: (args: Args) => story(projectTracker, args, { groupBy: "status" }) };
/** View sort and filter coexist over the stored order. */
export const SortedFiltered = {
  name: "Sorted and filtered",
  render: (args: Args) => story(projectTracker, args, {
    sort: { columnId: "due", direction: "asc" },
    filter: { columnId: "status", value: "Done", exclude: true },
  }),
};
/** The first column stays visible during horizontal scrolling. */
export const Wide = { name: "Wide", render: (args: Args) => story(wideTable, args) };
/** A windowed rendering of a 2,000-row table. */
export const Large = { name: "2,000 rows", render: (args: Args) => story(largeTable(2000), args) };
/** An outside writer applies changes while a person can keep editing. */
export const LiveUpdates = {
  name: "Live updates",
  render: (args: Args) => {
    const grid = story(projectTracker, args) as TableGrid;
    requestAnimationFrame(() => {
      if (grid.isConnected) grid.startLiveUpdates();
    });
    return grid;
  },
};
/** A blank table invites its first row. */
export const Empty = { name: "New table", render: (args: Args) => story(empty, args) };
/** Selection, copying and view operations remain available. */
export const ReadOnly = { name: "Read-only", render: (args: Args) => story(projectTracker, args, { readOnly: true }) };
/** The Status header menu opens once Storybook mounts the grid. */
export const ColumnMenu = {
  name: "Column menu",
  render: (args: Args) => {
    const grid = story(projectTracker, args) as TableGrid;
    requestAnimationFrame(() => {
      if (grid.isConnected) grid.openColumnMenu("status");
    });
    return grid;
  },
};
/** The Status picker opens once Storybook mounts the grid. */
export const SelectEditor = {
  name: "Editing a select cell",
  render: (args: Args) => {
    const grid = story(projectTracker, args) as TableGrid;
    requestAnimationFrame(() => {
      if (grid.isConnected) grid.openCellEditor("task-1", "status");
    });
    return grid;
  },
};
/** Every locally emitted change is shown as plain JSON beside the grid. */
export const ChangeLog = {
  name: "Change events",
  render: (args: Args) => {
    const page = document.createElement("div");
    page.className = "tg-changelog-layout";
    const grid = story(projectTracker, args) as TableGrid;
    const aside = document.createElement("aside");
    aside.className = "tg-changelog";
    const heading = document.createElement("h2");
    heading.textContent = "Change events";
    const hint = document.createElement("p");
    hint.textContent = "Edit a cell or add a row. Each action is one JSON change.";
    const list = document.createElement("div");
    list.className = "tg-changelog-list";
    aside.append(heading, hint, list);
    grid.addEventListener("table-change", (event) => {
      const change = (event as CustomEvent).detail;
      const entry = document.createElement("div");
      entry.className = "tg-change-entry";
      const label = document.createElement("strong");
      label.textContent = change.type;
      const json = document.createElement("pre");
      json.textContent = JSON.stringify(change, null, 2);
      entry.append(label, json);
      list.prepend(entry);
    });
    page.append(grid, aside);
    requestAnimationFrame(() => {
      if (!grid.isConnected) return;
      grid.makeChange({ type: "cell", rowId: "task-1", columnId: "points", value: 5 });
      grid.makeChange({
        type: "row-insert",
        row: { id: crypto.randomUUID(), cells: { title: "Review artifact table" } },
        index: 1,
      });
      grid.makeChange({
        type: "column-update",
        columnId: "title",
        column: { ...projectTracker.columns[0], name: "Deliverable" },
      });
    });
    return page;
  },
};

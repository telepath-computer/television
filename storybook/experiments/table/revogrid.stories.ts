// RevoGrid experiment stories, using the same samples as the native table.
import "../../../specs/ui/foundation/index.css";
import "../../../packages/canonical/canonical-components.ts";
import "./revogrid.css";
import { defineCustomElements } from "@revolist/revogrid/loader";
import { projectTracker, expenses, empty, wideTable, largeTable } from "./data";
import { createTable, type TableArgs } from "./revogrid/table";

defineCustomElements();
const render = (args: TableArgs & { rowCount?: number }) => {
  const firstRenderStartedAt = performance.now();
  return createTable(args.rowCount
    ? { ...args, table: largeTable(args.rowCount), firstRenderStartedAt }
    : { ...args, firstRenderStartedAt });
};

export default {
  title: "Experiments/Table/RevoGrid",
  parameters: { layout: "fullscreen" },
  render,
  args: { theme: "light", table: projectTracker },
};

export const ProjectTracker = { name: "Project tracker" };
export const Dark = { name: "Dark", args: { theme: "dark" } };
export const Expenses = { name: "Expenses with totals", args: { table: expenses, summary: true } };
export const Grouped = { name: "Grouped by status", args: { grouped: true } };
export const SortedFiltered = { name: "Sorted and filtered", args: { sortedFiltered: true } };
export const Wide = { name: "Wide", args: { table: wideTable } };
export const Large = { name: "2,000 rows", args: { rowCount: 2000 } };
export const Huge = { name: "50,000 rows", args: { rowCount: 50000 } };
export const LiveUpdates = { name: "Live updates", args: { liveUpdates: true } };
export const Empty = { name: "New table", args: { table: empty } };
export const ReadOnly = { name: "Read-only", args: { readOnly: true } };
export const ColumnMenu = { name: "Column menu", args: { openColumnMenu: true } };
export const SelectEditor = { name: "Editing a select cell", args: { openSelectEditor: true } };
export const ChangeLog = { name: "Change events", args: { changeLog: true } };

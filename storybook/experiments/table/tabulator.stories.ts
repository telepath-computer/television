// Tabulator experiment: keep each story's state in memory and use the library
// for table interactions; the adapter only maps the shared sample shape.
import "../../../specs/ui/foundation/index.css";
import "tabulator-tables/dist/css/tabulator.css";
import "./tabulator/table.css";
import { projectTracker, expenses, empty, largeTable } from "./data";
import { createTable, type TableArgs } from "./tabulator/table";

const render = (args: TableArgs & { rowCount?: number }) =>
  createTable({ ...args, table: args.rowCount ? largeTable(args.rowCount) : args.table });

export default {
  title: "Experiments/Table/Tabulator",
  parameters: { layout: "fullscreen" },
  render,
  args: { theme: "light", table: projectTracker },
};

export const ProjectTracker = { name: "Project tracker" };
export const Dark = { name: "Dark", args: { theme: "dark" } };
export const Expenses = { name: "Expenses with totals", args: { table: expenses, summary: true } };
export const SortedFiltered = { name: "Sorted and filtered", args: { sortedFiltered: true } };
export const Large = { name: "2,000 rows", args: { rowCount: 2000 } };
export const LiveUpdates = { name: "Live updates", args: { liveUpdates: true } };
export const Empty = { name: "New table", args: { table: empty } };
export const ReadOnly = { name: "Read-only", args: { readOnly: true } };

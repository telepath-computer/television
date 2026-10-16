// Community-only AG Grid experiment against the same sample tables as the
// other Table stories. Each render receives a copy of its sample data.
import "../../../specs/ui/foundation/index.css";
import { projectTracker, expenses, empty, largeTable } from "./data";
import { createTable, type TableArgs } from "./ag-grid/table";

export default {
  title: "Experiments/Table/AG Grid Community",
  parameters: { layout: "fullscreen" },
  render: (args: TableArgs) => createTable(args),
  args: { theme: "light", table: projectTracker },
};

export const ProjectTracker = { name: "Project tracker" };
export const Dark = { name: "Dark", args: { theme: "dark" } };
export const Expenses = { name: "Expenses with totals", args: { table: expenses, showTotalsFinding: true } };
export const SortedFiltered = { name: "Sorted and filtered", args: { sortedFiltered: true } };
export const Large = { name: "2,000 rows", args: { table: largeTable(2000) } };
export const LiveUpdates = { name: "Live updates", args: { liveUpdates: true } };
export const Empty = { name: "New table", args: { table: empty } };
export const ReadOnly = { name: "Read-only", args: { readOnly: true } };

// AG Grid Community table experiment. The grid owns editing, sorting, filtering,
// selection and cell undo; this adapter only maps the shared sample's cell types
// and supplies the structural actions that Community does not provide.
import {
  AllCommunityModule,
  ModuleRegistry,
  createGrid,
  themeQuartz,
  type ColDef,
  type GridApi,
  type GridOptions,
} from "ag-grid-community";
import type { CellValue, Column, Row, SelectOption, TableData } from "../data";
import { copyTable } from "../data";
import "./table.css";

ModuleRegistry.registerModules([AllCommunityModule]);

/** The story's only controls over the grid. */
export interface TableArgs {
  table: TableData;
  theme?: "light" | "dark";
  readOnly?: boolean;
  sortedFiltered?: boolean;
  liveUpdates?: boolean;
  showTotalsFinding?: boolean;
}

const theme = themeQuartz.withParams({
  backgroundColor: "var(--color-surface)",
  foregroundColor: "var(--color-text)",
  accentColor: "var(--color-primary)",
  borderColor: "var(--color-border)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--text-md)",
  headerBackgroundColor: "var(--color-surface-muted)",
  headerTextColor: "var(--color-text-muted)",
  rowHoverColor: "var(--tint-primary)",
  selectedRowBackgroundColor: "var(--tint-primary)",
  inputBackgroundColor: "var(--control-background)",
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  rowBorder: { color: "var(--color-border)" },
  headerColumnBorder: { color: "var(--color-border)" },
  cellHorizontalPadding: "var(--space-12)",
  rowHeight: 36,
});

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const currencyFormats = new Map<string, Intl.NumberFormat>();

function formatCurrency(value: number, currency: string): string {
  let format = currencyFormats.get(currency);
  if (!format) {
    format = new Intl.NumberFormat("en-US", { style: "currency", currency });
    currencyFormats.set(currency, format);
  }
  return format.format(value);
}

function displayValue(value: CellValue | undefined, column: Column): string {
  if (value == null || value === "") return "";
  if (column.type === "select") return column.options?.find((item) => item.id === value)?.label ?? String(value);
  if (column.type === "multiselect") return (Array.isArray(value) ? value : []).map((id) => column.options?.find((item) => item.id === id)?.label ?? id).join(", ");
  if (column.type === "number" && typeof value === "number") return numberFormat.format(value);
  if (column.type === "currency" && typeof value === "number") return formatCurrency(value, column.currency ?? "USD");
  if (column.type === "date" && typeof value === "string") {
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
  }
  return String(value);
}

function pill(option: SelectOption): HTMLElement {
  const element = document.createElement("span");
  element.className = `ag-table-pill ag-table-pill-${option.color}`;
  element.textContent = option.label;
  return element;
}

function pillRenderer(value: CellValue | undefined, column: Column): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = "ag-table-pills";
  const ids = Array.isArray(value) ? value : value == null ? [] : [String(value)];
  for (const id of ids) {
    const option = column.options?.find((item) => item.id === id);
    if (option) wrapper.append(pill(option));
  }
  return wrapper;
}

function columnDef(column: Column, readOnly: boolean): ColDef<Row, CellValue> {
  const definition: ColDef<Row, CellValue> = {
    colId: column.id,
    field: `cells.${column.id}`,
    headerName: column.name,
    initialWidth: column.width,
    minWidth: 82,
    pinned: column.primary ? "left" : undefined,
    lockPinned: Boolean(column.primary),
    editable: !readOnly && column.type !== "multiselect",
    sortable: true,
    filter: "agTextColumnFilter",
    floatingFilter: true,
    resizable: true,
    valueFormatter: ({ value }) => displayValue(value, column),
  };

  if (column.type === "number" || column.type === "currency") {
    definition.cellDataType = "number";
    definition.cellEditor = "agNumberCellEditor";
    definition.filter = "agNumberColumnFilter";
    definition.valueParser = ({ newValue }) => newValue === "" || newValue == null ? null : Number(newValue);
  } else if (column.type === "date") {
    definition.cellDataType = "dateString";
    definition.cellEditor = "agDateStringCellEditor";
    definition.filter = "agDateColumnFilter";
  } else if (column.type === "checkbox") {
    definition.cellDataType = "boolean";
    definition.cellRenderer = "agCheckboxCellRenderer";
    definition.cellEditor = "agCheckboxCellEditor";
    definition.filter = false;
  } else if (column.type === "select") {
    definition.cellEditor = "agSelectCellEditor";
    definition.cellEditorParams = { values: column.options?.map((option) => option.id) ?? [] };
    definition.filterValueGetter = ({ data }) => displayValue(data?.cells[column.id], column);
    definition.cellRenderer = ({ value }: { value: CellValue | undefined }) => pillRenderer(value, column);
  } else if (column.type === "multiselect") {
    // Rich multi-select editing is Enterprise-only. Show the sample's values
    // but leave editing unavailable instead of building a substitute.
    definition.filterValueGetter = ({ data }) => displayValue(data?.cells[column.id], column);
    definition.cellRenderer = ({ value }: { value: CellValue | undefined }) => pillRenderer(value, column);
  }

  return definition;
}

function button(label: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", action);
  return element;
}

/** Mount one independent, disposable story instance. */
export function createTable(args: TableArgs): HTMLElement {
  const table = copyTable(args.table);
  document.documentElement.dataset.theme = args.theme ?? "light";
  const page = document.createElement("div");
  page.className = "ag-table-page";
  const toolbar = document.createElement("div");
  toolbar.className = "ag-table-toolbar";
  const grid = document.createElement("div");
  grid.className = "ag-table-grid";
  page.append(toolbar, grid);

  let nextId = 0;
  let api: GridApi<Row>;
  const options: GridOptions<Row> = {
    theme,
    headerHeight: 38,
    floatingFiltersHeight: 34,
    rowData: table.rows,
    columnDefs: table.columns.map((column) => columnDef(column, Boolean(args.readOnly))),
    defaultColDef: { suppressHeaderMenuButton: true },
    getRowId: ({ data }) => data.id,
    rowSelection: args.readOnly ? undefined : { mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: true },
    undoRedoCellEditing: !args.readOnly,
    undoRedoCellEditingLimit: 50,
    singleClickEdit: false,
    stopEditingWhenCellsLoseFocus: true,
    enableCellTextSelection: true,
    animateRows: false,
    ensureDomOrder: true,
    maintainColumnOrder: true,
    onGridReady: ({ api: readyApi }) => {
      if (!args.sortedFiltered) return;
      readyApi.applyColumnState({ state: [{ colId: "points", sort: "desc" }] });
      readyApi.setFilterModel({ status: { filterType: "text", type: "equals", filter: "done" } });
    },
  };
  api = createGrid(grid, options);

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search rows";
  search.setAttribute("aria-label", "Search rows");
  search.addEventListener("input", () => api.setGridOption("quickFilterText", search.value));
  toolbar.append(search);

  if (!args.readOnly) {
    toolbar.append(button("Add row", () => {
      // Reveal the new row even when the current view filters it out.
      search.value = "";
      api.setGridOption("quickFilterText", "");
      api.setFilterModel(null);
      const row: Row = { id: `ag-row-${++nextId}`, cells: {} };
      table.rows.push(row);
      api.applyTransaction({ add: [row] });
      const index = api.getRowNode(row.id)?.rowIndex;
      if (index == null) return;
      api.ensureIndexVisible(index);
      api.setFocusedCell(index, table.columns[0].id);
      api.startEditingCell({ rowIndex: index, colKey: table.columns[0].id });
    }));
    toolbar.append(button("Delete row", () => {
      const focused = api.getFocusedCell();
      const selected = api.getSelectedRows();
      const rows = selected.length ? selected : focused ? [api.getDisplayedRowAtIndex(focused.rowIndex)?.data].filter((row): row is Row => Boolean(row)) : [];
      if (!rows.length) return;
      const ids = new Set(rows.map((row) => row.id));
      table.rows = table.rows.filter((row) => !ids.has(row.id));
      api.applyTransaction({ remove: rows });
    }));
    toolbar.append(button("Add column", () => {
      const name = window.prompt("Column name", "New column")?.trim();
      if (!name) return;
      const column: Column = { id: `ag-column-${++nextId}`, name, type: "text", width: 180 };
      table.columns.push(column);
      api.setGridOption("columnDefs", table.columns.map((item) => columnDef(item, false)));
    }));
    toolbar.append(button("Rename column", () => {
      const column = table.columns.find((item) => item.id === api.getFocusedCell()?.column.getColId());
      if (!column) return;
      const name = window.prompt("Column name", column.name)?.trim();
      if (!name) return;
      column.name = name;
      api.setGridOption("columnDefs", table.columns.map((item) => columnDef(item, false)));
    }));
    toolbar.append(button("Delete column", () => {
      const id = api.getFocusedCell()?.column.getColId();
      if (!id || table.columns.length === 1 || table.columns.find((item) => item.id === id)?.primary) return;
      table.columns = table.columns.filter((item) => item.id !== id);
      for (const row of table.rows) delete row.cells[id];
      api.setGridOption("columnDefs", table.columns.map((item) => columnDef(item, false)));
    }));
    toolbar.append(button("Undo", () => api.undoCellEditing()));
    toolbar.append(button("Redo", () => api.redoCellEditing()));
  }

  if (args.showTotalsFinding) {
    const finding = document.createElement("span");
    finding.className = "ag-table-finding";
    finding.textContent = "Column totals require Enterprise aggregation.";
    toolbar.append(finding);
  }

  let liveTimer: ReturnType<typeof setInterval> | undefined;
  if (args.liveUpdates) {
    let tick = 0;
    const statuses = ["todo", "progress", "review", "blocked", "done"];
    liveTimer = setInterval(() => {
      if (!page.isConnected || !table.rows.length) return;
      const editingRow = api.getEditingCells().find((cell) => cell.column?.getColId() === "status")?.rowIndex;
      for (let offset = 0; offset < table.rows.length; offset++) {
        const row = table.rows[(tick * 7 + offset) % table.rows.length];
        const node = api.getRowNode(row.id);
        if (!node || node.rowIndex === editingRow) continue;
        const nextStatus = statuses[(statuses.indexOf(String(row.cells.status)) + 1) % statuses.length];
        // The "data" source updates one committed value without closing a
        // different active editor on this row.
        node.setDataValue("status", nextStatus, "data");
        break;
      }
      tick++;
    }, 2000);
  }

  // Storybook removes rendered nodes without a teardown callback. Release the
  // grid and interval when its host leaves the document.
  const observer = new MutationObserver(() => {
    if (page.isConnected) return;
    if (liveTimer) clearInterval(liveTimer);
    api.destroy();
    observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return page;
}

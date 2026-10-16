// The only adapter between the shared Table samples and Tabulator. Tabulator
// owns editing, sorting, filtering, menus, history, clipboard and selection.
import { TabulatorFull as Tabulator, type CellComponent, type ColumnComponent, type ColumnDefinition, type RowComponent } from "tabulator-tables";
import { copyTable, type Column, type ColumnType, type SelectOption, type TableData } from "../data";

/** Story settings for one in-memory Tabulator instance. */
export interface TableArgs {
  theme: "light" | "dark";
  table: TableData;
  readOnly?: boolean;
  sortedFiltered?: boolean;
  summary?: boolean;
  liveUpdates?: boolean;
}

let nextId = 0;
const makeId = (prefix: string) => `${prefix}-${Date.now()}-${++nextId}`;

function pill(option: SelectOption): HTMLElement {
  const element = document.createElement("span");
  element.className = `tv-tabulator-pill tv-tabulator-pill-${option.color}`;
  element.textContent = option.label;
  return element;
}

function optionFormatter(options: SelectOption[], multiple: boolean) {
  const byId = new Map(options.map((option) => [option.id, option]));
  return (cell: CellComponent): HTMLElement => {
    const content = document.createElement("span");
    content.className = "tv-tabulator-pills";
    const value = cell.getValue() as string | string[] | null;
    const ids: (string | null)[] = multiple ? (Array.isArray(value) ? value : []) : [typeof value === "string" ? value : null];
    for (const id of ids) {
      const option = id && byId.get(id);
      if (option) content.append(pill(option));
    }
    return content;
  };
}

function personFormatter(cell: CellComponent): HTMLElement {
  const name = String(cell.getValue() ?? "");
  const content = document.createElement("span");
  content.className = "tv-tabulator-person";
  if (name) {
    const avatar = document.createElement("span");
    avatar.className = "tv-tabulator-avatar";
    avatar.textContent = name.slice(0, 1).toUpperCase();
    content.append(avatar, document.createTextNode(name));
  }
  return content;
}

// Tabulator's range paste supplies strings, including for numeric and Boolean cells.
function typedClipboard(value: unknown, column: Column): unknown {
  if (value === "") return null;
  if (column.type === "number" || column.type === "currency") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (column.type === "checkbox") return value === true || value === "true" || value === "1";
  return value;
}

// The native link formatter trusts href values, so constrain their schemes.
function safeUrl(cell: CellComponent): string {
  try {
    const url = new URL(String(cell.getValue() ?? ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "about:blank";
  } catch {
    return "about:blank";
  }
}

function columnDefinition(column: Column, getTable: () => Tabulator, readOnly: boolean, summary: boolean): ColumnDefinition {
  const definition: ColumnDefinition = {
    title: column.name,
    field: column.id,
    width: column.width,
    frozen: Boolean(column.primary),
    editableTitle: !readOnly,
    headerFilter: "input",
    headerFilterPlaceholder: "Filter…",
    editor: readOnly ? undefined : "input",
    mutatorClipboard: (value) => typedClipboard(value, column),
  };

  if (column.type === "number" || column.type === "currency") {
    definition.editor = readOnly ? undefined : "number";
    definition.sorter = "number";
    definition.hozAlign = "right";
    if (column.type === "currency") {
      definition.formatter = "money";
      definition.formatterParams = { symbol: column.currency === "USD" ? "$" : "", precision: 2 };
      if (summary) {
        definition.bottomCalc = "sum";
        definition.bottomCalcFormatter = "money";
        definition.bottomCalcFormatterParams = definition.formatterParams;
      }
    }
  } else if (column.type === "date") {
    definition.editor = readOnly ? undefined : "date";
    definition.sorter = "string";
  } else if (column.type === "checkbox") {
    definition.editor = readOnly ? undefined : "tickCross";
    definition.formatter = "tickCross";
    // With double-click editing elsewhere, this gives Boolean cells a one-click toggle.
    if (!readOnly) definition.cellClick = (_event, cell) => cell.setValue(!Boolean(cell.getValue()));
    definition.hozAlign = "center";
    definition.headerFilter = "tickCross";
    definition.headerFilterEmptyCheck = (value) => value === null;
  } else if (column.type === "select" || column.type === "multiselect") {
    const options = column.options ?? [];
    definition.editor = readOnly ? undefined : "list";
    definition.editorParams = {
      values: options.map((option) => ({ label: option.label, value: option.id })),
      multiselect: column.type === "multiselect",
      clearable: true,
    };
    definition.formatter = optionFormatter(options, column.type === "multiselect");
    if (column.type === "select") {
      definition.headerFilter = "list";
      definition.headerFilterParams = { values: { "": "All", ...Object.fromEntries(options.map((option) => [option.id, option.label])) } };
    } else definition.headerFilter = "input";
  } else if (column.type === "person") {
    definition.formatter = personFormatter;
  } else if (column.type === "url") {
    definition.formatter = "link";
    definition.formatterParams = { target: "_blank", url: safeUrl };
  }

  if (!readOnly) definition.headerMenu = [
    { label: "Add column left", action: (_event, target) => addColumn(getTable(), target, true) },
    { label: "Add column right", action: (_event, target) => addColumn(getTable(), target, false) },
    { separator: true },
    { label: "Delete column", disabled: Boolean(column.primary), action: (_event, target) => void getTable().deleteColumn(target) },
  ];
  return definition;
}

function addColumn(table: Tabulator, beside?: ColumnComponent, before = false): void {
  const name = window.prompt("Column name", "New column")?.trim();
  if (!name) return;
  const proposed = window.prompt("Type: text, number, currency, date, checkbox, select, multiselect, person, url", "text")?.trim().toLowerCase();
  const types: ColumnType[] = ["text", "number", "currency", "date", "checkbox", "select", "multiselect", "person", "url"];
  if (!proposed || !types.includes(proposed as ColumnType)) return;
  const column: Column = { id: makeId("column"), name, type: proposed as ColumnType, width: 160 };
  if (column.type === "currency") column.currency = "USD";
  if (column.type === "select" || column.type === "multiselect") {
    const labels = window.prompt("Options, separated by commas", "Option 1, Option 2")?.split(",").map((label) => label.trim()).filter(Boolean);
    if (!labels?.length) return;
    column.options = labels.map((label) => ({ id: makeId("option"), label, color: "neutral" }));
  }
  void table.addColumn(columnDefinition(column, () => table, false, false), before, beside);
}

function button(label: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", action);
  return element;
}

/** Create one full-page, in-memory Tabulator story. */
export function createTable(args: TableArgs): HTMLElement {
  const source = copyTable(args.table);
  document.documentElement.dataset.theme = args.theme;
  const page = document.createElement("div");
  page.className = "tv-tabulator-page";
  const toolbar = document.createElement("div");
  toolbar.className = "tv-tabulator-toolbar";
  const title = document.createElement("span");
  title.className = "tv-tabulator-title";
  title.textContent = source.title;
  const count = document.createElement("span");
  count.className = "tv-tabulator-count";
  count.textContent = `${source.rows.length.toLocaleString()} rows`;
  const controls = document.createElement("div");
  controls.className = "tv-tabulator-controls";
  toolbar.append(title, count, controls);
  const grid = document.createElement("div");
  grid.className = "tv-tabulator-grid";
  page.append(toolbar, grid);

  let table: Tabulator | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let editedCell: CellComponent | undefined;
  let updateIndex = 0;
  const observer = new MutationObserver(() => {
    if (page.isConnected) return;
    if (timer) clearInterval(timer);
    table?.destroy();
    observer.disconnect();
  });

  requestAnimationFrame(() => {
    if (!page.isConnected) return;
    const rows = source.rows.map((row) => ({ id: row.id, ...row.cells }));
    table = new Tabulator(grid, {
      height: "100%",
      data: rows,
      index: "id",
      // Tabulator warns about combining a frozen data column with cell ranges.
      // Keep both here to expose that library limitation in the experiment.
      columns: source.columns.map((column) => columnDefinition(column, () => table!, Boolean(args.readOnly), Boolean(args.summary))),
      rowHeader: { formatter: "rownum", width: 46, hozAlign: "center", headerSort: false },
      layout: "fitDataFill",
      placeholder: "No rows yet — use Add row",
      movableColumns: !args.readOnly,
      resizableColumnFit: true,
      editTriggerEvent: "dblclick",
      history: !args.readOnly,
      clipboard: !args.readOnly,
      clipboardCopyConfig: { columnHeaders: false, rowHeaders: false },
      clipboardCopyRowRange: "range",
      clipboardPasteParser: "range",
      clipboardPasteAction: "range",
      selectableRange: true,
      selectableRangeRows: true,
      popupContainer: page,
      // Persistence and remote-data options stay at their disabled defaults.
      initialSort: args.sortedFiltered ? [{ column: "due", dir: "asc" }] : [],
      initialFilter: args.sortedFiltered ? [{ field: "status", type: "!=", value: "done" }] : [],
      rowContextMenu: args.readOnly ? undefined : [
        { label: "Add row below", action: (_event, row: RowComponent) => void table!.addRow({ id: makeId("row") }, false, row) },
        { label: "Delete row", action: (_event, row: RowComponent) => void row.delete() },
      ],
    });
    table.on("cellEditing", (cell) => { editedCell = cell; });
    table.on("cellEdited", () => { editedCell = undefined; });
    table.on("cellEditCancelled", () => { editedCell = undefined; });
    const updateCount = () => { count.textContent = `${table!.getDataCount().toLocaleString()} rows`; };
    table.on("rowAdded", updateCount);
    table.on("rowDeleted", updateCount);
    if (!args.readOnly) {
      controls.append(
        button("Add row", () => void table!.addRow({ id: makeId("row") })),
        button("Add column", () => addColumn(table!)),
        button("Undo", () => table!.undo()),
        button("Redo", () => table!.redo()),
      );
    }
    if (args.liveUpdates) timer = setInterval(() => {
      const row = table!.getRows()[updateIndex++ % table!.getRows().length];
      const editing = editedCell;
      if (!row || (editing && editing.getRow().getIndex() === row.getIndex() && editing.getField() === "points")) return;
      const points = Number(row.getData().points ?? 0);
      void table!.updateData([{ id: row.getIndex(), points: points % 8 + 1 }]);
    }, 2000);
    observer.observe(document.body, { childList: true, subtree: true });
  });
  return page;
}

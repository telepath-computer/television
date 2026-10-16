// Storybook table controller. RevoGrid owns the viewport, focus, range and
// keyboard navigation; this layer owns store-shaped edits and app chrome.

import type { CellValue, Column, ColumnType, TableData, Row } from "../data";
import type { ColumnRegular, ColumnDataSchemaModel } from "@revolist/revogrid";
import { displayValue, gridColumn, rowHeader, type GridRow } from "./cells";
import { inputEditor, pillEditor } from "./editors";
import { fieldIcon } from "./field-icons";
import { convertValue, newId, TableModel, type TableChange } from "./model";

export interface TableArgs {
  theme: "light" | "dark";
  table: TableData;
  readOnly?: boolean;
  grouped?: boolean;
  sortedFiltered?: boolean;
  summary?: boolean;
  liveUpdates?: boolean;
  changeLog?: boolean;
  openColumnMenu?: boolean;
  openSelectEditor?: boolean;
  rowHeight?: number;
  firstRenderStartedAt?: number;
}

type Grid = HTMLRevoGridElement;
type Aggregate = "sum" | "average" | "min" | "max" | "filled" | "empty" | "checked" | "checkedPercent";
type MenuAction = { label: string; run: () => void; icon?: string; checked?: boolean; danger?: boolean; separator?: boolean };

function icon(name: string): HTMLElement {
  const element = document.createElement("tv-icon");
  element.setAttribute("name", name);
  element.setAttribute("size", "sm");
  return element;
}

function button(label: string, glyph: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.setAttribute("variant", "ghost");
  element.setAttribute("target", "");
  element.className = "rg-toolbar-button";
  element.append(icon(glyph), document.createTextNode(label));
  element.addEventListener("click", onClick);
  return element;
}

/** Build one self-cleaning, in-memory table experiment. */
export function createTable(args: TableArgs): HTMLElement {
  const controller = new TableController(args);
  return controller.page;
}

class TableController {
  readonly page = document.createElement("div");
  private grid = document.createElement("revo-grid") as Grid;
  private model: TableModel;
  private toolbar = document.createElement("div");
  private rowCount = document.createElement("span");
  private titleInput!: HTMLInputElement;
  private sortButton!: HTMLButtonElement;
  private filterButton!: HTMLButtonElement;
  private groupButton!: HTMLButtonElement;
  private search!: HTMLInputElement;
  private menu = document.createElement("tv-menu");
  private menuTrigger = document.createElement("button");
  private floatingPanel: HTMLElement | null = null;
  private panelListeners: AbortController | null = null;
  private editing: { rowId: string; columnId: string } | null = null;
  private focused: { rowId: string; columnId: string } | null = null;
  private sort: { columnId: string; order: "asc" | "desc" } | null = null;
  private filterNotDone = false;
  private groupBy: string | null = null;
  private aggregates = new Map<string, Aggregate>();
  private searchQuery = "";
  private liveTimer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private cleanupObserver: MutationObserver;
  private changePanel: HTMLElement | null = null;
  private rowById = new Map<string, Row>();
  private viewRows: Row[] = [];
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private initialFrame?: number;
  private firstRenderFrame?: number;
  private keyboardController = new AbortController();

  constructor(private args: TableArgs) {
    this.model = new TableModel(args.table);
    this.model.rowHeight = args.rowHeight ?? 34;
    this.filterNotDone = Boolean(args.sortedFiltered);
    this.groupBy = args.grouped ? "status" : null;
    if (args.sortedFiltered) this.sort = { columnId: "due", order: "asc" };
    if (args.summary) {
      this.aggregates.set("amount", "sum");
      this.aggregates.set("reimbursed", "checked");
    }
    document.documentElement.dataset.theme = args.theme;
    this.page.className = `rg-table-page${args.changeLog ? " rg-with-log" : ""}`;
    this.page.setAttribute("aria-label", this.model.data.title);
    this.buildToolbar();
    this.configureGrid();
    this.page.append(this.toolbar, this.grid);
    if (args.changeLog) this.buildChangePanel();
    this.menuTrigger.id = `rg-menu-anchor-${newId()}`;
    this.menuTrigger.className = "rg-floating-anchor";
    this.menuTrigger.type = "button";
    this.menuTrigger.setAttribute("aria-label", "Table menu");
    this.menu.setAttribute("trigger", this.menuTrigger.id);
    this.page.append(this.menuTrigger, this.menu);
    this.model.onChange = (change) => this.onChange(change);
    this.gridEvents();
    document.addEventListener("keydown", (event) => this.keyDown(event), { capture: true, signal: this.keyboardController.signal });
    this.renderGrid();
    if (args.changeLog) this.seedChangeLog();
    if (args.firstRenderStartedAt !== undefined) {
      this.grid.addEventListener("aftergridrender", () => {
        const mark = () => {
          if (this.disposed || this.page.dataset.firstRenderMs) return;
          if (!this.page.isConnected || !this.grid.querySelector(".rg-cell-content, .rg-new-row")) { this.firstRenderFrame = requestAnimationFrame(mark); return; }
          this.page.dataset.firstRenderMs = String(Math.round(performance.now() - args.firstRenderStartedAt!));
        };
        this.firstRenderFrame = requestAnimationFrame(mark);
      }, { once: true });
    }
    this.updateToolbar();
    if (args.liveUpdates) this.startLiveUpdates();
    this.cleanupObserver = new MutationObserver(() => { if (!this.page.isConnected) this.dispose(); });
    queueMicrotask(() => this.cleanupObserver.observe(document.body, { childList: true, subtree: true }));
    if (args.openColumnMenu || args.openSelectEditor) this.openInitialStory();
  }

  private openInitialStory(attempt = 0) {
    this.initialFrame = requestAnimationFrame(() => {
      if (this.disposed || attempt > 60) return;
      const header = [...this.grid.querySelectorAll<HTMLElement>(".rg-header-content")]
        .find((item) => item.querySelector(".rg-header-name")?.textContent === "Status");
      const anchor = header?.querySelector<HTMLElement>(".rg-header-menu");
      const cell = this.grid.querySelector<HTMLElement>('.rg-cell-content[data-column-id="status"]');
      if (!this.page.isConnected || this.args.openColumnMenu && !anchor || this.args.openSelectEditor && !cell) { this.openInitialStory(attempt + 1); return; }
      if (this.args.openColumnMenu && anchor) this.openColumnMenu("status", anchor);
      if (this.args.openSelectEditor) void this.grid.setCellEdit(0, "status");
    });
  }

  private buildToolbar() {
    this.toolbar.className = "rg-table-toolbar";
    const titleGroup = document.createElement("div");
    titleGroup.className = "rg-title-group";
    const tableIcon = icon("table");
    tableIcon.className = "rg-table-mark";
    const title = document.createElement("input");
    this.titleInput = title;
    title.className = "rg-table-title";
    title.value = this.model.data.title;
    title.setAttribute("aria-label", "Table title");
    title.readOnly = Boolean(this.args.readOnly);
    title.addEventListener("change", () => {
      if (title.value.trim() && title.value.trim() !== this.model.data.title) this.model.apply({ type: "title.set", title: title.value.trim() });
    });
    this.rowCount.className = "rg-row-count";
    const titleStack = document.createElement("div");
    titleStack.className = "rg-title-stack";
    titleStack.append(title, this.rowCount);
    titleGroup.append(tableIcon, titleStack);
    const controls = document.createElement("div");
    controls.className = "rg-toolbar-controls";
    this.sortButton = button("Sort", "sort", () => this.openSortMenu(this.sortButton));
    this.filterButton = button("Filter", "filter", () => this.openFilterMenu(this.filterButton));
    this.groupButton = button("Group by", "tag", () => this.openGroupMenu(this.groupButton));
    const heightButton = button("Row height", "expand", () => this.openHeightMenu(heightButton));
    const searchWrap = document.createElement("label");
    searchWrap.className = "rg-search";
    searchWrap.append(icon("search"));
    this.search = document.createElement("input");
    this.search.type = "search";
    this.search.placeholder = "Search records";
    this.search.setAttribute("aria-label", "Search records");
    this.search.addEventListener("input", () => {
      this.searchQuery = this.search.value.trim().toLowerCase();
      this.renderGrid();
    });
    searchWrap.append(this.search);
    controls.append(this.sortButton, this.filterButton, this.groupButton, heightButton, searchWrap);
    this.toolbar.append(titleGroup, controls);
  }

  private configureGrid() {
    this.grid.className = "rg-experiment-grid";
    this.grid.theme = this.args.theme === "dark" ? "darkCompact" : "compact";
    this.grid.setAttribute("aria-label", `${this.model.data.title} data grid`);
    this.grid.accessible = true;
    this.grid.rowHeaders = rowHeader(this.actions(), !this.args.readOnly && !this.hasView(), Boolean(this.args.readOnly));
    this.grid.rowSize = this.model.rowHeight;
    this.grid.resizeRow = !this.args.readOnly && !this.hasView();
    this.grid.resize = !this.args.readOnly;
    this.grid.autoSizeColumn = !this.args.readOnly;
    this.grid.range = true;
    this.grid.useClipboard = true;
    this.grid.filter = true;
    this.grid.canMoveColumns = !this.args.readOnly;
    this.grid.readonly = Boolean(this.args.readOnly);
    this.grid.applyOnClose = true;
    this.grid.columnTypes = {
      text: { editor: "text" }, person: { editor: "person" }, url: { editor: "url" },
      number: { editor: "number" }, currency: { editor: "currency" }, date: { editor: "date" },
      select: { editor: "select" }, multiselect: { editor: "multiselect" }, checkbox: { readonly: true },
    };
    this.grid.editors = Object.fromEntries(["text", "person", "url", "number", "currency", "date", "select", "multiselect"].map((type) => [type, (data: ColumnDataSchemaModel, save: (value?: unknown, preventFocus?: boolean) => void, close: (focusNext?: boolean) => void) => {
      const column = this.model.data.columns.find((item) => item.id === data.prop)!;
      return type === "select" || type === "multiselect" ? new (pillEditor(column, this.model))(data, save, close) : new (inputEditor(column))(data, save);
    }]));
  }

  private gridEvents() {
    this.grid.addEventListener("beforecellfocus", (event: Event) => {
      const detail = (event as CustomEvent<{ model: GridRow; prop: string }>).detail;
      this.focused = detail.model?.__id ? { rowId: detail.model.__id, columnId: String(detail.prop) } : null;
    });
    this.grid.addEventListener("beforeeditstart", (event: Event) => {
      const detail = (event as CustomEvent<{ model: GridRow; prop: string }>).detail;
      if (detail.model?.__id) this.editing = { rowId: detail.model.__id, columnId: String(detail.prop) };
    });
    this.grid.addEventListener("beforeedit", (event: Event) => {
      const detail = (event as CustomEvent<{ model: GridRow; prop: string; val: unknown }>).detail;
      const column = this.model.data.columns.find((item) => item.id === detail.prop);
      if (column) detail.val = convertValue(detail.val, column);
    });
    this.grid.addEventListener("afteredit", (event: Event) => {
      const detail = (event as CustomEvent<{ model?: GridRow; prop?: string; val?: CellValue; data?: Record<number, GridRow>; models?: Record<number, GridRow> }>).detail;
      if (detail.model?.__id && detail.prop) this.commitCell(detail.model.__id, detail.prop, detail.val ?? null, false);
      else if (detail.data) {
        const cells: Extract<TableChange, { type: "cells.set" }>["cells"] = [];
        for (const [index, values] of Object.entries(detail.data)) {
          const original = detail.models?.[Number(index)];
          if (!original?.__id) continue;
          for (const [columnId, value] of Object.entries(values)) {
            const column = this.model.data.columns.find((item) => item.id === columnId);
            const row = this.model.data.rows.find((item) => item.id === original.__id);
            if (!column || !row) continue;
            const converted = convertValue(value, column);
            const previous = row.cells[columnId] ?? null;
            if (JSON.stringify(converted) !== JSON.stringify(previous)) cells.push({ rowId: row.id, columnId, value: converted, previous });
          }
        }
        if (cells.length) {
          this.model.apply({ type: "cells.set", cells });
          for (const cell of cells) void this.updateGridCell(cell.rowId, cell.columnId, cell.value);
        }
      }
      this.editing = null;
    });
    this.grid.addEventListener("roworderchanged", (event: Event) => {
      event.preventDefault();
      if (this.args.readOnly || this.hasView()) return;
      const { from, to } = (event as CustomEvent<{ from: number; to: number }>).detail;
      const row = this.model.data.rows[from];
      if (row) { this.model.apply({ type: "row.move", rowId: row.id, from, to }); this.renderGrid(); }
    });
    this.grid.addEventListener("aftercolumnresize", (event: Event) => {
      const resized = (event as CustomEvent<Record<number, ColumnRegular>>).detail;
      for (const column of Object.values(resized)) {
        const original = this.model.data.columns.find((item) => item.id === column.prop);
        if (original && column.size && original.width !== column.size) this.model.apply({ type: "column.resize", columnId: original.id, width: column.size });
      }
    });
    this.grid.addEventListener("columndragend", (event: Event) => {
      const detail = (event as CustomEvent<{ columns: ColumnRegular[]; type: string }>).detail;
      if (detail.type !== "rgCol") return;
      const ordered = detail.columns.map((column) => String(column.prop)).filter((id) => this.model.data.columns.some((item) => item.id === id && !item.primary));
      const current = this.model.data.columns.filter((column) => !column.primary).map((column) => column.id);
      if (ordered.length !== current.length || ordered.every((id, index) => id === current[index])) return;
      this.model.apply({ type: "column.reorder", columnIds: [...this.model.data.columns.filter((column) => column.primary).map((column) => column.id), ...ordered] });
      this.renderGrid();
    });
    this.grid.addEventListener("afterrowresize", (event: Event) => {
      const detail = (event as CustomEvent<{ rowType: string; indexes: number[]; size: number }>).detail;
      if (detail.rowType !== "rgRow") return;
      void this.grid.getVisibleSource().then((rows: GridRow[]) => {
        for (const index of detail.indexes) {
          const rowId = rows[index]?.__id;
          if (rowId) this.model.apply({ type: "row.resize", rowId, height: detail.size });
        }
      });
    });
    this.grid.addEventListener("headerclick", (event: Event) => {
      const column = (event as CustomEvent<ColumnRegular>).detail;
      if (column.prop === "__add") {
        const anchor = this.grid.querySelector<HTMLElement>(".rg-add-column");
        if (anchor) this.showColumnComposer(this.model.data.columns.length, anchor);
        return;
      }
      const selected = this.model.data.columns.find((item) => item.id === column.prop);
      if (!selected) return;
      const sameViewport = this.model.data.columns.filter((item) => Boolean(item.primary) === Boolean(selected.primary));
      const x = sameViewport.findIndex((item) => item.id === selected.id);
      if (x >= 0 && this.model.data.rows.length) void this.grid.setCellsFocus({ x, y: 0 }, { x, y: this.model.data.rows.length - 1 }, selected.primary ? "colPinStart" : "rgCol", "rgRow");
    });
    this.grid.addEventListener("headerdblclick", (event: Event) => {
      const { column, originalEvent } = (event as CustomEvent<{ column: ColumnRegular; originalEvent: MouseEvent }>).detail;
      const anchor = [...this.grid.querySelectorAll<HTMLElement>(".rg-header-name")]
        .find((item) => item.textContent === column.name);
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      if (originalEvent.clientX >= rect.left && originalEvent.clientX <= rect.right) requestAnimationFrame(() => this.renameColumn(String(column.prop), anchor));
    });
    this.grid.addEventListener("click", (event: MouseEvent) => {
      const path = event.composedPath();
      if (path.some((part) => part instanceof HTMLElement && (part.classList.contains("rg-row-menu") || part.classList.contains("rg-row-drag")))) return;
      const number = path.find((part) => part instanceof HTMLElement && part.classList.contains("rg-row-number"));
      if (number instanceof HTMLElement) {
        const index = Number(number.querySelector("span")?.textContent) - 1;
        if (index >= 0 && this.model.data.rows.length) void this.grid.setCellsFocus({ x: 0, y: index }, { x: this.model.data.columns.filter((column) => !column.primary).length - 1, y: index }, "rgCol", "rgRow");
      }
    });
    this.grid.addEventListener("contextmenu", (event: MouseEvent) => {
      const path = event.composedPath();
      const header = path.find((part) => part instanceof HTMLElement && part.classList.contains("rg-header-content"));
      if (header instanceof HTMLElement) {
        const name = header.querySelector(".rg-header-name")?.textContent;
        const column = this.model.data.columns.find((item) => item.name === name);
        if (column) { event.preventDefault(); this.openColumnMenu(column.id, header); }
      } else {
        const number = path.find((part) => part instanceof HTMLElement && part.classList.contains("rg-row-number"));
        if (number instanceof HTMLElement) {
          const rowId = number.dataset.rowId;
          if (rowId) { event.preventDefault(); this.openRowMenu(rowId, number); }
        } else {
          const cell = path.find((part) => part instanceof HTMLElement && part.dataset.rowId);
          if (cell instanceof HTMLElement && cell.dataset.rowId) { event.preventDefault(); this.openRowMenu(cell.dataset.rowId, cell); }
        }
      }
    });
  }

  private actions() {
    return {
      set: (rowId: string, columnId: string, value: CellValue) => this.commitCell(rowId, columnId, value, true),
      addRow: () => this.addRow(),
      menu: (columnId: string, anchor: HTMLElement) => this.openColumnMenu(columnId, anchor),
      rowMenu: (rowId: string, anchor: HTMLElement) => this.openRowMenu(rowId, anchor),
      moveRow: (fromId: string, toId: string) => this.moveRow(fromId, toId),
      addColumn: (index: number, anchor: HTMLElement) => this.showColumnComposer(index, anchor),
      openLink: (url: string) => window.open(url, "_blank", "noopener,noreferrer"),
      isMatch: (rowId: string, columnId: string) => {
        if (!this.searchQuery) return false;
        const column = this.model.data.columns.find((item) => item.id === columnId);
        const row = this.rowById.get(rowId);
        return Boolean(this.searchQuery && column && row && displayValue(row.cells[columnId], column).toLowerCase().includes(this.searchQuery));
      },
      isFlash: (rowId: string, columnId: string) => this.page.dataset.lastUpdate === `${rowId}:${columnId}`,
      summary: (columnId: string) => this.summary(columnId),
      summaryMenu: (columnId: string, anchor: HTMLElement) => this.openSummaryMenu(columnId, anchor),
    };
  }

  private renderGrid() {
    const actions = this.actions();
    const data = this.model.data;
    this.rowById = new Map(data.rows.map((row) => [row.id, row]));
    this.grid.rowSize = this.model.rowHeight;
    const columns = data.columns.map((column, index) => gridColumn(column, index, actions, Boolean(this.args.readOnly)));
    if (this.hasView()) for (const column of columns) column.rowDrag = false;
    this.grid.rowHeaders = rowHeader(actions, !this.args.readOnly && !this.hasView(), Boolean(this.args.readOnly));
    if (!this.args.readOnly) columns.push({
      prop: "__add", name: "", size: 54, readonly: true, sortable: false, filter: false,
      columnTemplate: (h) => h("button", { class: "rg-add-column", type: "button", title: "Add column", "aria-label": "Add column", onClick: (event: MouseEvent) => { event.stopPropagation(); this.showColumnComposer(data.columns.length, event.currentTarget as HTMLElement); } }, h("tv-icon", { name: "add", size: "sm" })),
      cellTemplate: (h, props) => (props.model as GridRow).__kind === "new" ? h("button", {
        class: "rg-new-row rg-new-row-fill", type: "button", title: "Add a row", "aria-label": "Add a row",
        onMouseDown: (event: MouseEvent) => event.stopPropagation(),
        onClick: (event: MouseEvent) => { event.stopPropagation(); this.addRow(); },
      }) : h("span", null, ""),
    });
    this.grid.columns = columns;
    this.grid.rowDefinitions = this.hasView() ? [] : data.rows.flatMap((row, index) => this.model.rowHeights[row.id] ? [{ type: "rgRow" as const, index, size: this.model.rowHeights[row.id] }] : []);
    // RevoGrid's asynchronous sort and trimmedRows can briefly paint only a
    // fragment of a filtered view. Order the source before passing it to the
    // grid so the first paint and row numbers agree with the visible view.
    this.grid.sorting = { columns: [] };
    const groupColumn = data.columns.find((column) => column.id === this.groupBy);
    const optionOrder = new Map(groupColumn?.options?.map((option, index) => [option.id, index]) ?? []);
    const sortColumn = data.columns.find((column) => column.id === this.sort?.columnId);
    this.viewRows = groupColumn || sortColumn ? [...data.rows].sort((left, right) => {
      if (groupColumn) {
        const leftValue = left.cells[groupColumn.id];
        const rightValue = right.cells[groupColumn.id];
        const leftEmpty = leftValue == null || leftValue === "";
        const rightEmpty = rightValue == null || rightValue === "";
        if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
        const groupOrder = optionOrder.size
          ? (optionOrder.get(String(leftValue)) ?? Number.MAX_SAFE_INTEGER) - (optionOrder.get(String(rightValue)) ?? Number.MAX_SAFE_INTEGER)
          : displayValue(leftValue, groupColumn).localeCompare(displayValue(rightValue, groupColumn));
        if (groupOrder) return groupOrder;
      }
      if (!sortColumn || !this.sort) return 0;
      const leftValue = left.cells[sortColumn.id];
      const rightValue = right.cells[sortColumn.id];
      const comparison = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue : String(leftValue ?? "").localeCompare(String(rightValue ?? ""));
      return this.sort.order === "asc" ? comparison : -comparison;
    }) : data.rows;
    let visibleOrdinal = 0;
    this.grid.source = this.viewRows.map((row) => ({ ...row.cells, __id: row.id, __rowNumber: this.rowVisible(row) ? ++visibleOrdinal : 0 }));
    if (this.filterNotDone || this.searchQuery) this.applyFilter();
    else this.grid.trimmedRows = {};
    const groupCounts = new Map<string, number>();
    if (groupColumn) for (const row of this.viewRows) if (this.rowVisible(row)) {
      const value = displayValue(row.cells[groupColumn.id], groupColumn) || "Empty";
      groupCounts.set(value, (groupCounts.get(value) ?? 0) + 1);
    }
    this.grid.grouping = this.groupBy ? {
      props: [this.groupBy], expandedAll: true,
      getGroupValue: (row: GridRow, prop: string) => {
        const column = data.columns.find((item) => item.id === prop);
        return column ? displayValue(row[prop] as CellValue, column) || "Empty" : String(row[prop] ?? "Empty");
      },
      groupLabelTemplate: (h, props) => {
        if (props.colType !== "colPinStart") return h("span", null, "");
        const option = groupColumn?.options?.find((item) => item.label === props.name);
        const count = groupCounts.get(props.name) ?? 0;
        return h("span", { class: "rg-group-label" }, [
          h("tv-icon", { name: props.expanded ? "expand" : "collapse", size: "sm" }),
          option ? h("span", { class: `rg-pill rg-pill-${option.color}` }, option.label) : h("span", { class: "rg-pill rg-pill-neutral" }, props.name),
          h("span", { class: "rg-group-count" }, `${count} ${count === 1 ? "row" : "rows"}`),
        ]);
      },
    } : { props: [] };
    this.updateFooter();
    this.updateToolbar();
    this.drawEmptyState();
  }

  private drawEmptyState() {
    this.page.querySelector(".rg-empty-state")?.remove();
    if (this.model.data.rows.length || this.args.readOnly) return;
    const panel = document.createElement("div");
    panel.className = "rg-empty-state";
    panel.textContent = "No rows yet. Ask your agent to add some, or add one here.";
    this.page.append(panel);
  }

  private rowVisible(row: Row): boolean {
    if (this.filterNotDone && row.cells.status === "done") return false;
    if (!this.searchQuery) return true;
    return this.model.data.columns.some((column) => displayValue(row.cells[column.id], column).toLowerCase().includes(this.searchQuery));
  }

  private applyFilter() {
    if (!this.filterNotDone && !this.searchQuery) { this.grid.trimmedRows = {}; return; }
    this.grid.trimmedRows = Object.fromEntries(this.viewRows.map((row, index) => [index, !this.rowVisible(row)]));
  }

  private updateFooter() {
    if (!this.args.readOnly) this.grid.pinnedBottomSource = [
      ...(this.args.summary ? [{ __kind: "summary" as const }] : []),
      { __kind: "new" as const },
    ];
    else this.grid.pinnedBottomSource = this.args.summary ? [{ __kind: "summary" }] : [];
  }

  private updateToolbar() {
    const total = this.model.data.rows.length;
    const visible = this.filterNotDone || this.searchQuery ? this.model.data.rows.filter((row) => this.rowVisible(row)).length : total;
    const count = total.toLocaleString("en-US");
    this.rowCount.textContent = visible === total ? `${count} ${total === 1 ? "row" : "rows"}` : `${visible.toLocaleString("en-US")} of ${count} rows`;
    this.sortButton.classList.toggle("active", Boolean(this.sort));
    this.filterButton.classList.toggle("active", this.filterNotDone);
    this.groupButton.classList.toggle("active", Boolean(this.groupBy));
  }

  private onChange(change: TableChange) {
    if (document.activeElement !== this.titleInput) this.titleInput.value = this.model.data.title;
    if ((this.filterNotDone || this.searchQuery) && (change.type === "cell.set" || change.type === "cells.set")) this.applyFilter();
    this.updateToolbar();
    if (this.args.summary) this.updateFooter();
    if (this.changePanel) this.drawChangeLog();
    this.page.dispatchEvent(new CustomEvent("tablechange", { detail: change, bubbles: true }));
  }

  private commitCell(rowId: string, columnId: string, value: CellValue, updateGrid: boolean) {
    const row = this.model.data.rows.find((item) => item.id === rowId);
    const column = this.model.data.columns.find((item) => item.id === columnId);
    if (!row || !column || this.args.readOnly) return;
    const converted = convertValue(value, column);
    const previous = row.cells[columnId] ?? null;
    if (JSON.stringify(previous) === JSON.stringify(converted)) return;
    this.model.apply({ type: "cell.set", rowId, columnId, value: converted, previous });
    if (updateGrid) void this.updateGridCell(rowId, columnId, converted);
  }

  private async updateGridCell(rowId: string, columnId: string, value: CellValue) {
    const source = await this.grid.getVisibleSource();
    const row = source.findIndex((item: GridRow) => item.__id === rowId);
    const column = this.model.data.columns.find((item) => item.id === columnId);
    if (row < 0 || !column) return;
    const colType = column.primary ? "colPinStart" : "rgCol";
    const col = column.primary ? 0 : this.model.data.columns.filter((item) => !item.primary).findIndex((item) => item.id === columnId);
    if (col >= 0) await this.grid.setDataAt({ row, col, colType, rowType: "rgRow", val: value });
  }

  private addRow(index = this.model.data.rows.length, source?: Row) {
    if (this.args.readOnly) return;
    const row = source ? { ...structuredClone(source), id: this.model.id("row") } : { id: this.model.id("row"), cells: Object.fromEntries(this.model.data.columns.map((column) => [column.id, null])) };
    this.model.apply({ type: "row.insert", row, index });
    this.renderGrid();
    void (async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      // The pinned footer finishes its click focus after the row source draws.
      await new Promise<void>((resolve) => this.later(resolve, 120));
      if (!this.page.isConnected) return;
      const visible = await this.grid.getVisibleSource() as GridRow[];
      const target = visible.findIndex((item) => item.__id === row.id);
      if (target >= 0) {
        await this.grid.clearFocus();
        await this.grid.scrollToRow(target);
        await this.grid.setCellsFocus({ x: 0, y: target }, undefined, "colPinStart", "rgRow");
        await this.grid.setCellEdit(target, this.model.data.columns[0].id);
      }
    })();
  }

  private deleteRow(rowId: string) {
    const index = this.model.data.rows.findIndex((row) => row.id === rowId);
    if (index < 0) return;
    this.model.apply({ type: "row.delete", rowId, index });
    this.renderGrid();
    this.notice("Row deleted. Undo", () => { this.model.undo(); this.renderGrid(); });
  }

  private async deleteSelectedRows(rowId: string) {
    const range = await this.grid.getSelectedRange();
    const visible = await this.grid.getVisibleSource() as GridRow[];
    const rowIds = range ? visible.slice(Math.min(range.y, range.y1), Math.max(range.y, range.y1) + 1).map((row) => row.__id).filter((id): id is string => Boolean(id)) : [];
    if (!rowIds.includes(rowId) || rowIds.length < 2) { this.deleteRow(rowId); return; }
    this.model.apply({ type: "rows.delete", rowIds });
    this.renderGrid();
    this.notice(`${rowIds.length} rows deleted. Undo`, () => { this.model.undo(); this.renderGrid(); });
  }

  private moveRow(fromId: string, toId: string) {
    if (this.args.readOnly || this.hasView()) return;
    const from = this.model.data.rows.findIndex((row) => row.id === fromId);
    const to = this.model.data.rows.findIndex((row) => row.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    this.model.apply({ type: "row.move", rowId: fromId, from, to });
    this.renderGrid();
  }

  private addColumn(index: number, name: string, type: ColumnType) {
    const column: Column = { id: this.model.id("column"), name, type, width: type === "text" ? 200 : 150, ...(type === "select" || type === "multiselect" ? { options: [] } : {}) };
    this.model.apply({ type: "column.insert", column, index });
    this.renderGrid();
  }

  private deleteColumn(columnId: string) {
    const index = this.model.data.columns.findIndex((column) => column.id === columnId);
    if (index < 0 || this.model.data.columns[index].primary) return;
    this.model.apply({ type: "column.delete", columnId, index });
    this.renderGrid();
    this.notice("Column deleted. Undo", () => { this.model.undo(); this.renderGrid(); });
  }

  private showColumnComposer(index: number, anchor: HTMLElement) {
    if (this.args.readOnly) return;
    this.closePanel();
    // Header templates render inside RevoGrid's viewport, while tv-popover
    // pairs triggers through document.getElementById. A small document-level
    // form keeps the name field focused without relying on grid internals.
    const panel = document.createElement("div");
    panel.className = "rg-column-composer";
    const rect = anchor.getBoundingClientRect();
    Object.assign(panel.style, { left: `${Math.min(rect.left, window.innerWidth - 260)}px`, top: `${Math.min(rect.bottom + 5, window.innerHeight - 230)}px` });
    const heading = document.createElement("strong");
    heading.textContent = "Add a field";
    const name = document.createElement("input");
    name.placeholder = "Field name";
    name.setAttribute("aria-label", "Field name");
    const type = document.createElement("select");
    type.setAttribute("aria-label", "Field type");
    for (const value of ["text", "number", "currency", "date", "checkbox", "select", "multiselect", "person", "url"] as ColumnType[]) {
      const option = document.createElement("option"); option.value = value; option.textContent = value[0].toUpperCase() + value.slice(1); type.append(option);
    }
    const add = document.createElement("button");
    add.type = "button"; add.textContent = "Add field"; add.setAttribute("intent", "primary");
    add.addEventListener("click", () => { if (name.value.trim()) { this.addColumn(index, name.value.trim(), type.value as ColumnType); this.closePanel(); } });
    name.addEventListener("keydown", (event) => { if (event.key === "Enter") add.click(); });
    panel.append(heading, name, type, add);
    document.body.append(panel); this.floatingPanel = panel;
    this.panelListeners = new AbortController();
    document.addEventListener("pointerdown", (event) => { if (!panel.contains(event.target as Node) && event.target !== anchor) this.closePanel(); }, { capture: true, signal: this.panelListeners.signal });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") this.closePanel(); }, { signal: this.panelListeners.signal });
    requestAnimationFrame(() => name.focus());
  }

  private renameColumn(columnId: string, anchor: HTMLElement) {
    if (this.args.readOnly) return;
    const column = this.model.data.columns.find((item) => item.id === columnId);
    if (!column) return;
    this.closePanel();
    const input = document.createElement("input");
    input.className = "rg-rename-overlay";
    input.value = column.name;
    const rect = anchor.getBoundingClientRect();
    Object.assign(input.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    document.body.append(input); this.floatingPanel = input; input.focus(); input.select();
    let done = false;
    const finish = (save: boolean) => {
      if (done) return; done = true;
      if (save && input.value.trim() && input.value.trim() !== column.name) { this.model.apply({ type: "column.rename", columnId, name: input.value.trim() }); this.renderGrid(); }
      this.closePanel();
    };
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") finish(true); if (event.key === "Escape") finish(false); });
    input.addEventListener("blur", () => finish(true), { once: true });
  }

  private openColumnMenu(columnId: string, anchor: HTMLElement) {
    const column = this.model.data.columns.find((item) => item.id === columnId);
    if (!column) return;
    const index = this.model.data.columns.indexOf(column);
    this.openMenu(anchor, [
      { label: "Rename", icon: "edit", run: () => this.renameColumn(columnId, anchor) },
      { label: "Change type…", icon: "settings", run: () => this.openTypeMenu(columnId, anchor) },
      { label: "Insert left", icon: "add", separator: true, run: () => this.showColumnComposer(index, anchor) },
      { label: "Insert right", icon: "add", run: () => this.showColumnComposer(index + 1, anchor) },
      { label: "Duplicate", icon: "copy", run: () => {
        const copy = { ...structuredClone(column), id: this.model.id("column"), name: `${column.name} copy`, primary: false };
        this.model.apply({ type: "column.duplicate", sourceId: columnId, column: copy, index: index + 1 });
        this.renderGrid();
      } },
      { label: "Sort ascending", icon: "up", separator: true, run: () => this.setSort(columnId, "asc") },
      { label: "Sort descending", icon: "down", run: () => this.setSort(columnId, "desc") },
      { label: "Delete", icon: "delete", danger: true, separator: true, run: () => this.deleteColumn(columnId) },
    ].filter((action) => !this.args.readOnly || action.label.startsWith("Sort")));
  }

  private openTypeMenu(columnId: string, anchor: HTMLElement) {
    const current = this.model.data.columns.find((column) => column.id === columnId)?.type;
    this.openMenu(anchor, (["text", "number", "currency", "date", "checkbox", "select", "multiselect", "person", "url"] as ColumnType[]).map((columnType) => ({
      label: columnType[0].toUpperCase() + columnType.slice(1),
      icon: fieldIcon(columnType),
      checked: columnType === current,
      run: () => { this.model.apply({ type: "column.retype", columnId, columnType }); this.renderGrid(); },
    })));
  }

  private openRowMenu(rowId: string, anchor: HTMLElement) {
    if (this.args.readOnly) return;
    const index = this.model.data.rows.findIndex((row) => row.id === rowId);
    if (index < 0) return;
    this.openMenu(anchor, [
      { label: "Insert above", icon: "add", run: () => this.addRow(index) },
      { label: "Insert below", icon: "add", run: () => this.addRow(index + 1) },
      { label: "Duplicate", icon: "copy", run: () => this.addRow(index + 1, this.model.data.rows[index]) },
      { label: "Delete", icon: "delete", danger: true, separator: true, run: () => { void this.deleteSelectedRows(rowId); } },
    ]);
  }

  private openSortMenu(anchor: HTMLElement) {
    this.openMenu(anchor, [
      { label: "Clear sort", run: () => { this.sort = null; this.renderGrid(); } },
      ...this.model.data.columns.flatMap((column) => [
        { label: `${column.name} · ascending`, run: () => this.setSort(column.id, "asc") },
        { label: `${column.name} · descending`, run: () => this.setSort(column.id, "desc") },
      ]),
    ]);
  }

  private setSort(columnId: string, order: "asc" | "desc") {
    this.sort = { columnId, order };
    this.renderGrid();
  }

  private openFilterMenu(anchor: HTMLElement) {
    this.openMenu(anchor, [
      { label: "Show all rows", run: () => { this.filterNotDone = false; this.renderGrid(); } },
      { label: "Hide done", run: () => { this.filterNotDone = true; this.renderGrid(); } },
    ]);
  }

  private openGroupMenu(anchor: HTMLElement) {
    this.openMenu(anchor, [
      { label: "No groups", run: () => { this.groupBy = null; this.renderGrid(); } },
      ...this.model.data.columns.filter((column) => column.type === "select" || column.type === "person").map((column) => ({ label: column.name, run: () => { this.groupBy = column.id; this.renderGrid(); } })),
    ]);
  }

  private openHeightMenu(anchor: HTMLElement) {
    this.openMenu(anchor, [
      { label: "Short · 30 px", run: () => this.setHeight(30) },
      { label: "Medium · 34 px", run: () => this.setHeight(34) },
      { label: "Tall · 46 px", run: () => this.setHeight(46) },
    ]);
  }

  private setHeight(height: number) { this.model.apply({ type: "row.height", height }); this.grid.rowSize = height; }

  private openSummaryMenu(columnId: string, anchor: HTMLElement) {
    this.openMenu(anchor, [
      { label: "None", run: () => { this.aggregates.delete(columnId); this.updateFooter(); } },
      ...(["sum", "average", "min", "max", "filled", "empty", "checked", "checkedPercent"] as Aggregate[]).filter((aggregate) => aggregate !== "checked" && aggregate !== "checkedPercent" || this.model.data.columns.find((column) => column.id === columnId)?.type === "checkbox").map((aggregate) => ({
        label: aggregate === "checkedPercent" ? "Percentage checked" : aggregate === "checked" ? "Count checked" : aggregate[0].toUpperCase() + aggregate.slice(1),
        run: () => { this.aggregates.set(columnId, aggregate); this.updateFooter(); },
      })),
    ]);
  }

  private summary(columnId: string): string {
    const mode = this.aggregates.get(columnId);
    if (!mode) return columnId === this.model.data.columns[0]?.id ? "Σ Summary" : "";
    const column = this.model.data.columns.find((item) => item.id === columnId)!;
    const values = this.model.data.rows.map((row) => row.cells[columnId]);
    if (mode === "filled") return `${values.filter((value) => value != null && value !== "").length} filled`;
    if (mode === "empty") return `${values.filter((value) => value == null || value === "").length} empty`;
    if (mode === "checked") return `${values.filter(Boolean).length} checked`;
    if (mode === "checkedPercent") return `${Math.round(values.filter(Boolean).length / Math.max(1, values.length) * 100)}% checked`;
    const numbers = values.filter((value): value is number => typeof value === "number");
    if (!numbers.length) return "—";
    const result = mode === "sum" ? numbers.reduce((sum, value) => sum + value, 0) : mode === "average" ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : mode === "min" ? Math.min(...numbers) : Math.max(...numbers);
    return `${mode === "sum" ? "Σ " : ""}${displayValue(result, column)}`;
  }

  private placeAnchor(anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    Object.assign(this.menuTrigger.style, { left: `${rect.left}px`, top: `${rect.bottom - 2}px` });
  }

  private openMenu(anchor: HTMLElement, actions: MenuAction[]) {
    this.closePanel();
    this.placeAnchor(anchor);
    this.menu.replaceChildren();
    for (const action of actions) {
      if (action.separator && this.menu.children.length) this.menu.append(document.createElement("hr"));
      const item = document.createElement("tv-menu-item");
      if (action.icon) { const glyph = icon(action.icon); glyph.className = "rg-menu-icon"; item.append(glyph); }
      const label = document.createElement("span");
      label.textContent = action.label;
      item.append(label);
      if (action.checked) { const check = icon("check"); check.className = "rg-menu-check"; item.append(check); }
      if (action.danger) item.setAttribute("intent", "danger");
      item.addEventListener("click", action.run, { once: true });
      this.menu.append(item);
    }
    this.menu.setAttribute("open", "");
  }

  private closePanel() { this.menu.removeAttribute("open"); this.panelListeners?.abort(); this.panelListeners = null; this.floatingPanel?.remove(); this.floatingPanel = null; }

  private notice(message: string, undo: () => void) {
    this.page.querySelector(".rg-notice")?.remove();
    const notice = document.createElement("button");
    notice.className = "rg-notice"; notice.type = "button"; notice.textContent = message;
    notice.addEventListener("click", () => { undo(); notice.remove(); });
    this.page.append(notice);
    this.later(() => notice.remove(), 5000);
  }

  private keyDown(event: KeyboardEvent) {
    if (!this.page.isConnected || !event.composedPath().includes(this.page) && event.target !== document.body) return;
    if (event.key === "Escape") this.editing = null;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !this.args.readOnly) {
      event.preventDefault();
      if (event.shiftKey) this.model.redo(); else this.model.undo();
      this.renderGrid();
    } else if ((event.key === "Delete" || event.key === "Backspace") && !this.args.readOnly) {
      event.preventDefault(); void this.clearSelection();
    } else if (event.key === " " && !this.args.readOnly) {
      const activeCell = event.target instanceof HTMLElement ? event.target.querySelector<HTMLElement>(".rg-cell-content[data-row-id]") : null;
      const columnId = activeCell?.dataset.columnId ?? this.focused?.columnId;
      const rowId = activeCell?.dataset.rowId ?? this.focused?.rowId;
      const column = this.model.data.columns.find((item) => item.id === columnId);
      const row = this.model.data.rows.find((item) => item.id === rowId);
      if (column?.type === "checkbox" && row) { event.preventDefault(); this.commitCell(row.id, column.id, !row.cells[column.id], true); }
    }
  }

  private async clearSelection() {
    const selected = await this.grid.getSelectedRange();
    const focused = await this.grid.getFocused();
    if (!focused) return;
    const source = await this.grid.getVisibleSource();
    const columns = this.model.data.columns.filter((column) => Boolean(column.primary) === (focused.colType === "colPinStart"));
    const startRow = selected ? Math.min(selected.y, selected.y1) : focused.cell.y;
    const endRow = selected ? Math.max(selected.y, selected.y1) : focused.cell.y;
    const startCol = selected ? Math.min(selected.x, selected.x1) : focused.cell.x;
    const endCol = selected ? Math.max(selected.x, selected.x1) : focused.cell.x;
    const cells: Extract<TableChange, { type: "cells.set" }>["cells"] = [];
    for (let row = startRow; row <= endRow; row++) for (let col = startCol; col <= endCol; col++) {
      const rowId = (source[row] as GridRow)?.__id;
      const column = columns[col];
      const modelRow = this.model.data.rows.find((item) => item.id === rowId);
      if (rowId && column && modelRow && modelRow.cells[column.id] != null) cells.push({ rowId, columnId: column.id, value: null, previous: modelRow.cells[column.id] });
    }
    if (!cells.length) return;
    this.model.apply({ type: "cells.set", cells });
    for (const cell of cells) void this.updateGridCell(cell.rowId, cell.columnId, null);
  }

  private startLiveUpdates() {
    let tick = 0;
    this.liveTimer = setInterval(() => {
      if (!this.page.isConnected) return;
      const rows = this.model.data.rows;
      if (!rows.length) return;
      const row = rows[(tick * 7) % rows.length];
      const statuses = ["todo", "progress", "review", "blocked", "done"];
      const value = statuses[tick++ % statuses.length];
      if (this.editing?.rowId === row.id && this.editing.columnId === "status") return;
      this.model.externalSet(row.id, "status", value);
      this.flash(row.id, "status");
      void this.updateGridCell(row.id, "status", value);
    }, 2000);
  }

  private flash(rowId: string, columnId: string) {
    // Templates mark the targeted cell; no internal RevoGrid markup is queried.
    const row = this.model.data.rows.find((item) => item.id === rowId);
    if (!row) return;
    this.page.dataset.lastUpdate = `${rowId}:${columnId}`;
    this.later(() => {
      if (this.page.dataset.lastUpdate === `${rowId}:${columnId}`) {
        delete this.page.dataset.lastUpdate;
        void this.updateGridCell(rowId, columnId, row.cells[columnId] ?? null);
      }
    }, 850);
  }

  private buildChangePanel() {
    this.changePanel = document.createElement("aside");
    this.changePanel.className = "rg-change-panel";
    const heading = document.createElement("h2"); heading.textContent = "Change events";
    const detail = document.createElement("p"); detail.textContent = "Every table edit passes through one plain object.";
    this.changePanel.append(heading, detail);
    this.page.append(this.changePanel);
  }

  private seedChangeLog() {
    const first = this.model.data.rows[0];
    const primary = this.model.data.columns[0];
    if (first && primary) this.model.apply({ type: "cell.set", rowId: first.id, columnId: primary.id, value: `${first.cells[primary.id] ?? ""} (edited)`, previous: first.cells[primary.id] ?? null });
    const row: Row = { id: this.model.id("row"), cells: Object.fromEntries(this.model.data.columns.map((column) => [column.id, column.primary ? "Follow up on prototype" : null])) };
    this.model.apply({ type: "row.insert", row, index: this.model.data.rows.length });
    const status = this.model.data.columns.find((column) => column.id === "status");
    if (status) this.model.apply({ type: "column.rename", columnId: status.id, name: "Stage" });
    this.renderGrid();
  }

  private changeLabel(change: TableChange): string {
    if (change.type === "cells.set") return `${change.cells.length} cells updated`;
    const labels: Partial<Record<TableChange["type"], string>> = {
      "cell.set": "Cell updated", "row.insert": "Row added", "row.delete": "Row deleted", "rows.delete": "Rows deleted",
      "row.move": "Row moved", "column.insert": "Column added", "column.rename": "Column renamed", "column.retype": "Column type changed",
      "column.delete": "Column deleted", "column.reorder": "Columns reordered", "column.resize": "Column resized", "option.add": "Option added",
    };
    return labels[change.type] ?? change.type.replace(".", " ");
  }

  private drawChangeLog() {
    if (!this.changePanel) return;
    this.changePanel.querySelector(".rg-change-list")?.remove();
    const list = document.createElement("div"); list.className = "rg-change-list";
    for (const change of this.model.changes.slice(0, 30)) {
      const entry = document.createElement("div"); entry.className = "rg-change-entry";
      const label = document.createElement("strong"); label.textContent = this.changeLabel(change);
      const pre = document.createElement("pre"); pre.textContent = JSON.stringify(change, null, 2);
      entry.append(label, pre); list.append(entry);
    }
    this.changePanel.append(list);
  }

  private dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.liveTimer);
    this.keyboardController.abort();
    if (this.initialFrame !== undefined) cancelAnimationFrame(this.initialFrame);
    if (this.firstRenderFrame !== undefined) cancelAnimationFrame(this.firstRenderFrame);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.cleanupObserver.disconnect();
    this.closePanel();
  }

  private hasView() { return Boolean(this.sort || this.filterNotDone || this.groupBy || this.searchQuery); }

  private later(callback: () => void, delay: number) {
    const timer = setTimeout(() => { this.timers.delete(timer); if (!this.disposed) callback(); }, delay);
    this.timers.add(timer);
  }
}

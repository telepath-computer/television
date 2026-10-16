// A self-contained, framework-free table. Stored changes live in model.ts;
// this element owns only view preferences, selection, editing, and DOM.

import type { CellValue, Column, ColumnType, OptionColor, Row, TableData } from "../data.ts";
import { applyChange, type TableChange } from "./model.ts";
import { cellLabel, makeView, parseValue, sameViewOrder, type TableView, type ViewItem } from "./view.ts";
import { button, element, newId } from "./dom.ts";
import { numberPrecisionByColumn, renderCellContent } from "./cell-rendering.ts";
import { renderToolbar } from "./toolbar.ts";
import { buildSelectPicker } from "./picker.ts";
import { drawRow as renderRow, type RowRenderingConfig } from "./row-rendering.ts";
import { renderHeader } from "./header-rendering.ts";
import { BodyRenderer } from "./body-rendering.ts";
import { SelectionController } from "./selection-controller.ts";
import { buildColumnPanel, buildTypePanel, buildSummaryPanel } from "./panels.ts";
import { startCellInputEditor, startInlineRename } from "./editing.ts";
import {
  resizeColumn as resizeColumnPointer,
  fitColumn as fitColumnPointer,
  type ColumnPointerConfig,
} from "./column-pointer.ts";
import {
  moveActive as moveKeyboardActive,
  onKeyDown as handleGridKeyDown,
  onCopy as handleGridCopy,
  onPaste as handleGridPaste,
  selectionCells as getSelectionCells,
  type KeyboardContext,
} from "./keyboard.ts";
import { columnMenuItems, createContextMenu, rowMenuItems } from "./menus.ts";

/** Options that affect a grid's presentation but not its stored table. */
export interface GridOptions {
  readOnly?: boolean;
  rowHeight?: number;
  summary?: boolean;
  groupBy?: string;
  sort?: TableView["sort"];
  filter?: TableView["filter"];
}

type ActiveCell = { rowId: string; columnId: string };
type Editor = { rowId: string; columnId: string; element: HTMLElement; finish: (save: boolean, move?: "down" | "right" | "left") => void };
const colors: OptionColor[] = ["blue", "green", "purple", "orange", "pink", "yellow", "red", "neutral"];

/** A reusable grid that accepts outside changes with applyTableChange(). */
export class TableGrid extends HTMLElement {
  private table: TableData = { title: "", columns: [], rows: [] };
  private numberDigits = new Map<string, number>();
  private options: GridOptions = {};
  private view: TableView = { search: "" };
  private collapsed = new Set<string>();
  private editor?: Editor;
  private picker?: HTMLElement;
  private panel?: HTMLElement;
  private scrollArea?: HTMLElement;
  private body?: HTMLElement;
  private visible: ViewItem[] = [];
  private bodyRenderer = new BodyRenderer();
  private undoStack: TableChange[] = [];
  private redoStack: TableChange[] = [];
  private lifetime = new AbortController();
  private panelLifetime?: AbortController;
  private flash?: ActiveCell;
  private flashTimer?: number;
  private noticeTimer?: number;
  private liveTimer?: number;
  private summaryModes: Record<string, string> = {};
  private pendingRender = false;
  private rendering = false;
  private resizeObserver?: ResizeObserver;
  private lastViewportHeight = 0;
  private columnMenuElement?: HTMLElement;
  private rowMenuElement?: HTMLElement;
  private rowRenderingConfig?: RowRenderingConfig;
  private idPrefix = `tg-${newId().slice(0, 8)}`;
  private selection = new SelectionController({
    root: this,
    getTable: () => this.table,
    getVisible: () => this.visible,
    getScrollArea: () => this.scrollArea,
    getRenderedCell: (rowId, columnId) => this.renderedCell(rowId, columnId),
    getRowHeight: () => this.options.rowHeight ?? 34,
    getFlash: () => this.flash,
    drawRows: () => this.drawRows(),
  });
  private onPointerUp = (): void => this.selection.onPointerUp();

  /** Copy the supplied table and draw it with these options. */
  configure(table: TableData, options: GridOptions = {}): void {
    this.pendingRender = false;
    this.closeFloating();
    this.table = structuredClone(table);
    this.numberDigits = numberPrecisionByColumn(this.table);
    this.options = options;
    this.view = { search: "", groupBy: options.groupBy, sort: options.sort, filter: options.filter };
    this.collapsed.clear();
    this.selection.reset();
    this.editor = undefined;
    this.undoStack = [];
    this.redoStack = [];
    this.summaryModes = {};
    if (options.summary) {
      for (const column of table.columns) {
        if (column.type === "currency" || column.type === "number") this.summaryModes[column.id] = "sum";
        if (column.type === "checkbox") this.summaryModes[column.id] = "checked";
      }
    }
    if (this.isConnected) this.render();
  }

  connectedCallback(): void {
    const started = performance.now();
    if (this.lifetime.signal.aborted) this.lifetime = new AbortController();
    this.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("pointerup", this.onPointerUp, { signal: this.lifetime.signal });
    this.addEventListener("copy", this.onCopy);
    this.addEventListener("paste", this.onPaste);
    if (!this.firstChild) this.render();
    if (this.scrollArea) {
      const height = this.scrollArea.clientHeight;
      if (height !== this.lastViewportHeight) {
        this.lastViewportHeight = height;
        this.bodyRenderer.reset();
        this.drawRows();
      }
      this.resizeObserver = new ResizeObserver(() => {
        const height = this.scrollArea?.clientHeight ?? 0;
        if (height === this.lastViewportHeight || this.visible.length <= 150) return;
        this.lastViewportHeight = height;
        this.bodyRenderer.reset();
        this.drawRows();
      });
      this.resizeObserver.observe(this.scrollArea);
    }
    if (!this.dataset.firstRenderMs) {
      this.dataset.firstRenderMs = (performance.now() - started).toFixed(1);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (this.isConnected) this.dataset.firstPaintMs = (performance.now() - started).toFixed(1);
      }));
    }
  }

  disconnectedCallback(): void {
    this.removeEventListener("keydown", this.onKeyDown);
    this.removeEventListener("copy", this.onCopy);
    this.removeEventListener("paste", this.onPaste);
    this.resizeObserver?.disconnect();
    this.lifetime.abort();
    this.closeFloating();
    clearTimeout(this.flashTimer);
    clearTimeout(this.noticeTimer);
    clearInterval(this.liveTimer);
  }

  /** Apply an agent/store update without emitting another write event. */
  applyTableChange(change: TableChange): void {
    this.commit(change, false);
  }

  /** Apply a page action and emit the same change event used by editing. */
  makeChange(change: TableChange): void {
    this.commit(change, true);
  }

  /** Simulate a store writer for the live-update story. */
  startLiveUpdates(): void {
    clearInterval(this.liveTimer);
    this.liveTimer = window.setInterval(() => {
      if (!this.isConnected || !this.table.rows.length) return;
      const row = this.table.rows[Math.floor(Math.random() * this.table.rows.length)];
      const columns = this.table.columns.filter((column) => column.type === "number" || column.type === "text");
      const column = columns[Math.floor(Math.random() * columns.length)];
      if (!column || this.isEditing(row.id, column.id)) return;
      const old = row.cells[column.id];
      const value = column.type === "number" ? Math.round(Number(old ?? 0) + 1) : `${String(old ?? "").replace(/ · updated$/, "")} · updated`;
      this.applyTableChange({ type: "cell", rowId: row.id, columnId: column.id, value });
    }, 2000);
  }

  /** Open a column menu after its header has drawn, for inspection stories. */
  openColumnMenu(columnId: string): void {
    const column = this.column(columnId);
    const trigger = [...this.querySelectorAll<HTMLElement>(".tg-header-menu")]
      .find((node) => node.closest<HTMLElement>(".tg-head")?.dataset.columnId === columnId);
    if (!column || !trigger) return;
    this.columnMenuElement?.remove();
    const menu = this.columnMenu(column, trigger);
    menu.dataset.menuColumn = columnId;
    trigger.closest(".tg-head")?.append(menu);
    this.columnMenuElement = menu;
    menu.setAttribute("open", "");
  }

  /** Open the type-specific editor on a cell. */
  openCellEditor(rowId: string, columnId: string): void {
    this.selection.selectCell(rowId, columnId);
    this.beginEdit();
  }

  /** True while this cell has an uncommitted editor. */
  isEditing(rowId: string, columnId: string): boolean {
    return this.editor?.rowId === rowId && this.editor.columnId === columnId;
  }

  private commit(change: TableChange, local: boolean): void {
    if (local && this.options.readOnly) return;
    if (change.type === "cell" && !local && this.isEditing(change.rowId, change.columnId)) return;
    const result = applyChange(this.table, change);
    if (result.table === this.table) return;
    this.table = result.table;
    const previousNumberDigits = this.numberDigits;
    this.numberDigits = numberPrecisionByColumn(this.table);
    this.refreshNumberCells(previousNumberDigits);
    if (local) {
      this.undoStack.push(result.inverse);
      this.redoStack = [];
      this.dispatchEvent(new CustomEvent<TableChange>("table-change", { detail: change, bubbles: true }));
    }
    if (
      change.type === "batch" &&
      change.changes.every((part) => part.type === "cell" || part.type === "cells") &&
      !this.view.sort && !this.view.filter && !this.view.groupBy &&
      !this.options.summary && !this.editor
    ) {
      this.visible = this.table.rows.map((row) => ({ type: "row", row }));
      const changed = new Map<string, Set<string>>();
      const rowsById = new Map(this.table.rows.map((row) => [row.id, row]));
      const columnsById = new Map(this.table.columns.map((column) => [column.id, column]));
      for (const part of change.changes) {
        if (part.type === "cell") {
          const columns = changed.get(part.rowId) ?? new Set<string>();
          columns.add(part.columnId);
          changed.set(part.rowId, columns);
        } else if (part.type === "cells") {
          for (const row of part.rows) {
            const columns = changed.get(row.id) ?? new Set<string>();
            for (const columnId of Object.keys(row.values)) columns.add(columnId);
            changed.set(row.id, columns);
          }
        }
      }
      for (const cell of this.querySelectorAll<HTMLElement>(".tg-cell")) {
        const rowId = cell.dataset.rowId!;
        const columnId = cell.dataset.columnId!;
        if (!changed.get(rowId)?.has(columnId)) continue;
        const column = columnsById.get(columnId);
        const row = rowsById.get(rowId);
        if (!column || !row) continue;
        this.drawCellContent(cell, row.cells[columnId], column);
        cell.setAttribute("aria-label", `${column.name}: ${cellLabel(row.cells[columnId], column) || "empty"}`);
      }
      if (this.view.search) this.highlightMatches();
      return;
    }
    if (!local && this.editor && change.type !== "cell") {
      this.pendingRender = true;
      return;
    }
    if (local && change.type === "cell" && this.picker && this.isEditing(change.rowId, change.columnId)) {
      const cell = this.renderedCell(change.rowId, change.columnId);
      const column = this.column(change.columnId);
      if (cell && column) this.drawCellContent(cell, change.value, column);
      return;
    }
    // A targeted outside cell change keeps the active DOM node, editor,
    // scroll offsets, and keyboard focus in place.
    if (!local && change.type === "cell") {
      const nextVisible = makeView(this.table, this.view, this.collapsed);
      const sameOrder = sameViewOrder(this.visible, nextVisible);
      if (this.editor && !sameOrder) this.pendingRender = true;
      else if (!sameOrder) {
        this.render();
        return;
      }
      this.visible = sameOrder
        ? nextVisible
        : this.visible.map((item) => item.type === "row" && item.row.id === change.rowId
          ? { type: "row", row: this.row(change.rowId)! }
          : item);
      if (!sameOrder) this.selection.updatePositions();
      const cell = this.renderedCell(change.rowId, change.columnId);
      if (cell) {
        const column = this.column(change.columnId);
        if (column) this.drawCellContent(cell, change.value, column);
        this.highlightMatches();
        this.flash = { rowId: change.rowId, columnId: change.columnId };
        cell.classList.add("is-flash");
        clearTimeout(this.flashTimer);
        this.flashTimer = window.setTimeout(() => {
          cell.classList.remove("is-flash");
          this.flash = undefined;
        }, 1100);
      }
      return;
    }
    this.render();
  }

  private undo(): void {
    const change = this.undoStack.pop();
    if (!change) return;
    const result = applyChange(this.table, change);
    this.table = result.table;
    this.numberDigits = numberPrecisionByColumn(this.table);
    this.redoStack.push(result.inverse);
    this.dispatchEvent(new CustomEvent<TableChange>("table-change", { detail: change, bubbles: true }));
    this.render();
  }

  private redo(): void {
    const change = this.redoStack.pop();
    if (!change) return;
    const result = applyChange(this.table, change);
    this.table = result.table;
    this.numberDigits = numberPrecisionByColumn(this.table);
    this.undoStack.push(result.inverse);
    this.dispatchEvent(new CustomEvent<TableChange>("table-change", { detail: change, bubbles: true }));
    this.render();
  }

  private render(): void {
    this.rendering = true;
    this.pendingRender = false;
    const hadGridFocus = Boolean(this.scrollArea?.contains(document.activeElement));
    const top = this.scrollArea?.scrollTop ?? 0;
    const left = this.scrollArea?.scrollLeft ?? 0;
    this.closeFloating();
    this.replaceChildren();
    this.columnMenuElement = undefined;
    this.rowMenuElement = undefined;
    this.rowRenderingConfig = undefined;
    const page = element("div", "tg-page");
    page.append(this.drawToolbar());
    const shell = element("div", "tg-shell");
    const scroll = element("div", "tg-scroll");
    scroll.setAttribute("role", "grid");
    scroll.setAttribute("aria-label", this.table.title || "Table");
    scroll.setAttribute("aria-rowcount", String(this.table.rows.length + 1));
    scroll.setAttribute("aria-colcount", String(this.table.columns.length + 1));
    scroll.tabIndex = 0;
    scroll.append(this.drawHeader());
    this.body = element("div", "tg-body");
    this.body.setAttribute("role", "rowgroup");
    scroll.append(this.body);
    this.scrollArea = scroll;
    scroll.addEventListener("scroll", () => this.drawRows(), { passive: true });
    shell.append(scroll);
    page.append(shell);
    this.append(page);
    this.lastViewportHeight = scroll.clientHeight;
    this.resizeObserver?.disconnect();
    this.resizeObserver?.observe(scroll);
    this.visible = makeView(this.table, this.view, this.collapsed);
    this.selection.updatePositions();
    this.bodyRenderer.reset();
    this.drawRows();
    scroll.scrollTop = top;
    scroll.scrollLeft = left;
    if (top && this.visible.length > 150 && !this.view.groupBy) this.drawRows();
    this.selection.refresh();
    if (hadGridFocus) scroll.focus({ preventScroll: true });
    this.rendering = false;
  }

  private column(id: string): Column | undefined { return this.table.columns.find((column) => column.id === id); }
  private row(id: string): Row | undefined { return this.table.rows.find((row) => row.id === id); }
  private template(): string { return `48px ${this.table.columns.map((column) => `${column.width}px`).join(" ")} 44px`; }

  private renderedCell(rowId: string, columnId: string): HTMLElement | undefined {
    return [...this.querySelectorAll<HTMLElement>(".tg-cell")]
      .find((cell) => cell.dataset.rowId === rowId && cell.dataset.columnId === columnId);
  }

  private drawToolbar(): HTMLElement {
    return renderToolbar({
      table: this.table,
      view: this.view,
      idPrefix: this.idPrefix,
      readOnly: this.options.readOnly,
      rowHeight: this.options.rowHeight,
      onRenameTitle: (trigger) => this.renameTitle(trigger),
      onSort: (sort) => {
        this.view.sort = sort;
        this.render();
      },
      onFilter: (filter) => {
        this.view.filter = filter;
        this.render();
      },
      onGroupBy: (columnId) => {
        this.view.groupBy = columnId;
        this.render();
      },
      onRowHeight: (height) => this.setRowHeight(height),
      onSearch: (query) => {
        this.view.search = query;
        this.highlightMatches();
      },
    });
  }

  private sort(columnId: string, direction: "asc" | "desc"): void {
    this.view.sort = { columnId, direction };
    this.render();
  }

  private setRowHeight(height: number): void {
    this.options.rowHeight = height;
    this.render();
  }

  private drawHeader(): HTMLElement {
    return renderHeader({
      columns: this.table.columns,
      sort: this.view.sort,
      readOnly: this.options.readOnly,
      idPrefix: this.idPrefix,
      onSelect: (columnId) => this.selection.selectColumn(columnId),
      onRename: (columnId, head) => this.renameColumn(columnId, head),
      onMenu: (columnId) => this.openColumnMenu(columnId),
      onResize: (event, columnId) => this.resizeColumn(event, columnId),
      onFit: (columnId) => this.fitColumn(columnId),
      onInsert: (index, trigger) => this.columnPanel(index, trigger),
      onMove: (columnId, index) => this.commit({ type: "column-move", columnId, index }, true),
    });
  }

  private columnMenu(column: Column, trigger: HTMLElement): HTMLElement {
    const items = columnMenuItems(column, Boolean(this.options.readOnly), {
      rename: () => this.renameColumn(column.id, trigger.closest<HTMLElement>(".tg-head")!),
      changeType: () => this.typePanel(column.id, trigger),
      insert: (_column, side) => {
        const index = this.table.columns.findIndex((item) => item.id === column.id);
        this.columnPanel(index + (side === "right" ? 1 : 0), trigger);
      },
      duplicate: () => this.duplicateColumn(column.id),
      sort: (_column, direction) => this.sort(column.id, direction),
      delete: () => {
        this.commit({ type: "column-delete", columnId: column.id }, true);
        this.notice("Column deleted. Undo");
      },
    });
    return createContextMenu(trigger, items);
  }

  private drawRows(): void {
    if (!this.body || !this.scrollArea) return;
    this.bodyRenderer.draw({
      body: this.body,
      table: this.table,
      visible: this.visible,
      collapsed: this.collapsed,
      groupBy: this.view.groupBy,
      search: this.view.search,
      rowHeight: this.options.rowHeight ?? 34,
      readOnly: Boolean(this.options.readOnly),
      summary: Boolean(this.options.summary),
      summaryModes: this.summaryModes,
      viewportHeight: this.lastViewportHeight,
      scrollTop: this.scrollArea.scrollTop,
      template: this.template(),
      drawRow: (row, index, recycled) => this.drawRow(row, index, recycled),
      onGroupToggle: (key) => {
        if (this.collapsed.has(key)) this.collapsed.delete(key);
        else this.collapsed.add(key);
        this.visible = makeView(this.table, this.view, this.collapsed);
        this.selection.updatePositions();
        this.bodyRenderer.reset();
        this.drawRows();
      },
      onAddRow: () => this.insertRow(this.table.rows.length, true),
      onSummaryClick: (column, trigger) => this.summaryPanel(column, trigger),
      onEditorLeavesWindow: (desired) => {
        if (!this.editor || desired.has(this.editor.rowId)) return false;
        if (this.picker) this.closeFloating();
        else {
          this.editor.finish(true);
          return true;
        }
        return false;
      },
      highlightMatches: () => this.highlightMatches(),
    });
  }

  private drawRow(row: Row, displayIndex: number, recycled?: HTMLElement): HTMLElement {
    this.rowRenderingConfig ??= {
      columns: this.table.columns,
      template: this.template(),
      rowHeight: this.options.rowHeight ?? 34,
      idPrefix: this.idPrefix,
      readOnly: Boolean(this.options.readOnly),
      isRowSelected: (rowId) => this.selection.selectedRows.has(rowId),
      isDraggingSelection: () => Boolean(this.selection.isDragging),
      selectRow: (rowId) => this.selection.selectRow(rowId),
      openRowMenu: (rowId) => this.openRowMenu(rowId),
      moveRow: (sourceId, destinationId) => {
        const index = this.table.rows.findIndex((item) => item.id === destinationId);
        this.commit({ type: "row-move", rowId: sourceId, index }, true);
      },
      onCellPointerDown: (event, rowId, columnId) => this.selection.onCellPointerDown(event, rowId, columnId),
      extendSelection: (rowId, columnId) => this.selection.extendSelection(rowId, columnId),
      selectCell: (rowId, columnId) => this.selection.selectCell(rowId, columnId),
      beginEdit: () => this.beginEdit(),
      inSelection: (rowId, columnId) => this.selection.inSelection(rowId, columnId),
      drawCellContent: (cell, value, column) => this.drawCellContent(cell, value, column),
      styleSelection: (cell) => this.selection.styleCell(cell),
    };
    return renderRow(this.rowRenderingConfig, row, displayIndex, recycled);
  }

  private rowMenu(row: Row, trigger: HTMLElement): HTMLElement {
    const items = rowMenuItems(row, {
      insert: (_row, side) => {
        const index = this.table.rows.findIndex((item) => item.id === row.id);
        this.insertRow(index + (side === "below" ? 1 : 0));
      },
      duplicate: () => {
        const index = this.table.rows.findIndex((item) => item.id === row.id);
        this.commit({
          type: "row-insert",
          row: { id: newId(), cells: structuredClone(row.cells) },
          index: index + 1,
        }, true);
      },
      delete: () => this.deleteSelectedRows(row.id),
    });
    return createContextMenu(trigger, items);
  }

  private openRowMenu(rowId: string): void {
    const row = this.row(rowId);
    const trigger = [...this.querySelectorAll<HTMLElement>(".tg-row-menu-trigger")]
      .find((node) => node.closest<HTMLElement>(".tg-row")?.dataset.rowId === rowId);
    if (!row || !trigger) return;
    this.rowMenuElement?.remove();
    const menu = this.rowMenu(row, trigger);
    menu.dataset.menuRow = rowId;
    trigger.closest(".tg-index")?.append(menu);
    this.rowMenuElement = menu;
    menu.setAttribute("open", "");
  }

  private drawCellContent(cell: HTMLElement, value: CellValue | undefined, column: Column): void {
    renderCellContent(cell, value, column, {
      readOnly: this.options.readOnly,
      numberFractionDigits: this.numberDigits.get(column.id),
      toggleCheckbox: (checked) => {
        this.commit({ type: "cell", rowId: cell.dataset.rowId!, columnId: column.id, value: checked }, true);
      },
    });
  }

  private refreshNumberCells(previous: Map<string, number>): void {
    const changed = new Set(
      [...this.numberDigits].filter(([id, digits]) => previous.get(id) !== digits).map(([id]) => id),
    );
    if (!changed.size) return;
    const rows = new Map(this.table.rows.map((row) => [row.id, row]));
    const columns = new Map(this.table.columns.map((column) => [column.id, column]));
    for (const cell of this.querySelectorAll<HTMLElement>(".tg-cell[data-type=\"number\"]")) {
      const rowId = cell.dataset.rowId;
      const columnId = cell.dataset.columnId;
      if (!rowId || !columnId || !changed.has(columnId) || this.isEditing(rowId, columnId)) continue;
      const row = rows.get(rowId);
      const column = columns.get(columnId);
      if (row && column) this.drawCellContent(cell, row.cells[columnId], column);
    }
  }

  private keyboardContext(): KeyboardContext {
    return {
      table: this.table,
      rows: this.viewRows(),
      active: this.selection.active,
      anchor: this.selection.anchor,
      selectedRows: this.selection.selectedRows,
      selectedColumn: this.selection.selectedColumn,
      readOnly: Boolean(this.options.readOnly),
      editing: Boolean(this.editor),
      selectCell: (rowId, columnId, extend) => this.selection.selectCell(rowId, columnId, extend),
      selectAll: (anchor, active) => this.selection.selectAll(anchor, active),
      beginEdit: (replacement) => this.beginEdit(replacement),
      commit: (change) => this.commit(change, true),
      undo: () => this.undo(),
      redo: () => this.redo(),
    };
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    handleGridKeyDown(event, this.keyboardContext());
  };

  private onCopy = (event: ClipboardEvent): void => {
    handleGridCopy(event, this.keyboardContext());
  };

  private onPaste = (event: ClipboardEvent): void => {
    handleGridPaste(event, this.keyboardContext());
  };

  private moveActive(rowDelta: number, columnDelta: number, extend = false): void {
    moveKeyboardActive(this.keyboardContext(), rowDelta, columnDelta, extend);
  }

  private selectionCells(): ActiveCell[] {
    return getSelectionCells(this.keyboardContext());
  }

  private viewRows(): Row[] {
    return this.visible
      .filter((item): item is Extract<ViewItem, { type: "row" }> => item.type === "row")
      .map((item) => item.row);
  }

  private beginEdit(replacement?: string): void {
    if (this.options.readOnly || !this.selection.active || this.editor) return;
    const { rowId, columnId } = this.selection.active;
    const column = this.column(columnId);
    const row = this.row(rowId);
    const cell = [...this.querySelectorAll<HTMLElement>(".tg-cell")]
      .find((item) => item.dataset.rowId === rowId && item.dataset.columnId === columnId);
    if (!column || !row || !cell) return;

    if (column.type === "checkbox") {
      this.commit({ type: "cell", rowId, columnId, value: row.cells[columnId] !== true }, true);
      return;
    }
    if (column.type === "select" || column.type === "multiselect") {
      this.selectPicker(cell, column, row);
      return;
    }

    const editor = startCellInputEditor({
      cell,
      row,
      column,
      replacement,
      commit: (value) => this.commit({ type: "cell", rowId, columnId, value }, true),
      restore: () => this.drawCellContent(cell, row.cells[columnId], column),
      onFinish: () => { this.editor = undefined; },
      afterFinish: (move) => {
        if (this.pendingRender) this.render();
        if (move) {
          this.moveActive(move === "down" ? 1 : 0, move === "right" ? 1 : move === "left" ? -1 : 0);
        } else {
          this.scrollArea?.focus({ preventScroll: true });
        }
      },
    });
    this.editor = { rowId, columnId, ...editor };
  }

  private selectPicker(cell: HTMLElement, column: Column, row: Row): void {
    this.closeFloating();
    const panel = buildSelectPicker({
      column,
      rowId: row.id,
      getColumn: () => this.column(column.id),
      getValue: () => this.row(row.id)?.cells[column.id],
      commit: (change) => this.commit(change, true),
      close: () => this.closeFloating(),
      focusGrid: () => this.scrollArea?.focus({ preventScroll: true }),
    });
    this.append(panel);
    this.positionPanel(panel, cell);
    this.picker = panel;
    this.editor = {
      rowId: row.id,
      columnId: column.id,
      element: panel,
      finish: () => this.closeFloating(),
    };
    panel.querySelector<HTMLInputElement>(".tg-picker-filter")?.focus();
    this.dismissOnOutside(panel);
  }

  private closeFloating(): void {
    const hadPicker = Boolean(this.picker);
    this.panelLifetime?.abort();
    this.panelLifetime = undefined;
    this.picker?.remove();
    this.picker = undefined;
    this.panel?.remove();
    this.panel = undefined;
    if (this.editor?.element.classList.contains("tg-picker")) this.editor = undefined;
    if (hadPicker && this.pendingRender && !this.rendering) this.render();
  }

  private positionPanel(panel: HTMLElement, anchor: Element): void {
    const rect = anchor.getBoundingClientRect();
    panel.style.position = "fixed";
    panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 320))}px`;
    panel.style.top = `${rect.bottom + 4 + 290 < window.innerHeight ? rect.bottom + 4 : Math.max(12, rect.top - 294)}px`;
  }

  private dismissOnOutside(panel: HTMLElement): void {
    this.panelLifetime?.abort();
    const controller = new AbortController();
    this.panelLifetime = controller;
    document.addEventListener("pointerdown", (event) => {
      if (!panel.contains(event.target as Node)) this.closeFloating();
    }, { signal: controller.signal, capture: true });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !panel.isConnected) return;
      event.stopPropagation();
      this.closeFloating();
      this.scrollArea?.focus({ preventScroll: true });
    }, { signal: controller.signal, capture: true });
  }

  private renameTitle(trigger: HTMLElement): void {
    startInlineRename({
      trigger,
      className: "tg-title-editor",
      value: this.table.title,
      commit: (value) => this.commit({ type: "title", value }, true),
    });
  }

  private renameColumn(columnId: string, head: HTMLElement): void {
    if (this.options.readOnly) return;
    const column = this.column(columnId);
    const label = head.querySelector<HTMLElement>(".tg-head-label");
    if (!column || !label) return;
    startInlineRename({
      trigger: label,
      className: "tg-head-editor",
      value: column.name,
      commit: (name) => this.commit({
        type: "column-update",
        columnId,
        column: { ...column, name },
      }, true),
    });
  }

  private columnPointerConfig(): ColumnPointerConfig {
    return {
      host: this,
      table: () => this.table,
      commit: (change) => this.commit(change, true),
      render: () => this.render(),
      signal: this.lifetime.signal,
    };
  }

  private resizeColumn(event: PointerEvent, columnId: string): void {
    if (!this.options.readOnly) {
      resizeColumnPointer(event, columnId, this.columnPointerConfig());
    }
  }

  private fitColumn(columnId: string): void {
    if (!this.options.readOnly) {
      fitColumnPointer(columnId, this.columnPointerConfig());
    }
  }

  private insertRow(index: number, edit = false): void {
    const row: Row = {
      id: newId(),
      cells: Object.fromEntries(this.table.columns.map((column) => [column.id, null])),
    };
    if (edit) this.view.filter = undefined;
    this.commit({ type: "row-insert", row, index }, true);
    if (edit && this.table.columns[0]) this.openCellEditor(row.id, this.table.columns[0].id);
  }

  private deleteSelectedRows(rowId: string): void {
    const rangeRows = this.selection.selectedColumn
      ? []
      : [...new Set(this.selectionCells().map((cell) => cell.rowId))];
    const ids = this.selection.selectedRows.has(rowId)
      ? [...this.selection.selectedRows]
      : rangeRows.includes(rowId) && rangeRows.length > 1
        ? rangeRows
        : [rowId];
    const changes: TableChange[] = ids.map((id) => ({ type: "row-delete", rowId: id }));
    this.commit({ type: "batch", changes }, true);
    this.selection.clearSelectedRows();
    this.notice(`${ids.length} ${ids.length === 1 ? "row" : "rows"} deleted. Undo`);
  }

  private duplicateColumn(columnId: string): void {
    const column = this.column(columnId);
    if (!column) return;
    const id = newId();
    const index = this.table.columns.findIndex((item) => item.id === columnId) + 1;
    const cells = Object.fromEntries(
      this.table.rows.map((row) => [row.id, structuredClone(row.cells[columnId] ?? null)]),
    );
    this.commit({
      type: "column-insert",
      column: { ...structuredClone(column), id, name: `${column.name} copy`, primary: false },
      index,
      cells,
    }, true);
  }

  private panelAt(anchor: Element): HTMLElement {
    this.closeFloating();
    const panel = element("div", "tg-panel");
    this.append(panel);
    this.panel = panel;
    this.positionPanel(panel, anchor);
    this.dismissOnOutside(panel);
    return panel;
  }

  private columnPanel(index: number, anchor: Element): void {
    if (this.options.readOnly) return;
    const panel = this.panelAt(anchor);
    buildColumnPanel(panel, (name, type) => {
      const column: Column = {
        id: newId(),
        name,
        type,
        width: 160,
      };
      if (type === "select" || type === "multiselect") column.options = [];
      if (type === "currency") column.currency = "USD";
      this.commit({ type: "column-insert", column, index }, true);
    });
  }

  private typePanel(columnId: string, anchor: Element): void {
    const column = this.column(columnId);
    if (!column || this.options.readOnly) return;
    const panel = this.panelAt(anchor);
    buildTypePanel(panel, column, (type) => this.changeType(column, type));
  }

  private changeType(column: Column, type: ColumnType): void {
    if (column.type === type) {
      this.closeFloating();
      return;
    }
    const next: Column = { ...column, type };
    const labels = [...new Set(this.table.rows.map((row) => cellLabel(row.cells[column.id], column)).filter(Boolean))];
    if (type === "select" || type === "multiselect") {
      next.options = labels.map((label, index) => ({
        id: newId(),
        label,
        color: colors[index % colors.length],
      }));
    } else {
      delete next.options;
    }
    if (type === "currency") next.currency = column.currency ?? "USD";
    else delete next.currency;
    const changes: TableChange[] = [{ type: "column-update", columnId: column.id, column: next }];
    for (const row of this.table.rows) {
      const label = cellLabel(row.cells[column.id], column);
      let value: CellValue;
      if (type === "select") {
        value = next.options?.find((item) => item.label === label)?.id ?? null;
      } else if (type === "multiselect") {
        const option = next.options?.find((item) => item.label === label);
        value = option ? [option.id] : [];
      } else {
        value = parseValue(label, next);
      }
      changes.push({ type: "cell", rowId: row.id, columnId: column.id, value });
    }
    this.commit({ type: "batch", changes }, true);
  }

  private summaryPanel(column: Column, anchor: Element): void {
    const panel = this.panelAt(anchor);
    buildSummaryPanel(panel, column, this.summaryModes[column.id] ?? "none", (mode) => {
      this.summaryModes[column.id] = mode;
      this.render();
    });
  }

  private highlightMatches(): void {
    const query = this.view.search.toLowerCase();
    for (const cell of this.querySelectorAll<HTMLElement>(".tg-cell")) {
      const row = this.row(cell.dataset.rowId!), column = this.column(cell.dataset.columnId!);
      cell.classList.toggle("is-match", Boolean(query && row && cellLabel(row.cells[cell.dataset.columnId!], column).toLowerCase().includes(query)));
    }
  }

  private notice(message: string): void {
    this.querySelector(".tg-notice")?.remove();
    const notice = element("div", "tg-notice");
    const text = element("span", undefined, message.replace(/\. Undo$/, "."));
    const undo = button("Undo");
    undo.onclick = () => {
      this.undo();
      notice.remove();
    };
    notice.append(text, undo);
    this.querySelector(".tg-page")?.append(notice);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => notice.remove(), 4500);
  }
}

if (!customElements.get("table-grid")) customElements.define("table-grid", TableGrid);

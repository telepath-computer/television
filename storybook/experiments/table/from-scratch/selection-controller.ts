// Selection has its own state and view-order geometry. The grid supplies DOM
// access so this controller can update focus without owning rows or rendering.

import type { TableData } from "../data.ts";
import type { CellAddress } from "./selection.ts";
import type { ViewItem } from "./view.ts";

/** DOM and table state needed to keep the active cell visible and labelled. */
export interface SelectionHost {
  root: HTMLElement;
  getTable: () => TableData;
  getVisible: () => ViewItem[];
  getScrollArea: () => HTMLElement | undefined;
  getRenderedCell: (rowId: string, columnId: string) => HTMLElement | undefined;
  getRowHeight: () => number;
  getFlash: () => CellAddress | undefined;
  drawRows: () => void;
}

type SelectionRect = {
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
};

/** Tracks one active cell, a rectangular range, or a whole row or column. */
export class SelectionController {
  private currentActive?: CellAddress;
  private currentAnchor?: CellAddress;
  private currentSelectedRows = new Set<string>();
  private currentSelectedColumn?: string;
  private dragAnchor?: CellAddress;
  private rowPositions = new Map<string, number>();
  private columnPositions = new Map<string, number>();
  private rectangle?: SelectionRect;

  constructor(private readonly host: SelectionHost) {}

  get active(): CellAddress | undefined {
    return this.currentActive;
  }

  get anchor(): CellAddress | undefined {
    return this.currentAnchor;
  }

  get selectedRows(): ReadonlySet<string> {
    return this.currentSelectedRows;
  }

  get selectedColumn(): string | undefined {
    return this.currentSelectedColumn;
  }

  get isDragging(): boolean {
    return Boolean(this.dragAnchor);
  }

  /** Clear selection when the element is configured for another table. */
  reset(): void {
    this.currentActive = undefined;
    this.currentAnchor = undefined;
    this.currentSelectedRows.clear();
    this.currentSelectedColumn = undefined;
    this.dragAnchor = undefined;
    this.rowPositions.clear();
    this.columnPositions.clear();
    this.rectangle = undefined;
  }

  /** Rebuild visual positions after sorting, filtering, or changing columns. */
  updatePositions(): void {
    this.rowPositions = new Map(
      this.host.getVisible()
        .filter((item): item is Extract<ViewItem, { type: "row" }> => item.type === "row")
        .map((item, index) => [item.row.id, index]),
    );
    this.columnPositions = new Map(
      this.host.getTable().columns.map((column, index) => [column.id, index]),
    );
    this.updateRectangle();
  }

  /** Test a rendered cell against the current row, column, or range selection. */
  inSelection(rowId: string, columnId: string): boolean {
    if (this.currentSelectedRows.has(rowId) || this.currentSelectedColumn === columnId) {
      return true;
    }
    const row = this.rowPositions.get(rowId);
    const column = this.columnPositions.get(columnId);
    const rectangle = this.rectangle;
    return row !== undefined && column !== undefined && rectangle !== undefined &&
      row >= rectangle.firstRow && row <= rectangle.lastRow &&
      column >= rectangle.firstColumn && column <= rectangle.lastColumn;
  }

  /** Apply active, selected, flash, and ARIA state to a recycled cell. */
  styleCell(cell: HTMLElement): void {
    const rowId = cell.dataset.rowId!;
    const columnId = cell.dataset.columnId!;
    cell.classList.toggle(
      "is-active",
      this.currentActive?.rowId === rowId && this.currentActive.columnId === columnId,
    );
    cell.classList.toggle("is-selected", this.inSelection(rowId, columnId));
    const flash = this.host.getFlash();
    cell.classList.toggle(
      "is-flash",
      flash?.rowId === rowId && flash.columnId === columnId,
    );
  }

  /** Refresh the visible selection and the grid's active-descendant pointer. */
  refresh(): void {
    for (const cell of this.host.root.querySelectorAll<HTMLElement>(".tg-cell")) {
      this.styleCell(cell);
    }
    for (const index of this.host.root.querySelectorAll<HTMLElement>(".tg-index")) {
      index.classList.toggle(
        "is-selected",
        this.currentSelectedRows.has(index.parentElement?.dataset.rowId ?? ""),
      );
    }
    for (const head of this.host.root.querySelectorAll<HTMLElement>(".tg-head")) {
      head.classList.toggle("is-selected", this.currentSelectedColumn === head.dataset.columnId);
    }

    const activeCell = this.currentActive && this.host.getRenderedCell(
      this.currentActive.rowId,
      this.currentActive.columnId,
    );
    const scrollArea = this.host.getScrollArea();
    if (activeCell) scrollArea?.setAttribute("aria-activedescendant", activeCell.id);
    else scrollArea?.removeAttribute("aria-activedescendant");
  }

  /** Select one cell, or extend the current range to that cell. */
  selectCell(rowId: string, columnId: string, extend = false): void {
    if (!extend || !this.currentAnchor) this.currentAnchor = { rowId, columnId };
    this.currentActive = { rowId, columnId };
    this.currentSelectedRows.clear();
    this.currentSelectedColumn = undefined;
    this.updateRectangle();
    this.ensureVisible(rowId, columnId);
    this.refresh();
    this.focusGrid();
  }

  /** Extend a drag selection without scrolling or moving keyboard focus. */
  extendSelection(rowId: string, columnId: string): void {
    if (!this.currentAnchor) this.currentAnchor = this.currentActive ?? { rowId, columnId };
    this.currentActive = { rowId, columnId };
    this.updateRectangle();
    this.refresh();
  }

  /** Select a row from its number. */
  selectRow(rowId: string): void {
    this.currentSelectedRows = new Set([rowId]);
    this.currentSelectedColumn = undefined;
    this.currentActive = {
      rowId,
      columnId: this.host.getTable().columns[0]?.id ?? "",
    };
    this.currentAnchor = this.currentActive;
    this.updateRectangle();
    this.refresh();
    this.focusGrid();
  }

  /** Select a column from its header. */
  selectColumn(columnId: string): void {
    this.currentSelectedColumn = columnId;
    this.currentSelectedRows.clear();
    const firstVisible = this.host.getVisible().find(
      (item): item is Extract<ViewItem, { type: "row" }> => item.type === "row",
    );
    const firstRow = firstVisible?.row;
    if (firstRow) {
      this.currentActive = { rowId: firstRow.id, columnId };
      this.currentAnchor = this.currentActive;
    } else {
      this.currentActive = undefined;
      this.currentAnchor = undefined;
    }
    this.updateRectangle();
    this.refresh();
    this.focusGrid();
  }

  /** Select every visible row and column for the keyboard shortcut. */
  selectAll(anchor: CellAddress, active: CellAddress): void {
    this.currentAnchor = anchor;
    this.currentActive = active;
    this.currentSelectedRows.clear();
    this.currentSelectedColumn = undefined;
    this.updateRectangle();
    this.refresh();
  }

  /** Clear row-only selection after a row operation. */
  clearSelectedRows(): void {
    this.currentSelectedRows.clear();
    this.refresh();
  }

  /** Begin click-drag selection on the primary pointer only. */
  onCellPointerDown(event: PointerEvent, rowId: string, columnId: string): void {
    if (event.button !== 0) return;
    this.selectCell(rowId, columnId, event.shiftKey);
    this.dragAnchor = this.currentAnchor;
  }

  /** Stop drag extension when the pointer is released anywhere in the page. */
  onPointerUp(): void {
    this.dragAnchor = undefined;
  }

  private focusGrid(): void {
    this.host.getScrollArea()?.focus({ preventScroll: true });
  }

  private updateRectangle(): void {
    const anchor = this.currentAnchor;
    const active = this.currentActive;
    if (!anchor || !active) {
      this.rectangle = undefined;
      return;
    }
    const firstRow = this.rowPositions.get(anchor.rowId);
    const lastRow = this.rowPositions.get(active.rowId);
    const firstColumn = this.columnPositions.get(anchor.columnId);
    const lastColumn = this.columnPositions.get(active.columnId);
    if (
      firstRow === undefined || lastRow === undefined ||
      firstColumn === undefined || lastColumn === undefined
    ) {
      this.rectangle = undefined;
      return;
    }
    this.rectangle = {
      firstRow: Math.min(firstRow, lastRow),
      lastRow: Math.max(firstRow, lastRow),
      firstColumn: Math.min(firstColumn, lastColumn),
      lastColumn: Math.max(firstColumn, lastColumn),
    };
  }

  private ensureVisible(rowId: string, columnId: string): void {
    const scrollArea = this.host.getScrollArea();
    if (!scrollArea) return;

    const visible = this.host.getVisible();
    const rowIndex = visible.findIndex(
      (item) => item.type === "row" && item.row.id === rowId,
    );
    const rowHeight = this.host.getRowHeight();
    // Group bands have a fixed 34px height, independent of the chosen row
    // height. Accounting for them keeps keyboard navigation aligned in views.
    const top = 40 + visible.slice(0, Math.max(0, rowIndex)).reduce(
      (offset, item) => offset + (item.type === "group" ? 34 : rowHeight),
      0,
    );
    if (rowIndex >= 0 && top < scrollArea.scrollTop + 40) {
      scrollArea.scrollTop = Math.max(0, top - 40);
    }
    if (
      rowIndex >= 0 &&
      top + rowHeight > scrollArea.scrollTop + scrollArea.clientHeight
    ) {
      scrollArea.scrollTop = top + rowHeight - scrollArea.clientHeight;
    }
    this.host.drawRows();

    const columns = this.host.getTable().columns;
    const index = columns.findIndex((column) => column.id === columnId);
    if (index < 0) return;
    const x = 48 + columns.slice(0, index).reduce((sum, column) => sum + column.width, 0);
    const width = columns[index].width;
    const sticky = 48 + (columns.find((column) => column.primary)?.width ?? 0);
    if (x >= sticky && x < scrollArea.scrollLeft + sticky) {
      scrollArea.scrollLeft = x - sticky;
    }
    if (x + width > scrollArea.scrollLeft + scrollArea.clientWidth) {
      scrollArea.scrollLeft = x + width - scrollArea.clientWidth;
    }
  }
}

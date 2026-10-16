// Keyboard navigation and clipboard edits use the grid's current view. The
// owning element supplies actions, while selection geometry stays in one place.

import type { CellValue, Row, TableData } from "../data.ts";
import type { TableChange } from "./model.ts";
import { selectedCells, type CellAddress } from "./selection.ts";
import { cellLabel, parseValue } from "./view.ts";

/** The state keyboard actions need from a rendered grid. */
export interface KeyboardState {
  table: TableData;
  rows: Row[];
  active?: CellAddress;
  anchor?: CellAddress;
  selectedRows: ReadonlySet<string>;
  selectedColumn?: string;
  readOnly: boolean;
  editing: boolean;
}

/** Mutations remain with the element so they use its change and render path. */
export interface KeyboardActions {
  selectCell: (rowId: string, columnId: string, extend?: boolean) => void;
  selectAll: (anchor: CellAddress, active: CellAddress) => void;
  beginEdit: (replacement?: string) => void;
  commit: (change: TableChange) => void;
  undo: () => void;
  redo: () => void;
}

export type KeyboardContext = KeyboardState & KeyboardActions;

/** Move the active cell in view order, optionally extending its selection. */
export function moveActive(
  context: KeyboardContext,
  rowDelta: number,
  columnDelta: number,
  extend = false,
  edge = false,
): void {
  const { rows, table, active } = context;
  if (!rows.length || !table.columns.length) return;

  const rowIndex = Math.max(0, rows.findIndex((row) => row.id === active?.rowId));
  const columnIndex = Math.max(
    0,
    table.columns.findIndex((column) => column.id === active?.columnId),
  );
  const nextRow = edge && rowDelta
    ? rowDelta > 0 ? rows.length - 1 : 0
    : Math.max(0, Math.min(rows.length - 1, rowIndex + rowDelta));
  const nextColumn = edge && columnDelta
    ? columnDelta > 0 ? table.columns.length - 1 : 0
    : Math.max(0, Math.min(table.columns.length - 1, columnIndex + columnDelta));

  context.selectCell(rows[nextRow].id, table.columns[nextColumn].id, extend);
}

/** Return selected addresses in view order for bulk edits and row actions. */
export function selectionCells(context: KeyboardState): CellAddress[] {
  return selectedCells(
    context.rows,
    context.table.columns,
    context.anchor,
    context.active,
    context.selectedRows,
    context.selectedColumn,
  );
}

/** Clear a range as one change, one event, and one undo step. */
export function clearSelection(context: KeyboardContext): void {
  const rows = new Map<string, Record<string, CellValue>>();
  for (const { rowId, columnId } of selectionCells(context)) {
    const values = rows.get(rowId) ?? {};
    values[columnId] = null;
    rows.set(rowId, values);
  }
  if (!rows.size) return;
  context.commit({
    type: "batch",
    changes: [{
      type: "cells",
      rows: [...rows].map(([id, values]) => ({ id, values })),
    }],
  });
}

/** Copy selected cells as tab-separated display values. */
export function copySelection(context: KeyboardState): string {
  const cells = selectionCells(context);
  const rows = [...new Set(cells.map((cell) => cell.rowId))];
  const columns = [...new Set(cells.map((cell) => cell.columnId))];
  const rowById = new Map(context.table.rows.map((row) => [row.id, row]));
  const columnById = new Map(context.table.columns.map((column) => [column.id, column]));

  return rows.map((rowId) => columns.map((columnId) => cellLabel(
    rowById.get(rowId)?.cells[columnId],
    columnById.get(columnId),
  )).join("\t")).join("\n");
}

/** Parse pasted text according to destination column types as one change. */
export function paste(context: KeyboardContext, text: string): void {
  if (context.readOnly || !context.active || !text) return;

  const rowIndex = context.rows.findIndex((row) => row.id === context.active?.rowId);
  const columnIndex = context.table.columns.findIndex(
    (column) => column.id === context.active?.columnId,
  );
  const changes: TableChange[] = [];
  text.replace(/\n$/, "").split(/\r?\n/).forEach((line, y) => {
    line.split("\t").forEach((value, x) => {
      const row = context.rows[rowIndex + y];
      const column = context.table.columns[columnIndex + x];
      if (!row || !column) return;
      changes.push({
        type: "cell",
        rowId: row.id,
        columnId: column.id,
        value: parseValue(value, column),
      });
    });
  });
  if (changes.length) context.commit({ type: "batch", changes });
}

/** Handle grid-level shortcuts after inputs and floating panels get first use. */
export function onKeyDown(event: KeyboardEvent, context: KeyboardContext): void {
  if (context.editing) return;
  const target = event.target as HTMLElement;
  if (target.closest("input, button, select, textarea, tv-menu, tv-menu-item, .tg-picker, .tg-panel")) {
    return;
  }

  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (!context.readOnly) event.shiftKey ? context.redo() : context.undo();
    return;
  }
  if (command && event.key.toLowerCase() === "a") {
    event.preventDefault();
    const { rows, table } = context;
    if (rows.length && table.columns.length) {
      context.selectAll(
        { rowId: rows[0].id, columnId: table.columns[0].id },
        { rowId: rows.at(-1)!.id, columnId: table.columns.at(-1)!.id },
      );
    }
    return;
  }
  if (command && event.key.toLowerCase() === "c") {
    void navigator.clipboard?.writeText(copySelection(context)).catch(() => {});
    return;
  }
  if (command && event.key.toLowerCase() === "v") return;

  const arrows: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  const direction = arrows[event.key];
  if (direction) {
    event.preventDefault();
    moveActive(context, ...direction, event.shiftKey, command);
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    moveActive(context, 0, event.shiftKey ? -1 : 1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    context.beginEdit();
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && !context.readOnly) {
    event.preventDefault();
    clearSelection(context);
    return;
  }
  if (event.key === " " && context.active && !context.readOnly) {
    const column = context.table.columns.find((item) => item.id === context.active?.columnId);
    if (column?.type === "checkbox") {
      event.preventDefault();
      const value = context.table.rows.find((row) => row.id === context.active?.rowId)
        ?.cells[column.id];
      context.commit({ type: "cell", ...context.active, value: value !== true });
      return;
    }
  }
  if (!command && !event.altKey && event.key.length === 1 && !context.readOnly) {
    event.preventDefault();
    context.beginEdit(event.key);
  }
}

/** Supply the selected TSV to a native copy event when the grid owns focus. */
export function onCopy(event: ClipboardEvent, context: KeyboardState): void {
  const target = event.target as Element;
  if (!context.active || context.editing || !target.closest(".tg-scroll")) return;
  if (target.closest("input, textarea, [contenteditable]")) return;
  event.clipboardData?.setData("text/plain", copySelection(context));
  event.preventDefault();
}

/** Read a native paste event and submit a single batch change. */
export function onPaste(event: ClipboardEvent, context: KeyboardContext): void {
  const target = event.target as Element;
  if (context.editing || !target.closest(".tg-scroll")) return;
  if (target.closest("input, textarea, [contenteditable]")) return;
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return;
  event.preventDefault();
  paste(context, text);
}

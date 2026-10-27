import type { DisplayAxisItem } from "./model.js";

/** The displayed row and column positions used by selection transitions. */
export interface TableDisplayAxes {
  rows: DisplayAxisItem[];
  columns: DisplayAxisItem[];
}

/** One selected body cell. */
export interface TableCellSelection {
  kind: "cell";
  rowId: string;
  columnId: string;
}

/** One selected header cell. */
export interface TableHeaderSelection {
  kind: "header";
  columnId: string;
}

/** One contiguous whole-row or whole-column selection. */
export interface TableAxisSelection {
  kind: "rows" | "columns";
  ids: string[];
  anchorId: string;
  activeId: string;
}

/** Any current Table selection. */
export type TableSelection = TableCellSelection | TableHeaderSelection | TableAxisSelection;

/** A keyboard command that can affect selection. */
export type TableSelectionCommand = "left" | "right" | "up" | "down" | "tab-forward" | "tab-backward"
  | "select-row" | "select-column";

/** The result of one keyboard selection command. */
export interface TableSelectionMove {
  selection: TableSelection | null;
  exit: "before" | "after" | null;
}

/** Selects one body cell at a displayed position. */
export function cellSelectionAt(axes: TableDisplayAxes, rowIndex: number, columnIndex: number): TableCellSelection | null;

/** Selects one header cell at a displayed column position. */
export function headerSelectionAt(axes: TableDisplayAxes, columnIndex: number): TableHeaderSelection | null;

/** Selects one axis item or extends an existing same-axis range from its anchor. */
export function selectAxis(selection: TableSelection | null, kind: "rows" | "columns", index: number,
  extend: boolean, axes: TableDisplayAxes): TableAxisSelection | null;

/** Applies one keyboard selection command and reports when Tab should leave the table. */
export function moveSelection(selection: TableSelection | null, command: TableSelectionCommand, axes: TableDisplayAxes,
  options: { showHeader: boolean; extend?: boolean }): TableSelectionMove;

/** Returns the retained selection when entering the table, or selects its first body cell. */
export function enterTable(selection: TableSelection | null, axes: TableDisplayAxes): TableSelection | null;

/** Resolves the row or column selection whose action menu should open. */
export function selectionForMenu(selection: TableSelection | null, axes: TableDisplayAxes): TableAxisSelection | null;

/** Follows selected identities through a new display snapshot, clearing any invalid selection. */
export function reconcileSelection(selection: TableSelection | null, axes: TableDisplayAxes,
  showHeader: boolean): TableSelection | null;

/** Selects the new entry's body cell after an add-at-end action. */
export function selectionAfterAdd(previous: TableSelection | null, axis: "rows" | "columns", newKey: string,
  axes: TableDisplayAxes): TableCellSelection | null;

/** Selects the one new whole row or column after insertion. */
export function selectionAfterInsert(axis: "rows" | "columns", newKey: string,
  axes: TableDisplayAxes): TableAxisSelection | null;

/** Selects the former position, or the new last position, after deletion. */
export function selectionAfterDelete(axis: "rows" | "columns", formerIndex: number,
  axes: TableDisplayAxes): TableAxisSelection | null;

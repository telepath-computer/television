// Selection geometry is computed once for bulk operations. A per-cell scan of
// all 2,000 rows turned a simple clear into millions of repeated lookups.

import type { Column, Row } from "../data.ts";

export interface CellAddress {
  rowId: string;
  columnId: string;
}

/** Return addresses in visual order for a selected rectangular range. */
export function selectedCells(
  rows: Row[],
  columns: Column[],
  anchor: CellAddress | undefined,
  active: CellAddress | undefined,
  selectedRows: ReadonlySet<string>,
  selectedColumn: string | undefined,
): CellAddress[] {
  if (selectedColumn) {
    return rows.map((row) => ({ rowId: row.id, columnId: selectedColumn }));
  }
  if (selectedRows.size) {
    return rows
      .filter((row) => selectedRows.has(row.id))
      .flatMap((row) => columns.map((column) => ({ rowId: row.id, columnId: column.id })));
  }
  if (!anchor || !active) return [];

  const firstRow = rows.findIndex((row) => row.id === anchor.rowId);
  const lastRow = rows.findIndex((row) => row.id === active.rowId);
  const firstColumn = columns.findIndex((column) => column.id === anchor.columnId);
  const lastColumn = columns.findIndex((column) => column.id === active.columnId);
  if (firstRow < 0 || lastRow < 0 || firstColumn < 0 || lastColumn < 0) return [];

  const chosenRows = rows.slice(Math.min(firstRow, lastRow), Math.max(firstRow, lastRow) + 1);
  const chosenColumns = columns.slice(
    Math.min(firstColumn, lastColumn),
    Math.max(firstColumn, lastColumn) + 1,
  );
  return chosenRows.flatMap((row) => chosenColumns.map((column) => ({
    rowId: row.id,
    columnId: column.id,
  })));
}

// All stored edits pass through these pure functions. An inverse is ordinary
// change data, so local undo and later store updates use the same path.

import type { CellValue, Column, Row, SelectOption, TableData } from "../data.ts";

/** A serializable change to stored table data. */
export type TableChange =
  | { type: "batch"; changes: TableChange[] }
  | { type: "cell"; rowId: string; columnId: string; value: CellValue }
  | { type: "cells"; rows: Array<{ id: string; values: Record<string, CellValue> }> }
  | { type: "row-insert"; row: Row; index: number }
  | { type: "row-delete"; rowId: string }
  | { type: "row-move"; rowId: string; index: number }
  | { type: "column-insert"; column: Column; index: number; cells?: Record<string, CellValue> }
  | { type: "column-delete"; columnId: string }
  | { type: "column-update"; columnId: string; column: Column }
  | { type: "column-move"; columnId: string; index: number }
  | { type: "option-add"; columnId: string; option: SelectOption }
  | { type: "option-delete"; columnId: string; optionId: string }
  | { type: "title"; value: string };

/** Apply a change without mutating its input and return its inverse. */
export function applyChange(table: TableData, change: TableChange): { table: TableData; inverse: TableChange } {
  if (change.type === "batch") {
    if (change.changes.every((part) => part.type === "cell")) {
      const rows = table.rows.map((row) => ({ ...row, cells: { ...row.cells } }));
      const byId = new Map(rows.map((row) => [row.id, row]));
      const inverses: TableChange[] = [];
      for (const part of change.changes) {
        if (part.type !== "cell") continue;
        const row = byId.get(part.rowId);
        if (!row) continue;
        inverses.push({ ...part, value: row.cells[part.columnId] ?? null });
        row.cells[part.columnId] = part.value;
      }
      inverses.reverse();
      return { table: { ...table, rows }, inverse: { type: "batch", changes: inverses } };
    }
    let next = table;
    const inverses: TableChange[] = [];
    for (const part of change.changes) {
      const result = applyChange(next, part);
      next = result.table;
      inverses.push(result.inverse);
    }
    inverses.reverse();
    return { table: next, inverse: { type: "batch", changes: inverses } };
  }

  if (change.type === "title") return { table: { ...table, title: change.value }, inverse: { type: "title", value: table.title } };

  if (change.type === "cell") {
    const row = table.rows.find((item) => item.id === change.rowId);
    if (!row) return { table, inverse: change };
    const previous = row.cells[change.columnId] ?? null;
    return {
      table: { ...table, rows: table.rows.map((item) => item.id === row.id ? { ...item, cells: { ...item.cells, [change.columnId]: change.value } } : item) },
      inverse: { ...change, value: previous },
    };
  }

  if (change.type === "cells") {
    const updates = new Map(change.rows.map((entry) => [entry.id, entry.values]));
    const inverseRows: Array<{ id: string; values: Record<string, CellValue> }> = [];
    const rows = table.rows.map((row) => {
      const values = updates.get(row.id);
      if (!values) return row;
      const previous: Record<string, CellValue> = {};
      for (const columnId of Object.keys(values)) {
        previous[columnId] = row.cells[columnId] ?? null;
      }
      inverseRows.push({ id: row.id, values: previous });
      return { ...row, cells: { ...row.cells, ...values } };
    });
    if (!inverseRows.length) return { table, inverse: change };
    return {
      table: { ...table, rows },
      inverse: { type: "cells", rows: inverseRows },
    };
  }

  if (change.type === "row-insert") {
    const rows = [...table.rows];
    rows.splice(Math.max(0, Math.min(change.index, rows.length)), 0, structuredClone(change.row));
    return { table: { ...table, rows }, inverse: { type: "row-delete", rowId: change.row.id } };
  }
  if (change.type === "row-delete") {
    const index = table.rows.findIndex((row) => row.id === change.rowId);
    if (index < 0) return { table, inverse: change };
    return { table: { ...table, rows: table.rows.filter((row) => row.id !== change.rowId) }, inverse: { type: "row-insert", row: table.rows[index], index } };
  }
  if (change.type === "row-move") {
    const index = table.rows.findIndex((row) => row.id === change.rowId);
    if (index < 0) return { table, inverse: change };
    const rows = [...table.rows];
    const [row] = rows.splice(index, 1);
    rows.splice(Math.max(0, Math.min(change.index, rows.length)), 0, row);
    return { table: { ...table, rows }, inverse: { ...change, index } };
  }

  if (change.type === "column-insert") {
    const columns = [...table.columns];
    const earliest = columns.some((column) => column.primary) && !change.column.primary ? 1 : 0;
    columns.splice(Math.max(earliest, Math.min(change.index, columns.length)), 0, structuredClone(change.column));
    const rows = table.rows.map((row) => ({ ...row, cells: { ...row.cells, [change.column.id]: change.cells?.[row.id] ?? null } }));
    return { table: { ...table, columns, rows }, inverse: { type: "column-delete", columnId: change.column.id } };
  }
  if (change.type === "column-delete") {
    const index = table.columns.findIndex((column) => column.id === change.columnId);
    if (index < 0) return { table, inverse: change };
    const column = table.columns[index];
    const cells = Object.fromEntries(table.rows.map((row) => [row.id, row.cells[column.id] ?? null]));
    const rows = table.rows.map((row) => {
      const next = { ...row.cells };
      delete next[column.id];
      return { ...row, cells: next };
    });
    return {
      table: { ...table, columns: table.columns.filter((item) => item.id !== column.id), rows },
      inverse: { type: "column-insert", column, index, cells },
    };
  }
  if (change.type === "column-update") {
    const previous = table.columns.find((column) => column.id === change.columnId);
    if (!previous) return { table, inverse: change };
    return {
      table: {
        ...table,
        columns: table.columns.map((column) => column.id === change.columnId
          ? structuredClone(change.column)
          : column),
      },
      inverse: { type: "column-update", columnId: change.columnId, column: previous },
    };
  }
  if (change.type === "column-move") {
    const index = table.columns.findIndex((column) => column.id === change.columnId);
    if (index < 0) return { table, inverse: change };
    if (table.columns[index].primary) return { table, inverse: change };
    const columns = [...table.columns];
    const [column] = columns.splice(index, 1);
    columns.splice(Math.max(columns.some((item) => item.primary) ? 1 : 0, Math.min(change.index, columns.length)), 0, column);
    return { table: { ...table, columns }, inverse: { ...change, index } };
  }
  if (change.type === "option-add" || change.type === "option-delete") {
    const column = table.columns.find((item) => item.id === change.columnId);
    if (!column) return { table, inverse: change };
    const option = change.type === "option-add" ? change.option : column.options?.find((item) => item.id === change.optionId);
    if (!option) return { table, inverse: change };
    const options = change.type === "option-add" ? [...column.options ?? [], option] : (column.options ?? []).filter((item) => item.id !== option.id);
    return {
      table: { ...table, columns: table.columns.map((item) => item.id === column.id ? { ...item, options } : item) },
      inverse: change.type === "option-add"
        ? { type: "option-delete", columnId: column.id, optionId: option.id }
        : { type: "option-add", columnId: column.id, option },
    };
  }
  return { table, inverse: change };
}

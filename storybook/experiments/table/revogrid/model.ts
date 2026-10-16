// In-memory table model for the experiment. Every local edit is a plain change
// object, so the same boundary could later write to an artifact JSON store.

import type { CellValue, Column, ColumnType, SelectOption, TableData, Row } from "../data";

type CellEdit = { rowId: string; columnId: string; value: CellValue; previous: CellValue };
type RestoredRow = { row: Row; index: number; height?: number };

export type TableChange =
  | { type: "cell.set"; rowId: string; columnId: string; value: CellValue; previous: CellValue }
  | { type: "cells.set"; cells: CellEdit[] }
  | { type: "row.insert"; row: Row; index: number; height?: number }
  | { type: "row.delete"; rowId: string; index: number }
  | { type: "rows.delete"; rowIds: string[] }
  | { type: "rows.restore"; rows: RestoredRow[] }
  | { type: "row.move"; rowId: string; from: number; to: number }
  | { type: "row.resize"; rowId: string; height: number | null }
  | { type: "column.insert"; column: Column; index: number; values?: Record<string, CellValue> }
  | { type: "column.duplicate"; sourceId: string; column: Column; index: number }
  | { type: "column.delete"; columnId: string; index: number }
  | { type: "column.replace"; column: Column; values: Record<string, CellValue> }
  | { type: "column.move"; columnId: string; from: number; to: number }
  | { type: "column.reorder"; columnIds: string[] }
  | { type: "column.rename"; columnId: string; name: string }
  | { type: "column.retype"; columnId: string; columnType: ColumnType }
  | { type: "column.resize"; columnId: string; width: number }
  | { type: "option.add"; columnId: string; option: SelectOption }
  | { type: "option.remove"; columnId: string; optionId: string }
  | { type: "title.set"; title: string }
  | { type: "row.height"; height: number };

type HistoryEntry = { forward: TableChange; inverse: TableChange };

const colors: SelectOption["color"][] = ["blue", "green", "purple", "orange", "pink", "yellow", "red", "neutral"];

/** Normalize user input before a cell enters the model. */
// A random id. crypto.randomUUID exists only in secure contexts, and
// Television serves artifacts over plain HTTP on the tailnet, so this uses
// getRandomValues, which every context has.
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function convertValue(input: unknown, column: Column): CellValue {
  if (input === null || input === undefined || input === "") return null;
  if (column.type === "checkbox") return input === true || input === "true" || input === "1" || input === "yes";
  if (column.type === "number" || column.type === "currency") {
    const number = Number(String(input).replace(/[$,\s]/g, ""));
    return Number.isFinite(number) ? number : null;
  }
  if (column.type === "multiselect") {
    const labels = Array.isArray(input) ? input.map(String) : String(input).split(",").map((part) => part.trim());
    return labels.map((label) => column.options?.find((option) => option.id === label || option.label.toLowerCase() === label.toLowerCase())?.id)
      .filter((id): id is string => Boolean(id));
  }
  if (column.type === "select") {
    const label = String(input);
    return column.options?.find((option) => option.id === label || option.label.toLowerCase() === label.toLowerCase())?.id ?? null;
  }
  if (column.type === "date") {
    const value = String(input);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }
  return String(input);
}

/** Owns the editable table, history, and change feed. */
export class TableModel {
  data: TableData;
  rowHeight = 34;
  rowHeights: Record<string, number> = {};
  changes: TableChange[] = [];
  onChange: (change: TableChange) => void = () => {};
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(data: TableData) { this.data = structuredClone(data); }

  private announce(change: TableChange) {
    // History may be rebased after an outside write. Published events are
    // immutable records and must not change under an already drawn log.
    const record = structuredClone(change);
    this.changes.unshift(record);
    this.onChange(record);
  }

  /** Apply a local change and retain only the operation needed to reverse it. */
  apply(change: TableChange): void {
    const forward = structuredClone(change);
    const inverse = this.inverseOf(forward);
    this.mutate(forward);
    this.undoStack.push({ forward, inverse });
    this.redoStack = [];
    this.announce(forward);
  }

  // Inverses are plain changes, including the affected rows or column values
  // when deletion or retyping would otherwise discard them. Normal cell edits
  // retain only their former values, independent of table size.
  private inverseOf(change: TableChange): TableChange {
    const data = this.data;
    switch (change.type) {
      case "cell.set": {
        const previous = data.rows.find((row) => row.id === change.rowId)?.cells[change.columnId] ?? null;
        change.previous = structuredClone(previous);
        return { ...change, value: structuredClone(previous), previous: structuredClone(change.value) };
      }
      case "cells.set": {
        const current = new Map<string, CellValue>();
        for (const cell of change.cells) {
          const key = `${cell.rowId}\u0000${cell.columnId}`;
          const previous = current.has(key) ? current.get(key)! : data.rows.find((row) => row.id === cell.rowId)?.cells[cell.columnId] ?? null;
          cell.previous = structuredClone(previous);
          current.set(key, cell.value);
        }
        return { type: "cells.set", cells: [...change.cells].reverse().map((cell) => ({ ...cell, value: structuredClone(cell.previous), previous: structuredClone(cell.value) })) };
      }
      case "row.insert": return { type: "row.delete", rowId: change.row.id, index: change.index };
      case "row.delete": {
        const row = data.rows.find((item) => item.id === change.rowId)!;
        return { type: "row.insert", row: structuredClone(row), index: data.rows.indexOf(row), height: this.rowHeights[row.id] };
      }
      case "rows.delete": {
        const ids = new Set(change.rowIds);
        return { type: "rows.restore", rows: data.rows.flatMap((row, index) => ids.has(row.id) ? [{ row: structuredClone(row), index, height: this.rowHeights[row.id] }] : []) };
      }
      case "rows.restore": return { type: "rows.delete", rowIds: change.rows.map((item) => item.row.id) };
      case "row.move": return { ...change, from: change.to, to: change.from };
      case "row.resize": return { type: "row.resize", rowId: change.rowId, height: this.rowHeights[change.rowId] ?? null };
      case "column.insert": return { type: "column.delete", columnId: change.column.id, index: change.index };
      case "column.duplicate": return { type: "column.delete", columnId: change.column.id, index: change.index };
      case "column.delete": {
        const column = data.columns.find((item) => item.id === change.columnId)!;
        return { type: "column.insert", column: structuredClone(column), index: data.columns.indexOf(column), values: this.columnValues(column.id) };
      }
      case "column.replace": return { type: "column.replace", column: structuredClone(data.columns.find((item) => item.id === change.column.id)!), values: this.columnValues(change.column.id) };
      case "column.move": return { ...change, from: change.to, to: change.from };
      case "column.reorder": return { type: "column.reorder", columnIds: data.columns.map((column) => column.id) };
      case "column.rename": return { ...change, name: data.columns.find((column) => column.id === change.columnId)!.name };
      case "column.retype": {
        const column = data.columns.find((item) => item.id === change.columnId)!;
        return { type: "column.replace", column: structuredClone(column), values: this.columnValues(column.id) };
      }
      case "column.resize": return { ...change, width: data.columns.find((column) => column.id === change.columnId)!.width };
      case "option.add": return { type: "option.remove", columnId: change.columnId, optionId: change.option.id };
      case "option.remove": return { type: "option.add", columnId: change.columnId, option: structuredClone(data.columns.find((column) => column.id === change.columnId)!.options!.find((option) => option.id === change.optionId)!) };
      case "title.set": return { type: "title.set", title: data.title };
      case "row.height": return { type: "row.height", height: this.rowHeight };
    }
  }

  private columnValues(columnId: string): Record<string, CellValue> {
    return Object.fromEntries(this.data.rows.map((row) => [row.id, structuredClone(row.cells[columnId] ?? null)]));
  }

  private mutate(change: TableChange): void {
    const data = this.data;
    switch (change.type) {
      case "cell.set": {
        const row = data.rows.find((item) => item.id === change.rowId);
        if (row) row.cells[change.columnId] = change.value;
        break;
      }
      case "cells.set":
        for (const cell of change.cells) {
          const row = data.rows.find((item) => item.id === cell.rowId);
          if (row) row.cells[cell.columnId] = cell.value;
        }
        break;
      case "row.insert":
        data.rows.splice(change.index, 0, structuredClone(change.row));
        if (change.height !== undefined) this.rowHeights[change.row.id] = change.height;
        break;
      case "row.delete": {
        const index = data.rows.findIndex((row) => row.id === change.rowId);
        if (index >= 0) data.rows.splice(index, 1);
        delete this.rowHeights[change.rowId];
        break;
      }
      case "rows.delete":
      {
        const ids = new Set(change.rowIds);
        data.rows = data.rows.filter((row) => !ids.has(row.id));
        for (const rowId of change.rowIds) delete this.rowHeights[rowId];
        break;
      }
      case "rows.restore":
        for (const item of [...change.rows].sort((a, b) => a.index - b.index)) {
          data.rows.splice(item.index, 0, structuredClone(item.row));
          if (item.height !== undefined) this.rowHeights[item.row.id] = item.height;
        }
        break;
      case "row.move": data.rows.splice(change.to, 0, ...data.rows.splice(change.from, 1)); break;
      case "row.resize":
        if (change.height === null) delete this.rowHeights[change.rowId];
        else this.rowHeights[change.rowId] = change.height;
        break;
      case "column.insert":
        data.columns.splice(change.index, 0, structuredClone(change.column));
        if (change.values) for (const row of data.rows) row.cells[change.column.id] = structuredClone(change.values[row.id] ?? null);
        break;
      case "column.duplicate":
        data.columns.splice(change.index, 0, structuredClone(change.column));
        for (const row of data.rows) row.cells[change.column.id] = structuredClone(row.cells[change.sourceId] ?? null);
        break;
      case "column.delete": {
        const index = data.columns.findIndex((column) => column.id === change.columnId);
        if (index >= 0) data.columns.splice(index, 1);
        for (const row of data.rows) delete row.cells[change.columnId];
        break;
      }
      case "column.replace": {
        const index = data.columns.findIndex((column) => column.id === change.column.id);
        data.columns[index] = structuredClone(change.column);
        for (const row of data.rows) row.cells[change.column.id] = structuredClone(change.values[row.id] ?? null);
        break;
      }
      case "column.move": data.columns.splice(change.to, 0, ...data.columns.splice(change.from, 1)); break;
      case "column.reorder": data.columns.sort((a, b) => change.columnIds.indexOf(a.id) - change.columnIds.indexOf(b.id)); break;
      case "column.rename": data.columns.find((column) => column.id === change.columnId)!.name = change.name; break;
      case "column.resize": data.columns.find((column) => column.id === change.columnId)!.width = change.width; break;
      case "column.retype": {
        const column = data.columns.find((item) => item.id === change.columnId)!;
        const oldColumn = structuredClone(column);
        const labelsFor = (value: CellValue | undefined): string[] => {
          if (value == null || value === "") return [];
          const values = Array.isArray(value) ? value : [value];
          return values.map((item) => oldColumn.options?.find((option) => option.id === item)?.label ?? String(item));
        };
        const labelsByRow = data.rows.map((row) => labelsFor(row.cells[column.id]));
        column.type = change.columnType;
        if (change.columnType === "select" || change.columnType === "multiselect") {
          const labels = [...new Set(labelsByRow.flat())];
          column.options = labels.map((label, index) => ({ id: `option-${index}-${label.toLowerCase().replace(/\W+/g, "-")}`, label, color: colors[index % colors.length] }));
          for (const [index, row] of data.rows.entries()) {
            const ids = labelsByRow[index].map((label) => column.options!.find((option) => option.label === label)!.id);
            row.cells[column.id] = change.columnType === "multiselect" ? ids : ids[0] ?? null;
          }
        } else {
          for (const [index, row] of data.rows.entries()) {
            row.cells[column.id] = convertValue(labelsByRow[index].join(", "), column);
          }
          delete column.options;
        }
        break;
      }
      case "option.add": data.columns.find((column) => column.id === change.columnId)!.options!.push(change.option); break;
      case "option.remove": {
        const options = data.columns.find((column) => column.id === change.columnId)!.options!;
        const index = options.findIndex((option) => option.id === change.optionId);
        if (index >= 0) options.splice(index, 1);
        break;
      }
      case "title.set": data.title = change.title; break;
      case "row.height": this.rowHeight = change.height; break;
    }
  }

  /** Record an external edit without adding it to the person's undo stack. */
  externalSet(rowId: string, columnId: string, value: CellValue): void {
    const row = this.data.rows.find((item) => item.id === rowId);
    if (!row) return;
    const previous = row.cells[columnId] ?? null;
    row.cells[columnId] = value;
    // An outside write supersedes local edits to that cell. Rebase any pending
    // history operation touching it, so undo and redo cannot roll the write back.
    for (const entry of [...this.undoStack, ...this.redoStack]) {
      this.rebase(entry.forward, rowId, columnId, value);
      this.rebase(entry.inverse, rowId, columnId, value);
    }
    this.announce({ type: "cell.set", rowId, columnId, value, previous });
  }

  private rebase(change: TableChange, rowId: string, columnId: string, value: CellValue): void {
    if (change.type === "cell.set" && change.rowId === rowId && change.columnId === columnId) { change.value = value; change.previous = value; }
    if (change.type === "cells.set") for (const cell of change.cells) if (cell.rowId === rowId && cell.columnId === columnId) { cell.value = value; cell.previous = value; }
    if (change.type === "row.insert" && change.row.id === rowId) change.row.cells[columnId] = value;
    if (change.type === "rows.restore") for (const item of change.rows) if (item.row.id === rowId) item.row.cells[columnId] = value;
    if ((change.type === "column.insert" || change.type === "column.replace") && change.column.id === columnId && change.values) change.values[rowId] = value;
  }

  /** Apply and emit the inverse of the latest local change. */
  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.mutate(entry.inverse);
    this.redoStack.push(entry);
    this.announce(structuredClone(entry.inverse));
  }

  /** Reapply and emit the original change. */
  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.mutate(entry.forward);
    this.undoStack.push(entry);
    this.announce(structuredClone(entry.forward));
  }

  /** Produce a stable id for inserted rows or columns. */
  id(prefix: string): string { return `${prefix}-${newId()}`; }

  /** Choose an unused option color, rotating through the foundation hues. */
  optionColor(column: Column): SelectOption["color"] { return colors[(column.options?.length ?? 0) % colors.length]; }
}

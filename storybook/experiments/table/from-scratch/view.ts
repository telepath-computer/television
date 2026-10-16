// View operations never change the stored row order. They can be replaced by
// store-backed view preferences later without changing the edit model.

import type { CellValue, Column, Row, TableData } from "../data.ts";

/** Toolbar view settings. */
export interface TableView {
  sort?: { columnId: string; direction: "asc" | "desc" };
  filter?: { columnId: string; value: string; exclude?: boolean };
  groupBy?: string;
  search: string;
}

/** A visible row or collapsible group heading. */
export type ViewItem = { type: "row"; row: Row } | { type: "group"; key: string; label: string; count: number };

/** Compare the placement of rows and group headings between two views. */
export function sameViewOrder(before: ViewItem[], after: ViewItem[]): boolean {
  if (before.length !== after.length) return false;
  return before.every((item, index) => {
    const next = after[index];
    if (item.type !== next.type) return false;
    return item.type === "row" && next.type === "row"
      ? item.row.id === next.row.id
      : item.type === "group" && next.type === "group" && item.key === next.key;
  });
}

/** Build the visible rows from stored data and a view. */
export function makeView(table: TableData, view: TableView, collapsed: ReadonlySet<string>): ViewItem[] {
  let rows = table.rows;
  if (view.filter) {
    const filter = view.filter;
    const column = table.columns.find((item) => item.id === filter.columnId);
    rows = rows.filter((row) => {
      const value = cellLabel(row.cells[filter.columnId], column);
      const matches = value.toLowerCase().includes(filter.value.toLowerCase());
      return filter.exclude ? !matches : matches;
    });
  }
  if (view.sort) {
    const sort = view.sort;
    rows = [...rows].sort((a, b) => {
      const left = a.cells[sort.columnId];
      const right = b.cells[sort.columnId];
      const result = typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true });
      return sort.direction === "asc" ? result : -result;
    });
  }
  if (!view.groupBy) return rows.map((row) => ({ type: "row", row }));
  const column = table.columns.find((item) => item.id === view.groupBy);
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = String(row.cells[view.groupBy] ?? "");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const optionOrder = new Map(column?.options?.map((option, index) => [option.id, index]));
  return [...groups]
    .sort(([left], [right]) => {
      if (!left) return 1;
      if (!right) return -1;
      if (optionOrder.size) {
        return (optionOrder.get(left) ?? Infinity) - (optionOrder.get(right) ?? Infinity);
      }
      return left.localeCompare(right);
    })
    .flatMap(([key, group]): ViewItem[] => [
      { type: "group", key, label: cellLabel(key, column) || "Empty", count: group.length },
      ...collapsed.has(key) ? [] : group.map((row): ViewItem => ({ type: "row", row })),
    ]);
}

/** Human-readable content for cells, search, filtering, and copying. */
export function cellLabel(value: CellValue | undefined, column?: Column): string {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((id) => column?.options?.find((option) => option.id === id)?.label ?? id).join(", ");
  if (column?.type === "select") return column.options?.find((option) => option.id === value)?.label ?? String(value);
  return String(value);
}

/** Convert pasted or edited text to a column's stored type. */
export function parseValue(text: string, column: Column): CellValue {
  const value = text.trim();
  if (!value) return null;
  if (column.type === "number" || column.type === "currency") {
    const numericText = value.replace(/[^\d.\-]/g, "");
    if (!/\d/.test(numericText)) return null;
    const number = Number(numericText);
    return Number.isFinite(number) ? number : null;
  }
  if (column.type === "checkbox") return /^(true|yes|y|1|✓|checked)$/i.test(value);
  if (column.type === "select") return column.options?.find((option) => option.label.toLowerCase() === value.toLowerCase() || option.id === value)?.id ?? null;
  if (column.type === "multiselect") {
    return value.split(",")
      .map((part) => column.options?.find((option) =>
        option.label.toLowerCase() === part.trim().toLowerCase() || option.id === part.trim()
      )?.id)
      .filter((id): id is string => Boolean(id));
  }
  if (column.type === "date") {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
  }
  return text;
}

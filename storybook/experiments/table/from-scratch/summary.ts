// Summary values are derived from stored rows; changing the footer mode does
// not write to the table or change its row order.

import type { CellValue, Column, Row } from "../data.ts";

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** Format the aggregate chosen for one column. */
export function summaryValue(rows: Row[], column: Column, mode: string): string {
  if (mode === "none") return "";
  const values = rows
    .map((row) => row.cells[column.id])
    .filter((value): value is CellValue => value != null && value !== "");
  if (mode === "filled") return `${values.length} filled`;
  if (mode === "empty") return `${rows.length - values.length} empty`;
  if (mode === "checked") return `${values.filter(Boolean).length} checked`;
  if (mode === "percent") {
    return `${Math.round(100 * values.filter(Boolean).length / Math.max(1, rows.length))}% checked`;
  }

  const numbers = values.filter((value): value is number => typeof value === "number");
  if (!numbers.length) return "—";
  const total = numbers.reduce((sum, value) => sum + value, 0);
  const result = mode === "sum" ? total
    : mode === "average" ? total / numbers.length
    : mode === "min" ? Math.min(...numbers)
    : Math.max(...numbers);
  const formatted = column.type === "currency"
    ? new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: column.currency ?? "USD",
    }).format(result)
    : numberFormat.format(result);
  const label = mode === "sum" ? "Sum" : mode === "average" ? "Avg" : mode === "min" ? "Min" : "Max";
  return `${label} ${formatted}`;
}

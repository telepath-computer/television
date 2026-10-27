export interface TableRow {
  key: string;
  order: number;
  cells: Record<string, unknown>;
}

export interface TableColumn {
  key: string;
  numeric: boolean;
  long: boolean;
}

export interface TableSort {
  column: string;
  direction: "ascending" | "descending";
}

export function isTableData(value: unknown): value is { rows: Record<string, { order: number; [cell: string]: unknown }> };
export function orderedRows(value: unknown): TableRow[] | undefined;
export function cellValue(cells: Record<string, unknown>, key: string): unknown;
export function columnsOf(rows: TableRow[]): TableColumn[];
export function textOf(value: unknown): string;
export function compareValues(left: unknown, right: unknown): number;
export function visibleRows(rows: TableRow[], state: { filter: string; sort: TableSort | null }): Array<{ key: string; row: Record<string, unknown> }>;

/** The shared identity and order of a displayed stored row or column. */
export interface TableAxisEntry {
  key: string;
  order: number;
}

/** A tolerant, displayed column. */
export interface TableColumnEntry extends TableAxisEntry {
  width: number;
}

/** A tolerant, displayed row. */
export interface TableRowEntry extends TableAxisEntry {
  height: number;
  cells: Record<string, string>;
}

/** The readable portion of a Table store value. */
export interface TableModel {
  columns: TableColumnEntry[];
  rows: TableRowEntry[];
  headerRow: boolean;
}

/** A stored position in a displayed axis. */
export type StoredAxisItem<Entry extends TableAxisEntry = TableAxisEntry> = Entry & {
  kind: "stored";
  id: string;
};

/** An unstored position appended to a displayed axis. */
export interface DrawnAxisItem {
  kind: "drawn";
  id: string;
  index: number;
}

/** Any displayed row or column position. */
export type DisplayAxisItem<Entry extends TableAxisEntry = TableAxisEntry> = StoredAxisItem<Entry> | DrawnAxisItem;

/** One path-level store update. */
export type TableWriteOperation =
  | { kind: "set"; path: string[]; value: unknown }
  | { kind: "remove"; path: string[] };

/**
 * Fresh keys reserved before planning a drawn-position commit.
 * Supply one key for every drawn position through the target on each drawn axis;
 * planners ignore any keys after those positions.
 */
export interface TableCommitKeys {
  columns?: string[];
  rows?: string[];
}

/** A zero-based cell position. */
export interface TableCellPosition {
  rowIndex: number;
  columnIndex: number;
}

/** An inclusive zero-based range on one displayed axis. */
export interface TableAxisRange {
  start: number;
  end: number;
}

/** A logical selection accepted by the clear planner. */
export type TableClearSelection =
  | ({ kind: "cell" } & TableCellPosition)
  | ({ kind: "rows" | "columns" } & TableAxisRange);

/** One new entry supplied to a renumbering transaction callback. */
export interface TableRenumberEntry {
  key: string;
  value: Record<string, unknown>;
}

/** A retry-safe insertion or append request for one axis. */
export type TableRenumberRequest =
  | { mode: "append"; entries: TableRenumberEntry[] }
  | { mode: "insert"; selectedKeys: string[]; side: "before" | "after"; entries: TableRenumberEntry[] };

/** A no-write outcome that the page reports as a failed save. */
export type TableFailedSaveReason = "multiple-renumbering-required";

/** Why a planner produces no store write. */
export type TableNoWriteReason =
  | "cancelled"
  | "unchanged"
  | "empty-drawn"
  | "unreadable"
  | "invalid-size"
  | "invalid-target"
  | "missing-keys"
  | "invalid-keys"
  | "invalid-selection"
  | "nothing-to-delete"
  | "nothing-to-clear"
  | TableFailedSaveReason;

/**
 * A complete write plan, a retry-safe axis renumbering, or an intentional no-write outcome.
 * For a renumber result, run the transaction first and apply `operations` only after it commits.
 */
export type TablePlanResult =
  | { kind: "operations"; operations: TableWriteOperation[] }
  | { kind: "renumber"; axis: "rows" | "columns"; request: TableRenumberRequest; operations: TableWriteOperation[] }
  | { kind: "no-write"; reason: TableNoWriteReason };

/** Orders keys the same way JSON store child events do. */
export function compareStoreKeys(left: string, right: string): number;

/** Reads a store value into the tolerant display model, or returns null when the root is unreadable. */
export function readTable(value: unknown): TableModel | null;

/** Adds stable stored identities and enough count-based drawn identities to reach four positions. */
export function displayAxis<Entry extends TableAxisEntry>(entries: Entry[]): DisplayAxisItem<Entry>[];

/** Chooses a strict order, null when the axis needs renumbering, or undefined for an invalid selection. */
export function insertionOrder(entries: TableAxisEntry[], selectedKeys: string[], side: "before" | "after"): number | null | undefined;

/** Chooses consecutive strict orders after an axis, or null when its end must be renumbered. */
export function ordersAtEnd(entries: TableAxisEntry[], count: number): number[] | null;

/** Creates a retry-safe callback that inserts or appends entries while renumbering one current axis. */
export function createAxisRenumberUpdate(request: TableRenumberRequest):
  (current: unknown) => Record<string, unknown> | undefined;

/** Plans a cell commit; null text means that editing was cancelled. */
export function planCellCommit(value: unknown, target: TableCellPosition, openedText: string, text: string | null,
  keys: TableCommitKeys): TablePlanResult;

/** Plans showing or hiding the header row. */
export function planSetHeader(headerRow: boolean): TablePlanResult;

/**
 * Plans one stored or drawn size change. `openedSize` is the size shown when resizing began;
 * finite committed sizes clamp to the axis limits, while a non-finite size produces no write.
 */
export function planResize(value: unknown, axis: "rows" | "columns", targetIndex: number,
  openedSize: number, committedSize: number, keys: string[]): TablePlanResult;

/** Plans adding one row or column after storing every drawn position on that axis. */
export function planAdd(value: unknown, axis: "rows" | "columns", keys: string[]): TablePlanResult;

/** Plans inserting one row or column and only the drawn positions before it. */
export function planInsert(value: unknown, axis: "rows" | "columns", selection: TableAxisRange,
  side: "before" | "after", keys: string[]): TablePlanResult;

/** Plans removing the stored entries in a displayed row or column range. */
export function planDelete(value: unknown, axis: "rows" | "columns", selection: TableAxisRange): TablePlanResult;

/** Plans clearing selected non-empty cells without removing structure. */
export function planClear(value: unknown, selection: TableClearSelection): TablePlanResult;

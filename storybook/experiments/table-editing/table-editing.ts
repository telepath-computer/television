// Interactive, in-memory controller for the Table editing experiment. It
// deliberately models proposed store writes without importing the Table page
// or its store. Its context menu is the canonical production element.

import { html, type Html } from "../../lib/html.ts";
import "../../../packages/web/src/elements/menu.ts";

export type HeaderToggle = "shown" | "hidden";
export type Theme = "light" | "dark";

export interface TableEditingState {
  showHeader?: boolean;
  columns: Record<string, { order: number; name?: string }>;
  rows: Record<string, { order: number; cells: Record<string, string> }>;
}

export interface TableEditingArgs {
  initialState: TableEditingState;
  headerToggle: HeaderToggle;
  theme: Theme;
}

interface OrderedItem {
  key?: string;
  order: number;
}

interface CellSelection {
  kind: "cell";
  rowKey?: string;
  columnKey?: string;
  rowIndex: number;
  columnIndex: number;
}

interface HeaderSelection {
  kind: "header";
  columnKey?: string;
  columnIndex: number;
}

interface AxisSelection {
  kind: "rows" | "columns";
  start: number;
  end: number;
  anchor: number;
}

type Selection = CellSelection | HeaderSelection | AxisSelection;

interface CellEditing {
  kind: "cell";
  rowKey?: string;
  columnKey?: string;
  rowIndex: number;
  columnIndex: number;
  original: string;
  value: string;
}

interface HeaderEditing {
  kind: "header";
  columnKey?: string;
  columnIndex: number;
  original: string;
  value: string;
}

interface ContextMenuState {
  kind: "rows" | "columns";
  triggerId: string;
}

type Editing = CellEditing | HeaderEditing;
type FocusTarget = "none" | "selection" | "editor";

const BLANK_GRID_SIZE = 4;
const MAX_WRITE_LOG_ENTRIES = 40;
let experimentInstanceCount = 0;

/** Build one isolated instance of the interactive Table editing experiment. */
export function createTableEditingExperiment(args: TableEditingArgs): HTMLElement {
  const root = document.createElement("main");
  root.className = "table-editing";
  document.documentElement.dataset.theme = args.theme;

  const state = cloneState(args.initialState);
  const referenceIdPrefix = `table-editing-reference-${++experimentInstanceCount}`;
  let writes: string[] = [];
  let editing: Editing | null = null;
  let contextMenu: ContextMenuState | null = null;
  let selection: Selection | null = null;

  function paint(focusTarget: FocusTarget = "none"): void {
    reconcileSelection();
    root.innerHTML = String(view());

    if (focusTarget === "none") return;
    queueMicrotask(() => {
      let target: HTMLElement | null;
      if (focusTarget === "editor") {
        target = root.querySelector<HTMLInputElement>(".table-editing-input");
      } else if (selection?.kind === "rows") {
        target = root.querySelector<HTMLElement>(`[data-row-header][data-row-index="${selection.anchor}"]`);
      } else if (selection?.kind === "columns") {
        target = root.querySelector<HTMLElement>(`[data-column-select][data-column-index="${selection.anchor}"]`);
      } else if (selection?.kind === "header") {
        target = root.querySelector<HTMLElement>(`[data-header-text][data-column-index="${selection.columnIndex}"]`);
      } else {
        target = root.querySelector<HTMLElement>('[data-cell][data-selection="cell"]');
      }
      target?.focus();
      if (focusTarget === "editor" && target instanceof HTMLInputElement) {
        const caret = target.value.length;
        target.setSelectionRange(caret, caret);
      }
    });
  }

  function view(): Html {
    const columns = displayedColumns(state);
    const rows = displayedRows(state);
    const showHeader = state.showHeader === true;

    return html`
      <section class="table-editing-workspace" aria-label="Table editing mock-up">
        <div class="table-editing-frame" data-reference-visible="${selection === null ? "hidden" : "shown"}">
          <div class="table-editing-scroll">
            <div class="table-editing-sheet" style="--table-column-count: ${columns.length}">
              <div class="table-editing-reference-corner" aria-hidden="true"></div>
              <div class="table-editing-column-strip table-editing-reference-strip" aria-label="Column references">
                ${columns.map((_, columnIndex) => columnReferenceItem(columnIndex))}
                ${addColumnReferenceItem()}
              </div>
              <div class="table-editing-row-strip table-editing-reference-strip${showHeader ? " table-editing-row-strip-with-header" : ""}" aria-label="Row references">
                ${rows.map((_, rowIndex) => rowReferenceItem(rowIndex))}
                ${addRowReferenceItem()}
              </div>
              <table class="table-editing-grid" role="grid" aria-label="Editable table" aria-rowcount="${rows.length}" aria-colcount="${columns.length}">
                <colgroup>${columns.map(() => html`<col class="table-editing-data-column">`)}</colgroup>
                ${showHeader ? html`
                  <thead>
                    <tr class="table-editing-header-row">
                      ${columns.map((column, columnIndex) => headerCell(column, columnIndex))}
                    </tr>
                  </thead>` : ""}
                <tbody>
                  ${rows.map((row, rowIndex) => html`
                    <tr>${columns.map((column, columnIndex) => bodyCell(row, column, rowIndex, columnIndex))}</tr>`)}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <p class="table-editing-hint">
          <span>Click selects; type to replace; double-click, Return or F2 edits in place. Return or Tab commits and moves; hold Shift to reverse.</span>
          <span>Arrow keys move the selection; Delete or Backspace clears it. While editing, arrows move the caret and Escape cancels.</span>
          <span>Use a strip to select rows or columns, Shift-click to extend, and right-click for actions. ⌘/Ctrl+Shift+= inserts; ⌘/Ctrl+− deletes.</span>
        </p>
      </section>

      <aside class="table-editing-inspector" aria-label="Proposed store activity">
        <section class="table-editing-panel">
          <h2>State</h2>
          <pre data-state-json>${JSON.stringify(state, null, 2)}</pre>
        </section>
        <section class="table-editing-panel table-editing-writes">
          <h2>Writes</h2>
          ${writes.length > 0
            ? html`<ol>${writes.map((write) => html`<li><code>${write}</code></li>`)}</ol>`
            : html`<p>No writes yet.</p>`}
        </section>
      </aside>
      ${contextMenuView()}`;
  }

  function headerCell(column: OrderedItem, columnIndex: number): Html {
    const name = column.key === undefined ? "" : state.columns[column.key]?.name ?? "";
    const activeHeader = editing?.kind === "header" ? editing : null;
    const isEditing = activeHeader !== null
      && activeHeader.columnIndex === columnIndex
      && activeHeader.columnKey === column.key;
    const isAxisSelected = isColumnSelected(columnIndex);
    const isHeaderSelected = selection?.kind === "header" && selection.columnIndex === columnIndex;

    return html`
      <th class="table-editing-header" scope="col" data-column-header data-column-index="${columnIndex}" data-axis-selected="${isAxisSelected}" data-selection="${isHeaderSelected ? "header" : "none"}" aria-selected="${isAxisSelected || isHeaderSelected}">
        <div class="table-editing-header-content">
          ${isEditing
            ? html`<input class="table-editing-input table-editing-header-input" type="text" value="${activeHeader!.value}" aria-label="Column ${columnLetter(columnIndex)} name" spellcheck="false">`
            : html`<button type="button" class="table-editing-header-button" data-header-text data-column-index="${columnIndex}" data-selection="${isHeaderSelected ? "header" : "none"}" aria-label="Select column ${columnLetter(columnIndex)} name" tabindex="${isHeaderSelected ? 0 : -1}"><span>${name}</span></button>`}
        </div>
      </th>`;
  }

  function columnReferenceItem(columnIndex: number): Html {
    const isAxisSelected = isColumnSelected(columnIndex);
    const isFocusAnchor = selection?.kind === "columns"
      ? selection.anchor === columnIndex
      : (selection?.kind === "cell" || selection?.kind === "header") && selection.columnIndex === columnIndex;
    return html`
      <div class="table-editing-column-reference-item">
        <button type="button" class="table-editing-reference-item" id="${referenceButtonId("columns", columnIndex)}" data-column-select data-column-index="${columnIndex}" data-emphasis="${columnReferenceEmphasis(columnIndex)}" aria-label="Select column ${columnLetter(columnIndex)}" aria-haspopup="menu" aria-selected="${isAxisSelected}" tabindex="${isFocusAnchor ? 0 : -1}">${columnLetter(columnIndex)}</button>
      </div>`;
  }

  function rowReferenceItem(rowIndex: number): Html {
    const isAxisSelected = isRowSelected(rowIndex);
    const isFocusAnchor = selection?.kind === "rows"
      ? selection.anchor === rowIndex
      : selection?.kind === "cell" && selection.rowIndex === rowIndex;
    return html`
      <div class="table-editing-row-reference-item">
        <button type="button" class="table-editing-reference-item" id="${referenceButtonId("rows", rowIndex)}" data-row-header data-row-index="${rowIndex}" data-emphasis="${rowReferenceEmphasis(rowIndex)}" aria-label="Select row ${rowIndex + 1}" aria-haspopup="menu" aria-selected="${isAxisSelected}" tabindex="${isFocusAnchor ? 0 : -1}">${rowIndex + 1}</button>
      </div>`;
  }

  function addColumnReferenceItem(): Html {
    return html`
      <div class="table-editing-column-add-item">
        <button type="button" class="table-editing-reference-item table-editing-add-item" data-action="add-column" aria-label="Add column at end" title="Add column at end">+</button>
      </div>`;
  }

  function addRowReferenceItem(): Html {
    return html`
      <div class="table-editing-row-add-item">
        <button type="button" class="table-editing-reference-item table-editing-add-item" data-action="add-row" aria-label="Add row at end" title="Add row at end">+</button>
      </div>`;
  }

  function bodyCell(row: OrderedItem, column: OrderedItem, rowIndex: number, columnIndex: number): Html {
    const value = row.key !== undefined && column.key !== undefined
      ? state.rows[row.key]?.cells[column.key] ?? ""
      : "";
    const selectedKind = cellSelectionKind(rowIndex, columnIndex);
    const activeCell = editing?.kind === "cell" ? editing : null;
    const isEditing = activeCell !== null
      && activeCell.rowIndex === rowIndex
      && activeCell.columnIndex === columnIndex
      && activeCell.rowKey === row.key
      && activeCell.columnKey === column.key;

    return html`
      <td class="table-editing-cell" role="gridcell" data-cell data-row-index="${rowIndex}" data-column-index="${columnIndex}" data-selection="${selectedKind}" aria-selected="${selectedKind !== "none"}" tabindex="${selectedKind === "cell" ? 0 : -1}">
        ${isEditing
          ? html`<input class="table-editing-input table-editing-cell-input" type="text" value="${activeCell!.value}" aria-label="Edit row ${rowIndex + 1}, column ${columnLetter(columnIndex)}" spellcheck="false">`
          : html`<span>${value}</span>`}
      </td>`;
  }

  function contextMenuView(): Html | string {
    if (contextMenu === null || selection === null || selection.kind === "cell" || selection.kind === "header") return "";
    const count = selection.end - selection.start + 1;
    const isRows = contextMenu.kind === "rows";
    return html`
      <tv-menu class="table-editing-context-menu" trigger="${contextMenu.triggerId}" manual open aria-label="${isRows ? "Row" : "Column"} actions">
        <tv-menu-item data-menu-action="${isRows ? "insert-row-before" : "insert-column-before"}">
          <span>${isRows ? "Insert row above" : "Insert column left"}</span><kbd>⌘⇧=</kbd>
        </tv-menu-item>
        <tv-menu-item data-menu-action="${isRows ? "insert-row-after" : "insert-column-after"}">
          <span>${isRows ? "Insert row below" : "Insert column right"}</span>
        </tv-menu-item>
        <tv-menu-item intent="danger" data-menu-action="${isRows ? "delete-rows" : "delete-columns"}">
          <span>Delete ${isRows ? count === 1 ? "row" : "rows" : count === 1 ? "column" : "columns"}</span><kbd>⌘−</kbd>
        </tv-menu-item>
        ${args.headerToggle === "shown" ? html`
          <hr>
          <tv-menu-item data-menu-action="toggle-header">
            <span>${state.showHeader === true ? "Hide header row" : "Show header row"}</span>
          </tv-menu-item>` : ""}
      </tv-menu>`;
  }

  function referenceButtonId(kind: "rows" | "columns", index: number): string {
    return `${referenceIdPrefix}-${kind}-${index}`;
  }

  function reconcileSelection(): void {
    if (selection === null) return;
    const rows = displayedRows(state);
    const columns = displayedColumns(state);
    if (selection.kind === "cell") {
      const rowIndex = indexForSelection(rows, selection.rowKey, selection.rowIndex);
      const columnIndex = indexForSelection(columns, selection.columnKey, selection.columnIndex);
      selection = cellSelectionAt(rows, columns, rowIndex, columnIndex);
      return;
    }
    if (selection.kind === "header") {
      const columnIndex = indexForSelection(columns, selection.columnKey, selection.columnIndex);
      selection = headerSelectionAt(columns, columnIndex);
      return;
    }

    const length = selection.kind === "rows" ? rows.length : columns.length;
    selection = {
      ...selection,
      start: clamp(selection.start, 0, length - 1),
      end: clamp(selection.end, 0, length - 1),
      anchor: clamp(selection.anchor, 0, length - 1),
    };
  }

  function beginCellEditing(rowIndex: number, columnIndex: number, replacement?: string): void {
    const rows = displayedRows(state);
    const columns = displayedColumns(state);
    const cellSelection = cellSelectionAt(rows, columns, rowIndex, columnIndex);
    selection = cellSelection;
    contextMenu = null;
    const original = cellSelection.rowKey !== undefined && cellSelection.columnKey !== undefined
      ? state.rows[cellSelection.rowKey]?.cells[cellSelection.columnKey] ?? ""
      : "";
    editing = {
      ...cellSelection,
      original,
      value: replacement ?? original,
    };
    paint("editor");
  }

  function beginHeaderEditing(columnIndex: number, replacement?: string): void {
    const columns = displayedColumns(state);
    const column = columns[columnIndex];
    if (column === undefined) return;
    selection = headerSelectionAt(columns, columnIndex);
    contextMenu = null;
    const original = column.key === undefined ? "" : state.columns[column.key]?.name ?? "";
    editing = {
      kind: "header",
      columnKey: column.key,
      columnIndex,
      original,
      value: replacement ?? original,
    };
    paint("editor");
  }

  function beginSelectionEditing(replacement?: string): void {
    if (selection?.kind === "cell") {
      beginCellEditing(selection.rowIndex, selection.columnIndex, replacement);
    } else if (selection?.kind === "header") {
      beginHeaderEditing(selection.columnIndex, replacement);
    }
  }

  function commitEditing(): void {
    if (editing === null) return;
    const active = editing;
    editing = null;
    if (active.value === active.original) return;

    const actionWrites: string[] = [];
    if (active.kind === "header") {
      if (active.columnKey === undefined && active.value === "") return;
      const columnKey = active.columnKey ?? ensureColumnsThrough(active.columnIndex, actionWrites)[active.columnIndex]!;
      if (active.value === "") {
        delete state.columns[columnKey]!.name;
        actionWrites.push(`remove columns/${columnKey}/name`);
      } else {
        state.columns[columnKey]!.name = active.value;
        actionWrites.push(`set columns/${columnKey}/name ${JSON.stringify(active.value)}`);
      }
      selection = headerSelectionAt(displayedColumns(state), active.columnIndex);
    } else {
      if (active.rowKey === undefined && active.value === "") return;
      if (active.columnKey === undefined && active.value === "") return;
      const columnKey = active.columnKey ?? ensureColumnsThrough(active.columnIndex, actionWrites)[active.columnIndex]!;
      const rowKey = active.rowKey ?? ensureRowsThrough(active.rowIndex, actionWrites)[active.rowIndex]!;
      selection = {
        kind: "cell",
        rowKey,
        columnKey,
        rowIndex: active.rowIndex,
        columnIndex: active.columnIndex,
      };
      if (active.value === "") {
        delete state.rows[rowKey]!.cells[columnKey];
        actionWrites.push(`remove rows/${rowKey}/cells/${columnKey}`);
      } else {
        state.rows[rowKey]!.cells[columnKey] = active.value;
        actionWrites.push(`set rows/${rowKey}/cells/${columnKey} ${JSON.stringify(active.value)}`);
      }
    }
    recordWrites(actionWrites);
  }

  function ensureColumnsThrough(columnIndex: number, actionWrites: string[]): string[] {
    const existing = orderedEntries(state.columns).map(([key]) => key);
    if (existing.length > 0) return existing;

    const keys: string[] = [];
    for (let index = 0; index <= columnIndex; index += 1) {
      const key = opaqueKey(state.columns);
      const column = { order: index + 1 };
      state.columns[key] = column;
      keys.push(key);
      actionWrites.push(`push columns ${JSON.stringify(column)} → ${key}`);
    }
    return keys;
  }

  function ensureRowsThrough(rowIndex: number, actionWrites: string[]): string[] {
    const existing = orderedEntries(state.rows).map(([key]) => key);
    if (existing.length > 0) return existing;

    const keys: string[] = [];
    for (let index = 0; index <= rowIndex; index += 1) {
      const key = opaqueKey(state.rows);
      const row = { order: index + 1, cells: {} };
      state.rows[key] = row;
      keys.push(key);
      actionWrites.push(`push rows ${JSON.stringify(row)} → ${key}`);
    }
    return keys;
  }

  function performAction(action: string): void {
    commitEditing();
    contextMenu = null;
    if (action === "add-row") addRowAtEnd();
    else if (action === "add-column") addColumnAtEnd();
    else return;
    paint("selection");
  }

  function performMenuAction(action: string): void {
    contextMenu = null;
    switch (action) {
      case "insert-row-before": insertRow("before"); break;
      case "insert-row-after": insertRow("after"); break;
      case "insert-column-before": insertColumn("before"); break;
      case "insert-column-after": insertColumn("after"); break;
      case "delete-rows": deleteSelectedRows(); break;
      case "delete-columns": deleteSelectedColumns(); break;
      case "toggle-header": toggleHeader(); break;
      default: return;
    }
    paint("selection");
  }

  function addRowAtEnd(): void {
    const actionWrites: string[] = [];
    if (orderedEntries(state.rows).length === 0) ensureRowsThrough(BLANK_GRID_SIZE - 1, actionWrites);
    const entries = orderedEntries(state.rows);
    const key = opaqueKey(state.rows);
    const row = { order: entries.at(-1)![1].order + 1, cells: {} };
    state.rows[key] = row;
    actionWrites.push(`push rows ${JSON.stringify(row)} → ${key}`);
    recordWrites(actionWrites);
    const rows = displayedRows(state);
    const columns = displayedColumns(state);
    selection = cellSelectionAt(rows, columns, rows.length - 1, selection?.kind === "cell" ? selection.columnIndex : 0);
  }

  function addColumnAtEnd(): void {
    const actionWrites: string[] = [];
    if (orderedEntries(state.columns).length === 0) ensureColumnsThrough(BLANK_GRID_SIZE - 1, actionWrites);
    const entries = orderedEntries(state.columns);
    const key = opaqueKey(state.columns);
    const column = { order: entries.at(-1)![1].order + 1 };
    state.columns[key] = column;
    actionWrites.push(`push columns ${JSON.stringify(column)} → ${key}`);
    recordWrites(actionWrites);
    const rows = displayedRows(state);
    const columns = displayedColumns(state);
    selection = cellSelectionAt(rows, columns, selection?.kind === "cell" ? selection.rowIndex : 0, columns.length - 1);
  }

  function insertRow(side: "before" | "after"): void {
    if (selection?.kind !== "rows") return;
    const actionWrites: string[] = [];
    if (orderedEntries(state.rows).length === 0) ensureRowsThrough(BLANK_GRID_SIZE - 1, actionWrites);
    const entries = orderedEntries(state.rows);
    const targetIndex = side === "before" ? selection.start : selection.end;
    const order = insertedOrder(entries.map(([, row]) => row.order), targetIndex, side);
    const key = opaqueKey(state.rows);
    const row = { order, cells: {} };
    state.rows[key] = row;
    actionWrites.push(`push rows ${JSON.stringify(row)} → ${key}`);
    recordWrites(actionWrites);
    const rowIndex = displayedRows(state).findIndex((rowItem) => rowItem.key === key);
    selection = { kind: "rows", start: rowIndex, end: rowIndex, anchor: rowIndex };
  }

  function insertColumn(side: "before" | "after"): void {
    if (selection?.kind !== "columns") return;
    const actionWrites: string[] = [];
    if (orderedEntries(state.columns).length === 0) ensureColumnsThrough(BLANK_GRID_SIZE - 1, actionWrites);
    const entries = orderedEntries(state.columns);
    const targetIndex = side === "before" ? selection.start : selection.end;
    const order = insertedOrder(entries.map(([, column]) => column.order), targetIndex, side);
    const key = opaqueKey(state.columns);
    const column = { order };
    state.columns[key] = column;
    actionWrites.push(`push columns ${JSON.stringify(column)} → ${key}`);
    recordWrites(actionWrites);
    const columnIndex = displayedColumns(state).findIndex((columnItem) => columnItem.key === key);
    selection = { kind: "columns", start: columnIndex, end: columnIndex, anchor: columnIndex };
  }

  function deleteSelectedRows(): void {
    if (selection?.kind !== "rows") return;
    const actionWrites: string[] = [];
    if (orderedEntries(state.rows).length === 0) ensureRowsThrough(BLANK_GRID_SIZE - 1, actionWrites);
    const entries = orderedEntries(state.rows);
    const start = selection.start;
    for (const [key] of entries.slice(selection.start, selection.end + 1)) {
      delete state.rows[key];
      actionWrites.push(`remove rows/${key}`);
    }
    recordWrites(actionWrites);
    const rowIndex = Math.min(start, displayedRows(state).length - 1);
    selection = { kind: "rows", start: rowIndex, end: rowIndex, anchor: rowIndex };
  }

  function deleteSelectedColumns(): void {
    if (selection?.kind !== "columns") return;
    const actionWrites: string[] = [];
    if (orderedEntries(state.columns).length === 0) ensureColumnsThrough(BLANK_GRID_SIZE - 1, actionWrites);
    const entries = orderedEntries(state.columns);
    const start = selection.start;
    for (const [key] of entries.slice(selection.start, selection.end + 1)) {
      delete state.columns[key];
      actionWrites.push(`remove columns/${key}`);
    }
    recordWrites(actionWrites);
    const columnIndex = Math.min(start, displayedColumns(state).length - 1);
    selection = { kind: "columns", start: columnIndex, end: columnIndex, anchor: columnIndex };
  }

  function clearSelectedContents(): void {
    if (selection === null) return;
    const actionWrites: string[] = [];
    const rows = orderedEntries(state.rows);
    const columns = orderedEntries(state.columns);

    if (selection.kind === "cell") {
      if (selection.rowKey !== undefined && selection.columnKey !== undefined) {
        removeCell(selection.rowKey, selection.columnKey, actionWrites);
      }
    } else if (selection.kind === "header") {
      if (selection.columnKey !== undefined && Object.hasOwn(state.columns[selection.columnKey] ?? {}, "name")) {
        delete state.columns[selection.columnKey]!.name;
        actionWrites.push(`remove columns/${selection.columnKey}/name`);
      }
    } else if (selection.kind === "rows") {
      for (const [rowKey] of rows.slice(selection.start, selection.end + 1)) {
        for (const [columnKey] of columns) removeCell(rowKey, columnKey, actionWrites);
      }
    } else {
      for (const [rowKey] of rows) {
        for (const [columnKey] of columns.slice(selection.start, selection.end + 1)) {
          removeCell(rowKey, columnKey, actionWrites);
        }
      }
    }

    recordWrites(actionWrites);
    paint("selection");
  }

  function removeCell(rowKey: string, columnKey: string, actionWrites: string[]): void {
    const cells = state.rows[rowKey]?.cells;
    if (cells === undefined || !Object.hasOwn(cells, columnKey)) return;
    delete cells[columnKey];
    actionWrites.push(`remove rows/${rowKey}/cells/${columnKey}`);
  }

  function toggleHeader(): void {
    const showHeader = state.showHeader !== true;
    state.showHeader = showHeader;
    recordWrites([`set showHeader ${showHeader}`]);
  }

  function moveEditableSelection(rowDelta: number, columnDelta: number): void {
    if (selection?.kind !== "cell" && selection?.kind !== "header") return;
    const rows = displayedRows(state);
    const columns = displayedColumns(state);
    const columnIndex = clamp(selection.columnIndex + columnDelta, 0, columns.length - 1);
    if (selection.kind === "header") {
      selection = rowDelta > 0
        ? cellSelectionAt(rows, columns, 0, columnIndex)
        : headerSelectionAt(columns, columnIndex);
    } else {
      const requestedRowIndex = selection.rowIndex + rowDelta;
      selection = state.showHeader === true && requestedRowIndex < 0
        ? headerSelectionAt(columns, columnIndex)
        : cellSelectionAt(rows, columns, requestedRowIndex, columnIndex);
    }
    paint("selection");
  }

  function selectAxis(kind: "rows" | "columns", index: number, extend: boolean): void {
    if (extend && selection?.kind === kind) {
      selection = {
        kind,
        start: Math.min(selection.anchor, index),
        end: Math.max(selection.anchor, index),
        anchor: selection.anchor,
      };
    } else {
      selection = { kind, start: index, end: index, anchor: index };
    }
  }

  function selectAxisForContextMenu(kind: "rows" | "columns", index: number): void {
    if (selection?.kind === kind && index >= selection.start && index <= selection.end) return;
    selection = { kind, start: index, end: index, anchor: index };
  }

  function isRowSelected(rowIndex: number): boolean {
    return selection?.kind === "rows" && rowIndex >= selection.start && rowIndex <= selection.end;
  }

  function isColumnSelected(columnIndex: number): boolean {
    return selection?.kind === "columns" && columnIndex >= selection.start && columnIndex <= selection.end;
  }

  function rowReferenceEmphasis(rowIndex: number): "none" | "related" | "selected" {
    if (isRowSelected(rowIndex)) return "selected";
    return selection?.kind === "cell" && selection.rowIndex === rowIndex ? "related" : "none";
  }

  function columnReferenceEmphasis(columnIndex: number): "none" | "related" | "selected" {
    if (isColumnSelected(columnIndex)) return "selected";
    return (selection?.kind === "cell" || selection?.kind === "header") && selection.columnIndex === columnIndex ? "related" : "none";
  }

  function cellSelectionKind(rowIndex: number, columnIndex: number): "none" | "cell" | "range" {
    if (selection?.kind === "cell") {
      return selection.rowIndex === rowIndex && selection.columnIndex === columnIndex ? "cell" : "none";
    }
    if (selection?.kind === "rows") return isRowSelected(rowIndex) ? "range" : "none";
    return selection?.kind === "columns" && isColumnSelected(columnIndex) ? "range" : "none";
  }

  function recordWrites(actionWrites: string[]): void {
    writes = [...actionWrites].reverse().concat(writes).slice(0, MAX_WRITE_LOG_ENTRIES);
  }

  root.addEventListener("input", (event) => {
    if (!(event.target instanceof HTMLInputElement) || editing === null) return;
    editing.value = event.target.value;
  });

  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target instanceof HTMLInputElement) return;
    // Selecting the first click rerenders the grid. The click count survives
    // that replacement, so it is the reliable double-click signal here.
    const isRepeatedClick = event.detail > 1;

    const menuAction = event.target.closest<HTMLElement>("[data-menu-action]");
    if (menuAction !== null) {
      performMenuAction(menuAction.dataset.menuAction ?? "");
      return;
    }

    const action = event.target.closest<HTMLElement>("[data-action]");
    if (action !== null) {
      performAction(action.dataset.action ?? "");
      return;
    }

    const rowHeader = event.target.closest<HTMLElement>("[data-row-header]");
    if (rowHeader !== null) {
      commitEditing();
      contextMenu = null;
      selectAxis("rows", Number(rowHeader.dataset.rowIndex), event.shiftKey);
      paint("selection");
      return;
    }

    const columnSelector = event.target.closest<HTMLElement>("[data-column-select]");
    if (columnSelector !== null) {
      commitEditing();
      contextMenu = null;
      selectAxis("columns", Number(columnSelector.dataset.columnIndex), event.shiftKey);
      paint("selection");
      return;
    }

    const headerText = event.target.closest<HTMLElement>("[data-header-text]");
    if (headerText !== null) {
      commitEditing();
      const columnIndex = Number(headerText.dataset.columnIndex);
      if (isRepeatedClick) {
        beginHeaderEditing(columnIndex);
      } else {
        selection = headerSelectionAt(displayedColumns(state), columnIndex);
        contextMenu = null;
        paint("selection");
      }
      return;
    }

    const cell = event.target.closest<HTMLElement>("[data-cell]");
    if (cell !== null) {
      commitEditing();
      const rowIndex = Number(cell.dataset.rowIndex);
      const columnIndex = Number(cell.dataset.columnIndex);
      if (isRepeatedClick) {
        beginCellEditing(rowIndex, columnIndex);
      } else {
        selection = cellSelectionAt(displayedRows(state), displayedColumns(state), rowIndex, columnIndex);
        contextMenu = null;
        paint("selection");
      }
      return;
    }

    commitEditing();
    contextMenu = null;
    selection = null;
    paint();
  });

  root.addEventListener("contextmenu", (event) => {
    if (!(event.target instanceof Element)) return;
    const rowHeader = event.target.closest<HTMLElement>("[data-row-header]");
    const columnHeader = event.target.closest<HTMLElement>("[data-column-select]");
    if (rowHeader === null && columnHeader === null) return;

    event.preventDefault();
    commitEditing();
    if (rowHeader !== null) {
      const rowIndex = Number(rowHeader.dataset.rowIndex);
      selectAxisForContextMenu("rows", rowIndex);
      contextMenu = { kind: "rows", triggerId: referenceButtonId("rows", rowIndex) };
    } else if (columnHeader !== null) {
      const columnIndex = Number(columnHeader.dataset.columnIndex);
      selectAxisForContextMenu("columns", columnIndex);
      contextMenu = { kind: "columns", triggerId: referenceButtonId("columns", columnIndex) };
    }
    paint("selection");
  });

  root.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) {
      if (event.key === "Escape") {
        event.preventDefault();
        editing = null;
        paint("selection");
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        commitEditing();
        const rowDelta = event.key === "Enter" ? event.shiftKey ? -1 : 1 : 0;
        const columnDelta = event.key === "Tab" ? event.shiftKey ? -1 : 1 : 0;
        moveEditableSelection(rowDelta, columnDelta);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      contextMenu = null;
      selection = null;
      paint();
      return;
    }

    const targetIsSelection = event.target instanceof Element
      && event.target.closest("[data-cell], [data-header-text], [data-row-header], [data-column-select]") !== null;
    if (!targetIsSelection || selection === null) return;

    const usesCommand = event.metaKey || event.ctrlKey;
    if (usesCommand && (selection.kind === "rows" || selection.kind === "columns")) {
      if (event.shiftKey && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        if (selection.kind === "rows") insertRow("before");
        else insertColumn("before");
        paint("selection");
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        if (selection.kind === "rows") deleteSelectedRows();
        else deleteSelectedColumns();
        paint("selection");
        return;
      }
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      clearSelectedContents();
      return;
    }

    if (selection.kind !== "cell" && selection.kind !== "header") return;
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      beginSelectionEditing();
      return;
    }
    const moves: Partial<Record<string, [number, number]>> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      moveEditableSelection(...move);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveEditableSelection(0, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      beginSelectionEditing(event.key);
    }
  });

  paint();
  return root;
}

function cloneState(state: TableEditingState): TableEditingState {
  return {
    ...(state.showHeader === undefined ? {} : { showHeader: state.showHeader }),
    columns: Object.fromEntries(Object.entries(state.columns).map(([key, column]) => [key, { ...column }])),
    rows: Object.fromEntries(Object.entries(state.rows).map(([key, row]) => [key, { ...row, cells: { ...row.cells } }])),
  };
}

function orderedEntries<T extends { order: number }>(records: Record<string, T>): [string, T][] {
  return Object.entries(records).sort(([leftKey, left], [rightKey, right]) => left.order - right.order || leftKey.localeCompare(rightKey));
}

function displayedColumns(state: TableEditingState): OrderedItem[] {
  const columns = orderedEntries(state.columns).map(([key, column]) => ({ key, order: column.order }));
  return columns.length > 0 ? columns : virtualItems();
}

function displayedRows(state: TableEditingState): OrderedItem[] {
  const rows = orderedEntries(state.rows).map(([key, row]) => ({ key, order: row.order }));
  return rows.length > 0 ? rows : virtualItems();
}

function virtualItems(): OrderedItem[] {
  return Array.from({ length: BLANK_GRID_SIZE }, (_, index) => ({ order: index + 1 }));
}

function cellSelectionAt(rows: OrderedItem[], columns: OrderedItem[], rowIndex: number, columnIndex: number): CellSelection {
  const safeRowIndex = clamp(rowIndex, 0, rows.length - 1);
  const safeColumnIndex = clamp(columnIndex, 0, columns.length - 1);
  return {
    kind: "cell",
    rowKey: rows[safeRowIndex]?.key,
    columnKey: columns[safeColumnIndex]?.key,
    rowIndex: safeRowIndex,
    columnIndex: safeColumnIndex,
  };
}

function headerSelectionAt(columns: OrderedItem[], columnIndex: number): HeaderSelection {
  const safeColumnIndex = clamp(columnIndex, 0, columns.length - 1);
  return {
    kind: "header",
    columnKey: columns[safeColumnIndex]?.key,
    columnIndex: safeColumnIndex,
  };
}

function indexForSelection(items: OrderedItem[], key: string | undefined, fallback: number): number {
  const keyedIndex = key === undefined ? -1 : items.findIndex((item) => item.key === key);
  return keyedIndex >= 0 ? keyedIndex : clamp(fallback, 0, items.length - 1);
}

function insertedOrder(orders: number[], targetIndex: number, side: "before" | "after"): number {
  const target = orders[targetIndex]!;
  if (side === "before") {
    const previous = orders[targetIndex - 1];
    return previous === undefined ? target - 1 : (previous + target) / 2;
  }
  const next = orders[targetIndex + 1];
  return next === undefined ? target + 1 : (target + next) / 2;
}

function opaqueKey(records: Record<string, unknown>): string {
  let key: string;
  do {
    key = `-${crypto.randomUUID().replaceAll("-", "").slice(0, 19)}`;
  } while (Object.hasOwn(records, key));
  return key;
}

function columnLetter(index: number): string {
  let label = "";
  let value = index + 1;
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}

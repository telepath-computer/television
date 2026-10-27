// Each story is one state of the bundled Table page. Behaviour is specified
// in specs/ui/templates/table.mdx; this file owns independent story markup.

import "../../../../specs/ui/foundation/index.css";
import "./styles.css";
import { html, Html } from "../../../lib/html.ts";
import { poseOpenFoundationPanel } from "../../../lib/foundation.ts";
import iconFrame from "../../../../specs/ui/foundation/icons/icon.frame";

const icon = (params: { name: string; size?: string; spinning?: boolean }): Html =>
  new Html(iconFrame.render(params, { serializableShadowRoots: true }));

interface Column { key: string; width?: number }
type CellValue = string | number | boolean;
interface Row { key: string; height?: number; cells: Record<string, CellValue> }
type Selection =
  | { kind: "cell"; row: number; column: number }
  | { kind: "row"; start: number; end: number }
  | { kind: "column"; start: number; end: number }
  | null;
interface Args {
  theme: "light" | "dark";
  columns: Column[];
  rows: Row[];
  headerRow: boolean;
  selection: Selection;
  menu: "row" | "column" | null;
  editable: boolean;
  status: "reconnecting" | "save-failed" | null;
  loading: boolean;
  unreadable: boolean;
}

const minimumGridSize = 4;

function displayedColumns(columns: Column[]): Column[] {
  return columns.concat(Array.from(
    { length: Math.max(0, minimumGridSize - columns.length) },
    (_, index) => ({ key: `drawn-column-${columns.length + index}` }),
  ));
}

function displayedRows(rows: Row[]): Row[] {
  return rows.concat(Array.from(
    { length: Math.max(0, minimumGridSize - rows.length) },
    (_, index) => ({ key: `drawn-row-${rows.length + index}`, cells: {} }),
  ));
}

const parkColumns: Column[] = [
  { key: "c1" },
  { key: "c2" },
  { key: "c3" },
  { key: "c4" },
];

const parkRows: Row[] = [
  { key: "r1", cells: { c1: "Park", c2: "State", c3: "Open", c4: "Rating" } },
  { key: "r2", cells: { c1: "Acadia", c2: "Maine", c3: "Yes", c4: "4.9" } },
  { key: "r3", cells: { c1: "Arches", c2: "Utah", c3: "Yes", c4: "4.8" } },
  { key: "r4", cells: { c1: "Everglades", c2: "Florida", c3: "No", c4: "4.6" } },
  { key: "r5", cells: { c1: "Olympic", c2: "Washington", c3: "Yes", c4: "4.8" } },
  { key: "r6", cells: { c1: "Yosemite", c2: "California", c3: "Yes", c4: "4.9" } },
  { key: "r7", cells: { c1: "Zion", c2: "Utah", c3: "Yes" } },
];

const firstColumns: Column[] = [{ key: "c1" }];
const firstRows: Row[] = [{ key: "r1", cells: { c1: "Yosemite" } }];

const columnAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const unavailableCadence = 4;
const ratingBase = 4.2;
const ratingCycle = 8;
const seasonalAccessCadence = 3;
const extraRowNumberWidth = 7;
const scheduleColumnCount = 3;

const scheduleRows: Row[] = [
  { key: "r1", cells: { c1: "Time", c2: "Plan", c3: "Starts" } },
  { key: "r2", cells: { c1: "Morning", c2: "Train", c3: "08:40" } },
  { key: "r3", cells: { c1: "Afternoon", c2: "Walk" } },
  { key: "r4", cells: { c1: "Evening", c3: "Dinner" } },
];

const resizedColumns: Column[] = [
  { key: "c1", width: 230 },
  { key: "c2", width: 130 },
  { key: "c3", width: 96 },
  { key: "c4", width: 112 },
];

const resizedRows: Row[] = [
  ...parkRows.map((row, index) => index === 0 ? { ...row, height: 52 } : row),
  { key: "r8", cells: { c1: "Grand Canyon", c2: "Arizona", c3: "Yes", c4: "4.9" } },
  { key: "r9", cells: { c1: "Joshua Tree", c2: "California", c3: "Yes", c4: "4.7" } },
  { key: "r10", height: 28, cells: { c1: "Redwood", c2: "California", c3: "Yes", c4: "4.8" } },
];

const scrolledColumns: Column[] = Array.from({ length: 7 }, (_, index) => ({ key: `c${index + 1}` }));
const scrolledRows: Row[] = [
  { key: "r1", height: 52, cells: { c1: "Park", c2: "State", c3: "Open", c4: "Rating", c5: "Region", c6: "Visits", c7: "Notes" } },
  ...Array.from({ length: 23 }, (_, index) => ({
    key: `r${index + 2}`,
    cells: {
      c1: `Park ${index + 1}`,
      c2: index % 2 === 0 ? "California" : "Utah",
      c3: index % unavailableCadence === 0 ? "No" : "Yes",
      c4: (ratingBase + (index % ratingCycle) / 10).toFixed(1),
      c5: index % 2 === 0 ? "West" : "Mountain",
      c6: `${index + 2}.${index % 10}m`,
      c7: index % seasonalAccessCadence === 0 ? "Seasonal access" : "",
    },
  })),
];

function columnLetter(index: number): string {
  let label = "";
  let value = index + 1;
  while (value > 0) {
    value -= 1;
    label = columnAlphabet[value % columnAlphabet.length] + label;
    value = Math.floor(value / columnAlphabet.length);
  }
  return label;
}

function rowSelected(selection: Selection, row: number): boolean {
  return selection?.kind === "row" && row >= selection.start && row <= selection.end;
}

function columnSelected(selection: Selection, column: number): boolean {
  return selection?.kind === "column" && column >= selection.start && column <= selection.end;
}

function referenceEmphasis(selection: Selection, axis: "row" | "column", index: number): "none" | "related" | "selected" {
  if (axis === "row" && rowSelected(selection, index)) return "selected";
  if (axis === "column" && columnSelected(selection, index)) return "selected";
  if (selection?.kind === "cell" && selection[axis] === index) return "related";
  return "none";
}

function cellSelection(selection: Selection, row: number, column: number): "none" | "cell" | "range" {
  if (selection?.kind === "cell") return selection.row === row && selection.column === column ? "cell" : "none";
  if (rowSelected(selection, row) || columnSelected(selection, column)) return "range";
  return "none";
}

function rowMenu(headerRow: boolean, selection: Selection, triggerRow: number) {
  const count = selection?.kind === "row" ? selection.end - selection.start + 1 : 1;
  return html`
    <tv-menu class="table-context-menu table-row-context-menu" trigger="table-row-reference-${triggerRow + 1}" role="menu" aria-label="Row actions" open>
      <tv-menu-item role="menuitem" tabindex="-1"><span>Insert row above</span></tv-menu-item>
      <tv-menu-item role="menuitem" tabindex="-1"><span>Insert row below</span></tv-menu-item>
      <tv-menu-item role="menuitem" tabindex="-1" intent="danger"><span>Delete ${count === 1 ? "row" : "rows"}</span></tv-menu-item>
      ${triggerRow === 0 ? html`
        <hr>
        <tv-menu-item role="menuitem" tabindex="-1"><span>${headerRow ? "Remove header row" : "Make header row"}</span></tv-menu-item>
      ` : ""}
    </tv-menu>`;
}

function columnMenu(selection: Selection, triggerColumn: number) {
  const count = selection?.kind === "column" ? selection.end - selection.start + 1 : 1;
  return html`
    <tv-menu class="table-context-menu table-column-context-menu" trigger="table-column-reference-${triggerColumn + 1}" role="menu" aria-label="Column actions" open>
      <tv-menu-item role="menuitem" tabindex="-1"><span>Insert column left</span></tv-menu-item>
      <tv-menu-item role="menuitem" tabindex="-1"><span>Insert column right</span></tv-menu-item>
      <tv-menu-item role="menuitem" tabindex="-1" intent="danger"><span>Delete ${count === 1 ? "column" : "columns"}</span></tv-menu-item>
    </tv-menu>`;
}

const defaultColumnWidth = 160;
const defaultRowHeight = 38;
const referenceSize = 26;

const render = ({ theme, columns: storedColumns, rows: storedRows, headerRow, selection, menu, editable, status, loading, unreadable }: Args) => {
  document.documentElement.dataset.theme = theme;

  if (unreadable) return html`
    <main class="table-page">
      <section class="table-unreadable" role="alert">
        <span class="table-unreadable-icon">${icon({ name: "warning", size: "xl" })}</span>
        <h1 class="table-unreadable-title">This table can't be shown</h1>
        <p class="table-unreadable-text">Television can't read the saved table data. Ask your agent to check the data and access.</p>
      </section>
      <div class="table-status" role="status">${status === "reconnecting" ? "Reconnecting…" : ""}</div>
    </main>`;

  if (loading) return html`
    <main class="table-page" data-editable="${String(editable)}" data-header-row="${String(headerRow)}">
      <div class="table-loading" role="status" aria-label="Loading table">
        ${icon({ name: "spinner", size: "md", spinning: true })}
      </div>
      <div class="table-status" role="status">${status === "reconnecting" ? "Reconnecting…" : ""}</div>
    </main>`;

  const columns = displayedColumns(storedColumns);
  const rows = displayedRows(storedRows);
  const columnWidths = columns.map((column) => column.width ?? defaultColumnWidth);
  const gridWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const rowNumberDigits = String(rows.length).length;
  const rowReferenceWidth = referenceSize + Math.max(0, rowNumberDigits - 1) * extraRowNumberWidth;
  const menuTrigger = menu === "row"
    ? selection?.kind === "row" ? selection.start : 0
    : selection?.kind === "column" ? selection.start : 0;

  return html`
    <main class="table-page" data-editable="${String(editable)}" data-header-row="${String(headerRow)}">
      <div class="table-frame">
        <div class="table-scroll">
          <div
            class="table-sheet"
            style="--table-grid-width: ${gridWidth}px; --table-row-reference-width: ${rowReferenceWidth}px"
          >
            <div class="table-reference-corner" aria-hidden="true"></div>
            <div class="table-column-strip table-reference-strip" aria-label="Column references">
              ${columns.map((_, columnIndex) => html`
                <div class="table-column-reference-item" style="width: ${columnWidths[columnIndex]}px">
                  <button
                    type="button"
                    class="table-reference-item"
                    id="table-column-reference-${columnIndex + 1}"
                    data-emphasis="${referenceEmphasis(selection, "column", columnIndex)}"
                    aria-label="Select column ${columnLetter(columnIndex)}"
                    aria-haspopup="${editable ? "menu" : "false"}"
                    ${menu === "column" && columnIndex === menuTrigger ? html`aria-expanded="true"` : ""}
                    aria-pressed="${String(columnSelected(selection, columnIndex))}"
                    aria-description="${columnWidths[columnIndex]} pixels wide.${editable ? " Select this column, then use plus or minus to resize." : ""}"
                    tabindex="${selection?.kind === "column" && selection.start === columnIndex ? 0 : -1}"
                  >${columnLetter(columnIndex)}</button>
                  ${editable ? html`<span class="table-column-resize-handle" aria-hidden="true"></span>` : ""}
                </div>`)}
              ${editable ? html`<div class="table-column-add-item">
                <button type="button" class="table-reference-item table-add-item" aria-label="Add column at end" title="Add column at end" tabindex="-1">+</button>
              </div>` : ""}
            </div>
            <div class="table-row-strip table-reference-strip" aria-label="Row references">
              ${rows.map((row, rowIndex) => html`
                <div class="table-row-reference-item" style="--table-current-row-height: ${row.height ?? defaultRowHeight}px">
                  <button
                    type="button"
                    class="table-reference-item"
                    id="table-row-reference-${rowIndex + 1}"
                    data-emphasis="${referenceEmphasis(selection, "row", rowIndex)}"
                    aria-label="Select row ${rowIndex + 1}"
                    aria-haspopup="${editable ? "menu" : "false"}"
                    ${menu === "row" && rowIndex === menuTrigger ? html`aria-expanded="true"` : ""}
                    aria-pressed="${String(rowSelected(selection, rowIndex))}"
                    aria-description="${row.height ?? defaultRowHeight} pixels tall.${editable ? " Select this row, then use plus or minus to resize." : ""}"
                    tabindex="${selection?.kind === "row" && selection.start === rowIndex ? 0 : -1}"
                  >${rowIndex + 1}</button>
                  ${editable ? html`<span class="table-row-resize-handle" aria-hidden="true"></span>` : ""}
                </div>`)}
              ${editable ? html`<div class="table-row-add-item">
                <button type="button" class="table-reference-item table-add-item" aria-label="Add row at end" title="Add row at end" tabindex="-1">+</button>
              </div>` : ""}
            </div>
            <table class="table-grid" role="grid" aria-label="Table" aria-rowcount="${rows.length}" aria-colcount="${columns.length}" tabindex="${selection === null ? 0 : -1}">
              <colgroup>${columns.map((_, columnIndex) => html`<col style="width: ${columnWidths[columnIndex]}px">`)}</colgroup>
              <tbody>${rows.map((row, rowIndex) => html`
                <tr aria-rowindex="${rowIndex + 1}" style="--table-current-row-height: ${row.height ?? defaultRowHeight}px">${columns.map((column, columnIndex) => {
                  const state = cellSelection(selection, rowIndex, columnIndex);
                  return html`
                    <td
                      class="table-cell"
                      role="${headerRow && rowIndex === 0 ? "columnheader" : "gridcell"}"
                      data-header="${String(headerRow && rowIndex === 0)}"
                      data-selection="${state}"
                      aria-selected="${String(state !== "none")}"
                      aria-colindex="${columnIndex + 1}"
                      tabindex="${state === "cell" ? 0 : -1}"
                    ><span>${row.cells[column.key] ?? ""}</span></td>`;
                })}</tr>`)}</tbody>
            </table>
          </div>
        </div>
      </div>
      ${menu === "row" && editable ? rowMenu(headerRow, selection, menuTrigger) : ""}
      ${menu === "column" && editable ? columnMenu(selection, menuTrigger) : ""}
      <div class="table-status" role="status">${status === "reconnecting" ? "Reconnecting…" : status === "save-failed" ? "Couldn't save that change." : ""}</div>
    </main>`;
};

type Play = { canvasElement: HTMLElement };

const focusSelection = ({ canvasElement }: Play) => {
  canvasElement.querySelector<HTMLElement>('[data-selection="cell"], .table-reference-item[aria-pressed="true"]')?.focus();
};

const poseOpenMenu = ({ canvasElement }: Play) => {
  const menu = canvasElement.querySelector<HTMLElement>(".table-context-menu");
  if (!menu) throw new Error("Open-menu story has no menu");
  poseOpenFoundationPanel(menu);
};

const beginEditing = ({ canvasElement }: Play) => {
  const cell = canvasElement.querySelector<HTMLElement>('[data-selection="cell"]');
  const text = cell?.querySelector("span");
  if (!cell || !text) throw new Error("Editing story has no selected cell");
  const row = Number(cell.closest("tr")?.getAttribute("aria-rowindex"));
  const column = Number(cell.getAttribute("aria-colindex"));
  const input = cell.ownerDocument.createElement("textarea");
  input.className = "table-input table-cell-input";
  input.rows = 1;
  input.value = text.textContent ?? "";
  input.setAttribute("aria-label", `Row ${row}, column ${columnLetter(column - 1)}`);
  input.spellcheck = false;
  text.replaceWith(input);
  cell.tabIndex = -1;
  cell.dataset.editing = "true";
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
};

const poseScrolled = async ({ canvasElement }: Play) => {
  const scrollport = canvasElement.querySelector<HTMLElement>(".table-scroll");
  if (!scrollport) throw new Error("Scrolled story has no scrollport");
  scrollport.scrollLeft = 360;
  scrollport.scrollTop = 180;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const viewports = {
  artifact: { name: "Artifact, shared starting size", styles: { width: "760px", height: "770px" }, type: "desktop" },
};

export default {
  title: "Spec/Templates/Table",
  parameters: {
    layout: "fullscreen",
    viewport: { options: viewports },
    docs: { story: { inline: false, height: "770px" } },
  },
  globals: { viewport: { value: "artifact", isRotated: false } },
  render,
  args: {
    theme: "light",
    columns: parkColumns,
    rows: parkRows,
    headerRow: true,
    selection: null,
    menu: null,
    editable: true,
    status: null,
    loading: false,
    unreadable: false,
  } satisfies Args,
};

export const Blank = { args: { columns: [], rows: [], headerRow: false } };
export const PartiallyFilled = { name: "Partially filled", args: { columns: firstColumns, rows: firstRows, headerRow: false } };
export const WithData = { name: "With data" };
export const HeaderOff = { name: "Header row off", args: { columns: parkColumns.slice(0, scheduleColumnCount), rows: scheduleRows, headerRow: false } };
export const Resized = { name: "Saved sizes", args: { columns: resizedColumns, rows: resizedRows } };
export const Scrolled = { args: { columns: scrolledColumns, rows: scrolledRows }, play: poseScrolled };
export const SelectedCell = { name: "Selected cell", args: { selection: { kind: "cell", row: 3, column: 1 } } };
export const SelectedHeader = { name: "Selected header row cell", args: { selection: { kind: "cell", row: 0, column: 1 } } };
export const SelectedRow = { name: "Selected row", args: { selection: { kind: "row", start: 1, end: 1 } } };
export const SelectedColumn = { name: "Selected column", args: { selection: { kind: "column", start: 2, end: 2 } } };
export const KeyboardFocus = { name: "Keyboard focus", args: { selection: { kind: "cell", row: 3, column: 1 } }, play: focusSelection };
export const KeyboardFocusRow = { name: "Keyboard focus on a row", args: { selection: { kind: "row", start: 1, end: 1 } }, play: focusSelection };
export const EditingCell = { name: "Editing a cell", args: { selection: { kind: "cell", row: 3, column: 0 } }, play: beginEditing };
export const EditingHeaderCell = { name: "Editing a header row cell", args: { selection: { kind: "cell", row: 0, column: 1 } }, play: beginEditing };
export const OpenMenu = { name: "Open row 1 menu", args: { selection: { kind: "row", start: 0, end: 0 }, menu: "row" }, play: poseOpenMenu };
export const OpenColumnMenu = { name: "Open column menu", args: { selection: { kind: "column", start: 2, end: 2 }, menu: "column" }, play: poseOpenMenu };
export const OpenMultiRowMenu = { name: "Open multi-row menu", args: { selection: { kind: "row", start: 1, end: 3 }, menu: "row" }, play: poseOpenMenu };
export const ReadOnly = { name: "Read-only", args: { editable: false, selection: { kind: "cell", row: 3, column: 1 } } };
export const Disconnected = { args: { editable: false, status: "reconnecting", selection: { kind: "cell", row: 3, column: 1 } } };
export const SaveFailed = { name: "Save failed", args: { status: "save-failed", selection: { kind: "cell", row: 3, column: 1 } } };
export const Loading = { args: { columns: [], rows: [], loading: true, editable: false } };
export const LoadingDisconnected = { name: "Loading while disconnected", args: { columns: [], rows: [], loading: true, editable: false, status: "reconnecting" } };
export const Unreadable = { args: { unreadable: true } };
export const UnreadableDisconnected = { name: "Unreadable while disconnected", args: { unreadable: true, status: "reconnecting" } };
export const Dark = { args: { theme: "dark", selection: { kind: "cell", row: 3, column: 1 } } };

// Each story is one state of the bundled Table page. Behaviour is specified
// in specs/ui/templates/table.mdx; this file owns independent story markup.

import "../../../../specs/ui/foundation/index.css";
import "../../../../packages/web/src/elements/menu.ts";
import "./styles.css";
import { html, Html } from "../../../lib/html.ts";
import iconFrame from "../../../../specs/ui/foundation/icons/icon.frame";

const icon = (params: { name: string; size?: string; spinning?: boolean }): Html =>
  new Html(iconFrame.render(params, { serializableShadowRoots: true }));

interface Column { key: string; name?: string }
interface Row { key: string; cells: Record<string, string> }
type Selection =
  | { kind: "cell"; row: number; column: number }
  | { kind: "row"; start: number; end: number }
  | { kind: "column"; start: number; end: number }
  | null;
interface Args {
  theme: "light" | "dark";
  columns: Column[];
  rows: Row[];
  showHeader: boolean;
  selection: Selection;
  menu: "row" | null;
  editable: boolean;
  status: "reconnecting" | "save-failed" | null;
  loading: boolean;
  unreadable: boolean;
}

const blankColumns: Column[] = Array.from({ length: 4 }, (_, index) => ({ key: `virtual-column-${index}` }));
const blankRows: Row[] = Array.from({ length: 4 }, (_, index) => ({ key: `virtual-row-${index}`, cells: {} }));

const parkColumns: Column[] = [
  { key: "c1", name: "Park" },
  { key: "c2", name: "State" },
  { key: "c3", name: "Open" },
  { key: "c4", name: "Rating" },
];

const parkRows: Row[] = [
  { key: "r1", cells: { c1: "Acadia", c2: "Maine", c3: "Yes", c4: "4.9" } },
  { key: "r2", cells: { c1: "Arches", c2: "Utah", c3: "Yes", c4: "4.8" } },
  { key: "r3", cells: { c1: "Everglades", c2: "Florida", c3: "No", c4: "4.6" } },
  { key: "r4", cells: { c1: "Olympic", c2: "Washington", c3: "Yes", c4: "4.8" } },
  { key: "r5", cells: { c1: "Yosemite", c2: "California", c3: "Yes", c4: "4.9" } },
  { key: "r6", cells: { c1: "Zion", c2: "Utah", c3: "Yes" } },
];

const unnamedColumns: Column[] = [
  { key: "c1" },
  { key: "c2" },
  { key: "c3" },
];

const columnAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const scheduleRows: Row[] = [
  { key: "r1", cells: { c1: "Morning", c2: "Train", c3: "08:40" } },
  { key: "r2", cells: { c1: "Afternoon", c2: "Walk" } },
  { key: "r3", cells: { c1: "Evening", c3: "Dinner" } },
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

function rowMenu(showHeader: boolean) {
  return html`
    <tv-menu class="table-context-menu" trigger="table-row-reference-2" aria-label="Row actions">
      <tv-menu-item><span>Insert row above</span><kbd>⌘⇧=</kbd></tv-menu-item>
      <tv-menu-item><span>Insert row below</span></tv-menu-item>
      <tv-menu-item intent="danger"><span>Delete row</span><kbd>⌘−</kbd></tv-menu-item>
      <hr>
      <tv-menu-item><span>${showHeader ? "Hide header row" : "Show header row"}</span></tv-menu-item>
    </tv-menu>`;
}

const render = ({ theme, columns: storedColumns, rows: storedRows, showHeader, selection, menu, editable, status, loading, unreadable }: Args) => {
  document.documentElement.dataset.theme = theme;

  if (unreadable) return html`
    <main class="table-page">
      <section class="table-unreadable" role="alert">
        <span class="table-unreadable-icon">${icon({ name: "warning", size: "xl" })}</span>
        <h1 class="table-unreadable-title">This table can't be shown</h1>
        <p class="table-unreadable-text">Its saved data isn't in the form this page reads. Ask your agent to check it.</p>
      </section>
    </main>`;

  if (loading) return html`
    <main class="table-page" data-editable="${editable}">
      <div class="table-loading" role="status" aria-label="Loading table">
        ${icon({ name: "spinner", size: "md", spinning: true })}
      </div>
    </main>`;

  const columns = storedColumns.length === 0 ? blankColumns : storedColumns;
  const rows = storedRows.length === 0 ? blankRows : storedRows;
  const referencesVisible = selection !== null;

  return html`
    <main class="table-page" data-editable="${editable}">
      <div class="table-frame" data-reference-visible="${referencesVisible ? "shown" : "hidden"}">
        <div class="table-scroll">
          <div class="table-sheet" style="--table-column-count: ${columns.length}">
            <div class="table-reference-corner" aria-hidden="true"></div>
            <div class="table-column-strip table-reference-strip" aria-label="Column references">
              ${columns.map((_, columnIndex) => html`
                <div class="table-column-reference-item">
                  <button
                    type="button"
                    class="table-reference-item"
                    id="table-column-reference-${columnIndex + 1}"
                    data-emphasis="${referenceEmphasis(selection, "column", columnIndex)}"
                    aria-label="Select column ${columnLetter(columnIndex)}"
                    aria-haspopup="menu"
                    aria-selected="${columnSelected(selection, columnIndex)}"
                    tabindex="${selection?.kind === "column" && selection.start === columnIndex ? 0 : -1}"
                  >${columnLetter(columnIndex)}</button>
                </div>`)}
              ${editable ? html`<div class="table-column-add-item">
                <button type="button" class="table-reference-item table-add-item" aria-label="Add column at end" title="Add column at end">+</button>
              </div>` : ""}
            </div>
            <div class="table-row-strip table-reference-strip${showHeader ? " table-row-strip-with-header" : ""}" aria-label="Row references">
              ${rows.map((_, rowIndex) => html`
                <div class="table-row-reference-item">
                  <button
                    type="button"
                    class="table-reference-item"
                    id="table-row-reference-${rowIndex + 1}"
                    data-emphasis="${referenceEmphasis(selection, "row", rowIndex)}"
                    aria-label="Select row ${rowIndex + 1}"
                    aria-haspopup="menu"
                    aria-selected="${rowSelected(selection, rowIndex)}"
                    tabindex="${selection?.kind === "row" && selection.start === rowIndex ? 0 : -1}"
                  >${rowIndex + 1}</button>
                </div>`)}
              ${editable ? html`<div class="table-row-add-item">
                <button type="button" class="table-reference-item table-add-item" aria-label="Add row at end" title="Add row at end">+</button>
              </div>` : ""}
            </div>
            <table class="table-grid" role="grid" aria-label="Editable table" aria-rowcount="${rows.length}" aria-colcount="${columns.length}">
              <colgroup>${columns.map(() => html`<col class="table-data-column">`)}</colgroup>
              ${showHeader ? html`
                <thead>
                  <tr>${columns.map((column, columnIndex) => html`
                    <th class="table-header" scope="col" data-axis-selected="${columnSelected(selection, columnIndex)}" aria-selected="${columnSelected(selection, columnIndex)}">
                      <div class="table-header-content">
                        <button type="button" class="table-header-button" aria-label="Select column ${columnLetter(columnIndex)} name" tabindex="-1"><span>${column.name ?? ""}</span></button>
                      </div>
                    </th>`)}</tr>
                </thead>` : ""}
              <tbody>${rows.map((row, rowIndex) => html`
                <tr>${columns.map((column, columnIndex) => {
                  const state = cellSelection(selection, rowIndex, columnIndex);
                  return html`
                    <td
                      class="table-cell"
                      role="gridcell"
                      data-selection="${state}"
                      aria-selected="${state !== "none"}"
                      tabindex="${state === "cell" ? 0 : -1}"
                    ><span>${row.cells[column.key] ?? ""}</span></td>`;
                })}</tr>`)}</tbody>
            </table>
          </div>
        </div>
      </div>
      ${menu === "row" && editable ? rowMenu(showHeader) : ""}
      <div class="table-status" role="status">${status === "reconnecting" ? "Reconnecting…" : status === "save-failed" ? "Couldn't save that change." : ""}</div>
    </main>`;
};

type Play = { canvasElement: HTMLElement };

const focusSelection = ({ canvasElement }: Play) => {
  canvasElement.querySelector<HTMLElement>('[data-selection="cell"], .table-reference-item[aria-selected="true"]')?.focus();
};

const beginEditing = ({ canvasElement }: Play) => {
  const cell = canvasElement.querySelector<HTMLElement>('[data-selection="cell"]');
  const text = cell?.querySelector("span");
  if (!cell || !text) throw new Error("Editing story has no selected cell");
  const input = cell.ownerDocument.createElement("input");
  input.className = "table-input table-cell-input";
  input.type = "text";
  input.value = text.textContent ?? "";
  input.setAttribute("aria-label", "Edit row 4, column A");
  input.spellcheck = false;
  text.replaceWith(input);
  cell.dataset.editing = "true";
  input.focus();
  input.select();
};

const openRowMenu = async ({ canvasElement }: Play) => {
  const trigger = canvasElement.querySelector<HTMLButtonElement>("#table-row-reference-2");
  const menu = canvasElement.querySelector<HTMLElement>("tv-menu");
  if (!trigger || !menu) throw new Error("Menu story has no trigger or menu");
  await customElements.whenDefined("tv-menu");
  trigger.focus();
  menu.setAttribute("open", "");
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
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
    showHeader: true,
    selection: null,
    menu: null,
    editable: true,
    status: null,
    loading: false,
    unreadable: false,
  } satisfies Args,
};

export const Blank = { args: { columns: [], rows: [], showHeader: false } };
export const WithData = { name: "With data" };
export const HeaderOff = { name: "Header off", args: { columns: unnamedColumns, rows: scheduleRows, showHeader: false } };
export const SelectedCell = { name: "Selected cell", args: { selection: { kind: "cell", row: 3, column: 1 } }, play: focusSelection };
export const SelectedRow = { name: "Selected row", args: { selection: { kind: "row", start: 1, end: 1 } }, play: focusSelection };
export const SelectedColumn = { name: "Selected column", args: { selection: { kind: "column", start: 2, end: 2 } }, play: focusSelection };
export const EditingCell = { name: "Editing a cell", args: { selection: { kind: "cell", row: 3, column: 0 } }, play: beginEditing };
export const OpenMenu = { name: "Open row menu", args: { selection: { kind: "row", start: 1, end: 1 }, menu: "row" }, play: openRowMenu };
export const ReadOnly = { name: "Read-only", args: { editable: false, selection: { kind: "cell", row: 3, column: 1 } }, play: focusSelection };
export const Disconnected = { args: { editable: false, status: "reconnecting", selection: { kind: "cell", row: 3, column: 1 } }, play: focusSelection };
export const SaveFailed = { name: "Save failed", args: { status: "save-failed", selection: { kind: "cell", row: 3, column: 1 } }, play: focusSelection };
export const Loading = { args: { columns: [], rows: [], loading: true } };
export const Unreadable = { args: { unreadable: true } };
export const Dark = { args: { theme: "dark", selection: { kind: "cell", row: 3, column: 1 } }, play: focusSelection };

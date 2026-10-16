// Row DOM is recycled while the virtual window moves. Listeners read the
// current data attributes, so reusing a node never retains the old row ID.

import type { CellValue, Column, Row } from "../data.ts";
import { button, element } from "./dom.ts";
import { cellLabel } from "./view.ts";

/** Actions and presentation state supplied by the table element. */
export interface RowRenderingConfig {
  columns: Column[];
  template: string;
  rowHeight: number;
  idPrefix: string;
  readOnly: boolean;
  isRowSelected: (rowId: string) => boolean;
  isDraggingSelection: () => boolean;
  selectRow: (rowId: string) => void;
  openRowMenu: (rowId: string) => void;
  moveRow: (sourceId: string, destinationId: string) => void;
  onCellPointerDown: (event: PointerEvent, rowId: string, columnId: string) => void;
  extendSelection: (rowId: string, columnId: string) => void;
  selectCell: (rowId: string, columnId: string) => void;
  beginEdit: () => void;
  inSelection: (rowId: string, columnId: string) => boolean;
  drawCellContent: (cell: HTMLElement, value: CellValue | undefined, column: Column) => void;
  styleSelection: (cell: HTMLElement) => void;
}

/** Draw a row, reusing an old row node when virtual scrolling permits it. */
export function drawRow(
  config: RowRenderingConfig,
  row: Row,
  displayIndex: number,
  recycled?: HTMLElement,
): HTMLElement {
  if (recycled) {
    updateRenderedRow(config, recycled, row, displayIndex);
    return recycled;
  }

  const line = element("div", "tg-row");
  line.setAttribute("role", "row");
  line.style.gridTemplateColumns = config.template;
  line.style.height = `${config.rowHeight}px`;

  const index = element("div", "tg-index");
  index.setAttribute("role", "rowheader");
  index.addEventListener("click", () => config.selectRow(line.dataset.rowId!));
  index.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    config.openRowMenu(line.dataset.rowId!);
  });
  index.append(element("span", "tg-row-number"));

  if (!config.readOnly) {
    const handle = element("span", "tg-row-handle");
    handle.draggable = true;
    handle.title = "Drag to reorder row";
    handle.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/table-row", line.dataset.rowId!);
    });
    index.append(handle);

    const trigger = button("Row actions", "more", "tg-row-menu-trigger");
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      config.openRowMenu(line.dataset.rowId!);
    });
    index.append(trigger);
  }

  line.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("text/table-row")) event.preventDefault();
  });
  line.addEventListener("drop", (event) => {
    const sourceId = event.dataTransfer?.getData("text/table-row");
    const destinationId = line.dataset.rowId;
    if (!sourceId || !destinationId) return;
    event.preventDefault();
    config.moveRow(sourceId, destinationId);
  });

  line.append(index);
  for (const column of config.columns) {
    const cell = element("div", `tg-cell${column.primary ? " is-primary" : ""}`);
    cell.setAttribute("role", "gridcell");
    cell.dataset.columnId = column.id;
    cell.dataset.type = column.type;
    cell.addEventListener("pointerdown", (event) => {
      config.onCellPointerDown(event, line.dataset.rowId!, cell.dataset.columnId!);
    });
    cell.addEventListener("pointerenter", () => {
      if (config.isDraggingSelection()) {
        config.extendSelection(line.dataset.rowId!, cell.dataset.columnId!);
      }
    });
    cell.addEventListener("dblclick", () => {
      config.selectCell(line.dataset.rowId!, cell.dataset.columnId!);
      config.beginEdit();
    });
    cell.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const rowId = line.dataset.rowId!;
      const columnId = cell.dataset.columnId!;
      if (!config.inSelection(rowId, columnId)) config.selectCell(rowId, columnId);
      config.openRowMenu(rowId);
    });
    line.append(cell);
  }
  line.append(element("div", "tg-row-end"));

  updateRenderedRow(config, line, row, displayIndex);
  return line;
}

function updateRenderedRow(
  config: RowRenderingConfig,
  line: HTMLElement,
  row: Row,
  displayIndex: number,
): void {
  line.dataset.rowId = row.id;
  line.setAttribute("aria-rowindex", String(displayIndex + 1));
  const index = line.querySelector<HTMLElement>(".tg-index")!;
  index.classList.toggle("is-selected", config.isRowSelected(row.id));
  index.querySelector<HTMLElement>(".tg-row-number")!.textContent = String(displayIndex);

  const trigger = index.querySelector<HTMLElement>(".tg-row-menu-trigger");
  if (trigger) {
    trigger.id = `${config.idPrefix}-row-${row.id}`;
    trigger.setAttribute("aria-label", `Row ${displayIndex} actions`);
    trigger.title = `Row ${displayIndex} actions`;
  }

  const cells = line.querySelectorAll<HTMLElement>(":scope > .tg-cell");
  for (const [columnIndex, column] of config.columns.entries()) {
    const cell = cells[columnIndex];
    cell.dataset.rowId = row.id;
    cell.dataset.columnId = column.id;
    cell.dataset.type = column.type;
    cell.id = `${config.idPrefix}-cell-${encodeURIComponent(row.id)}-${encodeURIComponent(column.id)}`;
    cell.setAttribute(
      "aria-label",
      `${column.name}, row ${displayIndex}: ${cellLabel(row.cells[column.id], column) || "empty"}`,
    );
    config.drawCellContent(cell, row.cells[column.id], column);
    config.styleSelection(cell);
  }
}

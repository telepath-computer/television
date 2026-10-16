// Column pointer gestures preview width without changing stored data. The grid
// commits one column change when the gesture ends, so undo has one step.

import type { TableData } from "../data.ts";
import type { TableChange } from "./model.ts";
import { cellLabel } from "./view.ts";

/** The grid supplies its current table, lifetime, and change boundary. */
export interface ColumnPointerConfig {
  host: HTMLElement;
  table: () => TableData;
  commit: (change: TableChange) => void;
  render: () => void;
  signal: AbortSignal;
}

/** Drag a header's right edge to resize its column. */
export function resizeColumn(
  event: PointerEvent,
  columnId: string,
  config: ColumnPointerConfig,
): void {
  if (event.button !== 0 || config.signal.aborted) return;

  const table = config.table();
  const column = table.columns.find((item) => item.id === columnId);
  if (!column) return;

  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const startWidth = column.width;
  const gesture = new AbortController();
  const stopGesture = () => gesture.abort();

  config.signal.addEventListener("abort", stopGesture, {
    once: true,
    signal: gesture.signal,
  });

  document.addEventListener("pointermove", (move) => {
    const width = Math.max(72, startWidth + move.clientX - startX);
    const columns = table.columns.map((item) => (
      `${item.id === columnId ? width : item.width}px`
    )).join(" ");
    const template = `48px ${columns} 44px`;

    for (const row of config.host.querySelectorAll<HTMLElement>(
      ".tg-header, .tg-row, .tg-footer",
    )) {
      row.style.gridTemplateColumns = template;
    }
  }, { signal: gesture.signal });

  document.addEventListener("pointerup", (up) => {
    stopGesture();
    const width = Math.max(72, Math.round(startWidth + up.clientX - startX));
    if (width === startWidth) {
      config.render();
      return;
    }
    config.commit({
      type: "column-update",
      columnId,
      column: { ...column, width },
    });
  }, { signal: gesture.signal });

  document.addEventListener("pointercancel", () => {
    stopGesture();
    config.render();
  }, { signal: gesture.signal });
}

/** Fit a column to its header and a bounded sample of its cell labels. */
export function fitColumn(
  columnId: string,
  config: ColumnPointerConfig,
): void {
  const table = config.table();
  const column = table.columns.find((item) => item.id === columnId);
  if (!column) return;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return;

  const style = getComputedStyle(config.host);
  context.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

  let widest = context.measureText(column.name).width;
  for (const row of table.rows.slice(0, 200)) {
    const label = cellLabel(row.cells[columnId], column);
    widest = Math.max(widest, context.measureText(label).width);
  }

  const width = Math.max(88, Math.min(420, Math.ceil(widest + 54)));
  if (width === column.width) return;

  config.commit({
    type: "column-update",
    columnId,
    column: { ...column, width },
  });
}

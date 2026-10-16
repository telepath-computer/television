// Native inputs for value and name editing. The grid supplies change and
// selection callbacks; this module owns only the editor's DOM and lifecycle.

import type { CellValue, Column, Row } from "../data.ts";
import { parseValue } from "./view.ts";

export type EditMove = "down" | "right" | "left";

export interface InputEditor {
  element: HTMLInputElement;
  finish: (save: boolean, move?: EditMove) => void;
}

export interface CellInputConfig {
  cell: HTMLElement;
  row: Row;
  column: Column;
  replacement?: string;
  commit: (value: CellValue) => void;
  restore: () => void;
  onFinish: () => void;
  afterFinish: (move?: EditMove) => void;
}

/** Replace a cell's display with an input appropriate to its column type. */
export function startCellInputEditor(config: CellInputConfig): InputEditor {
  const { cell, row, column } = config;
  const input = document.createElement("input");
  input.className = "tg-editor";
  input.type = inputType(column);
  if (input.type === "number") input.step = "any";

  const oldValue = row.cells[column.id] ?? null;
  input.value = config.replacement ?? (oldValue == null ? "" : String(oldValue));
  cell.replaceChildren(input);

  let finished = false;
  const finish = (save: boolean, move?: EditMove): void => {
    if (finished) return;
    finished = true;
    config.onFinish();

    const nextValue = save ? parseValue(input.value, column) : oldValue;
    if (save && JSON.stringify(nextValue) !== JSON.stringify(oldValue)) {
      config.commit(nextValue);
    } else {
      config.restore();
    }
    config.afterFinish(move);
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      finish(true, "down");
    } else if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      finish(true, event.shiftKey ? "left" : "right");
    }
  });
  input.addEventListener("blur", () => finish(true), { once: true });
  input.focus();
  if (config.replacement == null && input.type !== "date") input.select();

  return { element: input, finish };
}

export interface InlineRenameConfig {
  trigger: HTMLElement;
  className: string;
  value: string;
  commit: (value: string) => void;
}

/** Edit a title or column name in place, restoring the label on cancel. */
export function startInlineRename(config: InlineRenameConfig): HTMLInputElement {
  const input = document.createElement("input");
  input.className = config.className;
  input.value = config.value;
  config.trigger.replaceWith(input);

  let finished = false;
  const finish = (save: boolean): void => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (save && value && value !== config.value) {
      config.commit(value);
    } else {
      input.replaceWith(config.trigger);
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(event.key === "Enter");
    }
  });
  input.addEventListener("blur", () => finish(true), { once: true });
  input.focus();
  input.select();
  return input;
}

function inputType(column: Column): string {
  if (column.type === "date") return "date";
  if (column.type === "number" || column.type === "currency") return "number";
  if (column.type === "url") return "url";
  return "text";
}

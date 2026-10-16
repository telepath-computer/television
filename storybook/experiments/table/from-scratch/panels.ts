// Small floating panels collect a choice and hand it back to the grid. They
// know about column types and summary modes, but never change table data.

import type { Column, ColumnType } from "../data.ts";
import { button, element, icon } from "./dom.ts";

const columnTypes: ColumnType[] = [
  "text",
  "number",
  "currency",
  "date",
  "checkbox",
  "select",
  "multiselect",
  "person",
  "url",
];

const typeIcons: Record<ColumnType, string> = {
  text: "edit",
  number: "hash",
  currency: "money",
  date: "calendar",
  checkbox: "check",
  select: "tag",
  multiselect: "list",
  person: "user",
  url: "link",
};

function labelFor(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}

/** Build the add-column panel and focus its name field. */
export function buildColumnPanel(
  panel: HTMLElement,
  onAdd: (name: string, type: ColumnType) => void,
): void {
  const heading = element("div", "tg-panel-heading", "New column");
  const name = element("input");
  name.placeholder = "Column name";
  name.setAttribute("aria-label", "Column name");

  const type = element("select");
  type.setAttribute("aria-label", "Column type");
  for (const value of columnTypes) {
    const option = element("option", undefined, labelFor(value));
    option.value = value;
    type.append(option);
  }

  const add = button("Add column", "add", "tg-panel-primary");
  const submit = (): void => {
    onAdd(name.value.trim() || "New column", type.value as ColumnType);
  };
  add.addEventListener("click", submit);
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });

  panel.append(heading, name, type, add);
  name.focus();
}

/** Build the type chooser, marking the column's current type. */
export function buildTypePanel(
  panel: HTMLElement,
  column: Column,
  onChoose: (type: ColumnType) => void,
): void {
  panel.append(element("div", "tg-panel-heading", `Change ${column.name} type`));
  for (const type of columnTypes) {
    const choice = button(labelFor(type), undefined, "tg-panel-choice tg-type-choice");
    choice.prepend(icon(typeIcons[type]));
    if (type === column.type) {
      choice.append(icon("check"));
      choice.setAttribute("aria-current", "true");
    }
    choice.addEventListener("click", () => onChoose(type));
    panel.append(choice);
  }
}

/** Build aggregate choices for a footer cell. */
export function buildSummaryPanel(
  panel: HTMLElement,
  column: Column,
  currentMode: string,
  onChoose: (mode: string) => void,
): void {
  panel.append(element("div", "tg-panel-heading", `Summarize ${column.name}`));
  const modes = ["none", "filled", "empty"];
  if (column.type === "number" || column.type === "currency") {
    modes.push("sum", "average", "min", "max");
  }
  if (column.type === "checkbox") modes.push("checked", "percent");

  for (const mode of modes) {
    const choice = button(labelFor(mode), undefined, "tg-panel-choice tg-type-choice");
    if (mode === currentMode) {
      choice.append(icon("check"));
      choice.setAttribute("aria-current", "true");
    }
    choice.addEventListener("click", () => onChoose(mode));
    panel.append(choice);
  }
}

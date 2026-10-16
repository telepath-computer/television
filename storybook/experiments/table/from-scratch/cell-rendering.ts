// Cell content is rendered from typed values without changing table state.
// The grid supplies the checkbox action; links and labels stay safe even when
// their values came from an agent or a pasted cell.

import type { CellValue, Column, OptionColor, TableData } from "../data.ts";

/** Actions the owning grid provides to an otherwise stateless cell renderer. */
export interface CellRenderCallbacks {
  toggleCheckbox: (checked: boolean) => void;
  readOnly?: boolean;
  numberFractionDigits?: number;
}

const numberFormats = [0, 1, 2].map((digits) => new Intl.NumberFormat(undefined, {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
}));
const currencyFormats = new Map<string, Intl.NumberFormat>();

/** Use one decimal width for each number column, including hidden rows. */
export function numberPrecisionByColumn(table: TableData): Map<string, number> {
  const digits = new Map<string, number>();
  for (const column of table.columns) {
    if (column.type !== "number") continue;
    let maximum = 0;
    for (const row of table.rows) {
      const value = row.cells[column.id];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const fraction = Number(value.toFixed(2)).toString().split(".")[1]?.length ?? 0;
      maximum = Math.max(maximum, fraction);
      if (maximum === 2) break;
    }
    digits.set(column.id, maximum);
  }
  return digits;
}

/** Replace a cell's presentation with the display for its typed value. */
export function renderCellContent(
  cell: HTMLElement,
  value: CellValue | undefined,
  column: Column,
  callbacks: CellRenderCallbacks,
): void {
  cell.replaceChildren();
  cell.classList.toggle("is-number", column.type === "number" || column.type === "currency");
  cell.classList.toggle("is-checkbox", column.type === "checkbox");

  const content = document.createElement("div");
  content.className = "tg-cell-content";

  if (column.type === "checkbox") {
    appendCheckbox(content, cell, column, value, callbacks);
  } else if (column.type === "select" || column.type === "multiselect") {
    appendOptions(content, value, column);
  } else if (column.type === "person" && value) {
    appendPerson(content, String(value));
  } else if (column.type === "url" && typeof value === "string" && value) {
    appendUrl(cell, content, value);
  } else if (column.type === "date" && typeof value === "string" && value) {
    content.textContent = formatDate(value);
  } else if (column.type === "currency" && typeof value === "number") {
    content.textContent = currencyFormat(column.currency ?? "USD").format(value);
  } else if (column.type === "number" && typeof value === "number") {
    content.textContent = numberFormats[callbacks.numberFractionDigits ?? 0].format(value);
  } else {
    content.textContent = value == null ? "" : String(value);
  }

  // A native tooltip exposes the complete display value without measuring
  // every recycled cell. Layout reads here would cost a frame while scrolling.
  content.title ||= content.textContent ?? "";
  cell.title = column.type === "url" && typeof value === "string"
    ? value
    : content.title;
  cell.prepend(content);
}

/** Build a coloured option pill for cells, group headings, or picker items. */
export function pill(label: string, color: OptionColor): HTMLElement {
  const node = document.createElement("span");
  node.className = "tg-pill";
  node.dataset.color = color;
  node.textContent = label;
  node.title = label;
  return node;
}

function appendCheckbox(
  content: HTMLElement,
  cell: HTMLElement,
  column: Column,
  value: CellValue | undefined,
  callbacks: CellRenderCallbacks,
): void {
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = value === true;
  checkbox.tabIndex = -1;
  checkbox.setAttribute("aria-label", `${column.name}, ${cell.dataset.rowId ?? "row"}`);
  checkbox.addEventListener("click", (event) => {
    event.stopPropagation();
    if (callbacks.readOnly) {
      checkbox.checked = value === true;
      return;
    }
    callbacks.toggleCheckbox(checkbox.checked);
  });
  content.append(checkbox);
}

function appendOptions(content: HTMLElement, value: CellValue | undefined, column: Column): void {
  const ids = column.type === "multiselect"
    ? Array.isArray(value) ? value : []
    : typeof value === "string" ? [value] : [];

  const labels: string[] = [];
  for (const id of ids) {
    const option = column.options?.find((item) => item.id === id);
    if (!option) continue;
    content.append(pill(option.label, option.color));
    labels.push(option.label);
  }
  content.title = labels.join(", ");
}

function appendPerson(content: HTMLElement, name: string): void {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const avatar = document.createElement("span");
  avatar.className = "tg-avatar";
  avatar.textContent = initials;
  const label = document.createElement("span");
  label.textContent = name;
  content.append(avatar, label);
}

function appendUrl(cell: HTMLElement, content: HTMLElement, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    content.textContent = value;
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    content.textContent = value;
    return;
  }

  const label = value.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const link = document.createElement("a");
  link.className = "tg-url";
  link.href = url.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  link.title = value;
  link.addEventListener("click", (event) => {
    if (!event.metaKey && !event.ctrlKey) event.preventDefault();
  });
  content.append(link);

  const open = document.createElement("a");
  open.className = "tg-cell-action";
  open.href = url.href;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.title = "Open link";
  open.setAttribute("aria-label", "Open link in new tab");
  const icon = document.createElement("tv-icon");
  icon.setAttribute("name", "external");
  open.append(icon);
  open.addEventListener("click", (event) => event.stopPropagation());
  cell.append(open);
}

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

function currencyFormat(currency: string): Intl.NumberFormat {
  let formatter = currencyFormats.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
    currencyFormats.set(currency, formatter);
  }
  return formatter;
}

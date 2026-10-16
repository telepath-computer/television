// RevoGrid cell and header templates. Stencil's hyperscript makes text nodes
// from source data, so untrusted agent-written values never enter HTML markup.

import type { Column, CellValue, SelectOption } from "../data";
import type { ColumnRegular } from "@revolist/revogrid";
import { fieldIcon } from "./field-icons";

/** Flat row shape passed to RevoGrid, retaining the store row id. */
export type GridRow = Record<string, CellValue | string | undefined> & { __id?: string; __kind?: "new" | "summary" };

interface CellActions {
  set(rowId: string, columnId: string, value: CellValue): void;
  addRow(): void;
  menu(columnId: string, anchor: HTMLElement): void;
  rowMenu(rowId: string, anchor: HTMLElement): void;
  moveRow(fromId: string, toId: string): void;
  addColumn(index: number, anchor: HTMLElement): void;
  openLink(url: string): void;
  isMatch(rowId: string, columnId: string): boolean;
  isFlash(rowId: string, columnId: string): boolean;
  summary(columnId: string): string;
  summaryMenu(columnId: string, anchor: HTMLElement): void;
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const currentYear = new Date().getFullYear();
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const dateWithYearFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const currencyFormats = new Map<string, Intl.NumberFormat>();
const dateLabels = new Map<string, string>();

function currencyFormat(currency: string): Intl.NumberFormat {
  let format = currencyFormats.get(currency);
  if (!format) {
    format = new Intl.NumberFormat("en-US", { style: "currency", currency });
    currencyFormats.set(currency, format);
  }
  return format;
}

/** User-facing value for copies, search, and typed cell display. */
export function displayValue(value: CellValue | undefined, column: Column): string {
  if (value == null || value === "") return "";
  if (column.type === "checkbox") return value ? "Yes" : "No";
  if (column.type === "select") return column.options?.find((option) => option.id === value)?.label ?? String(value);
  if (column.type === "multiselect") return (Array.isArray(value) ? value : []).map((id) => column.options?.find((option) => option.id === id)?.label ?? id).join(", ");
  if (column.type === "number" && typeof value === "number") return numberFormat.format(value);
  if (column.type === "currency" && typeof value === "number") return currencyFormat(column.currency ?? "USD").format(value);
  if (column.type === "date" && typeof value === "string") {
    const cached = dateLabels.get(value);
    if (cached) return cached;
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return value;
    const date = new Date(year, month - 1, day);
    const label = (year === currentYear ? dateFormat : dateWithYearFormat).format(date);
    // Large tables repeat dates. Bound the cache for arbitrary agent data.
    if (dateLabels.size >= 512) dateLabels.clear();
    dateLabels.set(value, label);
    return label;
  }
  if (column.type === "url") {
    try { const url = new URL(String(value)); return `${url.host}${url.pathname.length > 22 ? `${url.pathname.slice(0, 22)}…` : url.pathname}`; }
    catch { return String(value); }
  }
  return String(value);
}

/** Only web links can leave an artifact. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !/^https?:/i.test(value)) return null;
  try { const url = new URL(String(value)); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; }
  catch { return null; }
}

function optionPill(h: Parameters<NonNullable<ColumnRegular["cellTemplate"]>>[0], option: SelectOption) {
  return h("span", { class: `rg-pill rg-pill-${option.color}` }, option.label);
}

/** Build a RevoGrid column using columnTypes for reusable typed rendering. */
export function gridColumn(column: Column, index: number, actions: CellActions, readOnly: boolean): ColumnRegular {
  return {
    prop: column.id,
    name: column.name,
    size: column.width,
    minSize: 76,
    pin: column.primary ? "colPinStart" : undefined,
    columnType: column.type,
    sortable: false,
    filter: false,
    readonly: readOnly || column.type === "checkbox",
    rowDrag: column.primary && !readOnly,
    columnTemplate: (h) => h("div", { class: "rg-header-content" }, [
      h("tv-icon", { name: fieldIcon(column.type), size: "sm", class: "rg-header-type" }),
      h("span", { class: "rg-header-name", title: `Double-click to rename ${column.name}` }, column.name),
      h("button", {
        class: "rg-header-menu", type: "button", title: `${column.name} options`, "aria-label": `${column.name} options`,
        onClick: (event: MouseEvent) => { event.stopPropagation(); actions.menu(column.id, event.currentTarget as HTMLElement); },
      }, h("tv-icon", { name: "down", size: "sm" })),
      h("button", {
        class: "rg-header-insert", type: "button", title: `Insert column after ${column.name}`, "aria-label": `Insert column after ${column.name}`,
        onClick: (event: MouseEvent) => { event.stopPropagation(); actions.addColumn(index + 1, event.currentTarget as HTMLElement); },
      }, h("tv-icon", { name: "add", size: "sm" })),
    ]),
    cellTemplate: (h, props) => {
      const model = props.model as GridRow;
      if (model.__kind === "new") return h("button", {
        class: `rg-new-row${index ? " rg-new-row-fill" : ""}`, type: "button", title: "Add a row", "aria-label": "Add a row",
        onMouseDown: (event: MouseEvent) => event.stopPropagation(),
        onClick: (event: MouseEvent) => { event.stopPropagation(); actions.addRow(); },
      }, index === 0 ? [h("tv-icon", { name: "add", size: "sm" }), h("span", null, "New row")] : []);
      if (model.__kind === "summary") {
        const aggregate = actions.summary(column.id).replace(/^Σ /, "");
        const label = aggregate || (index === 0 ? "Summary" : "Summarize");
        return h("button", {
        type: "button", class: `rg-summary${index === 0 ? " rg-summary-label" : ""}${!aggregate && index !== 0 ? " rg-summary-empty" : ""}${column.type === "number" || column.type === "currency" ? " rg-summary-number" : ""}`, title: `Choose ${column.name} summary`,
        onClick: (event: MouseEvent) => { event.stopPropagation(); actions.summaryMenu(column.id, event.currentTarget as HTMLElement); },
      }, label);
      }
      const value = model[column.id] as CellValue | undefined;
      const match = model.__id && actions.isMatch(model.__id, column.id);
      const flash = model.__id && actions.isFlash(model.__id, column.id);
      const className = `rg-cell-content${match ? " rg-match" : ""}${flash ? " rg-flash" : ""}${column.type === "number" || column.type === "currency" ? " rg-number" : ""}`;
      const cellAttributes = { "data-row-id": model.__id, "data-column-id": column.id };
      if (column.type === "checkbox") return h("span", { class: `${className} rg-check-wrap`, ...cellAttributes }, h("button", {
        type: "button", class: `rg-check${value ? " checked" : ""}`, role: "checkbox", "aria-checked": String(Boolean(value)), "aria-label": `${column.name}: ${value ? "checked" : "unchecked"}`,
        onClick: (event: MouseEvent) => { event.stopPropagation(); if (!readOnly && model.__id) actions.set(model.__id, column.id, !value); },
      }, value ? h("tv-icon", { name: "check", size: "sm" }) : h("span", null, "")));
      if (column.type === "select" || column.type === "multiselect") {
        const ids = Array.isArray(value) ? value : value == null ? [] : [String(value)];
        return h("span", { class: `${className} rg-pills`, ...cellAttributes }, ids.map((id) => {
          const option = column.options?.find((item) => item.id === id);
          return option ? optionPill(h, option) : h("span", { class: "rg-pill rg-pill-neutral" }, id);
        }));
      }
      if (column.type === "person") return h("span", { class: `${className} rg-person`, ...cellAttributes }, value
        ? [h("span", { class: "rg-avatar", "aria-hidden": "true" }, String(value).slice(0, 1).toUpperCase()), h("span", null, String(value))]
        : []);
      if (column.type === "url") {
        const url = safeUrl(value);
        return h("span", { class: `${className} rg-url`, ...cellAttributes, onClick: (event: MouseEvent) => { if ((event.metaKey || event.ctrlKey) && url) { event.stopPropagation(); actions.openLink(url); } } }, [
          h("span", { class: "rg-url-text" }, displayValue(value, column)),
          url ? h("button", {
            type: "button", class: "rg-open-link", title: "Open link in new tab", "aria-label": `Open ${url} in new tab`,
            onClick: (event: MouseEvent) => { event.stopPropagation(); actions.openLink(url); },
          }, h("tv-icon", { name: "external", size: "sm" })) : h("span", null, ""),
        ]);
      }
      return h("span", { class: className, ...cellAttributes }, displayValue(value, column));
    },
  };
}

/** Custom row number column with a hover menu and RevoGrid row dragging. */
export function rowHeader(actions: CellActions, canMove: boolean, readOnly: boolean): ColumnRegular {
  return {
    prop: "__rowNumber", size: 58, readonly: true, rowDrag: canMove,
    columnTemplate: (h) => h("span", { class: "rg-row-header-title" }, "#"),
    cellTemplate: (h, props) => {
      const model = props.model as GridRow;
      if (model.__kind === "new") return h("button", {
        class: "rg-new-row rg-new-row-fill", type: "button", title: "Add a row", "aria-label": "Add a row",
        onMouseDown: (event: MouseEvent) => event.stopPropagation(),
        onClick: (event: MouseEvent) => { event.stopPropagation(); actions.addRow(); },
      });
      if (model.__kind) return h("span", null, "");
      return h("span", {
        class: `rg-row-number${readOnly ? "" : " editable"}`,
        "data-row-id": model.__id,
        onDragOver: (event: DragEvent) => event.preventDefault(),
        onDrop: (event: DragEvent) => { event.preventDefault(); if (!canMove) return; const fromId = event.dataTransfer?.getData("text/plain"); if (fromId && model.__id) actions.moveRow(fromId, model.__id); },
      }, [
        h("span", null, String(model.__rowNumber ?? props.rowIndex + 1)),
        canMove ? h("button", {
          class: "rg-row-drag", type: "button", draggable: true, title: "Drag to reorder row", "aria-label": `Drag row ${props.rowIndex + 1}`,
          onDragStart: (event: DragEvent) => { if (model.__id) event.dataTransfer?.setData("text/plain", model.__id); },
        }, h("span", { class: "rg-grip", "aria-hidden": "true" })) : h("span", null, ""),
        readOnly ? h("span", null, "") : h("button", {
          class: "rg-row-menu", type: "button", title: "Row options", "aria-label": `Row ${props.rowIndex + 1} options`,
          onClick: (event: MouseEvent) => { event.stopPropagation(); if (model.__id) actions.rowMenu(model.__id, event.currentTarget as HTMLElement); },
        }, h("tv-icon", { name: "more", size: "sm" })),
      ]);
    },
  };
}

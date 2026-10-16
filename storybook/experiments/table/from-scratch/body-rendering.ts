// The body owns its row window. Rows that leave the window become the nodes
// for rows entering it, so scrolling does not reconnect the whole grid.

import type { Column, Row, TableData } from "../data.ts";
import { pill } from "./cell-rendering.ts";
import { button, element, icon } from "./dom.ts";
import { summaryValue } from "./summary.ts";
import type { ViewItem } from "./view.ts";

/** State and actions supplied by the grid element for one body draw. */
export interface BodyRenderingConfig {
  body: HTMLElement;
  table: TableData;
  visible: ViewItem[];
  collapsed: ReadonlySet<string>;
  groupBy?: string;
  search: string;
  rowHeight: number;
  readOnly: boolean;
  summary: boolean;
  summaryModes: Readonly<Record<string, string>>;
  viewportHeight: number;
  scrollTop: number;
  template: string;
  drawRow: (row: Row, displayIndex: number, recycled?: HTMLElement) => HTMLElement;
  onGroupToggle: (key: string) => void;
  onAddRow: () => void;
  onSummaryClick: (column: Column, trigger: HTMLElement) => void;
  onEditorLeavesWindow: (rowIds: ReadonlySet<string>) => boolean;
  highlightMatches: () => void;
}

/** Render a complete small view or maintain a recycled window of large views. */
export class BodyRenderer {
  private lastWindow = "";
  private rows = new Map<string, HTMLElement>();
  private top?: HTMLElement;
  private bottom?: HTMLElement;
  private addRow?: HTMLElement;
  private footer?: HTMLElement;

  /** Invalidate the window when data, columns, view, or row height changes. */
  reset(): void {
    this.lastWindow = "";
    this.rows.clear();
    this.top = undefined;
    this.bottom = undefined;
    this.addRow = undefined;
    this.footer = undefined;
  }

  draw(config: BodyRenderingConfig): void {
    const { visible, rowHeight, viewportHeight, scrollTop } = config;
    const virtual = visible.length > 150 && !config.groupBy;
    const start = virtual
      ? Math.max(0, Math.floor(Math.max(0, scrollTop - 40) / rowHeight) - 8)
      : 0;
    const count = virtual ? Math.ceil(viewportHeight / rowHeight) + 18 : visible.length;
    const end = virtual ? Math.min(visible.length, start + count) : visible.length;
    const windowKey = `${start}:${end}:${config.table.rows.length}:${rowHeight}`;
    if (windowKey === this.lastWindow) return;
    this.lastWindow = windowKey;

    if (virtual) {
      this.drawVirtual(config, start, end);
      return;
    }
    this.drawAll(config, start, end);
  }

  private drawAll(config: BodyRenderingConfig, start: number, end: number): void {
    const fragment = document.createDocumentFragment();
    let recordNumber = 0;
    for (let index = start; index < end; index++) {
      const item = config.visible[index];
      if (item.type === "group") {
        fragment.append(this.drawGroup(config, item));
      } else {
        fragment.append(config.drawRow(item.row, ++recordNumber));
      }
    }
    if (!config.table.rows.length) fragment.append(this.drawEmpty(config));
    if (!config.readOnly) fragment.append(this.drawAddRow(config));
    if (config.summary) fragment.append(this.drawSummary(config));
    config.body.replaceChildren(fragment);
    this.rows.clear();
    this.top = undefined;
    this.bottom = undefined;
    this.addRow = undefined;
    this.footer = undefined;
    if (config.search) config.highlightMatches();
  }

  private drawVirtual(config: BodyRenderingConfig, start: number, end: number): void {
    const { body, visible, rowHeight } = config;
    if (this.top?.parentElement !== body || this.bottom?.parentElement !== body) {
      this.top = element("div", "tg-spacer tg-spacer-top");
      this.bottom = element("div", "tg-spacer tg-spacer-bottom");
      body.replaceChildren(this.top, this.bottom);
      this.rows.clear();
      this.addRow = undefined;
      this.footer = undefined;
    }
    const top = this.top!;
    const bottom = this.bottom!;
    const topHeight = `${start * rowHeight}px`;
    const bottomHeight = `${(visible.length - end) * rowHeight}px`;
    if (top.style.height !== topHeight) top.style.height = topHeight;
    if (bottom.style.height !== bottomHeight) bottom.style.height = bottomHeight;

    const desired = new Set<string>();
    for (let index = start; index < end; index++) {
      const item = visible[index];
      if (item.type === "row") desired.add(item.row.id);
    }
    if (config.onEditorLeavesWindow(desired)) return;

    const recycled: HTMLElement[] = [];
    for (const [rowId, node] of this.rows) {
      if (desired.has(rowId)) continue;
      this.rows.delete(rowId);
      node.remove();
      recycled.push(node);
    }

    let cursor: Node = top.nextSibling ?? bottom;
    for (let index = start; index < end; index++) {
      const item = visible[index];
      if (item.type !== "row") continue;
      let node = this.rows.get(item.row.id);
      if (!node) {
        node = config.drawRow(item.row, index + 1, recycled.pop());
        this.rows.set(item.row.id, node);
      }
      if (node !== cursor) body.insertBefore(node, cursor);
      cursor = node.nextSibling ?? bottom;
    }

    if (end === visible.length) {
      if (!config.readOnly) {
        this.addRow ??= this.drawAddRow(config);
        body.append(this.addRow);
      }
      if (config.summary) {
        this.footer ??= this.drawSummary(config);
        body.append(this.footer);
      }
    } else {
      this.addRow?.remove();
      this.footer?.remove();
    }
    if (config.search) config.highlightMatches();
  }

  private drawGroup(
    config: BodyRenderingConfig,
    item: Extract<ViewItem, { type: "group" }>,
  ): HTMLElement {
    const row = element("button", "tg-group");
    row.type = "button";
    row.style.width = `${tableWidth(config.table)}px`;
    const expanded = !config.collapsed.has(item.key);
    row.setAttribute("aria-expanded", String(expanded));
    row.append(icon(expanded ? "expand" : "collapse"));
    const groupColumn = config.table.columns.find((column) => column.id === config.groupBy);
    const option = groupColumn?.options?.find((candidate) => candidate.id === item.key);
    row.append(option ? pill(item.label, option.color) : element("strong", undefined, item.label));
    row.append(element("span", undefined, `${item.count} ${item.count === 1 ? "record" : "records"}`));
    row.addEventListener("click", () => config.onGroupToggle(item.key));
    return row;
  }

  private drawAddRow(config: BodyRenderingConfig): HTMLElement {
    const line = element("div", "tg-add-row");
    line.style.width = `${tableWidth(config.table)}px`;
    line.setAttribute("role", "button");
    line.setAttribute("aria-label", "New row");
    line.tabIndex = 0;
    const add = button("New row", "add");
    add.tabIndex = -1;
    line.append(add);
    line.addEventListener("click", () => config.onAddRow());
    line.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      config.onAddRow();
    });
    return line;
  }

  private drawEmpty(config: BodyRenderingConfig): HTMLElement {
    const empty = element("div", "tg-empty");
    empty.style.width = `${tableWidth(config.table)}px`;
    empty.textContent = "No rows yet. Ask your agent to add some, or add one here.";
    return empty;
  }

  private drawSummary(config: BodyRenderingConfig): HTMLElement {
    const footer = element("div", "tg-footer");
    footer.style.gridTemplateColumns = config.template;
    footer.append(element("div", "tg-index", "Σ"));
    for (const column of config.table.columns) {
      const cell = element("button", "tg-summary-cell");
      cell.type = "button";
      const mode = config.summaryModes[column.id] ?? "none";
      cell.textContent = summaryValue(config.table.rows, column, mode);
      cell.classList.toggle("is-empty", mode === "none");
      cell.title = `${column.name}: ${mode}. Click to change summary.`;
      cell.addEventListener("click", () => config.onSummaryClick(column, cell));
      footer.append(cell);
    }
    footer.append(element("div", "tg-row-end"));
    return footer;
  }
}

function tableWidth(table: TableData): number {
  return 48 + table.columns.reduce((sum, column) => sum + column.width, 0) + 44;
}

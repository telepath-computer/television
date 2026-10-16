// The toolbar builds controls for a table view. It reads the table and view,
// then reports intent through callbacks; the grid owns every state change.

import type { Column, TableData } from "../data.ts";
import { makeView, type TableView } from "./view.ts";

/** State and actions needed to render the table toolbar. */
export interface ToolbarConfig {
  table: TableData;
  view: TableView;
  idPrefix: string;
  readOnly?: boolean;
  rowHeight?: number;
  onRenameTitle: (trigger: HTMLButtonElement) => void;
  onSort: (sort?: TableView["sort"]) => void;
  onFilter: (filter?: TableView["filter"]) => void;
  onGroupBy: (columnId?: string) => void;
  onRowHeight: (heightPx: number) => void;
  onSearch: (query: string) => void;
}

type MenuAction = { label: string; action: () => void };

/** Render the compact title, view controls, and search field. */
export function renderToolbar(config: ToolbarConfig): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "tg-toolbar";

  const heading = document.createElement("div");
  heading.className = "tg-heading";
  const title = document.createElement("button");
  title.className = "tg-title";
  title.type = "button";
  title.setAttribute("variant", "ghost");
  title.textContent = config.table.title;
  title.title = config.readOnly ? config.table.title : "Rename table";
  if (!config.readOnly) title.addEventListener("click", () => config.onRenameTitle(title));

  const count = document.createElement("span");
  count.className = "tg-subtitle";
  count.textContent = recordCountLabel(config.table, config.view);
  heading.append(title, count);

  const tools = document.createElement("div");
  tools.className = "tg-tools";
  tools.append(
    toolbarMenu(config, "Sort", "sort", sortActions(config), Boolean(config.view.sort)),
    toolbarMenu(config, "Filter", "filter", filterActions(config), Boolean(config.view.filter)),
    toolbarMenu(config, "Group by", "group", groupActions(config), Boolean(config.view.groupBy)),
    toolbarMenu(config, "Row height", "height", heightActions(config)),
    searchField(config),
  );
  toolbar.append(heading, tools);
  return toolbar;
}

function recordCountLabel(table: TableData, view: TableView): string {
  const total = table.rows.length;
  const noun = total === 1 ? "record" : "records";
  const totalLabel = `${total.toLocaleString()} ${noun}`;
  if (!view.filter) return totalLabel;

  // Group headings are presentation rows, so count with grouping removed.
  const visible = makeView(table, { ...view, groupBy: undefined }, new Set()).length;
  return `${visible.toLocaleString()} of ${totalLabel}`;
}

function toolbarMenu(
  config: ToolbarConfig,
  label: string,
  name: string,
  actions: MenuAction[],
  isOn = false,
): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "tg-menu-wrap";

  const trigger = document.createElement("button");
  trigger.className = `tg-tool${isOn ? " is-on" : ""}`;
  trigger.type = "button";
  trigger.setAttribute("variant", "ghost");
  trigger.setAttribute("aria-label", label);
  trigger.title = label;
  trigger.dataset.tool = name;
  trigger.id = `${config.idPrefix}-${name}`;
  const icon = document.createElement("tv-icon");
  icon.setAttribute("name", name === "group" ? "table" : name === "height" ? "list" : name);
  icon.setAttribute("aria-hidden", "true");
  trigger.append(icon, document.createTextNode(label));

  const menu = document.createElement("tv-menu");
  menu.setAttribute("trigger", trigger.id);
  for (const action of actions) {
    const item = document.createElement("tv-menu-item");
    item.textContent = action.label;
    item.addEventListener("click", action.action);
    menu.append(item);
  }
  wrap.append(trigger, menu);
  return wrap;
}

function searchField(config: ToolbarConfig): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "tg-search-wrap";
  const icon = document.createElement("tv-icon");
  icon.setAttribute("name", "search");
  icon.setAttribute("aria-hidden", "true");
  const search = document.createElement("input");
  search.className = "tg-search";
  search.type = "search";
  search.placeholder = "Search";
  search.setAttribute("aria-label", "Search table");
  search.value = config.view.search;
  search.addEventListener("input", () => config.onSearch(search.value));
  wrap.append(icon, search);
  return wrap;
}

function sortActions(config: ToolbarConfig): MenuAction[] {
  const columns = config.table.columns;
  return [
    { label: "Clear sort", action: () => config.onSort() },
    ...columns.map((column) => sortAction(column, "asc", config.onSort)),
    ...columns.map((column) => sortAction(column, "desc", config.onSort)),
  ];
}

function sortAction(
  column: Column,
  direction: "asc" | "desc",
  onSort: ToolbarConfig["onSort"],
): MenuAction {
  const label = `${column.name} · ${direction === "asc" ? "ascending" : "descending"}`;
  return {
    label,
    action: () => onSort({ columnId: column.id, direction }),
  };
}

function filterActions(config: ToolbarConfig): MenuAction[] {
  const actions: MenuAction[] = [
    { label: "Show all records", action: () => config.onFilter() },
  ];
  for (const column of config.table.columns) {
    if (column.type === "checkbox") {
      actions.push({
        label: `${column.name} · unchecked`,
        action: () => config.onFilter({ columnId: column.id, value: "No" }),
      });
    }
    if (column.type === "select") {
      for (const option of column.options ?? []) {
        actions.push({
          label: `${column.name} · ${option.label}`,
          action: () => config.onFilter({ columnId: column.id, value: option.label }),
        });
      }
    }
  }
  return actions;
}

function groupActions(config: ToolbarConfig): MenuAction[] {
  const groupable = config.table.columns.filter((column) =>
    column.type === "select" || column.type === "person" || column.type === "checkbox"
  );
  return [
    { label: "No grouping", action: () => config.onGroupBy() },
    ...groupable.map((column) => ({
      label: column.name,
      action: () => config.onGroupBy(column.id),
    })),
  ];
}

function heightActions(config: ToolbarConfig): MenuAction[] {
  const currentHeight = config.rowHeight ?? 34;
  const heights = [
    { label: "Short", heightPx: 28 },
    { label: "Medium", heightPx: 34 },
    { label: "Tall", heightPx: 44 },
  ];
  return heights.map(({ label, heightPx }) => ({
    label: `${currentHeight === heightPx ? "✓ " : ""}${label} · ${heightPx} px`,
    action: () => config.onRowHeight(heightPx),
  }));
}

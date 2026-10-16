// Context menus use Television's menu and popover elements. The table owns
// which menu is present; this module builds one menu against its trigger.

import type { Column, Row } from "../data.ts";
import { newId } from "./dom.ts";

/** One action or separator in a table context menu. */
export interface ContextMenuItem {
  label?: string;
  icon?: string;
  danger?: boolean;
  action?: () => void;
  separator?: boolean;
}

/** Grid operations exposed to a column menu. */
export interface ColumnMenuActions {
  rename(column: Column): void;
  changeType(column: Column): void;
  insert(column: Column, side: "left" | "right"): void;
  duplicate(column: Column): void;
  sort(column: Column, direction: "asc" | "desc"): void;
  delete(column: Column): void;
}

/** Grid operations exposed to a row menu. */
export interface RowMenuActions {
  insert(row: Row, side: "above" | "below"): void;
  duplicate(row: Row): void;
  delete(row: Row): void;
}

/** Describe the column menu while keeping all table mutations in the grid. */
export function columnMenuItems(
  column: Column,
  readOnly: boolean,
  actions: ColumnMenuActions,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  if (!readOnly) {
    items.push(
      { label: "Rename", icon: "edit", action: () => actions.rename(column) },
      { label: "Change type", icon: "tag", action: () => actions.changeType(column) },
      { separator: true },
    );

    if (!column.primary) {
      items.push({
        label: "Insert left",
        icon: "add",
        action: () => actions.insert(column, "left"),
      });
    }

    items.push(
      { label: "Insert right", icon: "add", action: () => actions.insert(column, "right") },
      { label: "Duplicate", icon: "copy", action: () => actions.duplicate(column) },
      { separator: true },
    );
  }

  items.push(
    { label: "Sort ascending", icon: "up", action: () => actions.sort(column, "asc") },
    { label: "Sort descending", icon: "down", action: () => actions.sort(column, "desc") },
  );

  if (!readOnly && !column.primary) {
    items.push(
      { separator: true },
      {
        label: "Delete column",
        icon: "delete",
        danger: true,
        action: () => actions.delete(column),
      },
    );
  }

  return items;
}

/** Describe the row menu while keeping all table mutations in the grid. */
export function rowMenuItems(row: Row, actions: RowMenuActions): ContextMenuItem[] {
  return [
    { label: "Insert above", icon: "add", action: () => actions.insert(row, "above") },
    { label: "Insert below", icon: "add", action: () => actions.insert(row, "below") },
    { label: "Duplicate row", icon: "copy", action: () => actions.duplicate(row) },
    { separator: true },
    {
      label: "Delete row",
      icon: "delete",
      danger: true,
      action: () => actions.delete(row),
    },
  ];
}

/** Build a menu anchored to a button; append it before setting `open`. */
export function createContextMenu(
  trigger: HTMLElement,
  items: ContextMenuItem[],
): HTMLElement {
  if (!trigger.id) trigger.id = `tg-menu-trigger-${newId()}`;

  const menu = document.createElement("tv-menu");
  menu.className = "tg-context-menu";
  menu.setAttribute("trigger", trigger.id);

  for (const entry of items) {
    if (entry.separator) {
      // The menu spec uses an ordinary hr. Omit separators at the edges and
      // coalesce adjacent ones so the menu never starts with a stray rule.
      if (menu.lastElementChild && menu.lastElementChild.tagName !== "HR") {
        menu.append(document.createElement("hr"));
      }
      continue;
    }

    if (!entry.label) continue;
    const item = document.createElement("tv-menu-item");
    if (entry.danger) item.setAttribute("intent", "danger");
    if (entry.icon) {
      const icon = document.createElement("tv-icon");
      icon.setAttribute("name", entry.icon);
      icon.setAttribute("aria-hidden", "true");
      item.append(icon);
    }
    item.append(document.createTextNode(entry.label));
    if (entry.action) item.addEventListener("click", entry.action);
    menu.append(item);
  }

  if (menu.lastElementChild?.tagName === "HR") menu.lastElementChild.remove();
  return menu;
}

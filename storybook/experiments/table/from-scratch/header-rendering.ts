// The header owns column selection and pointer affordances. Stored changes and
// panels stay with the grid, which supplies callbacks for those actions.

import type { Column, ColumnType } from "../data.ts";
import type { TableView } from "./view.ts";
import { button, element, icon } from "./dom.ts";

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

/** Actions that the grid handles after a header interaction. */
export interface HeaderRenderingConfig {
  columns: Column[];
  sort?: TableView["sort"];
  readOnly?: boolean;
  idPrefix: string;
  onSelect: (columnId: string) => void;
  onRename: (columnId: string, header: HTMLElement) => void;
  onMenu: (columnId: string) => void;
  onResize: (event: PointerEvent, columnId: string) => void;
  onFit: (columnId: string) => void;
  onInsert: (index: number, trigger: HTMLElement) => void;
  onMove: (columnId: string, index: number) => void;
}

/** Render the sticky grid header and its column controls. */
export function renderHeader(config: HeaderRenderingConfig): HTMLElement {
  const header = element("div", "tg-header");
  header.setAttribute("role", "row");
  header.setAttribute("aria-rowindex", "1");
  header.style.gridTemplateColumns = `48px ${config.columns.map((column) => `${column.width}px`).join(" ")} 44px`;

  const corner = element("div", "tg-index-head", "#");
  corner.setAttribute("role", "columnheader");
  header.append(corner);

  config.columns.forEach((column, index) => {
    header.append(renderColumnHeader(column, index, config));
  });

  const add = element("div", "tg-add-column");
  if (!config.readOnly) {
    const trigger = button("Add column", "add");
    trigger.addEventListener("click", () => config.onInsert(config.columns.length, trigger));
    add.append(trigger);
  }
  header.append(add);

  return header;
}

function renderColumnHeader(
  column: Column,
  index: number,
  config: HeaderRenderingConfig,
): HTMLElement {
  const head = element("div", `tg-head${column.primary ? " is-primary" : ""}`);
  head.dataset.columnId = column.id;
  head.setAttribute("role", "columnheader");
  head.setAttribute("aria-label", column.name);

  const sortDirection = config.sort?.columnId === column.id
    ? config.sort.direction
    : undefined;
  if (sortDirection) {
    head.setAttribute("aria-sort", sortDirection === "asc" ? "ascending" : "descending");
  }

  head.addEventListener("click", (event) => {
    if (isControlTarget(event.target)) return;
    config.onSelect(column.id);
  });
  head.addEventListener("dblclick", (event) => {
    if (isControlTarget(event.target)) return;
    config.onRename(column.id, head);
  });
  head.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    config.onMenu(column.id);
  });

  addReorderHandlers(head, column, index, config);

  const typeIcon = icon(typeIcons[column.type]);
  typeIcon.className = "tg-type-icon";
  typeIcon.setAttribute("aria-hidden", "true");
  head.append(typeIcon, element("span", "tg-head-label", column.name));

  if (sortDirection) {
    const sortIcon = icon(sortDirection === "asc" ? "up" : "down");
    sortIcon.setAttribute("aria-hidden", "true");
    head.append(sortIcon);
  }

  const menuTrigger = button(`${column.name} menu`, "more", "tg-header-menu");
  menuTrigger.id = `${config.idPrefix}-column-${column.id}`;
  menuTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    config.onMenu(column.id);
  });
  head.append(menuTrigger);

  if (!config.readOnly) addEditControls(head, column, index, config);
  return head;
}

function addReorderHandlers(
  head: HTMLElement,
  column: Column,
  index: number,
  config: HeaderRenderingConfig,
): void {
  head.draggable = !config.readOnly && !column.primary;
  head.addEventListener("dragstart", (event) => {
    if (isControlTarget(event.target)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData("text/table-column", column.id);
  });
  head.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("text/table-column")) event.preventDefault();
  });
  head.addEventListener("drop", (event) => {
    const columnId = event.dataTransfer?.getData("text/table-column");
    if (!columnId) return;
    event.preventDefault();
    config.onMove(columnId, index);
  });
}

function addEditControls(
  head: HTMLElement,
  column: Column,
  index: number,
  config: HeaderRenderingConfig,
): void {
  const resize = element("span", "tg-resize");
  resize.setAttribute("role", "separator");
  resize.setAttribute("aria-label", `Resize ${column.name}`);
  resize.addEventListener("pointerdown", (event) => config.onResize(event, column.id));
  resize.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    config.onFit(column.id);
  });
  head.append(resize);

  if (index === 0) return;

  const insert = button(`Insert column before ${column.name}`, "add", "tg-insert-column");
  insert.addEventListener("click", (event) => {
    event.stopPropagation();
    config.onInsert(index, insert);
  });
  head.append(insert);

  // The insert control belongs to the top of a boundary. A narrow pointer
  // zone leaves the preceding column's full right edge free for resizing.
  head.addEventListener("pointermove", (event) => {
    const bounds = head.getBoundingClientRect();
    const isNearTop = event.clientY - bounds.top < 24;
    const isNearLeft = event.clientX - bounds.left < 28;
    head.classList.toggle("is-insert-zone", isNearTop && isNearLeft);
  });
  head.addEventListener("pointerleave", () => {
    head.classList.remove("is-insert-zone");
  });
  insert.addEventListener("pointerenter", () => {
    head.classList.add("is-insert-zone");
  });
}

function isControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, .tg-resize"));
}

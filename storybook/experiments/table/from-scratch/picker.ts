// The select editor owns its option list and keyboard navigation. The grid
// supplies current data and applies changes through its shared change path.

import type { CellValue, Column, OptionColor } from "../data.ts";
import { pill } from "./cell-rendering.ts";
import { button, element, icon } from "./dom.ts";
import type { TableChange } from "./model.ts";

const colors: OptionColor[] = [
  "blue", "green", "purple", "orange", "pink", "yellow", "red", "neutral",
];

/** Data and actions needed to edit one select or multiselect cell. */
export interface SelectPickerConfig {
  column: Column;
  rowId: string;
  getColumn: () => Column | undefined;
  getValue: () => CellValue | undefined;
  commit: (change: TableChange) => void;
  close: () => void;
  focusGrid: () => void;
}

/** Build a picker panel; append it and focus its search field in the caller. */
export function buildSelectPicker(config: SelectPickerConfig): HTMLElement {
  const { column, rowId, getColumn, getValue, commit, close, focusGrid } = config;
  const panel = element("div", "tg-picker");
  panel.setAttribute("role", "listbox");
  panel.setAttribute("aria-label", `Choose ${column.name}`);

  const selected = element("div", "tg-picker-selected");
  const filter = element("input", "tg-picker-filter");
  filter.type = "search";
  filter.placeholder = `Find or create ${column.name.toLowerCase()}`;
  filter.setAttribute("aria-label", `Find ${column.name} option`);
  const list = element("div", "tg-picker-list");

  const currentIds = (): string[] => {
    const value = getValue();
    return column.type === "multiselect" && Array.isArray(value) ? value : [];
  };

  const finish = (): void => {
    close();
    focusGrid();
  };

  const draw = (): void => {
    selected.replaceChildren();
    list.replaceChildren();
    const currentColumn = getColumn() ?? column;
    const ids = currentIds();

    if (column.type === "multiselect") {
      for (const id of ids) {
        const option = currentColumn.options?.find((item) => item.id === id);
        if (!option) continue;
        const chosen = pill(option.label, option.color);
        const remove = button(`Remove ${option.label}`, "delete", "tg-pill-remove");
        remove.addEventListener("click", () => {
          commit({
            type: "cell", rowId, columnId: column.id,
            value: currentIds().filter((item) => item !== id),
          });
          draw();
          filter.focus();
        });
        chosen.append(remove);
        selected.append(chosen);
      }
    }

    const query = filter.value.trim().toLowerCase();
    const matches = (currentColumn.options ?? []).filter((option) =>
      option.label.toLowerCase().includes(query));

    for (const option of matches) {
      const item = button(option.label, undefined, "tg-picker-item");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(
        column.type === "multiselect"
          ? ids.includes(option.id)
          : getValue() === option.id,
      ));
      item.replaceChildren(pill(option.label, option.color));
      if (column.type === "multiselect" && ids.includes(option.id)) {
        item.append(icon("check"));
      }
      item.addEventListener("click", () => {
        if (column.type === "multiselect") {
          const nextIds = currentIds();
          commit({
            type: "cell", rowId, columnId: column.id,
            value: nextIds.includes(option.id)
              ? nextIds.filter((id) => id !== option.id)
              : [...nextIds, option.id],
          });
          draw();
          filter.focus();
        } else {
          commit({ type: "cell", rowId, columnId: column.id, value: option.id });
          finish();
        }
      });
      list.append(item);
    }

    if (query && !matches.some((option) => option.label.toLowerCase() === query)) {
      const create = button(`Create '${filter.value.trim()}'`, "add", "tg-picker-create");
      create.addEventListener("click", () => {
        const fresh = getColumn();
        if (!fresh) return;
        const used = new Set((fresh.options ?? []).map((option) => option.color));
        const color = colors.find((candidate) => !used.has(candidate))
          ?? colors[(fresh.options?.length ?? 0) % colors.length];
        const option = {
          id: crypto.randomUUID(),
          label: filter.value.trim(),
          color,
        };
        const value = fresh.type === "multiselect"
          ? [...currentIds(), option.id]
          : option.id;
        commit({
          type: "batch",
          changes: [
            { type: "option-add", columnId: column.id, option },
            { type: "cell", rowId, columnId: column.id, value },
          ],
        });
        finish();
      });
      list.append(create);
    }
  };

  filter.addEventListener("input", draw);
  filter.addEventListener("keydown", (event) => {
    const firstItem = list.querySelector<HTMLButtonElement>("button");
    if (event.key === "ArrowDown") {
      event.preventDefault();
      firstItem?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      firstItem?.click();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish();
    }
  });
  list.addEventListener("keydown", (event) => {
    const items = [...list.querySelectorAll<HTMLButtonElement>("button")];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = Math.max(0, Math.min(items.length - 1, index + step));
      items[next]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish();
    }
  });

  panel.append(selected, filter, list);
  draw();
  return panel;
}

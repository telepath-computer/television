// Native input editors and an anchored select picker for RevoGrid's editor API.
// The picker lives in document.body because the virtualized grid clips cells.

import type { Column, CellValue } from "../data";
import type { ColumnDataSchemaModel, EditorBase, EditCell } from "@revolist/revogrid";
import type { TableModel } from "./model";

type Save = (value?: unknown, preventFocus?: boolean) => void;

/** Create a text, number, or date editor for a column. */
export function inputEditor(column: Column) {
  return class InputEditor implements EditorBase {
    element: Element | null = null;
    editCell?: EditCell;
    private input: HTMLInputElement | null = null;
    private pending: string | null = null;
    constructor(private data: ColumnDataSchemaModel, private save: Save) {}
    render(h: Parameters<EditorBase["render"]>[0]) {
      return h("input", {
        type: column.type === "date" ? "date" : column.type === "number" || column.type === "currency" ? "number" : "text",
        step: column.type === "currency" ? "0.01" : "any",
        class: "rg-editor-input",
        value: this.editCell?.val ?? this.data.value ?? "",
        ref: (element: HTMLInputElement) => { this.input = element; },
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); this.save(this.getValue(), event.key === "Tab"); }
        },
      });
    }
    componentDidRender() {
      queueMicrotask(() => {
        if (!this.input) return;
        if (this.pending !== null) this.input.value = `${this.editCell?.val ?? ""}${this.pending}`;
        this.input.focus();
        if (this.input.type === "text" && this.pending === null && this.editCell?.val === this.data.value) {
          const end = this.input.value.length;
          this.input.setSelectionRange(end, end);
        }
      });
    }
    appendPendingInput(value: string) { this.pending = `${this.pending ?? ""}${value}`; if (this.input) this.input.value += value; return true; }
    getValue(): string { return this.input?.value ?? ""; }
    beforeDisconnect() { this.input?.blur(); }
  };
}

/** Create a keyboard-accessible select or multiselect editor. */
export function pillEditor(column: Column, model: TableModel) {
  return class PillEditor implements EditorBase {
    element: Element | null = null;
    editCell?: EditCell;
    private anchor: HTMLElement | null = null;
    private input: HTMLInputElement | null = null;
    private panel: HTMLElement | null = null;
    private options: HTMLElement | null = null;
    private chosenPanel: HTMLElement | null = null;
    private chosen: string[];
    private active = 0;
    private pending: string | null = null;
    constructor(private data: ColumnDataSchemaModel, private save: Save, private close: (focusNext?: boolean) => void) {
      const value = data.value;
      this.chosen = Array.isArray(value) ? [...value] : value == null ? [] : [String(value)];
    }
    render(h: Parameters<EditorBase["render"]>[0]) {
      return h("div", { class: "rg-picker-cell-preview", ref: (element: HTMLElement) => { this.anchor = element; } },
        this.chosen.map((id) => {
          const option = column.options?.find((item) => item.id === id);
          return option ? h("span", { class: `rg-pill rg-pill-${option.color}` }, option.label) : h("span", { class: "rg-pill rg-pill-neutral" }, id);
        }));
    }
    componentDidRender() {
      queueMicrotask(() => {
        if (!this.anchor || this.panel) return;
        this.panel = document.createElement("div");
        this.panel.className = "rg-picker-panel";
        this.panel.setAttribute("role", "dialog");
        this.panel.setAttribute("aria-label", `${column.name} options`);
        this.input = document.createElement("input");
        this.input.type = "search";
        this.input.className = "rg-picker-filter";
        this.input.placeholder = "Find or create";
        this.input.setAttribute("aria-label", `Find or create ${column.name} option`);
        this.input.addEventListener("input", () => { this.active = 0; this.draw(); });
        this.input.addEventListener("keydown", (event) => this.keyDown(event));
        this.chosenPanel = document.createElement("div");
        this.chosenPanel.className = "rg-picker-chosen";
        this.options = document.createElement("div");
        this.options.className = "rg-picker-options";
        this.options.setAttribute("role", "listbox");
        this.options.setAttribute("aria-label", `${column.name} options`);
        this.panel.append(this.input, this.chosenPanel, this.options);
        document.body.append(this.panel);
        this.input.value = `${this.editCell?.val && this.editCell.val !== this.data.value ? this.editCell.val : ""}${this.pending ?? ""}`;
        this.place();
        this.draw();
        this.input.focus();
        this.input.select();
        window.addEventListener("resize", this.place);
        window.addEventListener("scroll", this.place, true);
      });
    }
    private place = () => {
      if (!this.anchor || !this.panel) return;
      const rect = this.anchor.getBoundingClientRect();
      const width = Math.max(240, rect.width);
      this.panel.style.width = `${width}px`;
      this.panel.style.left = `${Math.min(rect.left, window.innerWidth - width - 8)}px`;
      this.panel.style.top = `${rect.bottom + 4 + 260 < window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - 264)}px`;
    };
    private choices() {
      const query = this.input?.value.trim().toLowerCase() ?? "";
      const matches = (column.options ?? []).filter((option) => option.label.toLowerCase().includes(query));
      return { matches, create: Boolean(query) && !(column.options ?? []).some((option) => option.label.toLowerCase() === query) };
    }
    private draw() {
      if (!this.panel || !this.options || !this.chosenPanel) return;
      this.options.replaceChildren();
      this.chosenPanel.replaceChildren();
      this.chosenPanel.hidden = column.type !== "multiselect" || !this.chosen.length;
      if (column.type === "multiselect" && this.chosen.length) {
        for (const id of this.chosen) {
          const option = column.options?.find((item) => item.id === id);
          if (!option) continue;
          const button = document.createElement("button");
          button.className = `rg-pill rg-pill-${option.color}`;
          button.type = "button";
          button.textContent = `${option.label} ×`;
          button.setAttribute("aria-label", `Remove ${option.label}`);
          button.addEventListener("mousedown", (event) => event.preventDefault());
          button.addEventListener("click", () => { this.chosen = this.chosen.filter((item) => item !== id); this.draw(); this.input?.focus(); });
          this.chosenPanel.append(button);
        }
      }
      const { matches, create } = this.choices();
      const items = [...matches.map((option) => ({ label: option.label, id: option.id, color: option.color })), ...(create ? [{ label: `Create “${this.input?.value.trim()}”`, id: "__create", color: model.optionColor(column) }] : [])];
      items.forEach((item, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `rg-picker-option${index === this.active ? " active" : ""}`;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(index === this.active));
        const pill = document.createElement("span");
        pill.className = `rg-pill rg-pill-${item.color}`;
        pill.textContent = item.label;
        button.append(pill);
        if (this.chosen.includes(item.id)) button.append(" ✓");
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => this.choose(item.id));
        this.options!.append(button);
      });
      this.panel.querySelector(".rg-picker-done")?.remove();
      if (column.type === "multiselect") {
        const done = document.createElement("button");
        done.type = "button";
        done.className = "rg-picker-done";
        done.textContent = "Done";
        done.addEventListener("mousedown", (event) => event.preventDefault());
        done.addEventListener("click", () => this.save([...this.chosen]));
        this.panel.append(done);
      }
      if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "rg-picker-empty";
        empty.textContent = "No matching options";
        this.options.append(empty);
      }
    }
    private choose(id: string) {
      if (id === "__create") {
        const label = this.input?.value.trim();
        if (!label) return;
        id = model.id("option");
        model.apply({ type: "option.add", columnId: column.id, option: { id, label, color: model.optionColor(column) } });
      }
      if (column.type === "multiselect") {
        this.chosen = this.chosen.includes(id) ? this.chosen.filter((item) => item !== id) : [...this.chosen, id];
        if (this.input) this.input.value = "";
        this.paintPreview();
        this.draw();
        this.input?.focus();
      } else this.save(id);
    }
    private keyDown(event: KeyboardEvent) {
      const { matches, create } = this.choices();
      const length = matches.length + Number(create);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); event.stopPropagation();
        this.active = Math.max(0, Math.min(length - 1, this.active + (event.key === "ArrowDown" ? 1 : -1)));
        this.draw();
      } else if (event.key === "Enter") {
        event.preventDefault(); event.stopPropagation();
        if (length) this.choose(this.active < matches.length ? matches[this.active].id : "__create");
        else if (column.type === "multiselect") this.save([...this.chosen]);
      } else if (event.key === "Tab") this.save(this.getValue(), true);
      else if (event.key === "Escape") { event.stopPropagation(); this.close(); }
    }
    appendPendingInput(value: string) { this.pending = `${this.pending ?? ""}${value}`; if (this.input) { this.input.value += value; this.draw(); } return true; }
    getValue(): CellValue { return column.type === "multiselect" ? [...this.chosen] : this.chosen[0] ?? null; }
    private paintPreview() {
      if (!this.anchor) return;
      this.anchor.replaceChildren(...this.chosen.map((id) => {
        const option = column.options?.find((item) => item.id === id);
        const pill = document.createElement("span");
        pill.className = `rg-pill rg-pill-${option?.color ?? "neutral"}`;
        pill.textContent = option?.label ?? id;
        return pill;
      }));
    }
    beforeDisconnect() { this.input?.blur(); }
    disconnectedCallback() { this.panel?.remove(); this.panel = null; window.removeEventListener("resize", this.place); window.removeEventListener("scroll", this.place, true); }
  };
}

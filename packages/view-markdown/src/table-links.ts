import { markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { linkActivationHandlers } from "./markers.ts";

// The table package renders highlighted source rather than Markdown and offers
// no cell-renderer hook. Adapt its display DOM only; cell editors retain source.
function renderLinks(cell: HTMLElement): void {
  const source = cell.textContent ?? "";
  const links: Array<{ from: number; to: number; labelFrom: number; labelTo: number; href: string }> = [];
  markdownLanguage.parser.parse(source).iterate({
    enter(node) {
      if (node.name !== "Link") return;
      const children = node.node;
      const open = children.getChild("LinkMark");
      const close = children.getChildren("LinkMark")[1];
      const url = children.getChild("URL");
      if (!open || !close || !url || open.to >= close.from) return;
      links.push({ from: node.from, to: node.to, labelFrom: open.to, labelTo: close.from, href: source.slice(url.from, url.to) });
    },
  });

  // Replace from the end so earlier offsets remain valid. These are cloned
  // display nodes; ranges preserve their highlighted labels and surrounding text.
  for (const link of links.reverse()) {
    const rangeAt = (from: number, to: number): Range => {
      const range = cell.ownerDocument.createRange();
      const walker = cell.ownerDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      let offset = 0;
      let startSet = false;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const end = offset + (node.textContent?.length ?? 0);
        if (!startSet && from <= end) {
          range.setStart(node, from - offset);
          startSet = true;
        }
        if (to <= end) {
          range.setEnd(node, to - offset);
          break;
        }
        offset = end;
      }
      return range;
    };
    const anchor = cell.ownerDocument.createElement("a");
    anchor.className = "cm-md-link";
    anchor.dataset.href = link.href;
    anchor.append(rangeAt(link.labelFrom, link.labelTo).cloneContents());
    const wrapper = cell.ownerDocument.createElement("span");
    wrapper.className = "cm-md-table-link";
    const prefix = cell.ownerDocument.createElement("span");
    prefix.hidden = true;
    prefix.textContent = source.slice(link.from, link.labelFrom);
    const suffix = cell.ownerDocument.createElement("span");
    suffix.hidden = true;
    suffix.textContent = source.slice(link.labelTo, link.to);
    // Native table selection maps DOM text offsets directly to source offsets.
    // Keep the hidden syntax in textContent so click-to-edit positions agree.
    wrapper.append(prefix, anchor, suffix);
    const range = rangeAt(link.from, link.to);
    range.deleteContents();
    range.insertNode(wrapper);
  }
}

export const tableLinks = ViewPlugin.fromClass(class {
  private observer: MutationObserver;
  private rendered = new WeakMap<HTMLElement, { display: HTMLElement; source: string }>();
  private view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
    this.observer = new MutationObserver(() => this.render());
    this.observer.observe(view.dom, { childList: true, characterData: true, attributes: true, attributeFilter: ["data-hidden"], subtree: true });
    view.dom.addEventListener("pointerdown", this.pointerdown, true);
    view.dom.addEventListener("mousedown", this.mousedown, true);
    view.dom.addEventListener("click", this.click, true);
    view.dom.addEventListener("auxclick", this.auxclick, true);
    this.render();
  }

  private render(): void {
    for (const cell of this.view.dom.querySelectorAll<HTMLElement>(".tbl-cell-view:not(.cm-md-table-cell-view)")) {
      const source = cell.innerHTML;
      let rendered = this.rendered.get(cell);
      if (!rendered || rendered.source !== source) {
        const display = rendered?.display ?? cell.cloneNode(false) as HTMLElement;
        display.classList.add("cm-md-table-cell-view");
        display.style.display = "";
        display.replaceChildren(...Array.from(cell.childNodes, (node) => node.cloneNode(true)));
        renderLinks(display);
        if (!display.querySelector("a.cm-md-link")) {
          rendered?.display.remove();
          this.rendered.delete(cell);
          cell.style.display = "";
          continue;
        }
        // The package owns its source nodes and native caret offsets. Preserve
        // that DOM; render only into a sibling we own, with source offsets intact.
        cell.style.display = "none";
        if (!rendered) cell.after(display);
        rendered = { display, source };
        this.rendered.set(cell, rendered);
      }
      if (rendered.display.getAttribute("data-hidden") !== cell.getAttribute("data-hidden")) {
        if (cell.hasAttribute("data-hidden")) rendered.display.setAttribute("data-hidden", cell.getAttribute("data-hidden") ?? "");
        else rendered.display.removeAttribute("data-hidden");
      }
    }
  }

  private isTableLink(event: MouseEvent): boolean {
    return event.target instanceof Element && Boolean(event.target.closest(".tbl-cell-view a.cm-md-link"));
  }

  private pointerdown = (event: PointerEvent): void => {
    // Table selection begins on pointerdown, before the ordinary link handler.
    // Alt-click keeps that selection/editing behavior available.
    if (this.isTableLink(event) && !event.altKey && (event.button === 0 || event.button === 1)) {
      event.stopPropagation();
    }
  };

  private mousedown = (event: MouseEvent): void => {
    if (!this.isTableLink(event)) return;
    if (linkActivationHandlers.mousedown(event) || (event.button === 1 && !event.altKey)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  private click = (event: MouseEvent): void => {
    if (this.isTableLink(event) && linkActivationHandlers.click(event)) event.stopPropagation();
  };
  private auxclick = (event: MouseEvent): void => {
    if (this.isTableLink(event) && linkActivationHandlers.auxclick(event)) event.stopPropagation();
  };

  destroy(): void {
    this.observer.disconnect();
    for (const cell of this.view.dom.querySelectorAll<HTMLElement>(".tbl-cell-view:not(.cm-md-table-cell-view)")) {
      const rendered = this.rendered.get(cell);
      if (rendered) {
        rendered.display.remove();
        cell.style.display = "";
      }
    }
    this.view.dom.removeEventListener("pointerdown", this.pointerdown, true);
    this.view.dom.removeEventListener("mousedown", this.mousedown, true);
    this.view.dom.removeEventListener("click", this.click, true);
    this.view.dom.removeEventListener("auxclick", this.auxclick, true);
  }
});

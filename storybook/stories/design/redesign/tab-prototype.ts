// Design workshop (not a spec): an interactive, depth-one tab/pane model.
// Single tabs can merge into the active pane; split panes can break back out
// into a tab. The drag stack (ghost, half overlays, strip preview) is shared
// with the members prototype — see proto-drag.ts.

import { html, render, type TemplateResult } from "lit-html";
import { mockFrame, railTpl } from "./lib.ts";
import { beginPanePress, beginTabPress, makePanesTpl, PROTO_DRAG_CSS } from "./proto-drag.ts";
import { REDESIGN_CSS } from "./styles.ts";

interface Tab {
  id: number;
  panes: string[];
  name?: string; // a group's custom name; unset = the "N artifacts" placeholder
}

const PROTOTYPE_CSS = /*css*/ `
  .proto-strip {
    height: 40px;
    flex: none;
    box-sizing: border-box;
    padding: 0 8px;
    border-bottom: 1px solid #ddd;
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
  }

  /* Rename popover dropped under a double-clicked tab. */
  .proto-rename-pop {
    position: fixed;
    z-index: 10000;
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 8px;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
  }
  .proto-rename-pop input {
    width: 150px;
    padding: 4px 8px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font: 13px ui-sans-serif, system-ui, sans-serif;
    color: #333;
    outline: none;
  }
  .proto-rename-pop input:focus { border-color: #888; }
  .proto-rename-pop button {
    padding: 4px 12px;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #f7f7f7;
    color: #333;
    font: 13px ui-sans-serif, system-ui, sans-serif;
    cursor: pointer;
  }
  .proto-rename-pop button:hover { background: #efefef; }

  /* The rename field stays selectable despite the drag-time .stage rule. */
  .proto-rename-pop input {
    user-select: text;
    -webkit-user-select: text;
  }
`;

// A tabs-style preview of the new tab: single-pane glyph plus the label.
function makeTabPreview(doc: Document, label: string): HTMLElement {
  const preview = doc.createElement("div");
  preview.className = "tab proto-preview";
  preview.innerHTML = `<span class="glyph"><span class="c"></span></span>`;
  preview.append(doc.createTextNode(label));
  return preview;
}

export function tabPrototypeMock(): HTMLElement {
  const { host, root } = mockFrame("tab-prototype", REDESIGN_CSS + PROTO_DRAG_CSS + PROTOTYPE_CSS);
  let tabs: Tab[] = [
    { id: 1, panes: ["Calendar"] },
    { id: 2, panes: ["To-do list"] },
    { id: 3, panes: ["Daily brief"] },
  ];
  let activeId = tabs[0].id;

  // Rename popover state.
  let renaming: number | null = null;
  let renameAnchor: DOMRect | null = null;
  let renameOutside: ((event: PointerEvent) => void) | null = null;

  // --- templates ---------------------------------------------------------

  const glyph = (count: number): TemplateResult =>
    html`<span class="glyph">${Array.from({ length: count }, () => html`<span class="c"></span>`)}</span>`;

  const panesTpl = makePanesTpl({ panePress, closePane });

  const view = (): TemplateResult => {
    const active = tabs.find((tab) => tab.id === activeId);
    const renameTab = renaming !== null ? tabs.find((tab) => tab.id === renaming) : undefined;
    // Single tab → edit the artifact's own name; group → name the container.
    const renameValue = renameTab ? (renameTab.panes.length === 1 ? renameTab.panes[0] : renameTab.name ?? "") : "";
    const renamePlaceholder =
      renameTab && renameTab.panes.length === 2 ? `${renameTab.panes.length} artifacts` : "Name";
    return html`
      <div class="stage">
        <div class="shell">
          ${railTpl(["Today"], 0)}
          <div class="main column">
            <div class="proto-strip">
              ${tabs.map((tab) => {
                const isGroup = tab.panes.length === 2;
                const draggable = tab.id !== activeId && !isGroup;
                // One name per tab: a single tab shows its artifact's name (renaming
                // it renames the artifact); a group gets its own name, default
                // "N artifacts". Double-click to rename.
                const labelText = isGroup ? tab.name ?? `${tab.panes.length} artifacts` : tab.panes[0];
                return html`
                  <div
                    class="tab ${tab.id === activeId ? "active" : ""} ${draggable ? "proto-draggable" : ""}"
                    @pointerdown=${(event: PointerEvent) => tabPress(event, tab.id, draggable)}
                    @dblclick=${(event: MouseEvent) => openRename(event, tab.id)}
                  >
                    ${glyph(tab.panes.length)}${labelText}
                  </div>
                `;
              })}
            </div>
            <div class="proto-panes">${panesTpl(active)}</div>
          </div>
        </div>
        <div class="caption">
          Drag an inactive single-pane tab onto either half of the active pane to make a horizontal split.
          Drag either split pane's title bar into the tab strip to break it back out. Double-click a
          group's tab to name it.
        </div>
        ${renaming !== null && renameAnchor
          ? html`
              <div
                class="proto-rename-pop"
                style="top: ${renameAnchor.bottom + 4}px; left: ${renameAnchor.left}px"
                @pointerdown=${(event: PointerEvent) => event.stopPropagation()}
              >
                <input
                  class="proto-rename-input"
                  type="text"
                  placeholder=${renamePlaceholder}
                  .value=${renameValue}
                  @keydown=${onRenameKey}
                />
                <button @click=${commitRename}>OK</button>
              </div>
            `
          : ""}
      </div>
    `;
  };

  const rerender = (): void => {
    render(view(), root);
  };

  // --- state actions -----------------------------------------------------

  function selectTab(id: number): void {
    if (id === activeId || !tabs.some((tab) => tab.id === id)) return;
    activeId = id;
    rerender();
  }

  function openRename(event: MouseEvent, tabId: number): void {
    event.preventDefault();
    renaming = tabId;
    renameAnchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
    rerender();
    requestAnimationFrame(() => {
      const input = root.querySelector<HTMLInputElement>(".proto-rename-input");
      input?.focus();
      input?.select();
    });
    const doc = root.ownerDocument;
    renameOutside = (ev: PointerEvent) => {
      if (!(ev.target as HTMLElement).closest(".proto-rename-pop")) closeRename();
    };
    doc.addEventListener("pointerdown", renameOutside);
  }

  function closeRename(): void {
    if (renameOutside) {
      root.ownerDocument.removeEventListener("pointerdown", renameOutside);
      renameOutside = null;
    }
    renaming = null;
    renameAnchor = null;
    rerender();
  }

  function commitRename(): void {
    const input = root.querySelector<HTMLInputElement>(".proto-rename-input");
    const tab = tabs.find((item) => item.id === renaming);
    if (tab && input) {
      const value = input.value.trim();
      if (tab.panes.length === 1) {
        if (value) tab.panes[0] = value; // one name: renaming the tab renames the artifact
      } else {
        tab.name = value || undefined; // a group gets its own name
      }
    }
    closeRename();
  }

  function onRenameKey(event: KeyboardEvent): void {
    if (event.key === "Enter") commitRename();
    else if (event.key === "Escape") closeRename();
  }

  function closePane(tabId: number, paneIdx: number): void {
    const tabIdx = tabs.findIndex((tab) => tab.id === tabId);
    if (tabIdx < 0) return;
    const tab = tabs[tabIdx];
    if (tab.panes.length === 2) {
      tab.panes.splice(paneIdx, 1);
      tab.name = undefined; // back to a single artifact — drop the group name
    } else {
      tabs.splice(tabIdx, 1);
      if (activeId === tabId) {
        activeId = tabs[Math.min(tabIdx, tabs.length - 1)]?.id ?? 0;
      }
    }
    rerender();
  }

  function mergeTab(draggedId: number, side: "left" | "right"): void {
    const active = tabs.find((tab) => tab.id === activeId);
    const draggedIdx = tabs.findIndex((tab) => tab.id === draggedId);
    const dragged = tabs[draggedIdx];
    if (!active || active.panes.length !== 1 || !dragged || dragged.panes.length !== 1 || dragged.id === active.id) {
      return;
    }
    active.panes =
      side === "left" ? [dragged.panes[0], active.panes[0]] : [active.panes[0], dragged.panes[0]];
    tabs.splice(draggedIdx, 1);
    rerender();
  }

  function breakOutPane(tabId: number, paneIdx: number): void {
    const activeIdx = tabs.findIndex((tab) => tab.id === tabId);
    const tab = tabs[activeIdx];
    if (activeIdx < 0 || tab.id !== activeId || tab.panes.length !== 2) return;
    const [pane] = tab.panes.splice(paneIdx, 1);
    tab.name = undefined; // collapsed to a single artifact — drop the group name
    const nextId = Math.max(0, ...tabs.map((item) => item.id)) + 1;
    tabs.splice(activeIdx + 1, 0, { id: nextId, panes: [pane] });
    rerender();
  }

  // --- pointer gestures (shared drag stack, this mock's state) ------------

  function tabPress(event: PointerEvent, tabId: number, draggable: boolean): void {
    beginTabPress(event, root, draggable, {
      label: tabs.find((tab) => tab.id === tabId)?.panes[0] ?? "",
      canMerge: () => tabs.find((tab) => tab.id === activeId)?.panes.length === 1,
      merge: (side) => mergeTab(tabId, side),
      select: () => selectTab(tabId),
    });
  }

  function panePress(event: PointerEvent, tabId: number, paneIdx: number): void {
    beginPanePress(event, root, {
      label: tabs.find((tab) => tab.id === tabId)?.panes[paneIdx] ?? "",
      makeStripPreview: makeTabPreview,
      breakOut: () => breakOutPane(tabId, paneIdx),
    });
  }

  rerender();
  return host;
}

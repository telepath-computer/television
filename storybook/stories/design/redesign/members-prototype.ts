// Design workshop (not a spec): the interactive "members" prototype. Same
// depth-one drag model as the Tabs prototype (merge a single tab into the
// active pane to split; break a split pane back out into its own tab), but a
// group tab shows its artifacts inline as "◯ name" chips — and clicking a
// chip focuses (flashes) that pane. No rename: the chips are self-labeling.
// The drag stack (ghost, half overlays, strip preview) is shared — see
// proto-drag.ts.

import { html, render, nothing, type TemplateResult } from "lit-html";
import { mockFrame, railTpl } from "./lib.ts";
import {
  DRAG_THRESHOLD,
  PROTO_DRAG_CSS,
  beginPanePress,
  beginTabPress,
  makeGhost,
  makePanesTpl,
  positionGhost,
} from "./proto-drag.ts";
import { REDESIGN_CSS } from "./styles.ts";

interface Tab {
  id: number;
  panes: string[];
}

const PROTO_CSS = /*css*/ `
  /* Members layout: tabs flush against the content (no divider, no top gap). */
  .proto-strip {
    height: 44px;
    flex: none;
    box-sizing: border-box;
    /* left padding matches the content below so the tabs align with the artifact */
    padding: 0 16px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 4px;
    overflow-x: auto;
  }
  /* the pane area is flush too, so the half overlays start at its very top */
  .proto-panes { --proto-half-top: 0px; }

  .tab-member.proto-draggable { cursor: grab; }
`;

export function membersPrototypeMock(): HTMLElement {
  const { host, root } = mockFrame("members-prototype", REDESIGN_CSS + PROTO_DRAG_CSS + PROTO_CSS);
  let tabs: Tab[] = [
    { id: 1, panes: ["Calendar", "To-do list"] },
    { id: 2, panes: ["Daily brief"] },
    { id: 3, panes: ["Notes"] },
  ];
  let activeId = 2; // start on a single tab so merge is immediately possible

  // --- templates ---------------------------------------------------------

  const panesTpl = makePanesTpl({ panePress, closePane });

  const tabTpl = (tab: Tab): TemplateResult => {
    const isGroup = tab.panes.length === 2;
    const draggable = tab.id !== activeId && !isGroup;
    return html`
      <div
        class="tab ${tab.id === activeId ? "active" : ""} ${draggable ? "proto-draggable" : ""}"
        @pointerdown=${(event: PointerEvent) => tabPress(event, tab.id, draggable)}
      >
        <span class="tab-joined">
          ${tab.panes.map(
            (name, paneIdx) => html`
              ${paneIdx > 0 ? html`<span class="tab-sep">|</span>` : nothing}
              <span
                class="tab-member ${isGroup ? "proto-draggable" : ""}"
                @pointerdown=${isGroup ? (event: PointerEvent) => beginChipPress(event, tab.id, paneIdx) : undefined}
              >
                <span class="member-icon"></span>${name}
              </span>
            `,
          )}
        </span>
      </div>
    `;
  };

  const view = (): TemplateResult => {
    const active = tabs.find((tab) => tab.id === activeId);
    return html`
      <div class="stage">
        <div class="shell">
          ${railTpl(["Today"], 0)}
          <div class="main column">
            <div class="proto-strip">${tabs.map(tabTpl)}</div>
            <div class="proto-panes flush">${panesTpl(active)}</div>
          </div>
        </div>
        <div class="caption">
          Group tabs show their artifacts as inline chips — click a chip to open the tab. Drag an
          inactive single tab onto either half of the active pane to merge it into a split; drag a chip
          (or a split pane's title bar) out to break that artifact into its own tab.
        </div>
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

  function closePane(tabId: number, paneIdx: number): void {
    const tabIdx = tabs.findIndex((tab) => tab.id === tabId);
    if (tabIdx < 0) return;
    const tab = tabs[tabIdx];
    if (tab.panes.length === 2) {
      tab.panes.splice(paneIdx, 1);
    } else {
      tabs.splice(tabIdx, 1);
      if (activeId === tabId) activeId = tabs[Math.min(tabIdx, tabs.length - 1)]?.id ?? 0;
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
    active.panes = side === "left" ? [dragged.panes[0], active.panes[0]] : [active.panes[0], dragged.panes[0]];
    tabs.splice(draggedIdx, 1);
    rerender();
  }

  function breakOutPane(tabId: number, paneIdx: number): void {
    const srcIdx = tabs.findIndex((tab) => tab.id === tabId);
    const tab = tabs[srcIdx];
    if (srcIdx < 0 || tab.panes.length !== 2) return;
    const [pane] = tab.panes.splice(paneIdx, 1);
    const nextId = Math.max(0, ...tabs.map((item) => item.id)) + 1;
    // Land the new tab at the end of the strip — where the drag preview shows it.
    tabs.push({ id: nextId, panes: [pane] });
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
      makeStripPreview: makePreviewChip,
      breakOut: () => breakOutPane(tabId, paneIdx),
    });
  }

  // Drag a member chip out of its joined tab to break that artifact into its
  // own tab; a stationary press just opens the tab. Only group chips get this.
  function beginChipPress(event: PointerEvent, tabId: number, paneIdx: number): void {
    if (event.button !== 0) return;
    event.stopPropagation(); // don't also fire the tab's press
    const doc = root.ownerDocument;
    const startX = event.clientX;
    const startY = event.clientY;
    const label = tabs.find((tab) => tab.id === tabId)?.panes[paneIdx] ?? "";
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let preview: HTMLElement | null = null;

    const cleanup = (): void => {
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", up);
      doc.removeEventListener("pointercancel", cancel);
      ghost?.remove();
      preview?.remove();
    };

    const move = (moveEvent: PointerEvent): void => {
      if (!dragging) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) <= DRAG_THRESHOLD) return;
        dragging = true;
        ghost = makeGhost(doc, label);
        // Preview where the broken-out tab will land (end of the strip).
        const strip = root.querySelector<HTMLElement>(".proto-strip");
        if (strip) preview = strip.appendChild(makePreviewChip(doc, label));
      }
      moveEvent.preventDefault();
      positionGhost(ghost!, moveEvent);
    };

    const up = (): void => {
      const didDrag = dragging;
      cleanup();
      if (didDrag) breakOutPane(tabId, paneIdx);
      else selectTab(tabId);
    };
    const cancel = (): void => cleanup();

    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", up, { once: true });
    doc.addEventListener("pointercancel", cancel, { once: true });
  }

  // A members-style preview of the new single tab (one "◯ name" chip).
  function makePreviewChip(doc: Document, label: string): HTMLElement {
    const tab = doc.createElement("div");
    tab.className = "tab proto-preview";
    const joined = doc.createElement("span");
    joined.className = "tab-joined";
    const chip = doc.createElement("span");
    chip.className = "tab-member";
    const dot = doc.createElement("span");
    dot.className = "member-icon";
    chip.append(dot, doc.createTextNode(label));
    joined.append(chip);
    tab.append(joined);
    return tab;
  }

  rerender();
  return host;
}

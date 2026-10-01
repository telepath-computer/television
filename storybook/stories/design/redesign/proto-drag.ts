// Design workshop (not a spec): the drag stack shared by the two interactive
// tab prototypes (tab-prototype.ts, members-prototype.ts). Depth-one model:
// drag an inactive single tab onto either half of the active pane to merge it
// into a split; drag a split pane's title bar into the strip to break it back
// out. Drag feedback is imperative so pointer moves never re-render. The mocks
// pass in what genuinely differs: the strip-preview element factory and the
// state mutations (merge / break out / select), which close over each mock's
// own tab state.

import { html, type TemplateResult } from "lit-html";
import { icon } from "./lib.ts";

export const DRAG_THRESHOLD = 5;

// Drag chrome. `.proto-half`'s inset tracks the pane area's padding, which
// differs per mock — each sets --proto-half-top to match its own layout.
export const PROTO_DRAG_CSS = /*css*/ `
  .proto-strip .tab.proto-draggable,
  .proto-panes .card-title.proto-draggable {
    cursor: grab;
  }

  /* Preview of the new tab, shown inline only while a pane is over the strip. */
  .tab.proto-preview {
    border-style: dashed;
    color: #999;
    background: transparent;
    pointer-events: none;
  }

  .proto-half {
    position: absolute;
    top: var(--proto-half-top, 16px);
    bottom: 16px;
    z-index: 4;
    width: calc(50% - 16px);
    border: 1px dashed #777;
    box-sizing: border-box;
    background: rgba(100, 100, 100, 0.12);
    pointer-events: none;
  }
  .proto-half.left { left: 16px; border-radius: 6px 0 0 6px; }
  .proto-half.right { right: 16px; border-radius: 0 6px 6px 0; }

  .proto-ghost {
    position: fixed;
    z-index: 9999;
    padding: 6px 10px;
    border: 1px solid #bbb;
    border-radius: 4px;
    font: 13px ui-sans-serif, system-ui, sans-serif;
    color: #333;
    background: rgba(255, 255, 255, 0.94);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    pointer-events: none;
    white-space: nowrap;
  }

  /* No text selection while dragging. */
  .stage {
    user-select: none;
    -webkit-user-select: none;
  }
`;

function inRect(event: PointerEvent, rect: DOMRect): boolean {
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

export function makeGhost(doc: Document, label: string): HTMLElement {
  const ghost = doc.createElement("div");
  ghost.className = "proto-ghost";
  ghost.textContent = label;
  doc.body.appendChild(ghost);
  return ghost;
}

export function positionGhost(ghost: HTMLElement, event: PointerEvent): void {
  ghost.style.left = `${event.clientX + 12}px`;
  ghost.style.top = `${event.clientY + 12}px`;
}

// Press on a tab in the strip. A stationary press selects the tab; a drag (if
// `draggable`) targets either half of the active pane, and dropping merges.
export interface TabPressHandlers {
  label: string; // ghost label
  canMerge(): boolean; // active pane accepts a merge right now
  merge(side: "left" | "right"): void;
  select(): void;
}

export function beginTabPress(
  event: PointerEvent,
  root: HTMLElement,
  draggable: boolean,
  handlers: TabPressHandlers,
): void {
  if (event.button !== 0) return;
  const doc = root.ownerDocument;
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;
  let dragging = false;
  let side: "left" | "right" | null = null;
  let ghost: HTMLElement | null = null;
  let overlay: HTMLElement | null = null;

  const cleanup = (): void => {
    doc.removeEventListener("pointermove", move);
    doc.removeEventListener("pointerup", up);
    doc.removeEventListener("pointercancel", cancel);
    ghost?.remove();
    overlay?.remove();
  };

  const move = (moveEvent: PointerEvent): void => {
    if (!dragging) {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) <= DRAG_THRESHOLD) return;
      moved = true;
      if (!draggable) return;
      dragging = true;
      ghost = makeGhost(doc, handlers.label);
    }
    moveEvent.preventDefault();
    positionGhost(ghost!, moveEvent);
    const paneArea = root.querySelector<HTMLElement>(".proto-panes");
    const valid = paneArea && handlers.canMerge() && inRect(moveEvent, paneArea.getBoundingClientRect());
    if (!valid) {
      side = null;
      overlay?.remove();
      overlay = null;
      return;
    }
    const rect = paneArea.getBoundingClientRect();
    const nextSide = moveEvent.clientX < rect.left + rect.width / 2 ? "left" : "right";
    if (side === nextSide && overlay) return;
    side = nextSide;
    overlay?.remove();
    overlay = doc.createElement("div");
    overlay.className = `proto-half ${side}`;
    paneArea.appendChild(overlay);
  };

  const up = (): void => {
    const droppedSide = side;
    cleanup();
    if (dragging) {
      if (droppedSide) handlers.merge(droppedSide);
    } else if (!moved) {
      handlers.select();
    }
  };
  const cancel = (): void => cleanup();

  doc.addEventListener("pointermove", move);
  doc.addEventListener("pointerup", up, { once: true });
  doc.addEventListener("pointercancel", cancel, { once: true });
}

// Press on a split pane's title bar. Dragging it over the strip previews the
// new tab inline (via the mock's own preview factory); dropping breaks out.
export interface PanePressHandlers {
  label: string; // ghost label
  makeStripPreview(doc: Document, label: string): HTMLElement;
  breakOut(): void;
}

export function beginPanePress(event: PointerEvent, root: HTMLElement, handlers: PanePressHandlers): void {
  if (event.button !== 0) return;
  const doc = root.ownerDocument;
  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;
  let overStrip = false;
  let ghost: HTMLElement | null = null;
  let preview: HTMLElement | null = null;

  const removePreview = (): void => {
    preview?.remove();
    preview = null;
  };

  const cleanup = (): void => {
    doc.removeEventListener("pointermove", move);
    doc.removeEventListener("pointerup", up);
    doc.removeEventListener("pointercancel", cancel);
    ghost?.remove();
    removePreview();
  };

  const move = (moveEvent: PointerEvent): void => {
    if (!dragging) {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) <= DRAG_THRESHOLD) return;
      dragging = true;
      ghost = makeGhost(doc, handlers.label);
    }
    moveEvent.preventDefault();
    positionGhost(ghost!, moveEvent);
    const strip = root.querySelector<HTMLElement>(".proto-strip");
    overStrip = Boolean(strip && inRect(moveEvent, strip.getBoundingClientRect()));
    // Preview the new tab inline only once the pane is actually over the strip.
    if (overStrip && strip) {
      if (!preview) preview = strip.appendChild(handlers.makeStripPreview(doc, handlers.label));
    } else {
      removePreview();
    }
  };

  const up = (): void => {
    const shouldBreakOut = dragging && overStrip;
    cleanup();
    if (shouldBreakOut) handlers.breakOut();
  };
  const cancel = (): void => cleanup();

  doc.addEventListener("pointermove", move);
  doc.addEventListener("pointerup", up, { once: true });
  doc.addEventListener("pointercancel", cancel, { once: true });
}

// The pane area shared by both prototypes: a single card, or a two-pane split
// whose title bars are draggable (to break back out) and closable.
export interface PaneTab {
  id: number;
  panes: string[];
}

export interface PanesTplHandlers {
  panePress(event: PointerEvent, tabId: number, paneIdx: number): void;
  closePane(tabId: number, paneIdx: number): void;
}

export function makePanesTpl(handlers: PanesTplHandlers): (tab: PaneTab | undefined) => TemplateResult {
  const paneCard = (tab: PaneTab, paneIdx: number): TemplateResult => {
    const canBreakOut = tab.panes.length === 2;
    return html`
      <div class="card">
        <div
          class="card-title ${canBreakOut ? "proto-draggable" : ""}"
          @pointerdown=${canBreakOut
            ? (event: PointerEvent) => handlers.panePress(event, tab.id, paneIdx)
            : undefined}
        >
          <span class="card-name">${tab.panes[paneIdx]}</span>
          <button
            class="tb-btn"
            title="Close"
            @pointerdown=${(event: PointerEvent) => event.stopPropagation()}
            @click=${(event: Event) => {
              event.stopPropagation();
              handlers.closePane(tab.id, paneIdx);
            }}
          >
            ${icon("close")}
          </button>
        </div>
        <div class="card-body"></div>
      </div>
    `;
  };

  return (tab: PaneTab | undefined): TemplateResult =>
    !tab
      ? html`<div></div>`
      : tab.panes.length === 1
        ? paneCard(tab, 0)
        : html`<div class="split row">${tab.panes.map((_, paneIdx) => paneCard(tab, paneIdx))}</div>`;
}

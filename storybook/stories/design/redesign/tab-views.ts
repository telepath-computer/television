// Design workshop (not a spec): Approach 2 — the view type is a property of
// each TAB, not a global switch. Every tab is a set of artifacts with its own
// arrangement (split / sidebar / grid), shown by a glyph on the tab; click the
// glyph to change that tab's view. Switching tabs shows that tab's view.

import { html, render, nothing, type TemplateResult } from "lit-html";
import { PLANS, mockFrame, railTpl } from "./lib.ts";
import { REDESIGN_CSS } from "./styles.ts";

const SCREENS = ["Today", "Projects", "Research", "Scratch"];
type ViewType = "split" | "sidebar" | "board";

// The Board view is a masonry grid of the tab's artifacts (varied heights).
const MASONRY_HEIGHTS = [180, 120, 220, 140, 160, 100];

interface TabDef {
  name: string;
  view: ViewType;
  artifacts: string[];
  active: string;
}

const CAPTION =
  "Approach 2 — a tab's view type is its own property, over the same twelve project plans. In flight is " +
  "a split of the active plans, All plans a masonry board, Browse a sidebar; click a tab's glyph to change its view.";

const CSS = /*css*/ `
  .proto-strip {
    height: 40px;
    flex: none;
    border-bottom: 1px solid #ddd;
    background: #fff;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
  }
  .proto-strip .tab { cursor: pointer; }

  /* view-type glyph on a tab (and in the picker) */
  .vg {
    width: 14px;
    height: 11px;
    flex: none;
    box-sizing: border-box;
    border: 1px solid #888;
    border-radius: 2px;
    display: flex;
    overflow: hidden;
    cursor: pointer;
  }
  .vg.split > i { flex: 1; }
  .vg.split > i + i { border-left: 1px solid #888; }
  .vg.sidebar > i.bar { width: 4px; flex: none; background: #888; }
  .vg.sidebar > i.area { flex: 1; }
  .vg.board > i { flex: 1; }
  .vg.board > i + i { border-left: 1px solid #888; }

  .view-menu {
    position: fixed;
    z-index: 10000;
    min-width: 130px;
    padding: 4px;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  }
  .vm-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    color: #333;
    text-transform: capitalize;
  }
  .vm-item:hover { background: #f2f2f2; }
  .vm-item.on { background: #ececec; color: #111; }
  .vm-item .vg { cursor: default; }

  .tv-sidebar { display: flex; gap: 16px; }
  .tv-side-list {
    width: 200px;
    flex: none;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
    box-sizing: border-box;
  }
  .tv-side-list .side-row { padding: 6px 8px; border-radius: 4px; cursor: pointer; color: #333; }
  .tv-side-list .side-row:hover { background: #ececec; }
  .tv-side-list .side-row.active { background: #e2e2e2; color: #111; }
  .tv-sidebar .tv-pane { flex: 1; min-width: 0; display: flex; }
  .tv-sidebar .tv-pane > * { flex: 1; }

  .tv-board {
    flex: 1;
    min-height: 0;
    column-count: 3;
    column-gap: 16px;
    overflow-y: auto;
  }
  .tv-board > .card {
    break-inside: avoid;
    margin-bottom: 16px;
    width: 100%;
  }

  .stage { user-select: none; -webkit-user-select: none; }
`;

export function tabViewsMock(): HTMLElement {
  const { host, root } = mockFrame("tab-views", REDESIGN_CSS + CSS);

  const tabs: TabDef[] = [
    {
      name: "In flight",
      view: "split",
      artifacts: ["Website redesign", "Mobile app", "Pricing update"],
      active: "Website redesign",
    },
    { name: "All plans", view: "board", artifacts: PLANS, active: PLANS[0] },
    { name: "Browse", view: "sidebar", artifacts: PLANS, active: PLANS[0] },
  ];
  let activeTab = 0;
  let menu: { tabIdx: number; anchor: DOMRect } | null = null;
  let menuOutside: ((e: PointerEvent) => void) | null = null;

  // --- actions ------------------------------------------------------------

  const activate = (i: number): void => {
    activeTab = i;
    rerender();
  };
  const selectArtifact = (i: number, name: string): void => {
    tabs[i].active = name;
    rerender();
  };
  const setView = (i: number, v: ViewType): void => {
    tabs[i].view = v;
    activeTab = i;
    closeMenu();
  };
  const openMenu = (e: MouseEvent, i: number): void => {
    activeTab = i;
    menu = { tabIdx: i, anchor: (e.currentTarget as HTMLElement).getBoundingClientRect() };
    rerender();
    const doc = root.ownerDocument;
    menuOutside = (ev: PointerEvent) => {
      if (!(ev.target as HTMLElement).closest(".view-menu") && !(ev.target as HTMLElement).closest(".vg")) closeMenu();
    };
    doc.addEventListener("pointerdown", menuOutside);
  };
  const closeMenu = (): void => {
    if (menuOutside) {
      root.ownerDocument.removeEventListener("pointerdown", menuOutside);
      menuOutside = null;
    }
    menu = null;
    rerender();
  };

  // --- glyph + templates --------------------------------------------------

  const glyphCells = (v: ViewType): TemplateResult =>
    v === "split"
      ? html`<i></i><i></i>`
      : v === "sidebar"
        ? html`<i class="bar"></i><i class="area"></i>`
        : html`<i></i><i></i><i></i>`;

  const glyph = (v: ViewType, onClick?: (e: MouseEvent) => void): TemplateResult =>
    html`<span class="vg ${v}" title="View: ${v}" @click=${onClick ?? nothing}>${glyphCells(v)}</span>`;

  const card = (name: string): TemplateResult => html`
    <div class="card">
      <div class="card-title"><span class="card-name">${name}</span></div>
      <div class="card-body"></div>
    </div>
  `;

  const splitOf = (t: TabDef): TemplateResult => {
    if (t.artifacts.length === 1) return card(t.artifacts[0]);
    const [first, ...rest] = t.artifacts;
    return html`<div class="split row">${card(first)}<div class="split col">${rest.map(card)}</div></div>`;
  };
  const sidebarOf = (t: TabDef, i: number): TemplateResult => html`
    <div class="tv-sidebar">
      <div class="tv-side-list">
        ${t.artifacts.map(
          (n) => html`<div class="side-row ${n === t.active ? "active" : ""}" @click=${() => selectArtifact(i, n)}>${n}</div>`,
        )}
      </div>
      <div class="tv-pane">${card(t.active)}</div>
    </div>
  `;
  const boardOf = (t: TabDef): TemplateResult => html`
    <div class="tv-board">
      ${t.artifacts.map(
        (n, idx) => html`
          <div class="card" style="height: ${MASONRY_HEIGHTS[idx % MASONRY_HEIGHTS.length]}px">
            <div class="card-title"><span class="card-name">${n}</span></div>
            <div class="card-body"></div>
          </div>
        `,
      )}
    </div>
  `;

  const contentOf = (t: TabDef, i: number): TemplateResult =>
    t.view === "split" ? splitOf(t) : t.view === "sidebar" ? sidebarOf(t, i) : boardOf(t);

  const view = (): TemplateResult => {
    const t = tabs[activeTab];
    return html`
      <div class="stage">
        <div class="shell">
          ${railTpl(SCREENS, 1)}
          <div class="workspace">
            <div class="proto-strip">
              ${tabs.map(
                (tb, i) => html`
                  <div class="tab ${i === activeTab ? "active" : ""}" @click=${() => activate(i)}>
                    ${glyph(tb.view, (e: MouseEvent) => {
                      e.stopPropagation();
                      openMenu(e, i);
                    })}
                    <span class="tab-label">${tb.name}</span>
                  </div>
                `,
              )}
            </div>
            <div class="proto-panes">${contentOf(t, activeTab)}</div>
          </div>
        </div>
        <div class="caption">${CAPTION}</div>
        ${menu
          ? html`
              <div
                class="view-menu"
                style="top: ${menu.anchor.bottom + 6}px; left: ${menu.anchor.left}px"
                @pointerdown=${(e: PointerEvent) => e.stopPropagation()}
              >
                ${(["split", "sidebar", "board"] as ViewType[]).map(
                  (v) => html`
                    <div class="vm-item ${tabs[menu!.tabIdx].view === v ? "on" : ""}" @click=${() => setView(menu!.tabIdx, v)}>
                      ${glyph(v)}<span>${v}</span>
                    </div>
                  `,
                )}
              </div>
            `
          : ""}
      </div>
    `;
  };

  const rerender = (): void => {
    render(view(), root);
  };
  rerender();
  return host;
}

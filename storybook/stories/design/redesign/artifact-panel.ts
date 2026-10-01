// Design workshop (not a spec): tabs stay the default nav, plus an artifact
// panel you can PIN OPEN per-screen. Light screens (a few artifacts) show
// just tabs; heavy screens (a projects view with a plan per project) pin the
// panel open as a sidebar to browse/reopen them all. The panel lives in the
// workspace, never in the global screens rail — so no second permanent
// navigation layer, and no imposition on the common case.

import { html, render, nothing, type TemplateResult } from "lit-html";
import { PLANS, icon, mockFrame, railTpl } from "./lib.ts";
import { REDESIGN_CSS } from "./styles.ts";

interface Screen {
  name: string;
  artifacts: string[]; // everything that lives on the screen
  open: string[]; // the subset open as tabs, in order
  active: string | null;
  pinned: boolean; // artifact panel pinned open for this screen
}

const SCREENS: Screen[] = [
  {
    name: "Today",
    artifacts: ["Daily brief", "Calendar", "To-do list"],
    open: ["Daily brief", "Calendar", "To-do list"],
    active: "Daily brief",
    pinned: false,
  },
  {
    name: "Projects",
    artifacts: [...PLANS],
    open: ["Website redesign", "Q3 planning", "Hiring pipeline", "Mobile app"],
    active: "Website redesign",
    pinned: true,
  },
  {
    name: "Research",
    artifacts: ["Sources", "Notes", "Draft"],
    open: ["Sources", "Notes"],
    active: "Sources",
    pinned: false,
  },
  {
    name: "Scratch",
    artifacts: ["Scratchpad"],
    open: ["Scratchpad"],
    active: "Scratchpad",
    pinned: false,
  },
];

const CAPTION =
  "Projects holds twelve plans, so its artifact panel is pinned open as a sidebar (☰ toggles it). " +
  "Switch to Today — three artifacts — and there's no panel, just tabs. The panel is opt-in per " +
  "screen and never sits in the screens rail; tabs stay the open set, the panel browses everything.";

const PROTO_CSS = /*css*/ `
  /* Workspace column: tabs run full-width across the top, then a row of the
     artifact sidebar + the pane. */
  .content-row {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .pane-wrap {
    flex: 1;
    min-width: 0;
    display: flex;
  }

  /* Pinnable artifact panel — a per-screen sidebar sitting on the workspace
     background (no white pane, no heading). */
  .artifact-panel {
    width: 210px;
    flex: none;
    box-sizing: border-box;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .artifact-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    color: #333;
    white-space: nowrap;
  }
  .artifact-row:hover { background: #ececec; }
  .artifact-row.active { background: #e2e2e2; color: #111; }
  .artifact-row.closed { color: #888; }
  .artifact-row .dot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: #ccc;
  }
  .artifact-row.open .dot { background: #3aa06b; }
  .artifact-row .ar-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .artifact-row .ar-x {
    flex: none;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    background: transparent;
    border-radius: 3px;
    color: #999;
    cursor: pointer;
    display: none;
    align-items: center;
    justify-content: center;
  }
  .artifact-row:hover .ar-x { display: flex; }
  .artifact-row .ar-x:hover { background: #e2e2e2; color: #333; }
  .artifact-row .ar-x .icon { width: 12px; height: 12px; }

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
  .panel-toggle {
    flex: none;
    display: flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 4px;
    color: #666;
    cursor: pointer;
    user-select: none;
  }
  .panel-toggle:hover { background: #f0f0f0; }
  .panel-toggle.active { background: #ececec; color: #111; border-color: #ddd; }
  .panel-toggle .bars { font-size: 13px; line-height: 1; }

  .proto-strip .tab { cursor: pointer; padding-right: 4px; }
  .proto-strip .tab .tb-btn { width: 18px; height: 18px; }
  .proto-strip .tab .icon { width: 13px; height: 13px; }

  .proto-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #bbb;
    font-size: 13px;
  }

  .stage { user-select: none; -webkit-user-select: none; }
`;

export function artifactPanelMock(): HTMLElement {
  const { host, root } = mockFrame("artifact-panel", REDESIGN_CSS + PROTO_CSS);
  let screenIdx = 1; // start on Projects so the pinned sidebar is visible

  const screen = (): Screen => SCREENS[screenIdx];

  function selectScreen(i: number): void {
    screenIdx = i;
    rerender();
  }
  function focusArtifact(name: string): void {
    const s = screen();
    if (!s.open.includes(name)) s.open.push(name);
    s.active = name;
    rerender();
  }
  function closeArtifact(name: string): void {
    const s = screen();
    const i = s.open.indexOf(name);
    if (i < 0) return;
    s.open.splice(i, 1);
    if (s.active === name) s.active = s.open[Math.min(i, s.open.length - 1)] ?? null;
    rerender();
  }
  function togglePanel(): void {
    screen().pinned = !screen().pinned;
    rerender();
  }

  // --- templates ----------------------------------------------------------

  const tab = (name: string, s: Screen): TemplateResult => html`
    <div class="tab ${name === s.active ? "active" : ""}" @click=${() => focusArtifact(name)}>
      <span class="tab-label">${name}</span>
      <button
        class="tb-btn"
        title="Close"
        @click=${(e: Event) => {
          e.stopPropagation();
          closeArtifact(name);
        }}
      >
        ${icon("close")}
      </button>
    </div>
  `;

  const artifactRow = (name: string, s: Screen): TemplateResult => {
    const isOpen = s.open.includes(name);
    return html`
      <div
        class="artifact-row ${isOpen ? "open" : "closed"} ${name === s.active ? "active" : ""}"
        @click=${() => focusArtifact(name)}
      >
        <span class="dot"></span>
        <span class="ar-name">${name}</span>
        ${isOpen
          ? html`<button
              class="ar-x"
              title="Close"
              @click=${(e: Event) => {
                e.stopPropagation();
                closeArtifact(name);
              }}
            >
              ${icon("close")}
            </button>`
          : nothing}
      </div>
    `;
  };

  const panelTpl = (s: Screen): TemplateResult => html`
    <div class="artifact-panel">${s.artifacts.map((name) => artifactRow(name, s))}</div>
  `;

  const paneTpl = (s: Screen): TemplateResult =>
    s.active
      ? html`
          <div class="card">
            <div class="card-title">
              <span class="card-name">${s.active}</span>
              <button class="tb-btn" title="Close" @click=${() => s.active && closeArtifact(s.active)}>
                ${icon("close")}
              </button>
            </div>
            <div class="card-body"></div>
          </div>
        `
      : html`<div class="proto-empty">No artifact open — pick one from the panel.</div>`;

  const view = (): TemplateResult => {
    const s = screen();
    return html`
      <div class="stage">
        <div class="shell">
          ${railTpl(SCREENS.map((x) => x.name), screenIdx, selectScreen)}
          <div class="workspace">
            <div class="proto-strip">
              <div class="panel-toggle ${s.pinned ? "active" : ""}" title="Artifact panel" @click=${togglePanel}>
                <span class="bars">☰</span>${s.artifacts.length}
              </div>
              ${s.open.map((name) => tab(name, s))}
            </div>
            <div class="content-row">
              ${s.pinned ? panelTpl(s) : nothing}
              <div class="pane-wrap">
                <div class="proto-panes">${paneTpl(s)}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="caption">${CAPTION}</div>
      </div>
    `;
  };

  const rerender = (): void => {
    render(view(), root);
  };
  rerender();
  return host;
}

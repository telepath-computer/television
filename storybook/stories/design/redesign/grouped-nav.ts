// Design workshop (not a spec): Approach 1 to organizing many artifacts — a
// flat nav of the screen's project plans, and the user chooses where it lives:
// a left sidebar or a top tab bar. Same flat list either way. The orientation
// comes from the Storybook toolbar (the "Nav" tool), not an in-mock control —
// see manager.ts / preview.ts.

import { html, render, type TemplateResult } from "lit-html";
import { PLANS, mockFrame, railTpl } from "./lib.ts";
import { REDESIGN_CSS } from "./styles.ts";

const SCREENS = ["Today", "Projects", "Research", "Scratch"];
const FIRST = PLANS[0];

const CAPTION =
  "The nav lists the screen's twelve project plans and can sit on the left (a sidebar) or up top (a " +
  "tab bar) — flip it with the Nav toggle in the Storybook toolbar. Pick a plan to open it.";

const CSS = /*css*/ `
  .main-row { flex: 1; min-width: 0; display: flex; }

  .side-nav {
    width: 220px;
    flex: none;
    border-right: 1px solid #ddd;
    background: #fff;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-sizing: border-box;
  }
  .side-row {
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    color: #333;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .side-row:hover { background: #f2f2f2; }
  .side-row.active { background: #ececec; color: #111; }

  .top-nav {
    min-height: 40px;
    flex: none;
    border-bottom: 1px solid #ddd;
    background: #fff;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    overflow-x: auto;
  }
  .top-nav .tab { cursor: pointer; }

  .stage { user-select: none; -webkit-user-select: none; }
`;

export function groupedNavMock(orient: "top" | "left" = "left"): HTMLElement {
  const { host, root } = mockFrame("grouped-nav", REDESIGN_CSS + CSS);
  let active = FIRST;

  const select = (name: string): void => {
    active = name;
    rerender();
  };

  const card = (name: string): TemplateResult => html`
    <div class="card">
      <div class="card-title"><span class="card-name">${name}</span></div>
      <div class="card-body"></div>
    </div>
  `;

  const sideNav = (): TemplateResult => html`
    <div class="side-nav">
      ${PLANS.map(
        (n) => html`<div class="side-row ${n === active ? "active" : ""}" @click=${() => select(n)}>${n}</div>`,
      )}
    </div>
  `;

  const topNav = (): TemplateResult => html`
    <div class="top-nav">
      ${PLANS.map(
        (n) => html`<div class="tab ${n === active ? "active" : ""}" @click=${() => select(n)}>${n}</div>`,
      )}
    </div>
  `;

  const view = (): TemplateResult => html`
    <div class="stage">
      <div class="shell">
        ${railTpl(SCREENS, 1)}
        <div class="main-row">
          ${orient === "left" ? sideNav() : ""}
          <div class="workspace">
            ${orient === "top" ? topNav() : ""}
            <div class="proto-panes">${card(active)}</div>
          </div>
        </div>
      </div>
      <div class="caption">${CAPTION}</div>
    </div>
  `;

  const rerender = (): void => {
    render(view(), root);
  };
  rerender();
  return host;
}

// Design workshop (not a spec): Approach — consolidate the many artifacts into
// ONE artifact that carries its own sidebar. Instead of twelve project plans as
// twelve separate artifacts on the screen, there's a single "Project plans"
// artifact whose left sidebar navigates the plans and whose body shows the
// selected one. One artifact, one internal nav — the screens rail is untouched.

import { html, render, type TemplateResult } from "lit-html";
import { PLANS, fakeDoc, mockFrame, railTpl } from "./lib.ts";
import { REDESIGN_CSS } from "./styles.ts";

const SCREENS = ["Today", "Projects", "Research", "Scratch"];

const CAPTION =
  "Consolidate the twelve project plans into a single artifact that carries its own sidebar — the " +
  "sidebar picks the plan, the body shows it. One artifact, one internal nav; the screens rail is untouched.";

const CSS = /*css*/ `
  /* tab bar sits directly on the workspace: no bg, no divider */
  .proto-strip {
    height: 44px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 4px;
    /* left padding matches the content below so the tab aligns with the artifact */
    padding: 0 16px;
  }
  .proto-strip .tab { cursor: default; }

  /* the artifact's body is split into a sidebar + the plan detail */
  .plan-card .card-body {
    display: flex;
    min-height: 0;
  }
  .plan-nav {
    width: 220px;
    flex: none;
    border-right: 1px solid #eee;
    overflow-y: auto;
    padding: 8px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .plan-row {
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    color: #333;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .plan-row:hover { background: #f2f2f2; }
  .plan-row.active { background: #ececec; color: #111; }

  .plan-detail {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  /* just a title, not a header bar */
  .plan-title {
    flex: none;
    padding: 20px 20px 4px;
    font-size: 16px;
    font-weight: 600;
    color: #1a1a1a;
  }
  .plan-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .plan-content .fake { padding: 12px 20px 24px; }

  .stage { user-select: none; -webkit-user-select: none; }
`;

export function artifactSidebarMock(): HTMLElement {
  const { host, root } = mockFrame("artifact-sidebar", REDESIGN_CSS + CSS);
  let active = PLANS[0];

  const select = (name: string): void => {
    active = name;
    rerender();
  };

  const view = (): TemplateResult => html`
    <div class="stage">
      <div class="shell">
        ${railTpl(SCREENS, 1)}
        <div class="workspace">
          <div class="proto-strip">
            <div class="tab active">Project plans</div>
          </div>
          <div class="proto-panes flush">
            <div class="card plan-card">
              <div class="card-title"><span class="card-name">Project plans</span></div>
              <div class="card-body">
                <div class="plan-nav">
                  ${PLANS.map(
                    (n) => html`<div class="plan-row ${n === active ? "active" : ""}" @click=${() => select(n)}>${n}</div>`,
                  )}
                </div>
                <div class="plan-detail">
                  <div class="plan-title">${active}</div>
                  <div class="plan-content">${fakeDoc()}</div>
                </div>
              </div>
            </div>
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

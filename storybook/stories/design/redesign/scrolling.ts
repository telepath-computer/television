// Design workshop (not a spec): mockup 1 — today's model plus a rail.
// Artifacts on a free-scrolling horizontal strip at independent sizes;
// any card can enter/exit full-screen from its title bar. Pure lit:
// every action re-renders the whole view (no transitions in this mock).

import { html, render, type TemplateResult } from "lit-html";
import { icon, mockFrame, railTpl } from "./lib.ts";

// Same workflow as the Tab groups mock: screens are contexts, artifacts
// live on each screen's strip.
const SCREENS = [
  { name: "Today", cards: [
    { name: "Calendar", width: 560 },
    { name: "To-do list", width: 300 },
    { name: "Daily brief", width: 440 },
    { name: "Meeting prep", width: 360 },
  ] },
  { name: "Research", cards: [
    { name: "Paper", width: 560 },
    { name: "Notes", width: 340 },
    { name: "Source table", width: 440 },
  ] },
  { name: "Telepath", cards: [
    { name: "Waitlist", width: 440 },
    { name: "Testers", width: 340 },
    { name: "Usage", width: 440 },
  ] },
  { name: "Scratch", cards: [
    { name: "Scratchpad", width: 560 },
  ] },
];

const CAPTION =
  "Today's model, plus a sidebar: artifacts sit on a free-scrolling horizontal " +
  "strip at independent sizes, screens live in a persistent rail, and any card " +
  "can enter and exit full-screen from its title bar.";

export function scrollingMock(): HTMLElement {
  const { host, root } = mockFrame("scrolling");
  let screenIdx = 0;
  let maximized: string | null = null;
  const closed = new Set<string>();

  const selectScreen = (idx: number): void => {
    if (idx === screenIdx) return;
    screenIdx = idx;
    maximized = null;
    closed.clear();
    rerender();
  };

  const card = (name: string, width?: number): TemplateResult => {
    const isMax = maximized === name;
    return html`
      <div class="card" style=${width === undefined ? "" : `width: ${width}px`}>
        <div class="card-title">
          <button
            class="tb-btn ${isMax ? "on" : ""}"
            title=${isMax ? "Restore" : "Maximize"}
            @click=${() => {
              maximized = isMax ? null : name;
              rerender();
            }}
          >
            ${icon(isMax ? "restore" : "max")}
          </button>
          <span class="card-name">${name}</span>
          <button
            class="tb-btn"
            title="Close"
            @click=${() => {
              if (isMax) maximized = null;
              else closed.add(name);
              rerender();
            }}
          >
            ${icon("close")}
          </button>
        </div>
        <div class="card-body"></div>
      </div>
    `;
  };

  const view = (): TemplateResult => html`
    <div class="stage">
      <div class="shell">
        ${railTpl(SCREENS.map((s) => s.name), screenIdx, selectScreen)}
        <div class="main">
          <div class="scroller">
            ${SCREENS[screenIdx].cards.filter((c) => !closed.has(c.name)).map((c) => card(c.name, c.width))}
          </div>
          <div class="fullscreen ${maximized ? "on" : ""}">
            ${maximized ? card(maximized) : ""}
          </div>
        </div>
      </div>
      <div class="caption">${CAPTION}</div>
    </div>
  `;

  const rerender = () => render(view(), root);
  rerender();
  return host;
}

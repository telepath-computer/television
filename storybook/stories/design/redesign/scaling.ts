// Design workshop (not a spec): mockup 3 — the in-between. The strip keeps
// the grouped layout language (full-width cards, side-by-side pairs, stacked
// halves) but navigation is flat: every artifact gets its own tab, clicking
// one anchors it to the left edge, and the active tab tracks the leftmost
// card on scroll. Lit for markup; scrolling is imperative on the real nodes.

import { html, render, type TemplateResult } from "lit-html";
import { icon, mockFrame, railTpl } from "./lib.ts";

// A group is one full/half-width card, or a column of stacked half-height
// cards. Each screen's strip mirrors the Tab groups arrangements, unrolled.
type Group = { kind: "card"; name: string; width: number } | { kind: "col"; names: string[]; width: number };
interface Screen {
  name: string;
  groups: Group[];
}

const SCREENS: Screen[] = [
  { name: "Today", groups: [
    { kind: "card", name: "Calendar", width: 700 },
    { kind: "card", name: "To-do list", width: 340 },
    { kind: "card", name: "Daily brief", width: 340 },
    { kind: "card", name: "Meeting prep", width: 700 },
    { kind: "card", name: "Inbox", width: 340 },
    { kind: "col", names: ["Notes", "Chat"], width: 340 },
  ] },
  { name: "Research", groups: [
    { kind: "card", name: "Paper", width: 700 },
    { kind: "col", names: ["Notes", "Highlights"], width: 340 },
    { kind: "card", name: "Source table", width: 460 },
    { kind: "card", name: "Draft", width: 460 },
  ] },
  { name: "Telepath", groups: [
    { kind: "card", name: "Waitlist", width: 460 },
    { kind: "card", name: "Testers", width: 460 },
    { kind: "card", name: "Usage", width: 700 },
  ] },
  { name: "Scratch", groups: [
    { kind: "card", name: "Scratchpad", width: 700 },
  ] },
];

const CAPTION =
  "In between: the strip keeps the grouped layout language — full-width cards, " +
  "side-by-side pairs, stacked halves — but navigation is flat. Every artifact " +
  "gets its own tab; clicking one anchors it to the left edge, and the active " +
  "tab tracks the leftmost card as you scroll. Widths would scale to the " +
  "window (fixed in this mock).";

const PAD = 16;

const groupNames = (g: Group): string[] => (g.kind === "card" ? [g.name] : g.names);

export function scalingMock(): HTMLElement {
  const { host, root } = mockFrame("sliding-tabs");
  let screenIdx = 0;
  const closed = new Set<string>();
  let activeName = groupNames(SCREENS[0].groups[0])[0];

  const groups = (): Group[] => SCREENS[screenIdx].groups;
  const visibleNames = (): string[] => groups().flatMap(groupNames).filter((n) => !closed.has(n));

  function selectScreen(idx: number): void {
    if (idx === screenIdx) return;
    screenIdx = idx;
    closed.clear();
    activeName = visibleNames()[0] ?? "";
    rerender();
    const scroller = root.querySelector<HTMLElement>(".scroller");
    if (scroller) scroller.scrollLeft = 0;
  }

  const card = (name: string, width?: number): TemplateResult => html`
    <div class="card" data-name=${name} style=${width === undefined ? "" : `width: ${width}px`}>
      <div class="card-title">
        <span class="card-name">${name}</span>
        <button
          class="tb-btn"
          title="Close"
          @click=${() => {
            closed.add(name);
            if (activeName === name) activeName = visibleNames()[0] ?? "";
            rerender();
          }}
        >
          ${icon("close")}
        </button>
      </div>
      <div class="card-body"></div>
    </div>
  `;

  const group = (g: Group): TemplateResult | "" => {
    if (g.kind === "card") return closed.has(g.name) ? "" : card(g.name, g.width);
    const names = g.names.filter((n) => !closed.has(n));
    if (names.length === 0) return "";
    return html`<div class="col" style="width: ${g.width}px">${names.map((n) => card(n))}</div>`;
  };

  // Anchor a card's left edge to the strip's left (tab click).
  function anchorLeft(name: string): void {
    const scroller = root.querySelector<HTMLElement>(".scroller")!;
    const target = scroller.querySelector<HTMLElement>(`[data-name="${CSS.escape(name)}"]`);
    if (!target) return;
    const delta = target.getBoundingClientRect().left - scroller.getBoundingClientRect().left - PAD;
    scroller.scrollBy({ left: delta, behavior: "smooth" });
  }

  // Keep the active tab in sync with the leftmost card as the strip scrolls.
  let raf = 0;
  function onScroll(e: Event): void {
    const scroller = e.currentTarget as HTMLElement;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const anchor = scroller.getBoundingClientRect().left + PAD;
      let best: string | null = null;
      let bestD = Infinity;
      for (const el of scroller.querySelectorAll<HTMLElement>(".card[data-name]")) {
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.left - anchor) + r.top * 0.001; // tie-break toward the topmost
        if (d < bestD) {
          bestD = d;
          best = el.dataset.name ?? null;
        }
      }
      if (best && best !== activeName) {
        activeName = best;
        rerender();
      }
    });
  }

  const view = (): TemplateResult => html`
    <div class="stage">
      <div class="shell">
        ${railTpl(SCREENS.map((s) => s.name), screenIdx, selectScreen)}
        <div class="main column">
          <div class="tabs-band inline">
            ${visibleNames().map(
              (name) => html`
                <div
                  class="tab ${name === activeName ? "active" : ""}"
                  @click=${() => {
                    activeName = name;
                    rerender();
                    requestAnimationFrame(() => anchorLeft(name));
                  }}
                >
                  ${name}
                </div>
              `,
            )}
          </div>
          <div class="main">
            <div class="scroller" @scroll=${onScroll}>${groups().map(group)}</div>
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

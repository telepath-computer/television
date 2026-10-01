// Design workshop (not a spec): mockup 2 — the tmux model. Screens in a
// rail, each screen a set of tabs, each tab a pane-group (a splittable
// layout of artifact cards). Markup is lit templates; the two animated
// containers (tab strip, pane viewport) are driven imperatively because
// their enter/exit choreography outlives any single render.

import { html, render, nothing, type TemplateResult } from "lit-html";
import { icon, mockFrame, railTpl, removeAfterTransition } from "./lib.ts";

type LayoutNode = string | { dir: "row" | "col"; children: LayoutNode[] };
interface Tab {
  name: string;
  layout: LayoutNode;
}
interface Screen {
  name: string;
  tabs: Tab[];
}

// A workflow modeled on real Television use: screens are contexts, tabs are
// working sets, panes are artifacts.
const SCREENS: Screen[] = [
  { name: "Today", tabs: [
    { name: "Brief", layout: "Daily brief" },
    { name: "Schedule", layout: { dir: "row", children: ["Calendar", "To-do list"] } },
    { name: "Meeting prep", layout: "Meeting prep" },
  ] },
  { name: "Research", tabs: [
    { name: "Reading", layout: { dir: "row", children: ["Paper", { dir: "col", children: ["Notes", "Highlights"] }] } },
    { name: "Sources", layout: "Source table" },
    { name: "Draft", layout: { dir: "col", children: ["Draft", "Outline"] } },
  ] },
  { name: "Telepath", tabs: [
    { name: "Alpha", layout: { dir: "row", children: ["Waitlist", "Testers"] } },
    { name: "Metrics", layout: "Usage" },
  ] },
  { name: "Scratch", tabs: [
    { name: "Scratch", layout: "Scratchpad" },
  ] },
];

export type TabStyle = "tabs" | "minimap" | "lead-count" | "expandable" | "members";

const BASE_CAPTION =
  "The tmux model: screens in a rail, each screen a set of tabs, each tab a " +
  "pane-group. Screens swish vertically, tabs swipe horizontally.";
const STYLE_CAPTIONS: Record<TabStyle, string> = {
  tabs: "Tab style — tabs: each tab shows its name plus overlapping circles counting its panes (capped at 3).",
  minimap: "Tab style — minimap: each tab is a clickable miniature of its layout; the arrangement itself is the label.",
  "lead-count": "Tab style — lead + count: groups collapse to their lead artifact and a muted +N badge.",
  expandable:
    "Tab style — expandable: groups show their name; the active group expands inline to reveal its members — click one to locate its pane.",
  members:
    "Tab style — split tabs: every artifact shows as its own icon + name, groups stay expanded at all times (Calendar | Tasks).",
};

const isLeaf = (node: LayoutNode): node is string => typeof node === "string";
const leafNames = (node: LayoutNode): string[] => (isLeaf(node) ? [node] : node.children.flatMap(leafNames));

const NUDGE = 10;

export function tmuxMock(tabStyle: TabStyle = "tabs"): HTMLElement {
  const { host, root } = mockFrame("tab-groups");
  let screenIdx = 0;
  let tabIdx = 0;

  // --- templates ---------------------------------------------------------

  const paneCard = (name: string): TemplateResult => html`
    <div class="card">
      <div class="card-title">
        <span class="card-name">${name}</span>
        <button
          class="tb-btn"
          title="Close"
          @click=${(e: Event) => (e.currentTarget as HTMLElement).closest(".card")?.remove()}
        >
          ${icon("close")}
        </button>
      </div>
      <div class="card-body"></div>
    </div>
  `;

  const layoutTpl = (node: LayoutNode): TemplateResult =>
    isLeaf(node)
      ? paneCard(node)
      : html`<div class="split ${node.dir}">${node.children.map(layoutTpl)}</div>`;

  const glyph = (count: number): TemplateResult =>
    html`<span class="glyph">${Array.from({ length: Math.min(count, 3) }, () => html`<span class="c"></span>`)}</span>`;

  const miniTpl = (node: LayoutNode): TemplateResult =>
    isLeaf(node)
      ? html`<span class="m-pane"></span>`
      : html`<span class="m-split ${node.dir === "col" ? "col" : ""}">${node.children.map(miniTpl)}</span>`;

  const tabContent = (tab: Tab, i: number): TemplateResult => {
    const names = leafNames(tab.layout);
    switch (tabStyle) {
      case "minimap":
        return html`<span class="mini" title=${tab.name}>${miniTpl(tab.layout)}</span>`;
      case "lead-count":
        return html`${glyph(names.length)}${names[0]}${names.length > 1
          ? html`<span class="plus">+${names.length - 1}</span>`
          : nothing}`;
      case "expandable":
        return html`${glyph(names.length)}${tab.name}${names.length > 1
          ? html`<span class="members">
              ${names.map(
                (n, leafIdx) => html`
                  <span
                    class="member"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      if (i !== tabIdx) selectTab(i);
                      flashPane(leafIdx);
                    }}
                    >${n}</span
                  >
                `,
              )}
            </span>`
          : nothing}`;
      case "members":
        return html`<span class="tab-joined"
          >${names.map(
            (n, leafIdx) => html`${leafIdx > 0 ? html`<span class="tab-sep">|</span>` : nothing}<span
                class="tab-member"
                ><span class="member-icon"></span>${n}</span
              >`,
          )}</span
        >`;
      default:
        return html`${glyph(names.length)}${tab.name}`;
    }
  };

  const stripTpl = (screen: Screen): TemplateResult =>
    html`${screen.tabs.map(
      (tab, i) => html`
        <div
          class="tab ${i === tabIdx ? "active" : ""} ${tabStyle === "minimap" ? "minimap" : ""}"
          @click=${() => selectTab(i)}
        >
          ${tabContent(tab, i)}
        </div>
      `,
    )}`;

  const skeletonTpl = (): TemplateResult => html`
    <div class="stage">
      <div class="shell">
        ${railTpl(SCREENS.map((s) => s.name), screenIdx, selectScreen)}
        <div class="main column ${tabStyle === "members" ? "members-layout" : ""}">
          <div class="tabs-band stripped"></div>
          <div class="panes"><div class="viewport"></div></div>
        </div>
      </div>
      <div class="caption">${BASE_CAPTION} ${STYLE_CAPTIONS[tabStyle]}</div>
    </div>
  `;

  // --- animated containers (imperative choreography) ---------------------

  render(skeletonTpl(), root);
  const tabsBand = root.querySelector<HTMLElement>(".tabs-band")!;
  const viewport = root.querySelector<HTMLElement>(".viewport")!;

  let curStrip: HTMLElement | null = null;
  let curPage: HTMLElement | null = null;

  // Slide new pane content in. axis "X" | "Y", dir -1 | 0 | 1.
  function slidePane(content: TemplateResult, axis: "X" | "Y", dir: number): void {
    const page = document.createElement("div");
    page.className = "page";
    render(content, page);
    if (dir === 0 || !curPage) {
      viewport.replaceChildren(page);
    } else {
      page.style.transform = `translate${axis}(${dir * 100}%)`;
      viewport.appendChild(page);
      page.getBoundingClientRect(); // reflow so the start transform sticks
      const outgoing = curPage;
      page.style.transform = "translate(0, 0)";
      outgoing.style.transform = `translate${axis}(${-dir * 100}%)`;
      removeAfterTransition(outgoing);
    }
    curPage = page;
  }

  // Cross-fade + small vertical nudge between tab strips. dir -1 | 0 | 1.
  function swapStrip(content: TemplateResult, dir: number): void {
    const strip = document.createElement("div");
    strip.className = "tab-strip";
    render(content, strip);
    if (dir === 0 || !curStrip) {
      tabsBand.replaceChildren(strip);
    } else {
      strip.style.opacity = "0";
      strip.style.transform = `translateY(${dir * NUDGE}px)`;
      tabsBand.appendChild(strip);
      strip.getBoundingClientRect();
      const outgoing = curStrip;
      strip.style.opacity = "1";
      strip.style.transform = "translateY(0)";
      outgoing.style.opacity = "0";
      outgoing.style.transform = `translateY(${-dir * NUDGE}px)`;
      removeAfterTransition(outgoing);
    }
    curStrip = strip;
  }

  // Briefly highlight the nth pane of the current page (leaf order = DOM order).
  function flashPane(leafIdx: number): void {
    const pane = viewport.querySelectorAll(".card")[leafIdx];
    if (!pane) return;
    pane.classList.add("flash");
    setTimeout(() => pane.classList.remove("flash"), 700);
  }

  // --- actions ------------------------------------------------------------

  function selectTab(idx: number): void {
    if (idx === tabIdx) return;
    const dir = idx > tabIdx ? 1 : -1;
    tabIdx = idx;
    const screen = SCREENS[screenIdx];
    if (curStrip) render(stripTpl(screen), curStrip); // same strip, new active tab
    slidePane(layoutTpl(screen.tabs[idx].layout), "X", dir);
  }

  function selectScreen(idx: number): void {
    if (idx === screenIdx) return;
    const dir = idx > screenIdx ? 1 : -1;
    screenIdx = idx;
    tabIdx = 0;
    const screen = SCREENS[idx];
    render(skeletonTpl(), root); // rail active state
    swapStrip(stripTpl(screen), dir);
    slidePane(layoutTpl(screen.tabs[0].layout), "Y", dir);
  }

  // --- boot ----------------------------------------------------------------

  swapStrip(stripTpl(SCREENS[0]), 0);
  slidePane(layoutTpl(SCREENS[0].tabs[0].layout), "Y", 0);
  return host;
}

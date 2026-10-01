// Design workshop (not a spec): slide content for the channels / screens /
// artifacts concept. Each exported *Slide() renders as an isolated frame
// (frameSlide) so it drops straight into the deck without being its own story.
//   beforeSlide()  — slide 1: the model up to now (screens as top tabs).
//   tensionSlide() — slide 2: why change it (one endless scroll → grouping).

import { html, type TemplateResult } from "lit-html";
import { fakeDoc } from "./lib.ts";
import { frameSlide } from "./slideshow.ts";
import { REDESIGN_CSS } from "./styles.ts";

// larger caption + shared framing across the concept slides. Each slide is
// its own iframe, so nothing here leaks beyond the slide it's used in.
const SLIDE_CSS = /*css*/ `
  .caption { font-size: 17px; max-width: 840px; }

  /* Shared mini-window wireframe: a tab row up top, panes below. Window
     width/height are set per-use via inline style; a slide overrides only
     what genuinely differs (see the ch-* rules in CHANNELS_CSS). */
  .win {
    box-sizing: border-box;
    background: #f5f5f5;
    border: 1px solid #ccc;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: ui-sans-serif, system-ui, sans-serif;
  }
  .win .tabs {
    height: 34px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 8px;
  }
  /* re-skin the base .tab (REDESIGN_CSS) down to the mini wireframe scale */
  .win .tab {
    height: auto;
    font-size: 11px;
    padding: 3px 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    color: #777;
    white-space: nowrap;
    cursor: default;
  }
  .win .tab.active { background: #fafafa; color: #111; border-color: #bbb; }

  .pane {
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .pane .pl { margin-top: auto; font-size: 10px; color: #777; padding: 4px 7px; border-top: 1px solid #eee; }

  /* a column of panes inside a window body */
  .col { flex: 1; display: flex; flex-direction: column; gap: 10px; }
  .col > .pane { flex: 1; }
`;

// Shared wireframe bits: a pane with its bottom label, and a tab row with the
// first tab active.
const pane = (label: string): TemplateResult => html`<div class="pane"><div class="pl">${label}</div></div>`;
const tabs = (names: string[]): TemplateResult => html`
  <div class="tabs">${names.map((name, i) => html`<div class="tab ${i === 0 ? "active" : ""}">${name}</div>`)}</div>
`;

// ---------------------------------------------------------------- slide 1

const SCREENS = ["Today", "Research", "Planning"];
const ARTIFACTS = ["Calendar", "To-do list", "Daily brief", "Meeting prep", "Notes"];

const BEFORE_CAPTION = html`Screens are horizontally scrolling collections of artifacts. In practice, they
are used to both group work according to theme <em>and</em> to arrange artifacts for display. Scrolling and
rearranging is bug-prone, and with too many artifacts organization is unruly.`;

const BEFORE_CSS = /*css*/ `
  .cb-head { font: 600 22px ui-sans-serif, system-ui, sans-serif; color: #222; text-align: center; margin-bottom: 14px; }
  .cb-col { display: flex; flex-direction: column; align-items: center; gap: 12px; }

  /* callout: a label + a vertical arrow pointing at the window */
  .cb-anno { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .cb-label { font: 600 15px ui-sans-serif, system-ui, sans-serif; color: #333; }
  .cb-arrow { width: 2px; height: 32px; background: #a8a8a8; position: relative; }
  .cb-arrow.down::after,
  .cb-arrow.up::after {
    content: "";
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
  }
  .cb-arrow.down::after { bottom: -2px; border-top: 9px solid #a8a8a8; }
  .cb-arrow.up::after { top: -2px; border-bottom: 9px solid #a8a8a8; }

  /* the wireframe "window" */
  .cb-win {
    width: 820px;
    height: 440px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background: #f5f5f5;
    border: 1px solid #ccc;
    overflow: hidden;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 13px;
    color: #333;
  }
  /* tabs centered, no bar background or divider */
  .cb-top {
    height: 44px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 12px;
  }
  .cb-body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 16px;
    padding: 16px;
    box-sizing: border-box;
    overflow-x: auto;
  }
  .cb-body > .card { flex: none; width: 230px; }
  /* artifact label sits at the bottom of the card */
  .cb-body .card-title { border-bottom: none; border-top: 1px solid #eee; }
`;

export function beforeSlide(): HTMLIFrameElement {
  const card = (name: string): TemplateResult => html`
    <div class="card">
      <div class="card-body">${fakeDoc(2)}</div>
      <div class="card-title"><span class="card-name">${name}</span></div>
    </div>
  `;

  const view = html`
    <div class="stage">
      <div class="cb-head">The core organizing metaphor in Television is the &ldquo;screen&rdquo;</div>
      <div class="cb-col">
        <div class="cb-anno">
          <div class="cb-label">Screens</div>
          <div class="cb-arrow down"></div>
        </div>

        <div class="cb-win">
          <div class="cb-top">
            ${SCREENS.map((name, i) => html`<div class="tab ${i === 0 ? "active" : ""}">${name}</div>`)}
          </div>
          <div class="cb-body">${ARTIFACTS.map(card)}</div>
        </div>

        <div class="cb-anno">
          <div class="cb-arrow up"></div>
          <div class="cb-label">Artifacts</div>
        </div>
      </div>
      <div class="caption">${BEFORE_CAPTION}</div>
    </div>
  `;

  return frameSlide(REDESIGN_CSS + SLIDE_CSS + BEFORE_CSS, view);
}

// ---------------------------------------------------------------- slide 2

// The flat scroll (overflows the frame), and the groupings you actually reach
// for. Groups draw from the same set to make the point that they're the same
// artifacts, just arranged.
const SCROLL = ["Calendar", "Tasks", "Daily plan", "Inbox", "Paper", "Notes", "Metrics", "Draft"];
const GROUPS: Array<{ label: string; cards: string[] }> = [
  { label: "Calendar + Tasks", cards: ["Calendar", "Tasks"] },
  { label: "Daily plan", cards: ["Daily plan"] },
  { label: "Research", cards: ["Paper", "Notes"] },
];

const TENSION_CAPTION =
  "Instead of one long scrolling surface, divide it into smaller, fixed surfaces that can contain one or more artifacts arranged just the way you like.";

const TENSION_CSS = /*css*/ `
  .ts-scene { display: flex; flex-direction: column; align-items: center; gap: 20px; margin-bottom: 52px; }
  .ts-head { font: 600 22px ui-sans-serif, system-ui, sans-serif; color: #222; margin-bottom: 52px; }

  /* the flat endless scroll */
  .ts-scrollwrap { position: relative; width: 840px; overflow: hidden; }
  .ts-scrollwrap::after {
    content: "";
    position: absolute;
    inset: 0 0 0 auto;
    width: 90px;
    background: linear-gradient(to right, rgba(240, 240, 240, 0), #f0f0f0);
    pointer-events: none;
  }
  .ts-scroll { display: flex; gap: 10px; }

  .ts-card {
    width: 120px;
    height: 80px;
    flex: none;
    box-sizing: border-box;
    border: 1px solid #d6d6d6;
    border-radius: 6px;
    background: #fff;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: ui-sans-serif, system-ui, sans-serif;
  }
  .ts-card .nm { font-size: 11px; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ts-card .ln { height: 5px; border-radius: 3px; background: #ededed; }
  .ts-card .ln.s { width: 65%; }

  /* the "you actually want" arrow */
  .ts-arrow { width: 2px; height: 28px; background: #bbb; position: relative; }
  .ts-arrow::after {
    content: "";
    position: absolute;
    bottom: -2px;
    left: 50%;
    transform: translateX(-50%);
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 9px solid #bbb;
  }

  /* the groupings */
  .ts-groups { display: flex; gap: 28px; }
  .ts-group { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .ts-group .gl { font: 600 13px ui-sans-serif, system-ui, sans-serif; color: #333; }
  .ts-group .gbox {
    display: flex;
    gap: 8px;
    padding: 10px;
    border: 1px solid #cfcfcf;
    border-radius: 8px;
    background: #fafafa;
  }
`;

export function tensionSlide(): HTMLIFrameElement {
  const miniCard = (name: string): TemplateResult => html`
    <div class="ts-card">
      <div class="nm">${name}</div>
      <div class="ln"></div>
      <div class="ln s"></div>
    </div>
  `;

  const group = (g: { label: string; cards: string[] }): TemplateResult => html`
    <div class="ts-group">
      <div class="gl">${g.label}</div>
      <div class="gbox">${g.cards.map(miniCard)}</div>
    </div>
  `;

  const view = html`
    <div class="stage">
      <div class="ts-scene">
        <div class="ts-head">What if we could split screens into smaller pieces?</div>

        <div class="ts-scrollwrap"><div class="ts-scroll">${SCROLL.map(miniCard)}</div></div>

        <div class="ts-arrow"></div>

        <div class="ts-groups">${GROUPS.map(group)}</div>
      </div>
      <div class="caption">${TENSION_CAPTION}</div>
    </div>
  `;

  return frameSlide(REDESIGN_CSS + SLIDE_CSS + TENSION_CSS, view);
}

// ---------------------------------------------------------------- slide 3

// One screen (Today) and its artifacts; after, the same artifacts divided into
// several new screens (tabs), each a tight layout. The before's artifacts sit
// vertically centered at less than full height, and the strip slowly scrolls
// on a CSS loop; the after's tabs are clickable — pick a screen to see it.
const TODAY_ARTIFACTS = ["Calendar", "Tasks", "Daily plan", "Inbox", "Paper", "Notes", "Metrics"];
const BEFORE_TABS = ["Today"];

// Per-screen layouts for the after window: tiled, full-screen, full-screen, split.
type AfterLayout = { tab: string; kind: "tile" | "full" | "side"; panes: string[] };
const AFTER_SCREENS: AfterLayout[] = [
  { tab: "Morning", kind: "tile", panes: ["Calendar", "Tasks", "Daily plan"] },
  { tab: "Inbox", kind: "full", panes: ["Inbox"] },
  { tab: "Metrics", kind: "full", panes: ["Metrics"] },
  { tab: "Reading", kind: "side", panes: ["Paper", "Notes"] },
];

const SCREEN_CSS = /*css*/ `
  .sc-scene { display: flex; flex-direction: column; align-items: center; gap: 34px; margin-bottom: 40px; }
  .sc-head { font: 600 22px ui-sans-serif, system-ui, sans-serif; color: #222; text-align: center; }

  .sc-ba { display: flex; align-items: center; gap: 26px; }
  .sc-arrow { font-size: 30px; color: #bbb; line-height: 1; }
  .sc-side { display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .sc-side .lbl { font: 600 13px ui-sans-serif, system-ui, sans-serif; color: #666; }
  .sc-side .lbl .q { color: #999; font-weight: 400; }

  /* before body: one long horizontal strip, slowly scrolling back and forth;
     artifacts sit centered at less than full height — the view isn't filled */
  .sc-scrollbody { flex: 1; min-height: 0; position: relative; overflow: hidden; padding: 12px; }
  .sc-scrollrow {
    display: flex;
    gap: 8px;
    height: 100%;
    align-items: center;
    animation: sc-scroll 11s ease-in-out infinite;
  }
  .sc-scrollrow .pane { width: 92px; height: 68%; flex: none; }
  @keyframes sc-scroll {
    0%, 10% { transform: translateX(0); }
    45%, 55% { transform: translateX(-54%); }
    90%, 100% { transform: translateX(0); }
  }

  /* after body: click a tab and the screens slide horizontally, like flicking
     between tmux windows */
  .tab.clickable { cursor: pointer; }
  .sc-pages { flex: 1; min-height: 0; position: relative; overflow: hidden; }
  .sc-page {
    position: absolute;
    inset: 0;
    display: flex;
    gap: 10px;
    padding: 12px;
    transform: translateX(110%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .sc-page.no-trans { transition: none; }
  .sc-page.show { transform: translateX(0); }
  .sc-page > .pane { flex: 1; }
`;

export function screenSlide(): HTMLIFrameElement {
  const pageBody = (screen: AfterLayout): TemplateResult =>
    screen.kind === "tile"
      ? html`${pane(screen.panes[0])}<div class="col">${screen.panes.slice(1).map(pane)}</div>`
      : html`${screen.panes.map(pane)}`;

  // Click a tab → slide to its page: incoming enters from the side you're
  // heading toward, outgoing exits the other way. Imperative within the window
  // (the slide renders once; lit listeners survive adoption into the frame).
  let currentIdx = 0;
  const selectScreen = (event: Event, idx: number): void => {
    const win = (event.currentTarget as HTMLElement).closest(".win");
    if (!win || idx === currentIdx) return;
    const dir = idx > currentIdx ? 1 : -1;
    const pages = win.querySelectorAll<HTMLElement>(".sc-page");
    const incoming = pages[idx];
    const outgoing = pages[currentIdx];
    // park the incoming page just off the entry side, without animating there
    incoming.classList.add("no-trans");
    incoming.style.transform = `translateX(${dir * 110}%)`;
    incoming.getBoundingClientRect(); // reflow so the start position sticks
    incoming.classList.remove("no-trans");
    incoming.classList.add("show");
    incoming.style.transform = "";
    outgoing.classList.remove("show");
    outgoing.style.transform = `translateX(${-dir * 110}%)`;
    win.querySelectorAll(".tab").forEach((t, i) => t.classList.toggle("active", i === idx));
    currentIdx = idx;
  };

  const view = html`
    <div class="stage">
      <div class="sc-scene">
        <div class="sc-head">This becomes <em>this</em>.</div>

        <div class="sc-ba">
          <div class="sc-side">
            <div class="win" style="width: 420px; height: 288px">
              ${tabs(BEFORE_TABS)}
              <div class="sc-scrollbody">
                <div class="sc-scrollrow">${TODAY_ARTIFACTS.map(pane)}</div>
              </div>
            </div>
            <div class="lbl">Before <span class="q">— Today, one scroll</span></div>
          </div>

          <div class="sc-arrow">&rarr;</div>

          <div class="sc-side">
            <div class="win" style="width: 420px; height: 288px">
              <div class="tabs">
                ${AFTER_SCREENS.map(
                  (s, i) => html`
                    <div
                      class="tab clickable ${i === 0 ? "active" : ""}"
                      @click=${(event: Event) => selectScreen(event, i)}
                    >
                      ${s.tab}
                    </div>
                  `,
                )}
              </div>
              <div class="sc-pages">
                ${AFTER_SCREENS.map((s, i) => html`<div class="sc-page ${i === 0 ? "show" : ""}">${pageBody(s)}</div>`)}
              </div>
            </div>
            <div class="lbl">After <span class="q">— Today, divided into screens</span></div>
          </div>
        </div>
      </div>
    </div>
  `;

  return frameSlide(REDESIGN_CSS + SLIDE_CSS + SCREEN_CSS, view);
}

// ---------------------------------------------------------------- slide 4

// A simple task needs one screen; a complex task needs many — the setup for
// channels as the larger grouping.
const GROUPING_CAPTION =
  "Screens are now purely about display. The other job — organizing them into tasks — still needs a home.";

const GROUPING_CSS = /*css*/ `
  .gr-row { display: flex; align-items: flex-start; gap: 44px; margin-bottom: 28px; }
  .gr-item { display: flex; flex-direction: column; align-items: center; gap: 16px; }
  .gr-note { font: 15px ui-sans-serif, system-ui, sans-serif; color: #555; max-width: 400px; text-align: center; }

  .gr-body { flex: 1; min-height: 0; display: flex; gap: 10px; padding: 12px; }
  .gr-body > .pane { flex: 1; }
`;

const COMPLEX_TABS = ["Brief", "Timeline", "Assets", "Metrics", "Feedback", "Notes"];

export function groupingSlide(): HTMLIFrameElement {
  const view = html`
    <div class="stage">
      <div class="gr-row">
        <div class="gr-item">
          <div class="gr-note">For a simple task, we might only need one of these screens.</div>
          <div class="win" style="width: 430px; height: 270px">
            ${tabs(["Meeting"])}
            <div class="gr-body">${pane("Meeting prep")}${pane("Meeting notes")}</div>
          </div>
        </div>
        <div class="gr-item">
          <div class="gr-note">For a complex task, we might need many.</div>
          <div class="win" style="width: 430px; height: 270px">
            ${tabs(COMPLEX_TABS)}
            <div class="gr-body">
              ${pane("Launch plan")}
              <div class="col">${pane("Timeline")}${pane("Checklist")}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="caption">${GROUPING_CAPTION}</div>
    </div>
  `;

  return frameSlide(REDESIGN_CSS + SLIDE_CSS + GROUPING_CSS, view);
}

// ---------------------------------------------------------------- slide 5

const CHANNELS_CAPTION =
  "Channels are used to group one or more screens together. Like a channel in Slack, it is meant to represent a project, task, or context — permanent or ephemeral.";

// Channels come in all sizes: standing contexts stay pinned; one-off tasks
// come and go in recents.
const CH_PINNED = ["Today", "Research", "Q3 launch"];
const CH_RECENT = ["Meeting with Sam", "Fix login bug", "Trip to Lisbon", "Tax return", "Blog post draft"];
const CH_SCREENS = ["Morning", "Inbox", "Metrics", "Reading"];

const CHANNELS_CSS = /*css*/ `
  .ch-scene { display: flex; flex-direction: column; align-items: center; gap: 30px; margin-bottom: 40px; }
  .ch-head { font: 600 22px ui-sans-serif, system-ui, sans-serif; color: #222; text-align: center; }

  .ch-row { display: flex; align-items: center; gap: 14px; }
  .ch-callout { display: flex; align-items: center; gap: 8px; }
  .ch-callout .lbl { font: 600 15px ui-sans-serif, system-ui, sans-serif; color: #333; }
  .ch-arrow-r { width: 34px; height: 2px; background: #a8a8a8; position: relative; }
  .ch-arrow-r::after {
    content: "";
    position: absolute;
    right: -2px;
    top: 50%;
    transform: translateY(-50%);
    border-top: 6px solid transparent;
    border-bottom: 6px solid transparent;
    border-left: 9px solid #a8a8a8;
  }

  /* the channels window differs from the shared .win: white, a rail beside
     the main column (row layout), and slightly larger tabs/text */
  .ch-win {
    flex-direction: row;
    background: #fff;
    font-size: 13px;
    color: #333;
  }
  .ch-win .tabs { height: 42px; justify-content: flex-start; padding: 0 12px; }
  .ch-win .tab { font-size: 12px; padding: 4px 10px; color: #666; }
  .ch-win .tab.active { background: #fafafa; border-color: #bbb; color: #111; }
  .ch-rail {
    width: 164px;
    flex: none;
    border-right: 1px solid #ddd;
    background: #fafafa;
    display: flex;
    flex-direction: column;
    padding: 10px 8px;
    gap: 2px;
    overflow-y: auto;
  }
  .ch-sec {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #aaa;
    padding: 2px 9px;
  }
  .ch-sec + .ch-chan { margin-top: 2px; }
  .ch-rail .ch-sec:not(:first-child) { margin-top: 14px; }
  .ch-chan {
    padding: 6px 9px;
    border-radius: 4px;
    color: #555;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ch-chan.active { background: #ececec; color: #111; }

  .ch-main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: #f5f5f5; }
  .ch-body { flex: 1; min-height: 0; display: flex; gap: 12px; padding: 12px; }
  .ch-body > .pane { flex: 1; }
  .ch-body .col { gap: 12px; }
`;

export function channelsSlide(): HTMLIFrameElement {
  const chan = (name: string, i: number): TemplateResult =>
    html`<div class="ch-chan ${i === 0 ? "active" : ""}">${name}</div>`;

  const view = html`
    <div class="stage">
      <div class="ch-scene">
        <div class="ch-head">Introducing: Channels</div>

        <div class="ch-row">
          <div class="ch-callout"><span class="lbl">Channels</span><span class="ch-arrow-r"></span></div>
          <div class="win ch-win" style="width: 720px; height: 400px">
            <div class="ch-rail">
              <div class="ch-sec">Pinned</div>
              ${CH_PINNED.map(chan)}
              <div class="ch-sec">Recent</div>
              ${CH_RECENT.map((name) => chan(name, -1))}
            </div>
            <div class="ch-main">
              ${tabs(CH_SCREENS)}
              <div class="ch-body">
                ${pane("Calendar")}
                <div class="col">${pane("Tasks")}${pane("Daily plan")}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="caption">${CHANNELS_CAPTION}</div>
    </div>
  `;

  return frameSlide(REDESIGN_CSS + SLIDE_CSS + CHANNELS_CSS, view);
}

// ---------------------------------------------------------------- slide 6

const GROW_CAPTION =
  "Right now, Channels are simply organizational. But over time, they can accumulate context: like user interactions, archived artifacts, and chat history.";

// The kinds of context a channel accumulates, floating as icon chips.
const GROW_ITEMS: Array<{ label: string; icon: TemplateResult }> = [
  {
    label: "Screens",
    icon: html`<svg class="gw-icon" viewBox="0 0 24 24">
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="M13 5v14M4 12h9" />
    </svg>`,
  },
  {
    label: "Chat history",
    icon: html`<svg class="gw-icon" viewBox="0 0 24 24"><path d="M4 5.5h16v11H9l-5 4v-15z" /></svg>`,
  },
  {
    label: "User interactions",
    icon: html`<svg class="gw-icon" viewBox="0 0 24 24"><path d="M6 4l12 7-5.5 1.5L16 19l-2.5 1-3.4-6.4L6 17z" /></svg>`,
  },
  {
    label: "Archived artifacts",
    icon: html`<svg class="gw-icon" viewBox="0 0 24 24">
      <rect x="4" y="5" width="16" height="4" rx="1" />
      <path d="M6 9v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9M10 13h4" />
    </svg>`,
  },
  {
    label: "Memory",
    icon: html`<svg class="gw-icon" viewBox="0 0 24 24">
      <path d="M12 4a5 5 0 0 1 5 5c0 1.5-.6 2.6-1.4 3.6-.7.9-1.1 1.6-1.1 2.4v1H9.5v-1c0-.8-.4-1.5-1.1-2.4C7.6 11.6 7 10.5 7 9a5 5 0 0 1 5-5z" />
      <path d="M10 19h4" />
    </svg>`,
  },
];

const GROW_CSS = /*css*/ `
  .gw-head { font: 600 22px ui-sans-serif, system-ui, sans-serif; color: #222; text-align: center; margin-bottom: 56px; }

  .gw-float { display: flex; align-items: center; justify-content: center; gap: 24px; margin-bottom: 56px; }
  .gw-chip {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px 16px;
    border: 1px solid #d5d5d5;
    border-radius: 999px;
    background: #fff;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.06);
    font: 13px ui-sans-serif, system-ui, sans-serif;
    color: #444;
    white-space: nowrap;
  }
  /* loose, floating stagger */
  .gw-chip:nth-child(odd) { transform: translateY(-14px); }
  .gw-chip:nth-child(even) { transform: translateY(10px); }
  .gw-icon {
    width: 17px;
    height: 17px;
    flex: none;
    fill: none;
    stroke: #888;
    stroke-width: 1.6;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
`;

export function growSlide(): HTMLIFrameElement {
  const view = html`
    <div class="stage">
      <div class="gw-head">Channels are the home for all the context about your work</div>
      <div class="gw-float">
        ${GROW_ITEMS.map((item) => html`<div class="gw-chip">${item.icon}${item.label}</div>`)}
      </div>
      <div class="caption">${GROW_CAPTION}</div>
    </div>
  `;

  return frameSlide(REDESIGN_CSS + SLIDE_CSS + GROW_CSS, view);
}

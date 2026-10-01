// PROTOTYPE — the ribbon application rig, a copy of [[frames/lib/app.ts]]
// wired to the ribbon shell ([[frames/prototypes/ribbon/shell.frame]]). Two modes
// per channel:
//
// - The ribbon (default): every page at full strength, side by side.
//   Selecting a tab moves the strip as little as possible — not at all when
//   the page is already in view. A press on a visible neighbour selects it.
// - Focus mode: double-clicking a tab centres its page and recedes the
//   others — the shipped stage's look. Double-clicking the focused page's
//   tab leaves the mode; double-clicking another tab moves the focus there.
//
// Double-click therefore no longer toggles full-screen (the shipped stage's
// tab gesture); full-screen remains reachable by the corner-drag snap.

import shellFrame from "./shell.frame";
import appMeasures from "../../../specs/ui/app/measures.yml";
import stageMeasures from "../../../specs/ui/app/stage/measures.yml";
import { settleDocument } from "../../lib/foundation";
import { sidebarPrototype } from "../../lib/sidebar";
import { ribbonStagePrototype } from "./ribbon-stage";
import { SampleChannel } from "../../lib/app";

// The frame's `application.channels`. The shipped fixture carries at most
// two tabs per channel — too few to feel a sliding strip — so the ribbon
// stages fuller channels of the same shape.
const channels: SampleChannel[] = [
  { id: "television", name: "Television", pinned: true, tabs: [
    { id: "roadmap", name: "Roadmap", src: "/frames/app/example-artifact", width: 720, height: 520 },
    { id: "spec-review", name: "Spec review", src: "/frames/app/example-artifact", width: 640, height: 480 },
    { id: "release-notes", name: "Release notes", src: "/frames/app/example-artifact", width: 560, height: 560 },
    { id: "telemetry", name: "Telemetry", src: "/frames/app/example-artifact", width: 680, height: 440 },
    { id: "notes", name: "Notes", src: "/frames/app/example-artifact", width: 520, height: 500 },
  ] },
  { id: "agenda", name: "Agenda", pinned: true, tabs: [
    { id: "today", name: "Today", src: "/frames/app/example-artifact", width: 680, height: 500 },
    { id: "this-week", name: "This week", src: "/frames/app/example-artifact", width: 620, height: 520 },
    { id: "someday", name: "Someday", src: "/frames/app/example-artifact", width: 560, height: 440 },
  ] },
  { id: "weekend-recipes", name: "Weekend recipes", tabs: [
    { id: "shortlist", name: "Shortlist", src: "/frames/app/example-artifact", width: 600, height: 460 },
    { id: "pantry", name: "Pantry", src: "/frames/app/example-artifact", width: 560, height: 420 },
  ] },
  { id: "return-to-australia", name: "Return to Australia", tabs: [
    { id: "timeline", name: "Timeline", src: "/frames/app/example-artifact", width: 640, height: 480 },
  ] },
  { id: "daily-plan-flow", name: "Daily plan flow", tabs: [] },
];

export default { channels };

export interface RibbonAppState {
  channels: SampleChannel[];
  selected: string;
  /** The remembered selected tab per channel; absent means the first tab. */
  selectedTabs: Record<string, string>;
  /** The full-screen page per channel, when one is. */
  fullScreen: Record<string, string | undefined>;
  /** Whether a channel sits in focus mode (ribbon behavior only). */
  focus: Record<string, boolean>;
  /** The staged variant — the frame's behavior param, carried through
      state-driven re-renders. */
  behavior: string;
}

export const ribbonPrototype = (host: HTMLElement): (() => void) => {
  host.style.setProperty("--sidebar-width", `${appMeasures.sidebar.default_width_px}px`);

  const state: RibbonAppState = {
    channels,
    selected:
      channels.find((c) => c.name === host.querySelector('.channel[aria-selected="true"]')?.textContent?.trim())?.id
      ?? channels[0].id,
    selectedTabs: {},
    fullScreen: {},
    focus: {},
    behavior: host.querySelector<HTMLElement>(".stage")?.dataset.behavior ?? "ribbon",
  };

  const openChannel = () => state.channels.find((c) => c.id === state.selected);

  const selectedTab = () => {
    const channel = openChannel();
    if (!channel) return undefined;
    return state.selectedTabs[channel.id] ?? channel.tabs[0]?.id;
  };

  let disposeSidebar: (() => void) | null = null;
  let disposeStage: (() => void) | null = null;

  const stageEl = () => host.querySelector<HTMLElement>(".stage");
  const filmstripEl = () => host.querySelector<HTMLElement>(".filmstrip");
  const filmstripInnerEl = () => host.querySelector<HTMLElement>(".filmstrip-inner");

  const inFocusMode = () => state.focus[state.selected] === true;
  /** Fit rests with nothing selected: focus alone carries a selection. */
  const fitAtRest = () => state.behavior === "fit" && !inFocusMode();
  /** The zoomed rests where a press means jump in. */
  const zoomedRest = () =>
    (state.behavior === "overview" || state.behavior === "fit") && !inFocusMode();

  // A single press already jumps into focus from a zoomed rest, so the
  // second half of a double press must not read as the exit gesture.
  const FOCUS_SETTLE_MS = 400;
  let focusEnteredAt = 0;

  const enterFocus = (tabId: string) => {
    state.selectedTabs[state.selected] = tabId;
    state.focus[state.selected] = true;
    focusEnteredAt = performance.now();
    update();
  };

  const easeScroll = (scroller: HTMLElement, inner: HTMLElement, target: number) => {
    const delta = target - scroller.scrollLeft;
    scroller.scrollLeft = target;
    if (delta === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    inner.animate(
      [{ translate: `${delta}px 0` }, { translate: "0 0" }],
      { duration: stageMeasures.crossing.duration_ms, easing: "ease" },
    );
  };

  const pageInset = (): number => {
    const el = stageEl();
    const value = el ? parseFloat(getComputedStyle(el).getPropertyValue("--page-inset")) : NaN;
    if (!Number.isFinite(value)) throw new Error("Ribbon prototype requires the authored --page-inset");
    return value;
  };

  /** The centre target the shipped stage scrolls to. */
  const centreTarget = (strip: HTMLElement, page: HTMLElement) =>
    page.offsetLeft + page.offsetWidth / 2 - strip.clientWidth / 2;

  /** The ribbon's target: the current position when the page is fully in
      view, otherwise the nearest position that shows it whole. */
  const minimalTarget = (strip: HTMLElement, page: HTMLElement) => {
    const margin = pageInset();
    const left = page.offsetLeft;
    const right = left + page.offsetWidth;
    let target = strip.scrollLeft;
    if (right + margin > target + strip.clientWidth) target = right + margin - strip.clientWidth;
    if (left - margin < target) target = left - margin;
    return target;
  };

  const scrollToSelected = () => {
    const strip = filmstripEl();
    const inner = filmstripInnerEl();
    const page = host.querySelector<HTMLElement>(".page[selected]");
    const el = stageEl();
    if (!strip || !inner || !page || !el) return;
    const centring = el.hasAttribute("focus")
      || state.behavior === "centered" || state.behavior === "shipped";
    const target = centring ? centreTarget(strip, page) : minimalTarget(strip, page);
    easeScroll(strip, inner, target);
  };

  /** After leaving fit's focus there is no selection to follow, but the
      viewer's place is the page they just left: slide it into view. */
  const revealPage = (tabId: string | undefined) => {
    if (tabId === undefined) return;
    const tabs = openChannel()?.tabs ?? [];
    const index = tabs.findIndex((t) => t.id === tabId);
    const strip = filmstripEl();
    const inner = filmstripInnerEl();
    const page = [...host.querySelectorAll<HTMLElement>(".page")][index];
    if (index < 0 || !strip || !inner || !page) return;
    easeScroll(strip, inner, minimalTarget(strip, page));
  };

  const selectTabInPlace = (tabId: string) => {
    const tabs = openChannel()?.tabs ?? [];
    const index = tabs.findIndex((t) => t.id === tabId);
    if (index < 0) return;
    state.selectedTabs[state.selected] = tabId;

    const tabEls = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
    const pages = [...host.querySelectorAll<HTMLElement>(".page")];
    tabEls.forEach((el, i) => {
      el.setAttribute("aria-selected", i === index ? "true" : "false");
      el.setAttribute("tabindex", i === index ? "0" : "-1");
    });
    pages.forEach((el, i) => {
      if (i === index) el.setAttribute("selected", "");
      else el.removeAttribute("selected");
    });

    scrollToSelected();

    const strip = host.querySelector<HTMLElement>(".tab-strip");
    const tab = tabEls[index];
    if (strip && tab && strip.scrollWidth > strip.clientWidth) {
      const target = Math.max(0, Math.min(
        tab.offsetLeft + tab.offsetWidth / 2 - strip.clientWidth / 2,
        strip.scrollWidth - strip.clientWidth,
      ));
      strip.scrollTo({ left: target, behavior: "smooth" });
    }
  };

  const update = () => {
    disposeSidebar?.();
    disposeStage?.();
    host.setHTMLUnsafe(shellFrame.render(
      {
        channels: state.channels,
        selected: state.selected,
        // Fit's rest carries no selection at all — no lit tab, no selected
        // page; the remembered tab returns with focus.
        selected_tab: fitAtRest() ? undefined : selectedTab(),
        full_screen: state.fullScreen[state.selected],
        behavior: state.behavior,
        focus: state.focus[state.selected] === true,
        show_notice: true,
      },
      { serializableShadowRoots: true },
    ));
    disposeSidebar = sidebarPrototype(host, { selection: false });
    // settleDocument's filmstrip rest pose centres the selected page — the
    // shipped stance. It runs before the stage rig so the rig's own settle
    // (least motion, or the overview's whole row) lands last and holds.
    settleDocument();
    disposeStage = ribbonStagePrototype(host, {
      onResize: (index, width, height) => {
        const tab = openChannel()?.tabs[index];
        if (tab) {
          tab.width = Math.round(width);
          tab.height = Math.round(height);
        }
      },
      onFullScreen: (index, fullScreen) => {
        const tab = openChannel()?.tabs[index];
        if (tab) state.fullScreen[state.selected] = fullScreen ? tab.id : undefined;
      },
    });
  };

  update();

  const onClick = (e: Event) => {
    const channel = (e.target as HTMLElement).closest<HTMLElement>(".channel");
    if (channel && host.contains(channel)) {
      if ((e.target as HTMLElement).closest(".channel-menu-trigger, tv-menu")) return;
      const name = channel.textContent?.trim();
      const match = state.channels.find((c) => c.name === name);
      if (match && state.selected !== match.id) {
        state.selected = match.id;
        update();
      }
      return;
    }
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (tab && host.contains(tab)) {
      const name = tab.textContent?.trim();
      const match = openChannel()?.tabs.find((t) => t.name === name);
      if (!match) return;
      // At fit's rest a press only moves: the row slides to the page,
      // nothing selects, nothing focuses.
      if (fitAtRest()) revealPage(match.id);
      else if (selectedTab() !== match.id) selectTabInPlace(match.id);
      return;
    }
    // In the overview, pressing any tile zooms into it — the Mission
    // Control gesture. At fit's rest a press on a page, like on a tab,
    // only moves the row to it.
    if (zoomedRest()) {
      const tile = (e.target as HTMLElement).closest<HTMLElement>(".page");
      if (tile && host.contains(tile)) {
        const pages = [...host.querySelectorAll(".page")];
        const match = openChannel()?.tabs[pages.indexOf(tile)];
        if (!match) return;
        if (state.behavior === "overview") enterFocus(match.id);
        else revealPage(match.id);
        return;
      }
    }
    // Pressing a visible neighbour selects it — the one interaction it takes.
    // In focus mode receded pages take no pointer, so this is ribbon-only.
    const page = (e.target as HTMLElement).closest<HTMLElement>(".page:not([selected])");
    if (page && host.contains(page)) {
      const pages = [...host.querySelectorAll(".page")];
      const match = openChannel()?.tabs[pages.indexOf(page)];
      if (match) selectTabInPlace(match.id);
    }
  };
  document.addEventListener("click", onClick);

  // Double-clicking a tab toggles focus mode — the ribbon's reading of the
  // gesture; the centred variants read it as full-screen in the stage rig
  // ([[frames/prototypes/ribbon/ribbon-stage.ts]]). The attribute flips on the persistent
  // markup so the recede transitions carry the change; state remembers it so
  // the next state-driven render reproduces the same rest.
  const onDblClick = (e: Event) => {
    if (state.behavior === "centered" || state.behavior === "shipped") return;
    // At fit's rest, double-pressing a page focuses it — the single press
    // only moved the row there.
    if (fitAtRest()) {
      const tile = (e.target as HTMLElement).closest<HTMLElement>(".page");
      if (tile && host.contains(tile)) {
        const pages = [...host.querySelectorAll(".page")];
        const match = openChannel()?.tabs[pages.indexOf(tile)];
        if (match) enterFocus(match.id);
        return;
      }
    }
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (!tab || !host.contains(tab)) return;
    const el = stageEl();
    if (!el) return;
    const tabEls = [...host.querySelectorAll('[role="tab"]')];
    const match = openChannel()?.tabs[tabEls.indexOf(tab)];
    if (!match) return;
    const inFocus = el.hasAttribute("focus");
    if (inFocus && selectedTab() === match.id) {
      // A single press on this tab may have just jumped in; the second half
      // of that double press is not the exit gesture.
      if (performance.now() - focusEnteredAt < FOCUS_SETTLE_MS) return;
      const leaving = selectedTab();
      state.focus[state.selected] = false;
      if (state.behavior === "overview" || state.behavior === "fit") {
        // A zoomed rest's tile sizes come from the rig's formula, so
        // leaving focus re-renders back into it.
        update();
        if (state.behavior === "fit") revealPage(leaving);
      } else {
        // Leaving ribbon focus holds still: the page keeps its place while
        // the neighbours return around it.
        el.removeAttribute("focus");
      }
      return;
    }
    if (!inFocus && (state.behavior === "overview" || state.behavior === "fit")) {
      enterFocus(match.id);
      return;
    }
    const wasSelected = selectedTab();
    state.selectedTabs[state.selected] = match.id;
    state.focus[state.selected] = true;
    focusEnteredAt = performance.now();
    el.setAttribute("focus", "");
    if (wasSelected !== match.id) selectTabInPlace(match.id);
    else scrollToSelected();
  };
  document.addEventListener("dblclick", onDblClick);

  // Escape zooms back out of focus mode, in the ribbon and the zoomed rests.
  const onKeyDown = (e: Event) => {
    if ((e as KeyboardEvent).key !== "Escape") return;
    if (state.behavior === "centered" || state.behavior === "shipped") return;
    if (!inFocusMode()) return;
    const leaving = selectedTab();
    state.focus[state.selected] = false;
    if (state.behavior === "overview" || state.behavior === "fit") {
      update();
      if (state.behavior === "fit") revealPage(leaving);
    } else {
      stageEl()?.removeAttribute("focus");
    }
  };
  document.addEventListener("keydown", onKeyDown);

  return () => {
    document.removeEventListener("click", onClick);
    document.removeEventListener("dblclick", onDblClick);
    document.removeEventListener("keydown", onKeyDown);
    host.style.removeProperty("--sidebar-width");
    disposeSidebar?.();
    disposeStage?.();
  };
};

// The sample application state the workshop feeds through the app spec
// frame's params — staging fixture, never a conformance target. One flat
// channel list with a pinned mark, the shape the frames take directly.
// Channels carry their tabs already, so selection can drive a tab strip
// and artifact frames the moment the shell composes them.

export interface SampleTab {
  id: string;
  name: string;
  /** The page's document. */
  src: string;
  /** The size the page was left at ([[ui/app/stage/index.md]], Page sizing). */
  width: number;
  height: number;
}

export interface SampleChannel {
  id: string;
  name: string;
  pinned?: boolean;
  tabs: SampleTab[];
}

const channels: SampleChannel[] = [
  { id: "television", name: "Television", pinned: true, tabs: [{ id: "roadmap", name: "Roadmap", src: "/frames/app/example-artifact", width: 720, height: 520 }, { id: "spec-review", name: "Spec review", src: "/frames/app/example-artifact", width: 640, height: 480 }] },
  { id: "agenda", name: "Agenda", pinned: true, tabs: [{ id: "today", name: "Today", src: "/frames/app/example-artifact", width: 680, height: 500 }] },
  { id: "weekend-recipes", name: "Weekend recipes", tabs: [{ id: "shortlist", name: "Shortlist", src: "/frames/app/example-artifact", width: 600, height: 460 }, { id: "pantry", name: "Pantry", src: "/frames/app/example-artifact", width: 560, height: 420 }] },
  { id: "return-to-australia", name: "Return to Australia", tabs: [{ id: "timeline", name: "Timeline", src: "/frames/app/example-artifact", width: 640, height: 480 }] },
  { id: "daily-plan-flow", name: "Daily plan flow", tabs: [] },
];

export default { channels };

import appFrame from "../../specs/ui/app/app.frame";
import appMeasures from "../../specs/ui/app/measures.yml";
import stageMeasures from "../../specs/ui/app/stage/measures.yml";
import { settleDocument } from "./foundation";
import { sidebarPrototype } from "./sidebar";
import { stagePrototype } from "./stage";
import { sidebarTransition } from "./sidebar-transition";

export interface AppState {
  channels: SampleChannel[];
  selected: string;
  /** The remembered selected tab per channel; absent means the first tab. */
  selectedTabs: Record<string, string>;
  /** The full-screen page per channel, when one is. */
  fullScreen: Record<string, string | undefined>;
  /** The channel sidebar is collapsed; the navbar carries the lead group. */
  collapsed: boolean;
  /** The collapsed navbar's channel-switcher menu is posed open. */
  switcherOpen: boolean;
}

/**
 * The application prototype: selection is application state, so the shell
 * re-renders as its projection — the plumbing the stage will ride when the
 * shell composes tabs and artifact frames. The sidebar rig rides along for
 * gestures; its own content mutations (rename, delete, pin moves) stay
 * DOM-local staging and are reset by the next state-driven re-render.
 * Returns a disposer.
 */
export const appPrototype = (host: HTMLElement): (() => void) => {
  // The production client maintains --sidebar-width on the application root
  // ([[specs/ui/app/index.md]], Resizing the channel sidebar); in staging the
  // board plays the client, seeding the default from the authored measures.
  host.style.setProperty("--sidebar-width", `${appMeasures.sidebar.default_width_px}px`);

  const state: AppState = {
    channels,
    // Seed from the rendered pose so a posed board and the prototype agree.
    selected:
      channels.find((c) => c.name === host.querySelector('.channel[aria-selected="true"]')?.textContent?.trim())?.id
      ?? channels[0].id,
    selectedTabs: {},
    fullScreen: {},
    // Seeded from the pose like selection: a collapsed pose renders no sidebar.
    collapsed: host.querySelector(".app-sidebar") === null,
    switcherOpen: host.querySelector(".channel-switcher-pop") !== null,
  };

  const openChannel = () => state.channels.find((c) => c.id === state.selected);

  const selectedTab = () => {
    const channel = openChannel();
    if (!channel) return undefined;
    return state.selectedTabs[channel.id] ?? channel.tabs[0]?.id;
  };

  // The sidebar rig's listeners are document-delegated and survive re-renders,
  // but its resize handle is a DOM mutation the next render wipes — so the rig
  // is disposed and re-applied around every state-driven render.
  let disposeSidebar: (() => void) | null = null;
  let disposeMotion: (() => void) | null = null;
  let disposeStage: (() => void) | null = null;

  // Tab selection is a gesture the rig performs on the persistent markup —
  // real movement on surviving elements, not a re-render. The attribute
  // flips land exactly the state the frame renders for these params, so the
  // next state-driven render is a no-op repaint of the same rest. The
  // scroller eases home over the crossing duration on CSS's ease curve
  // ([[ui/app/stage/index.md]], Selection; [[ui/app/tab-strip/index.md]],
  // ^tb-selected-centres for the strip's own centring).
  const easeScroll = (scroller: HTMLElement, inner: HTMLElement, target: number) => {
    const delta = target - scroller.scrollLeft;
    scroller.scrollLeft = target;
    if (delta === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    inner.animate(
      [{ translate: `${delta}px 0` }, { translate: "0 0" }],
      { duration: stageMeasures.crossing.duration_ms, easing: "ease" },
    );
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

    const filmstrip = host.querySelector<HTMLElement>(".filmstrip");
    const filmstripInner = host.querySelector<HTMLElement>(".filmstrip-inner");
    const page = pages[index];
    if (filmstrip && filmstripInner && page) {
      easeScroll(
        filmstrip,
        filmstripInner,
        page.offsetLeft + page.offsetWidth / 2 - filmstrip.clientWidth / 2,
      );
    }
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
    disposeMotion?.();
    disposeSidebar?.();
    disposeStage?.();
    host.setHTMLUnsafe(appFrame.render(
      {
        channels: state.channels,
        selected: state.selected,
        selected_tab: selectedTab(),
        full_screen: state.fullScreen[state.selected],
        show_notice: true,
        collapsed: state.collapsed,
        sidebar_transition: true,
        switcher_open: state.switcherOpen,
      },
      { serializableShadowRoots: true },
    ));
    disposeSidebar = sidebarPrototype(host, { selection: false });
    disposeStage = stagePrototype(host, {
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
    disposeMotion = sidebarTransition(host, {
      collapsed: state.collapsed,
      onChange: (collapsed) => { state.collapsed = collapsed; },
    });
    // Position posed panels after the shell has reached its requested rest.
    settleDocument();
  };

  update();

  const onClick = (e: Event) => {
    const switcher = (e.target as HTMLElement).closest(".channel-switcher");
    // Shared panel wiring toggles existing panels. The frame omits a closed
    // switcher after selection, so opening it again needs a new composition.
    if (switcher && host.contains(switcher) && !host.querySelector(".channel-switcher-pop")) {
      state.switcherOpen = true;
      update();
      return;
    }
    state.switcherOpen = host.querySelector(".channel-switcher-pop[open]") !== null;
    const channel = (e.target as HTMLElement).closest<HTMLElement>(".channel");
    if (channel && host.contains(channel)) {
      if ((e.target as HTMLElement).closest(".channel-menu-trigger, tv-menu")) return;
      const name = channel.textContent?.trim();
      const match = state.channels.find((c) => c.name === name);
      const fromSwitcher = channel.closest(".channel-switcher-pop") !== null;
      if (match && (state.selected !== match.id || fromSwitcher)) {
        state.selected = match.id;
        if (fromSwitcher) state.switcherOpen = false;
        update();
        if (fromSwitcher) host.querySelector<HTMLButtonElement>(".channel-switcher")?.focus({ preventScroll: true });
      }
      return;
    }
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (tab && host.contains(tab)) {
      const name = tab.textContent?.trim();
      const match = openChannel()?.tabs.find((t) => t.name === name);
      if (match && selectedTab() !== match.id) selectTabInPlace(match.id);
      return;
    }
    // Pressing a background page selects it — the one interaction it takes
    // ([[ui/app/stage/index.md]], Filmstrip).
    const page = (e.target as HTMLElement).closest<HTMLElement>(".page:not([selected])");
    if (page && host.contains(page)) {
      const pages = [...host.querySelectorAll(".page")];
      const match = openChannel()?.tabs[pages.indexOf(page)];
      if (match) selectTabInPlace(match.id);
    }
  };
  document.addEventListener("click", onClick);

  return () => {
    document.removeEventListener("click", onClick);
    host.style.removeProperty("--sidebar-width");
    disposeMotion?.();
    disposeSidebar?.();
    disposeStage?.();
  };
};

// The App vehicle, shared by the App frame and its state boards: mounts the
// spec's app template into the frame's .window and wires the staging
// behaviours (selection, reorder, full-screen, the connection states). One
// module so every board stages the same app; the css rides along.
import "./app.css";
import "../../lib/foundation.ts";
import app from "../../../specs/ui/app/template.liquid";
import { CHANNELS, Selection, artifactsOf, nextCreated, pageName, pinned, unpinned } from "../../lib/state.ts";
import * as filmstrip from "../../lib/filmstrip.ts";
import { RULER_CSS, addTabRulers } from "../../lib/tab-ruler.ts";
import { DRAG_DISPLACEMENT_MS, DRAG_THRESHOLD_PX } from "../../lib/drag.ts";
import { DRAWBACK_DURATION_MS, DRAWBACK_SCALE, PAGE_INITIAL_HEIGHT_PX, PAGE_INITIAL_WIDTH_PX } from "../../lib/stage-measures.ts";
import { addPageHandles, cancelActiveResize, factorFor, installResize, pageBox, renderFloor } from "../../lib/resize.ts";
import { CREATE_NAME, collapseRow, growRow, prepareChannelRows, wirePinning, wireRenameField, wireScrollEdge } from "../../lib/sidebar.ts";
import { installTrafficLights } from "../../lib/traffic-lights.ts";
import deleteConfirm from "../../../specs/ui/app/artifact-frame/delete-confirm/delete-confirm.liquid";
import channelDeleteConfirm from "../../../specs/ui/app/sidebar/delete-confirm.liquid";
import sidebarTpl from "../../../specs/ui/app/sidebar/template.liquid";

document.head.insertAdjacentHTML("beforeend", `<style>${RULER_CSS}</style>`);

// The disconnected board's posed countdown (the `seconds` the spec's copy
// interpolates), and the reorder tripwire's tolerance — rounding and
// subpixel drift, not real movement.
const SAMPLE_RECONNECT_SECONDS = 3;
const GUARD_TOLERANCE_PX = 3;
// Transition cleanup waits out the displacement plus a settle margin.
const SETTLE_BUFFER_MS = 50;
// Window tracking counts as over once resize ticks stop arriving for this long.
const TRACKING_SETTLE_MS = 120;

export function mountApp(overrides = {}) {
  const window_ = document.querySelector(".window");
  installTrafficLights(window_);
  // The draw-back's measures, authored in the spec's yml, reach app.css as vars.
  document.documentElement.style.setProperty("--drawback-scale", String(DRAWBACK_SCALE));
  document.documentElement.style.setProperty("--drawback-duration", `${DRAWBACK_DURATION_MS}ms`);
  const selection = new Selection();

  // The app's connection state, posed: fixed by the mounting frame (the state
  // boards), or free — a viewer control, with ?state for direct routes.
  const params = new URLSearchParams(location.search);
  const states = ["connected", "connecting", "disconnected", "unauthorized", "error", "needs-upgrade", "no-channels"];
  const requestedState = params.get("state");
  let state = overrides.state ?? (states.includes(requestedState) ? requestedState : states[0]);
  let invalid = overrides.invalid ?? params.get("invalid") === "true";
  let seconds = overrides.secondsControl && params.get("now") === "true" ? null : SAMPLE_RECONNECT_SECONDS;
  if (!overrides.state) {
    // "no-channels" is a model pose over the connected app
    // ([[channels.md#^ch-delete-selection]]), not a connection state: the
    // world empties. A later URL pose reloads the sample module state.
    if (state === "no-channels") {
      CHANNELS.splice(0, CHANNELS.length);
      state = "connected";
    }
  } else if (overrides.secondsControl) {
    // The disconnected board's own knob: the countdown, or the in-flight
    // "Reattempting now…" moment (`seconds` absent).
  } else if (overrides.invalidControl) {
    // A fixed pose can still offer its own knobs — the unauthorized board
    // carries the rejected-token toggle.
  }

  let renamingChannel = null;
  let madeChannels = 0;
  const mark = (channel) => ({ id: channel.id, name: channel.name, selected: channel === selection.channel, renaming: channel === renamingChannel });

  // Renaming repaints the sidebar alone — a full renderApp reloads every
  // artifact, and a name edit must not disturb the stage. Still a spec
  // render: the sidebar template, fresh each paint.
  // The rename field's wiring is the shared module's; this binds it to the
  // App's renaming mark and sidebar-only repaint.
  const wireRename = () => {
    wireRenameField(appEl.querySelector(".app-sidebar"), renamingChannel, () => {
      renamingChannel = null;
      repaintSidebar();
    });
  };

  const repaintSidebar = () => {
    const sidebarEl = appEl.querySelector(".app-sidebar");
    // The repaint replaces the scrolling region; the reader's place
    // survives the redraw.
    const scrolled = sidebarEl.querySelector(".sidebar-body")?.scrollTop ?? 0;
    sidebarEl.innerHTML = sidebarTpl({ pinned: pinned().map(mark), unpinned: unpinned().map(mark) }).markup;
    prepareChannelRows(sidebarEl);
    if (scrolled) sidebarEl.querySelector(".sidebar-body").scrollTop = scrolled;
    wireRename();
  };

  const stageArgs = () => {
    const channel = selection.channel;
    return {
      tabs: channel.pages.map((pg, i) => ({ name: pageName(pg), selected: i === selection.shown })),
      pages: channel.pages.map((pg, i) => {
        const lead = artifactsOf(pg.content)[0];
        return { id: lead.id, src: lead.src, name: pageName(pg), selected: i === selection.shown, full_screen: pg.full_screen };
      }),
    };
  };

  // Staging content: an update is applying, so the bell shows with a sample
  // notice. Absent a notice, the bell is absent too.
  const NOTICE = {
    body: "<h3>Television 0.2 is available</h3><p>New stage, new tabs, and a faster start. Upgrade when convenient.</p>",
    prompt: "Upgrade Television following https://television.run/install.md",
    copied: false,
  };

  let appEl = null;
  // The window-tracking observer and its settle timer, one generation per
  // render (see the render block).
  let trackingObserver = null;
  let trackingSettle = 0;
  // Styles inject as they are first collected — a later state's render can
  // bring sheets the first render's composition never touched (the system
  // modal's, absent while connected).
  const injectedStyles = new Set();

  const strip = () => appEl.querySelector(".filmstrip");
  const showPage = (index, instant = false) => {
    if (strip()) filmstrip.showPage(strip(), index, instant);
  };

  // Selected-tab centring ([[ui/app/stage/tab-strip/index.md#^tb-selected-centres]]):
  // the tab scrolls toward the band's centre over the stage's crossing, so
  // the tab and its page cross together.
  const centreTab = (instant = false) => {
    const stripBar = appEl.querySelector(".top-bar .tab-strip");
    if (stripBar) filmstrip.showPage(stripBar, selection.shown, instant, ".tab");
  };

  const syncTabs = (shown) => {
    [...appEl.querySelectorAll(".top-bar .tab")].forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === shown));
      tab.setAttribute("tabindex", i === shown ? "0" : "-1");
    });
    [...appEl.querySelectorAll(".page")].forEach((pageEl, i) => {
      pageEl.toggleAttribute("selected", i === shown);
    });
  };

  const selectPage = (shown) => {
    selection.showScreen(shown);
    showPage(shown);
    syncTabs(shown);
    centreTab();
  };

  // Full-screen is a mode over the page's size ([[ui/app/stage/index.md]], Page sizing);
  // the size waits beneath it and is what leaving returns to.
  const goFull = (pg) => {
    pg.full_screen = true;
  };
  const backFromFull = (pg) => {
    pg.full_screen = false;
  };

  // The template renders the page-state attribute; interaction updates that
  // same authored branch in place so the live artifact document stays
  // mounted through the size morph.
  //
  // A page's size is its own state ([[ui/app/stage/index.md]], Page sizing) rather than
  // anything the sheet authors, so this vehicle applies it: the authored
  // initial size until a resize gesture is staged. Full-screen is a mode over
  // that size, and the sheet draws it, so the inline size comes off while the
  // mode holds and returns underneath when it is left.
  const syncPageModes = () => {
    // One shared, damped factor from the current page box: every page
    // renders its stored reference-pixel size through it, so all frames
    // resize at the same rate when the stage changes.
    const stripEl = strip();
    const box = stripEl ? pageBox(stripEl) : null;
    const f = box ? factorFor(box) : { w: 1, h: 1 };
    // The rendered floor holds on every paint, not only during a drag: the
    // artifact minimum, the box winning below it ([[ui/app/stage/index.md]],
    // Bounds). The ceiling stays the sheet's max-width/height.
    const floor = box ? renderFloor(box) : { w: 0, h: 0 };
    [...appEl.querySelectorAll(".page")].forEach((pageEl, i) => {
      const pg = selection.channel.pages[i];
      const full = Boolean(pg?.full_screen);
      pageEl.style.width = full ? "" : `${Math.max(floor.w, (pg?.size?.w ?? PAGE_INITIAL_WIDTH_PX) * f.w)}px`;
      pageEl.style.height = full ? "" : `${Math.max(floor.h, (pg?.size?.h ?? PAGE_INITIAL_HEIGHT_PX) * f.h)}px`;
      pageEl.toggleAttribute("full-screen", full);
    });
  };

  // A channel change re-renders the app from the spec's template — its
  // artifacts load afresh, the accepted cost of channel motion being out of
  // scope. Within a channel nothing re-renders: selection only scrolls, so
  // page documents keep their state.
  const renderApp = () => {
    // Hidden states render no shell: nothing behind while connecting or
    // gated. The gate's body below is obviously-sample copy posing the
    // state's shape — deliberately NOT the spec's fallback instructions
    // (staging never restates spec-authored values).
    const hidden = state === "connecting" || state === "unauthorized" || state === "error" || state === "needs-upgrade";
    // With no channels at all the stage carries the no-channels state
    // ([[channels.md#^ch-delete-selection]]); the sidebar renders its
    // chrome with no groups.
    const noChannel = CHANNELS.length === 0;
    const settingsArgs = overrides.settings
      ? {
          display: {
            activeThemeName: overrides.settings.activeThemeName ?? null,
            appearanceMode: overrides.settings.appearanceMode ?? "system",
          },
          themes: overrides.settings.themes ?? [],
          theme_errors: overrides.settings.errors ?? [],
          themes_loading: overrides.settings.loading ?? false,
          settings_failure: overrides.settings.failure,
        }
      : {};
    const shellArgs = hidden
      ? { pinned: [], unpinned: [], tabs: [], pages: [], ...settingsArgs }
      : noChannel
        ? { pinned: [], unpinned: [], tabs: [], pages: [], no_channel: true, notice: NOTICE, ...settingsArgs }
        : { pinned: pinned().map(mark), unpinned: unpinned().map(mark), notice: NOTICE, ...stageArgs(), ...settingsArgs };
    const UPGRADE_BODY = `<h1>Sample upgrade instructions</h1>
<p>Staging poses the gate with sample copy; the real body arrives from the update channel or the spec's fallback markdown.</p>
<pre><code>sample-upgrade-command --for-staging</code></pre>
<p>A second paragraph, so the panel's rhythm with mixed prose and commands can be judged:</p>
<pre><code>sample-relaunch-command</code></pre>`;
    const rendered = app({
      ...shellArgs,
      state,
      seconds: seconds ?? undefined,
      invalid,
      server_url: state === "error" ? "https://example.com:7788" : undefined,
      message: state === "error" ? "Failed to fetch" : undefined,
      upgrade_instructions: state === "needs-upgrade" ? UPGRADE_BODY : undefined,
    });
    for (const css of rendered.styles) {
      if (injectedStyles.has(css)) continue;
      injectedStyles.add(css);
      document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
    }
    appEl?.remove();
    window_.insertAdjacentHTML("beforeend", rendered.markup);
    appEl = window_.lastElementChild;
    // Hidden states render no shell — there is nothing to wire, and the
    // filmstrip queries below would throw on null.
    if (hidden) return;
    prepareChannelRows(appEl.querySelector(".app-sidebar"));
    // With no channels there is no stage to wire — the sidebar wiring
    // below still runs, so the create affordance leads out.
    if (!noChannel) {
      addTabRulers(appEl);
      // The size a page is drawn at is state, not styling, so every render
      // applies it — a fresh render has none until this runs. The handles ride
      // each page's boundary; the css shows only the selected page's.
      syncPageModes();
      addPageHandles(appEl);
      // A fresh render poses the remembered selection rather than changing
      // it, so its tab centres without motion.
      centreTab(true);
      // The template's inner wrapper lets draw-back scale the strip content
      // inside its clip; scaling the scroll container would scale the clip.
      // A fresh render already carries its ordinary/full-screen attributes,
      // so no size transition runs on channel entry. A stage change moves
      // every page through the shared factor: window tracking, not a state
      // change, so the page transition is suppressed while it runs.
      showPage(selection.shown, true);
      // One observer generation per render: the previous render's observer
      // and pending settle timer come down with its DOM, so a stale timer
      // never strips the class from under a live resize.
      trackingObserver?.disconnect();
      clearTimeout(trackingSettle);
      trackingObserver = new ResizeObserver(() => {
        // A page-box change cancels a live resize drag ([[ui/app/stage/
        // index.md]], The gesture) before pages re-render through the factor.
        cancelActiveResize();
        document.body.classList.add("window-tracking");
        syncPageModes();
        showPage(selection.shown, true);
        centreTab(true);
        clearTimeout(trackingSettle);
        trackingSettle = setTimeout(() => document.body.classList.remove("window-tracking"), TRACKING_SETTLE_MS);
      });
      trackingObserver.observe(appEl.querySelector(".filmstrip"));

      // The reorder vehicle ([[ui/app/stage/index.md]], Reordering).
      // A press arms; release without a drag selects (selection is on
      // release, so a drag can carry any tab, the selected one included, and
      // carrying never selects). Past the press threshold the tab itself
      // leaves the flow
      // and follows the pointer wherever it goes, the template's placeholder
      // holding its slot in the band. Crossing a neighbour's centre swaps
      // them — the neighbour slides over on drag.yml's displacement duration,
      // and the pages swap in the
      // same motion: the selected page keeps the foreground (the sheet's rule)
      // and holds its painted place (the scroll re-centres under it),
      // whichever role it has. Release drops the tab onto the placeholder — the slot is
      // already its, so nothing else moves.
      appEl.querySelector(".top-bar .tab-strip").addEventListener("pointerdown", (event) => {
        const tab = event.target.closest(".tab");
        if (!tab) return;

        const stripBar = tab.parentElement;
        const startX = event.clientX;
        const startY = event.clientY;
        let placeholder = null;
        let baseLeft = 0;
        let baseTop = 0;
        let slot = 0;
        let draggedPageEl = null;
        let originalPages = null;
        let originalPageEls = null;
        const originalTabs = [...stripBar.querySelectorAll(".tab")];
        const originallySelectedPage = selection.channel.pages[selection.shown];

        // Paint an element's travel from where it was to where the DOM now
        // puts it, on the reorder's displacement duration.
        // The invariant, enforced ([[ui/app/stage/index.md]],
        // Reordering): while the drag holds, no page's layout bounds change
        // and the selected page stays centred — dragged or crossed. A
        // violation is a staging bug; it screams rather than hides.
        let guardLoop = null;
        const startGuard = () => {
          // Per element, not per slot: swaps reorder the DOM, and the claim
          // binds each page's bounds, not the strip's ordering.
          const boundsAt = new Map(
            [...appEl.querySelectorAll(".page")].map((el) => [el, `${el.offsetWidth}x${el.offsetHeight}`]),
          );
          let reported = false;
          let badFrames = 0;
          const step = () => {
            if (!placeholder) return;
            const changed = [...boundsAt].filter(([el, b]) => `${el.offsetWidth}x${el.offsetHeight}` !== b);
            const b = appEl.querySelector(".page[selected]").getBoundingClientRect();
            const sr = strip().getBoundingClientRect();
            const off = b.left + b.width / 2 - (sr.left + sr.width / 2);
            // Two consecutive bad frames: a real violation persists, while a
            // mid-morph race settles on the very next frame.
            badFrames = changed.length || Math.abs(off) > GUARD_TOLERANCE_PX ? badFrames + 1 : 0;
            if (!reported && badFrames >= 2) {
              reported = true;
              console.error("reorder invariant violated:", {
                changed: changed.map(([el, b]) => `${b} -> ${el.offsetWidth}x${el.offsetHeight}`),
                offCentre: Math.round(off),
              });
            }
            guardLoop = requestAnimationFrame(step);
          };
          guardLoop = requestAnimationFrame(step);
        };

        const slide = (el, from) => {
          const parent = el.parentElement;
          const factor = parent.getBoundingClientRect().width / parent.clientWidth || 1;
          const dx = (from.left - el.getBoundingClientRect().left) / factor;
          if (!dx) return;
          el.style.transition = "none";
          el.style.translate = `${dx}px 0`;
          requestAnimationFrame(() => {
            el.style.transition = `translate ${DRAG_DISPLACEMENT_MS}ms ease`;
            el.style.translate = "0px 0";
            setTimeout(() => { el.style.transition = ""; el.style.translate = ""; }, DRAG_DISPLACEMENT_MS + SETTLE_BUFFER_MS);
          });
        };

        const begin = () => {
          // Capture only once the drag is real: capturing from the press
          // would retarget the click pair to the strip and eat double-clicks.
          // On the strip, not the tab — the carried tab is reparented, and
          // moving a capturing element releases its capture.
          stripBar.setPointerCapture(event.pointerId);
          const r = tab.getBoundingClientRect();
          originalPages = [...selection.channel.pages];
          originalPageEls = [...appEl.querySelectorAll(".page")];
          baseLeft = r.left;
          baseTop = r.top;
          slot = [...appEl.querySelectorAll(".top-bar .tab")].indexOf(tab);
          draggedPageEl = appEl.querySelectorAll(".page")[slot];
          placeholder = document.createElement("span");
          placeholder.className = "tab-placeholder";
          placeholder.setAttribute("aria-hidden", "true");
          placeholder.style.width = `${r.width}px`;
          placeholder.style.height = `${r.height}px`;
          stripBar.insertBefore(placeholder, tab);
          document.body.classList.add("tab-held");
          filmstrip.recentreThrough(strip(), () => selection.shown);
          startGuard();
          // The carried tab escapes the band's clipping (its overflow and
          // fade mask): lifted to the app root, fixed at the pointer. Its
          // selectedness rides the element, so nothing needs re-marking.
          tab.setAttribute("dragged", "");
          tab.style.position = "fixed";
          tab.style.width = `${r.width}px`;
          tab.style.left = `${baseLeft}px`;
          tab.style.top = `${baseTop}px`;
          appEl.append(tab);
        };

        // One swap with the neighbour on side dir (-1 left, +1 right): the
        // neighbour tab slides over; the model swaps; the dragged page and
        // the displaced page trade slots, both animating — and whichever of
        // them is the selected page ends up painted exactly where it was,
        // because the recentre holds it and its slide collapses to nothing.
        const swap = (dir) => {
          const neighbour = dir < 0 ? placeholder.previousElementSibling : placeholder.nextElementSibling;
          if (!neighbour?.classList.contains("tab")) return false;
          const nFrom = neighbour.getBoundingClientRect();
          if (dir < 0) stripBar.insertBefore(neighbour, placeholder.nextSibling);
          else stripBar.insertBefore(neighbour, placeholder);
          slide(neighbour, nFrom);

          const other = slot + dir;
          const pages = selection.channel.pages;
          [pages[slot], pages[other]] = [pages[other], pages[slot]];
          const pageEls = [...appEl.querySelectorAll(".page")];
          const displaced = pageEls[other];
          const dFrom = displaced.getBoundingClientRect();
          const gFrom = draggedPageEl.getBoundingClientRect();
          const roll = draggedPageEl.parentElement;
          // moveBefore, not insertBefore: an insert re-inserts the page's
          // iframe and reloads the artifact; the atomic move keeps its state.
          const ref = dir < 0 ? draggedPageEl.nextSibling : draggedPageEl;
          if (roll.moveBefore) roll.moveBefore(displaced, ref);
          else roll.insertBefore(displaced, ref);
          const shown = selection.shown === slot ? other : selection.shown === other ? slot : selection.shown;
          selection.showScreen(shown);
          showPage(shown, true);
          slide(displaced, dFrom);
          slide(draggedPageEl, gFrom);
          slot = other;
          return true;
        };

        const move = (ev) => {
          if (ev.pointerId !== event.pointerId) return;
          if (!placeholder) {
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
            begin();
          }
          tab.style.left = `${baseLeft + (ev.clientX - startX)}px`;
          tab.style.top = `${baseTop + (ev.clientY - startY)}px`;
          const r = tab.getBoundingClientRect();
          const centre = r.left + r.width / 2;
          for (;;) {
            const prev = placeholder.previousElementSibling;
            if (prev?.classList.contains("tab")) {
              const pr = prev.getBoundingClientRect();
              if (centre < pr.left + pr.width / 2 && swap(-1)) continue;
            }
            const next = placeholder.nextElementSibling;
            if (next?.classList.contains("tab")) {
              const nr = next.getBoundingClientRect();
              if (centre > nr.left + nr.width / 2 && swap(1)) continue;
            }
            break;
          }
        };
        let finishing = false;
        const cleanup = () => {
          cancelAnimationFrame(guardLoop);
          stripBar.removeEventListener("pointermove", move);
          stripBar.removeEventListener("pointerup", onPointerUp);
          stripBar.removeEventListener("pointercancel", onPointerCancel);
          stripBar.removeEventListener("lostpointercapture", onLostCapture);
          window.removeEventListener("keydown", onKeydown);
        };
        const finish = (commit) => {
          if (finishing) return;
          finishing = true;
          cleanup();
          if (!placeholder) {
            // Only ordinary release selects an armed press. Cancellation of
            // a press that never lifted is inert.
            if (commit) selectPage([...appEl.querySelectorAll(".top-bar .tab")].indexOf(tab));
            return;
          }
          tab.removeAttribute("dragged");
          tab.style.position = tab.style.left = tab.style.top = tab.style.width = "";
          if (commit) {
            stripBar.insertBefore(tab, placeholder);
            placeholder.remove();
          } else {
            placeholder.remove();
            for (const originalTab of originalTabs) {
              originalTab.style.transition = originalTab.style.translate = "";
              stripBar.append(originalTab);
            }
            selection.channel.pages.splice(0, selection.channel.pages.length, ...originalPages);
            const roll = originalPageEls[0]?.parentElement;
            for (const pageEl of originalPageEls) {
              pageEl.style.transition = pageEl.style.translate = "";
              if (roll?.moveBefore) roll.moveBefore(pageEl, null);
              else roll?.append(pageEl);
            }
            selection.showScreen(originalPages.indexOf(originallySelectedPage));
            showPage(selection.shown, true);
          }
          placeholder = null;
          draggedPageEl = null;
          document.body.classList.remove("tab-held");
          filmstrip.recentreThrough(strip(), () => selection.shown);
          if (!commit && stripBar.hasPointerCapture(event.pointerId)) {
            stripBar.releasePointerCapture(event.pointerId);
          }
        };
        const onPointerUp = (ev) => {
          if (ev.pointerId === event.pointerId) finish(true);
        };
        const onPointerCancel = (ev) => {
          if (ev.pointerId === event.pointerId) finish(false);
        };
        const onLostCapture = (ev) => {
          if (ev.pointerId === event.pointerId && !finishing) finish(false);
        };
        const onKeydown = (ev) => {
          if (ev.key === "Escape" && placeholder) {
            ev.preventDefault();
            finish(false);
          }
        };
        stripBar.addEventListener("pointermove", move);
        stripBar.addEventListener("pointerup", onPointerUp);
        stripBar.addEventListener("pointercancel", onPointerCancel);
        stripBar.addEventListener("lostpointercapture", onLostCapture);
        window.addEventListener("keydown", onKeydown);
      });
      // Double-clicking a tab toggles its page's full-screen state. A live
      // resize ends first — cancelled, so entering the mode preserves the
      // settled size rather than one the drag had reached ([[ui/app/stage/
      // index.md]], The size).
      appEl.querySelector(".top-bar .tab-strip").addEventListener("dblclick", (event) => {
        const tab = event.target.closest(".tab");
        if (!tab) return;
        cancelActiveResize();
        // A state change morphs even inside the tracking settle window: the
        // suppression is for window tracking alone.
        clearTimeout(trackingSettle);
        document.body.classList.remove("window-tracking");
        const pg = selection.channel.pages[[...appEl.querySelectorAll(".top-bar .tab")].indexOf(tab)];
        if (pg.full_screen) {
          backFromFull(pg);
        } else {
          goFull(pg);
        }
        syncPageModes();
        filmstrip.recentreThrough(strip(), selection.shown);
      });
      // The frame menu's one action ([[ui/app/artifact-frame/index.md]]):
      // Delete, which confirms before it acts — the dialog's alert, focus
      // resting on Cancel, the destructive action never the default.
      appEl.querySelector(".filmstrip").addEventListener("click", (event) => {
        const item = event.target.closest(".menu .menu-item");
        const label = item?.textContent.trim();
        if (label !== "Delete") return;
        item.closest(".menu").hidePopover();
        const pageEl = item.closest(".page");
        const idx = [...appEl.querySelectorAll(".page")].indexOf(pageEl);
        const pg = selection.channel.pages[idx];
        const rendered = deleteConfirm({ title: pageName(pg) });
        for (const css of rendered.styles) {
          if (injectedStyles.has(css)) continue;
          injectedStyles.add(css);
          document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
        }
        document.body.insertAdjacentHTML("beforeend", rendered.markup);
        const confirmOverlay = document.body.lastElementChild;
        const [cancelBtn, deleteBtn] = confirmOverlay.querySelectorAll(".dialog-actions button");
        cancelBtn.focus();
        cancelBtn.addEventListener("click", () => confirmOverlay.remove());
        deleteBtn.addEventListener("click", () => {
          confirmOverlay.remove();
          selection.channel.pages.splice(idx, 1);
          selection.showScreen(Math.max(0, Math.min(selection.shown, selection.channel.pages.length - 1)));
          renderApp();
        });
      });
      // Pressing a background page selects it — its artifact is inert (the
      // spec's styling), so the press lands on the page itself.
      appEl.querySelector(".filmstrip").addEventListener("pointerdown", (event) => {
        const pageEl = event.target.closest(".page");
        if (!pageEl || pageEl.hasAttribute("selected")) return;
        selectPage([...appEl.querySelectorAll(".page")].indexOf(pageEl));
      });
      // The channel menu's Delete ([[ui/app/sidebar/index.md]]): confirms
      // with the dialog's alert; deleting the selected channel moves
      // selection to the first pinned channel, or the first there is.
      appEl.querySelector(".app-sidebar").addEventListener("click", (event) => {
        const item = event.target.closest(".menu .menu-item");
        if (!item || item.textContent.trim() !== "Delete") return;
        item.closest(".menu").hidePopover();
        const rowEl = item.closest(".channel-row");
        const order = [...pinned(), ...unpinned()];
        const rows = [...appEl.querySelectorAll(".channel-row")];
        const channel = order[rows.indexOf(rowEl)];
        const rendered = channelDeleteConfirm({ name: channel.name });
        for (const css of rendered.styles) {
          if (injectedStyles.has(css)) continue;
          injectedStyles.add(css);
          document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
        }
        document.body.insertAdjacentHTML("beforeend", rendered.markup);
        const confirmOverlay = document.body.lastElementChild;
        const [cancelBtn, deleteBtn] = confirmOverlay.querySelectorAll(".dialog-actions button");
        cancelBtn.focus();
        cancelBtn.addEventListener("click", () => confirmOverlay.remove());
        deleteBtn.addEventListener("click", async () => {
          confirmOverlay.remove();
          // The row shrinks away before the model changes ([[ui/app/sidebar/index.md]], Deleting).
          const rowEl = [...appEl.querySelectorAll(".channel-row")]
            .find((row) => row.dataset.channelId === channel.id);
          if (rowEl) await collapseRow(rowEl);
          const wasSelected = channel === selection.channel;
          CHANNELS.splice(CHANNELS.indexOf(channel), 1);
          // Deleting the last channel lands on the no-channels state
          // ([[channels.md#^ch-delete-selection]]).
          if (wasSelected && CHANNELS.length > 0) {
            const next = CHANNELS.find((c) => c.pinned) ?? CHANNELS[0];
            selection.selectChannel(Math.max(0, CHANNELS.indexOf(next)));
          }
          renderApp();
        });
      });
    }

    // Creating ([[ui/app/sidebar/index.md]], Creating): the newest channel,
    // born "New channel", selected, renaming in place. unshift puts it at
    // index 0, so selectChannel(0) points at it whatever was selected before.
    appEl.querySelector(".app-sidebar").addEventListener("click", (event) => {
      if (!event.target.closest(".channel-create")) return;
      const channel = { id: `made-${++madeChannels}`, name: CREATE_NAME, created: nextCreated(), pages: [] };
      CHANNELS.unshift(channel);
      selection.selectChannel(0);
      renderApp();
      // Grown plainly first; the rename field takes the seat when the
      // growth lands (a field mid-grow flickers its selection highlight).
      const rowEl = [...appEl.querySelectorAll(".channel-row")]
        .find((row) => row.dataset.channelId === channel.id) ?? null;
      growRow(rowEl).then(() => {
        renamingChannel = channel;
        repaintSidebar();
      });
    });
    // The channel menu's Rename ([[ui/app/sidebar/index.md]], Renaming):
    // the row re-renders with the field in the channel's seat.
    appEl.querySelector(".app-sidebar").addEventListener("click", (event) => {
      const item = event.target.closest(".menu .menu-item");
      if (!item || item.textContent.trim() !== "Rename") return;
      item.closest(".menu").hidePopover();
      const order = [...pinned(), ...unpinned()];
      const rows = [...appEl.querySelectorAll(".channel-row")];
      renamingChannel = order[rows.indexOf(item.closest(".channel-row"))];
      repaintSidebar();
    });
    // Pinning and drag ([[ui/app/sidebar/index.md]], Pinning and
    // reordering): the shared module, repainting the sidebar alone — the
    // stage must not reload over a rearrangement. The commit is bracketed
    // to re-point the index-based selection across the array rebuild.
    wireScrollEdge(appEl.querySelector(".app-sidebar"));
    wirePinning(appEl.querySelector(".app-sidebar"), {
      repaint: repaintSidebar,
      aroundCommit: (commit) => {
        const keep = selection.channel;
        commit();
        selection.selectChannel(CHANNELS.indexOf(keep));
      },
    });
    // Selection on release without movement ([[ui/app/sidebar/index.md]],
    // Interaction). Rows index by .channel-row: while one renames, its
    // .channel button is absent and a .channel list would misalign. The
    // index is taken at press, before the rename commit's repaint.
    let pressedChannel = null;
    appEl.querySelector(".app-sidebar").addEventListener("pointerdown", (event) => {
      const row = event.target.closest(".channel");
      if (!row) return;
      const order = [...pinned(), ...unpinned()];
      const rows = [...appEl.querySelectorAll(".channel-row")];
      pressedChannel = { index: CHANNELS.indexOf(order[rows.indexOf(row.closest(".channel-row"))]), x: event.clientX, y: event.clientY };
      appEl.querySelector(".channel-rename")?.blur();
    });
    appEl.querySelector(".app-sidebar").addEventListener("pointerup", (event) => {
      if (!pressedChannel) return;
      const { index, x, y } = pressedChannel;
      pressedChannel = null;
      if (Math.hypot(event.clientX - x, event.clientY - y) > DRAG_THRESHOLD_PX) return;
      if (selection.selectChannel(index) !== 0) renderApp();
    });
  };

  renderApp();
  if (overrides.settings) {
    appEl.querySelector(".settings-popover")?.showPopover();
  }

  // The resize drag, wired once for the document: it reads the live channel
  // each gesture, and re-centres as the size changes, since the selected page
  // holds the centre throughout ([[ui/app/stage/index.md]], Page sizing).
  installResize({
    stage: () => appEl.querySelector(".stage"),
    pages: () => selection.channel.pages,
    shown: () => selection.shown,
    apply: () => {
      syncPageModes();
      showPage(selection.shown, true);
    },
  });

  // Staging only: Option with the arrows moves along both axes — sideways
  // between pages, up and down between channels. The spec records the intent
  // and no mechanism yet ([[ui/app/stage/index.md]]); this is that intent,
  // wired so the movement can be felt.
  document.addEventListener("keydown", (event) => {
    if (!event.altKey || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      if (selection.selectChannel(selection.channelIndex + step) !== 0) renderApp();
    } else {
      const target = selection.shown + (event.key === "ArrowRight" ? 1 : -1);
      if (target < 0 || target >= selection.channel.pages.length) return;
      selectPage(target);
    }
  });
}

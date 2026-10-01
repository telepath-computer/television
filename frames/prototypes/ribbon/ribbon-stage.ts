// PROTOTYPE — the ribbon stage rig, a copy of [[frames/lib/stage.ts]] with the
// scrolling policy split by mode. In the ribbon (default) the viewport moves
// as little as possible: selection scrolls only when the selected page is not
// fully in view, resizing never scrolls, and the wheel pans the strip freely.
// In focus mode (the stage's `focus` attribute) the shipped behavior holds:
// the selected page stays centred. Double-click moved to the app rig
// ([[frames/prototypes/ribbon/ribbon.ts]]) — it toggles focus mode there, not full-screen.

import artifactMeasures from "../../../specs/ui/app/artifact-frame/measures.yml";
import stageMeasures from "../../../specs/ui/app/stage/measures.yml";

export interface RibbonStagePrototypeOptions {
  /** A drag settled: the page's new authored (reference-box) size. */
  onResize?: (pageIndex: number, width: number, height: number) => void;
  /** Full-screen entered or left for a page (corner-snap only, here). */
  onFullScreen?: (pageIndex: number, fullScreen: boolean) => void;
}

interface Zone {
  left: -1 | 0 | 1;
  top: -1 | 0 | 1;
  cursor: string;
}

export const ribbonStagePrototype = (
  host: HTMLElement,
  options: RibbonStagePrototypeOptions = {},
): (() => void) => {
  const removers: (() => void)[] = [];
  const on = <K extends keyof DocumentEventMap>(
    target: EventTarget,
    type: K | string,
    handler: (e: Event) => void,
    opts?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type as string, handler, opts);
    removers.push(() => target.removeEventListener(type as string, handler, opts));
  };

  const stage = () => host.querySelector<HTMLElement>(".stage");
  const filmstrip = () => host.querySelector<HTMLElement>(".filmstrip");
  const pages = () => [...host.querySelectorAll<HTMLElement>(".page")];
  const selectedPage = () => host.querySelector<HTMLElement>(".page[selected]");
  const focusMode = () => stage()?.hasAttribute("focus") ?? false;
  /** The staged variant — ribbon, centered, shipped, or overview. */
  const behavior = () => stage()?.dataset.behavior ?? "ribbon";
  /** The overview at rest: the zoomed-out tiling, before a tile is focused. */
  const overviewMode = () => behavior() === "overview" && !focusMode();
  /** Fit at rest: the left-aligned row scaled to seat whole pages. */
  const fitMode = () => behavior() === "fit" && !focusMode();
  /** Either zoomed rest: inert tiles, no handles, a press means jump in. */
  const restMode = () => overviewMode() || fitMode();
  /** Whether the viewport keeps the selected page centred, as shipped. */
  const centring = () =>
    focusMode() || behavior() === "centered" || behavior() === "shipped";

  const inset = (el: HTMLElement): number => {
    const value = parseFloat(getComputedStyle(el).getPropertyValue("--page-inset"));
    if (!Number.isFinite(value)) throw new Error("Ribbon stage prototype requires the authored --page-inset");
    return value;
  };

  /** The stage's page box: the stage inside its side and bottom insets. */
  const pageBox = () => {
    const el = stage();
    if (!el) return { width: 0, height: 0 };
    const i = inset(el);
    return { width: el.clientWidth - 2 * i, height: el.clientHeight - i };
  };

  const factors = () => {
    const box = pageBox();
    const s = stageMeasures.sizing;
    return {
      width: 1 - s.width_share + (s.width_share * box.width) / s.reference_width_px,
      height: 1 - s.height_share + (s.height_share * box.height) / s.reference_height_px,
    };
  };

  const authoredSize = (page: HTMLElement) => ({
    width: parseFloat(page.dataset.width ?? page.style.width) || stageMeasures.page.initial_width_px,
    height: parseFloat(page.dataset.height ?? page.style.height) || stageMeasures.page.initial_height_px,
  });

  const centreSelected = () => {
    const strip = filmstrip();
    const page = selectedPage();
    if (!strip || !page) return;
    strip.scrollLeft = page.offsetLeft + page.offsetWidth / 2 - strip.clientWidth / 2;
  };

  /** The ribbon's smallest move: scroll only until the selected page is
      fully in view, a page-inset's breathing room beside it. */
  const keepSelectedInView = () => {
    const strip = filmstrip();
    const page = selectedPage();
    const el = stage();
    if (!strip || !page || !el) return;
    const margin = inset(el);
    const left = page.offsetLeft;
    const right = left + page.offsetWidth;
    let target = strip.scrollLeft;
    if (right + margin > target + strip.clientWidth) target = right + margin - strip.clientWidth;
    if (left - margin < target) target = left - margin;
    strip.scrollLeft = target;
  };

  /** Entering a zoomed rest shows the row. The overview centres it when it
      fits the viewport; fit always starts from the first page — side by
      side, never centred. The selected tile, when one exists, is nudged
      into view. */
  const settleRestRow = () => {
    const strip = filmstrip();
    const el = stage();
    const all = pages();
    if (!strip || !el || all.length === 0) return;
    const margin = inset(el);
    const first = all[0];
    const last = all[all.length - 1];
    const rowLeft = first.offsetLeft;
    const rowRight = last.offsetLeft + last.offsetWidth;
    const rowWidth = rowRight - rowLeft;
    const fitsWhole = rowWidth + 2 * margin <= strip.clientWidth;
    strip.scrollLeft = fitsWhole && overviewMode()
      ? rowLeft + rowWidth / 2 - strip.clientWidth / 2
      : rowLeft - margin;
    keepSelectedInView();
  };

  /** After a formula pass or resize: centred whenever the variant centres
      (and for a full-screen page), least motion in the ribbon, the whole
      row on a zoomed rest's entry. */
  const settleScroll = (entering = false) => {
    if (entering && restMode()) settleRestRow();
    else if (centring() || selectedPage()?.hasAttribute("full-screen") || entering) centreSelected();
    else keepSelectedInView();
  };

  // The overview's zoom: the tallest tile takes this share of the page box's
  // height, clamped so tiles stay recognisable without dominating.
  const OVERVIEW_HEIGHT_SHARE = 0.62;
  const OVERVIEW_ZOOM_MAX = 0.5;
  const OVERVIEW_ZOOM_MIN = 0.15;

  const overviewZoom = (f: { width: number; height: number }) => {
    const box = pageBox();
    const tallest = Math.max(
      ...pages().map((page) => authoredSize(page).height * f.height),
      1,
    );
    const fit = (box.height * OVERVIEW_HEIGHT_SHARE) / tallest;
    return Math.min(Math.max(fit, OVERVIEW_ZOOM_MIN), OVERVIEW_ZOOM_MAX);
  };

  // Fit's tolerance: pages shrink at most this far to seat one more per
  // screenful; a row that would need less stays at full size.
  const FIT_ZOOM_MIN = 0.7;

  /** Fit's width factor: the most pages a screenful can seat wherever the
      viewer scrolls — judged against the widest run of that many
      consecutive pages, so no group clips — without narrowing below the
      tolerance. It narrows widths only; nothing scales. */
  const fitWidthFactor = (f: { width: number; height: number }) => {
    const el = stage();
    const all = pages();
    if (!el || all.length === 0) return 1;
    const gap = parseFloat(getComputedStyle(el).getPropertyValue("--page-gap")) || 0;
    const box = pageBox();
    const widths = all.map((page) => authoredSize(page).width * f.width);
    for (let seats = all.length; seats >= 1; seats--) {
      let widestRun = 0;
      for (let start = 0; start + seats <= widths.length; start++) {
        let run = 0;
        for (let i = start; i < start + seats; i++) run += widths[i];
        widestRun = Math.max(widestRun, run);
      }
      const zoom = (box.width - (seats - 1) * gap) / widestRun;
      if (zoom >= FIT_ZOOM_MIN) return Math.min(1, zoom);
    }
    return FIT_ZOOM_MIN;
  };

  /** Rendered sizes for the live page box; no animation. The overview
      renders every page — full-screen included — as a tile at the shared
      zoom, which rides the stage as --overview-zoom for the frame's
      un-scaling rule. Fit narrows widths only: heights hold, documents
      reflow, nothing scales. */
  const applyFormula = (entering = false) => {
    const f = factors();
    const rest = restMode();
    const zoom = overviewMode() ? overviewZoom(f) : 1;
    const widthFactor = fitMode() ? fitWidthFactor(f) : 1;
    stage()?.style.setProperty("--overview-zoom", String(zoom));
    for (const page of pages()) {
      const authored = authoredSize(page);
      page.dataset.width = String(authored.width);
      page.dataset.height = String(authored.height);
      if (!rest && page.hasAttribute("full-screen")) {
        page.style.width = "";
        page.style.height = "";
        continue;
      }
      const priorTransition = page.style.transition;
      page.style.transition = "none";
      page.style.width = `${authored.width * f.width * zoom * widthFactor}px`;
      page.style.height = `${authored.height * f.height * zoom}px`;
      void page.offsetWidth;
      page.style.transition = priorTransition;
    }
    settleScroll(entering);
  };

  const zoneAt = (x: number, y: number): Zone | null => {
    // Tiles are previews: the zoomed rests offer no resize handles.
    if (restMode()) return null;
    const page = selectedPage();
    if (!page) return null;
    const r = page.getBoundingClientRect();
    const m = stageMeasures.handles;
    const half = m.edge_band_px / 2;
    const nearLeft = Math.abs(x - r.left) <= half;
    const nearRight = Math.abs(x - r.right) <= half;
    const nearTop = Math.abs(y - r.top) <= half;
    const nearBottom = Math.abs(y - r.bottom) <= half;
    const withinX = x >= r.left - half && x <= r.right + half;
    const withinY = y >= r.top - half && y <= r.bottom + half;

    const armX = (edge: number) => Math.abs(x - edge) <= m.corner_thickness_px / 2 + half;
    const armY = (edge: number) => Math.abs(y - edge) <= m.corner_thickness_px / 2 + half;
    const reachX = (corner: number) => Math.abs(x - corner) <= m.corner_reach_px;
    const reachY = (corner: number) => Math.abs(y - corner) <= m.corner_reach_px;
    const corner = (cx: number, cy: number) =>
      (armY(cy) && reachX(cx) && withinX) || (armX(cx) && reachY(cy) && withinY);

    if (corner(r.left, r.top)) return { left: -1, top: -1, cursor: "nwse-resize" };
    if (corner(r.right, r.top)) return { left: 1, top: -1, cursor: "nesw-resize" };
    if (corner(r.left, r.bottom)) return { left: -1, top: 1, cursor: "nesw-resize" };
    if (corner(r.right, r.bottom)) return { left: 1, top: 1, cursor: "nwse-resize" };
    if ((nearLeft || nearRight) && withinY) return { left: nearLeft ? -1 : 1, top: 0, cursor: "ew-resize" };
    if ((nearTop || nearBottom) && withinX) return { left: 0, top: nearTop ? -1 : 1, cursor: "ns-resize" };
    return null;
  };

  interface Resize {
    pointerId: number;
    zone: Zone;
    page: HTMLElement;
    index: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    startWidth: number;
    startHeight: number;
    settled: { width: number; height: number };
    wasFullScreen: boolean;
    armed: boolean;
    optionHeld: boolean;
  }
  let resize: Resize | null = null;
  let outline: HTMLElement | null = null;

  const showOutline = () => {
    const el = stage();
    if (!el || outline) return;
    outline = document.createElement("div");
    outline.className = "snap-outline";
    outline.setAttribute("aria-hidden", "true");
    el.append(outline);
  };
  const hideOutline = () => {
    outline?.remove();
    outline = null;
  };

  const setSize = (page: HTMLElement, width: number, height: number) => {
    page.style.width = `${width}px`;
    page.style.height = `${height}px`;
    // Centring variants keep the resizing page centred, as shipped; the
    // ribbon holds still under a drag.
    if (centring()) centreSelected();
  };

  const applyDrag = () => {
    if (!resize) return;
    const box = pageBox();
    const rawWidth = resize.startWidth + 2 * (resize.lastX - resize.startX) * resize.zone.left;
    const rawHeight = resize.startHeight + 2 * (resize.lastY - resize.startY) * resize.zone.top;
    let width = resize.zone.left === 0 ? resize.startWidth
      : Math.min(Math.max(rawWidth, artifactMeasures.artifact.min_width_px), box.width);
    let height = resize.zone.top === 0 ? resize.startHeight
      : Math.min(Math.max(rawHeight, artifactMeasures.artifact.min_height_px), box.height);

    const cornerDrag = resize.zone.left !== 0 && resize.zone.top !== 0;
    const near = cornerDrag &&
      box.width - width <= stageMeasures.snap.arm_px &&
      box.height - height <= stageMeasures.snap.arm_px;
    const armed = near && !resize.optionHeld;
    if (armed) {
      width = box.width;
      height = box.height;
      if (!resize.armed) showOutline();
    } else if (resize.armed) {
      hideOutline();
    }
    resize.armed = armed;
    setSize(resize.page, width, height);
  };

  const endResize = (commit: boolean) => {
    if (!resize) return;
    const r = resize;
    resize = null;
    hideOutline();
    r.page.style.transition = "";
    if (!commit) {
      if (r.wasFullScreen) {
        r.page.setAttribute("full-screen", "");
        r.page.style.width = "";
        r.page.style.height = "";
      } else {
        setSize(r.page, r.startWidth, r.startHeight);
      }
      return;
    }
    if (r.armed) {
      r.page.setAttribute("full-screen", "");
      r.page.style.width = "";
      r.page.style.height = "";
      settleScroll();
      options.onFullScreen?.(r.index, true);
      return;
    }
    const f = factors();
    const width = parseFloat(r.page.style.width) / f.width;
    const height = parseFloat(r.page.style.height) / f.height;
    r.page.dataset.width = String(width);
    r.page.dataset.height = String(height);
    options.onResize?.(r.index, width, height);
    if (r.wasFullScreen) options.onFullScreen?.(r.index, false);
  };

  on(host, "pointermove", (e) => {
    const pointer = e as PointerEvent;
    if (resize) {
      resize.lastX = pointer.clientX;
      resize.lastY = pointer.clientY;
      applyDrag();
      return;
    }
    const zone = zoneAt(pointer.clientX, pointer.clientY);
    const el = stage();
    if (el) el.style.cursor = zone?.cursor ?? "";
  });

  on(host, "pointerdown", (e) => {
    const pointer = e as PointerEvent;
    const zone = zoneAt(pointer.clientX, pointer.clientY);
    const page = selectedPage();
    if (!zone || !page) return;
    const index = pages().indexOf(page);
    const wasFullScreen = page.hasAttribute("full-screen");
    const rect = page.getBoundingClientRect();
    if (wasFullScreen) {
      page.removeAttribute("full-screen");
    }
    resize = {
      pointerId: pointer.pointerId,
      zone,
      page,
      index,
      startX: pointer.clientX,
      startY: pointer.clientY,
      lastX: pointer.clientX,
      lastY: pointer.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      settled: authoredSize(page),
      wasFullScreen,
      armed: false,
      optionHeld: pointer.altKey,
    };
    page.style.transition = "none";
    setSize(page, rect.width, rect.height);
    (e.currentTarget as HTMLElement).setPointerCapture?.(pointer.pointerId);
    host.setPointerCapture?.(pointer.pointerId);
    pointer.preventDefault();
  });

  const swallowClick = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  on(host, "pointerup", () => {
    if (!resize) return;
    document.addEventListener("click", swallowClick, { capture: true, once: true });
    setTimeout(() => document.removeEventListener("click", swallowClick, { capture: true }), 0);
    endResize(true);
  });
  on(host, "pointercancel", () => endResize(false));
  on(host, "lostpointercapture", () => { if (resize) endResize(false); });
  on(document, "keydown", (e) => {
    const key = e as KeyboardEvent;
    if (key.key === "Escape" && resize) endResize(false);
    if (key.key === "Alt" && resize) {
      resize.optionHeld = true;
      applyDrag();
    }
  });
  on(document, "keyup", (e) => {
    if ((e as KeyboardEvent).key === "Alt" && resize) {
      resize.optionHeld = false;
      applyDrag();
    }
  });

  // The sliding screen: in the ribbon the wheel pans the strip directly —
  // the one gesture the shipped stage reserves. Centring variants stay
  // locked to their centred page.
  on(host, "wheel", (e) => {
    const strip = filmstrip();
    if (!strip || centring() || resize) return;
    if (!strip.contains(e.target as Node)) return;
    const wheel = e as WheelEvent;
    // A zoomed rest scrolls across on either wheel axis — it has no
    // vertical scrolling to protect. The ribbon reserves plain vertical
    // wheeling for the page under the pointer and pans on shift.
    const delta = Math.abs(wheel.deltaX) >= Math.abs(wheel.deltaY)
      ? wheel.deltaX
      : (wheel.shiftKey || restMode() ? wheel.deltaY : 0);
    if (delta === 0) return;
    strip.scrollLeft += delta;
    wheel.preventDefault();
  }, { passive: false });

  // In the centred variants, double-clicking a tab toggles its page between
  // ordinary and full-screen, exactly as shipped ([[frames/lib/stage.ts]]).
  // The ribbon, the overview, and fit read the same gesture as their focus
  // toggle in the app rig ([[frames/prototypes/ribbon/ribbon.ts]]), so it is ignored here.
  on(document, "dblclick", (e) => {
    if (behavior() !== "centered" && behavior() !== "shipped") return;
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (!tab || !host.contains(tab)) return;
    const index = [...host.querySelectorAll('[role="tab"]')].indexOf(tab);
    const page = pages()[index];
    if (!page) return;
    const entering = !page.hasAttribute("full-screen");
    if (entering) {
      page.setAttribute("full-screen", "");
      page.style.width = "";
      page.style.height = "";
    } else {
      page.removeAttribute("full-screen");
      const f = factors();
      const authored = authoredSize(page);
      page.style.width = `${authored.width * f.width}px`;
      page.style.height = `${authored.height * f.height}px`;
    }
    recentreThrough();
    options.onFullScreen?.(index, entering);
  });

  // Centring rides the morph: the target moves while the page's width
  // transitions, so it is restated each frame slightly past the morph.
  const RECENTRE_SETTLE_MS = 40;
  const RECENTRE_MS = stageMeasures.crossing.duration_ms + RECENTRE_SETTLE_MS;
  let recentreLoop = 0;
  const recentreThrough = () => {
    cancelAnimationFrame(recentreLoop);
    const start = performance.now();
    const step = (now: number) => {
      centreSelected();
      if (now - start < RECENTRE_MS) recentreLoop = requestAnimationFrame(step);
    };
    recentreLoop = requestAnimationFrame(step);
  };
  removers.push(() => cancelAnimationFrame(recentreLoop));

  // While the window resizes, pages follow the formula, with no animation;
  // a drag in flight is cancelled by the page box changing under it.
  const onWindowResize = () => {
    if (resize) endResize(false);
    applyFormula();
  };
  on(window, "resize", onWindowResize);

  // On entry, centre the selected page — least motion has no prior position
  // to respect, and the centre shows its neighbours on both sides.
  applyFormula(true);

  return () => {
    endResize(false);
    const el = stage();
    if (el) el.style.cursor = "";
    for (const remover of removers) remover();
  };
};

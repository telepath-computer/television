// The stage rig: page resizing, full-screen, and window response on the
// staged markup, per [[specs/ui/app/stage/index.md]] (Page sizing,
// Full-screen, Full-screen snapping). Gestures manipulate the persistent
// markup; every rest lands the state the frame renders for its params, and
// settled outcomes flow back through the callbacks so the host's next
// render reproduces them. One knowing deviation from the static pose: the
// frame renders authored sizes (reference-box pixels) inline, while this
// rig renders each page at the formula's rendered size for the live page
// box — the pose is exact at the reference box, and the formula is runtime
// behavior only a rig can say.

import artifactMeasures from "../../specs/ui/app/artifact-frame/measures.yml";
import stageMeasures from "../../specs/ui/app/stage/measures.yml";

export interface StagePrototypeOptions {
  /** A drag settled: the page's new authored (reference-box) size. */
  onResize?: (pageIndex: number, width: number, height: number) => void;
  /** Full-screen entered or left for a page. */
  onFullScreen?: (pageIndex: number, fullScreen: boolean) => void;
}

interface Zone {
  left: -1 | 0 | 1;
  top: -1 | 0 | 1;
  cursor: string;
}

export const stagePrototype = (
  host: HTMLElement,
  options: StagePrototypeOptions = {},
): (() => void) => {
  const removers: (() => void)[] = [];
  const on = <K extends keyof DocumentEventMap>(
    target: EventTarget,
    type: K | string,
    handler: (e: Event) => void,
  ) => {
    target.addEventListener(type as string, handler);
    removers.push(() => target.removeEventListener(type as string, handler));
  };

  const stage = () => host.querySelector<HTMLElement>(".stage");
  const filmstrip = () => host.querySelector<HTMLElement>(".filmstrip");
  const pages = () => [...host.querySelectorAll<HTMLElement>(".page")];
  const selectedPage = () => host.querySelector<HTMLElement>(".page[selected]");

  const inset = (el: HTMLElement): number => {
    const value = parseFloat(getComputedStyle(el).getPropertyValue("--page-inset"));
    if (!Number.isFinite(value)) throw new Error("Stage prototype requires the authored --page-inset");
    return value;
  };

  /** The stage's page box: the stage inside its side and bottom insets. */
  const pageBox = () => {
    const el = stage();
    if (!el) return { width: 0, height: 0 };
    const i = inset(el);
    return { width: el.clientWidth - 2 * i, height: el.clientHeight - i };
  };

  // The sizing formula ([[specs/ui/app/stage/index.md]], The size): per
  // axis, rendered = size × (1 − share + share × stage ÷ reference).
  const factors = () => {
    const box = pageBox();
    const s = stageMeasures.sizing;
    return {
      width: 1 - s.width_share + (s.width_share * box.width) / s.reference_width_px,
      height: 1 - s.height_share + (s.height_share * box.height) / s.reference_height_px,
    };
  };

  /** Authored sizes ride the markup so the formula can rerender them. */
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

  /** Rendered sizes for the live page box; no animation, selected centred. */
  const applyFormula = () => {
    const f = factors();
    for (const page of pages()) {
      const authored = authoredSize(page);
      page.dataset.width = String(authored.width);
      page.dataset.height = String(authored.height);
      if (page.hasAttribute("full-screen")) {
        page.style.width = "";
        page.style.height = "";
        continue;
      }
      const priorTransition = page.style.transition;
      page.style.transition = "none";
      page.style.width = `${authored.width * f.width}px`;
      page.style.height = `${authored.height * f.height}px`;
      void page.offsetWidth;
      page.style.transition = priorTransition;
    }
    centreSelected();
  };

  // Handle hit-testing ([[specs/ui/app/stage/index.md]], Handles): edge
  // bands centred on the boundary, corners reaching down both adjoining
  // edges as an L. Only the selected page resizes.
  const zoneAt = (x: number, y: number): Zone | null => {
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

    // A corner's L: within an arm's thickness of the boundary and within
    // its reach of the corner, along either adjoining edge.
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
    /** Rendered size when the drag began — cancellation's restore point. */
    startWidth: number;
    startHeight: number;
    /** The settled authored size beneath the drag — what full-screen keeps. */
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
    centreSelected();
  };

  const applyDrag = () => {
    if (!resize) return;
    const box = pageBox();
    // The page holds its centre: a dimension changes by twice the pointer's
    // travel along it, keeping the dragged edge under the pointer.
    const rawWidth = resize.startWidth + 2 * (resize.lastX - resize.startX) * resize.zone.left;
    const rawHeight = resize.startHeight + 2 * (resize.lastY - resize.startY) * resize.zone.top;
    // The artifact frame's stated minimums, which a resize stops against
    // ([[specs/ui/app/artifact-frame/measures.yml]]).
    let width = resize.zone.left === 0 ? resize.startWidth
      : Math.min(Math.max(rawWidth, artifactMeasures.artifact.min_width_px), box.width);
    let height = resize.zone.top === 0 ? resize.startHeight
      : Math.min(Math.max(rawHeight, artifactMeasures.artifact.min_height_px), box.height);

    // The snap ([[specs/ui/app/stage/index.md]], Full-screen snapping):
    // corners only, both axes near the box, unless Option suppresses it.
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
      // Cancellation abandons the resize; an armed snap never fires.
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
      // Release while armed enters full-screen; the size beneath the mode
      // is the one the page was settled at when the drag began.
      r.page.setAttribute("full-screen", "");
      r.page.style.width = "";
      r.page.style.height = "";
      centreSelected();
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
      // Dragging a handle leaves the mode, continuing from the page box as
      // an ordinary resize; cancelling restores the mode.
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
    // A live drag never animates.
    page.style.transition = "none";
    setSize(page, rect.width, rect.height);
    (e.currentTarget as HTMLElement).setPointerCapture?.(pointer.pointerId);
    host.setPointerCapture?.(pointer.pointerId);
    pointer.preventDefault();
  });

  // The click that ends a resize means nothing else: without this, a
  // release over a background page would also select it.
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
    // Option suppresses the magnet the moment it is taken.
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

  // Double-clicking a tab toggles its page between ordinary and
  // full-screen ([[specs/ui/app/stage/index.md]], Full-screen); the change
  // is not a drag, so the page's transition morphs it.
  on(document, "dblclick", (e) => {
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

  // While the window resizes, pages follow the formula exactly, with no
  // animation, the selected page centred throughout; a drag in flight is
  // cancelled by the page box changing under it.
  const onWindowResize = () => {
    if (resize) endResize(false);
    applyFormula();
  };
  on(window, "resize", onWindowResize);
  // The shell drives the same sizing rule at each sidebar boundary position.
  on(host, "sidebar-transition-pose", applyFormula);

  applyFormula();

  return () => {
    endResize(false);
    const el = stage();
    if (el) el.style.cursor = "";
    for (const remover of removers) remover();
  };
};

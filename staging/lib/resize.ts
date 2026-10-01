// The resize vehicle (staging, not spec content): the handle DOM, its css, and
// the drag realizing the spec's claims ([[ui/app/stage/index.md]], Page sizing) — a drag on
// any edge or corner of the selected page, centre-held, stopping at the bounds.
// The spec binds the measures and the principles (ride the boundary, the L
// corner, the axis cursor); the elements realizing them are this vehicle's own.
import { ARTIFACT_MIN_HEIGHT_PX, ARTIFACT_MIN_WIDTH_PX } from "./frame-measures.ts";
import { HANDLE_CORNER_REACH_PX, HANDLE_CORNER_THICKNESS_PX, HANDLE_EDGE_BAND_PX, PAGE_INITIAL_HEIGHT_PX, PAGE_INITIAL_WIDTH_PX, SIZING_HEIGHT_SHARE, SIZING_REFERENCE_HEIGHT_PX, SIZING_REFERENCE_WIDTH_PX, SIZING_WIDTH_SHARE, SNAP_ARM_PX } from "./stage-measures.ts";

// Centre-held: the opposite edge moves with the dragged one, so the pointer's
// travel lands on the dimension twice.
const CENTRE_HELD = 2;

type Size = { w: number; h: number };
type Page = { size?: Size; full_screen?: boolean };

// What the vehicle needs from its host, read fresh per gesture — the App's
// channel, and so its pages array, changes between drags.
type Host = {
  stage: () => HTMLElement;
  pages: () => Page[];
  shown: () => number;
  apply: () => void;
};

// Corners sit above the edge bands, so a near-corner grab resolves to the
// two-axis drag, and only as an L riding the edges — the interior stays the
// artifact's.
const RESIZE_CSS = `
  .page:not([selected]) .page-handles { display: none; }

  .page-handle { position: absolute; z-index: 2; }

  .page-handle.left,
  .page-handle.right { top: 0; bottom: 0; width: var(--handle-band); cursor: ew-resize; }

  .page-handle.top,
  .page-handle.bottom { left: 0; right: 0; height: var(--handle-band); cursor: ns-resize; }

  .page-handle.left { left: calc(var(--handle-band) / -2); }
  .page-handle.right { right: calc(var(--handle-band) / -2); }
  .page-handle.top { top: calc(var(--handle-band) / -2); }
  .page-handle.bottom { bottom: calc(var(--handle-band) / -2); }

  .page-handle.top-left,
  .page-handle.top-right,
  .page-handle.bottom-left,
  .page-handle.bottom-right { width: var(--handle-reach); height: var(--handle-reach); z-index: 3; }

  .page-handle.top-left {
    left: calc(var(--handle-thickness) / -2);
    top: calc(var(--handle-thickness) / -2);
    cursor: nwse-resize;
    clip-path: polygon(0 0, 100% 0, 100% var(--handle-thickness), var(--handle-thickness) var(--handle-thickness), var(--handle-thickness) 100%, 0 100%);
  }

  .page-handle.bottom-right {
    right: calc(var(--handle-thickness) / -2);
    bottom: calc(var(--handle-thickness) / -2);
    cursor: nwse-resize;
    clip-path: polygon(calc(100% - var(--handle-thickness)) 0, 100% 0, 100% 100%, 0 100%, 0 calc(100% - var(--handle-thickness)), calc(100% - var(--handle-thickness)) calc(100% - var(--handle-thickness)));
  }

  .page-handle.top-right {
    right: calc(var(--handle-thickness) / -2);
    top: calc(var(--handle-thickness) / -2);
    cursor: nesw-resize;
    clip-path: polygon(0 0, 100% 0, 100% 100%, calc(100% - var(--handle-thickness)) 100%, calc(100% - var(--handle-thickness)) var(--handle-thickness), 0 var(--handle-thickness));
  }

  .page-handle.bottom-left {
    left: calc(var(--handle-thickness) / -2);
    bottom: calc(var(--handle-thickness) / -2);
    cursor: nesw-resize;
    clip-path: polygon(0 0, var(--handle-thickness) 0, var(--handle-thickness) calc(100% - var(--handle-thickness)), 100% calc(100% - var(--handle-thickness)), 100% 100%, 0 100%);
  }

  /* A live drag never animates — the edge is under the pointer — and iframes
     must not swallow the pointer while it runs. */
  body.resizing iframe { pointer-events: none; }
  body.resizing .page { transition: none; }
`;

const POSITIONS = ["left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"];

// The vehicle's handle DOM, added around the spec's markup on every page; the
// css shows only the selected page's. Call again after a re-render — pages
// already carrying handles are left alone.
export function addPageHandles(root: ParentNode): void {
  for (const pageEl of root.querySelectorAll(".page")) {
    if (pageEl.querySelector(".page-handles")) continue;
    pageEl.insertAdjacentHTML(
      "beforeend",
      `<div class="page-handles" aria-hidden="true">${POSITIONS.map((pos) => `<span class="page-handle ${pos}"></span>`).join("")}</div>`,
    );
  }
}

// The page box a page can never exceed: the stage inside its side and bottom
// insets ([[ui/app/stage/styles.css]]). The filmstrip fills the stage, so its
// box less those insets is the page box; the inset is the sheet's own custom
// property, read here rather than restated.
export const pageBox = (strip: HTMLElement): Size => {
  const inset = parseFloat(getComputedStyle(strip).getPropertyValue("--stage-inset")) || 0;
  // Never negative: a window smaller than the insets yields a zero box, not
  // negative floors and ceilings downstream.
  return { w: Math.max(0, strip.clientWidth - 2 * inset), h: Math.max(0, strip.clientHeight - inset) };
};

// The smallest a page renders at on a given box: the artifact minimum, the
// box winning below it ([[ui/app/stage/index.md]], Bounds). The floor holds
// on every render, not only during a drag.
export const renderFloor = (box: Size): Size => ({
  w: Math.min(ARTIFACT_MIN_WIDTH_PX, box.w),
  h: Math.min(ARTIFACT_MIN_HEIGHT_PX, box.h),
});

// The stage's shared sizing factor ([[ui/app/stage/index.md]], The size).
// The vehicle keeps sizes in reference pixels — its realization of the
// same-rate invariant: render multiplies by the factor, a drag divides, so
// the released size is exact on the stage it was dragged on. The reference
// and shares are the spec's measures.
export const factorFor = (box: Size): Size => ({
  w: 1 + SIZING_WIDTH_SHARE * (box.w / SIZING_REFERENCE_WIDTH_PX - 1),
  h: 1 + SIZING_HEIGHT_SHARE * (box.h / SIZING_REFERENCE_HEIGHT_PX - 1),
});

// The live drag, so a full-screen entry from anywhere else can end it first:
// entering the mode mid-resize preserves the settled size ([[ui/app/stage/
// index.md]], The size), which only cancelling the drag guarantees.
let activeCancel: (() => void) | null = null;
export const cancelActiveResize = (): void => activeCancel?.();

// Wires the drag once per document: the spec's measures into the css above,
// and the pointer logic against the host's live state.
export function installResize(host: Host): void {
  for (const [name, value] of Object.entries({
    "--handle-band": HANDLE_EDGE_BAND_PX,
    "--handle-reach": HANDLE_CORNER_REACH_PX,
    "--handle-thickness": HANDLE_CORNER_THICKNESS_PX,
  })) document.documentElement.style.setProperty(name, `${value}px`);
  document.head.insertAdjacentHTML("beforeend", `<style>${RESIZE_CSS}</style>`);

  document.addEventListener("pointerdown", (event) => {
    const handle = (event.target as Element).closest?.(".page-handle") as HTMLElement | null;
    if (!handle) return;
    event.preventDefault();
    const stageEl = host.stage();
    const stripEl = stageEl.querySelector(".filmstrip") as HTMLElement;
    const shown = host.shown();
    const pg = host.pages()[shown];
    const pageEl = stripEl.querySelectorAll(".page")[shown] as HTMLElement;
    if (!pg || !pageEl) return;

    const horizontal = /left|right/.test(handle.className);
    const vertical = /top|bottom/.test(handle.className);
    const leftish = /left/.test(handle.className);
    const topish = /top/.test(handle.className);
    const startX = event.clientX;
    const startY = event.clientY;
    const start = pageEl.getBoundingClientRect();
    const box = pageBox(stripEl);
    const floor = renderFloor(box);
    // The drag works in real pixels; what is stored is reference pixels,
    // through the shared factor, so the released size renders back exactly.
    // A page never dragged holds the authored initial size — the size it
    // renders from — not the rectangle the stage's ceiling may have clamped.
    const factor = factorFor(box);
    pg.size ??= { w: PAGE_INITIAL_WIDTH_PX, h: PAGE_INITIAL_HEIGHT_PX };
    // What waits beneath the mode if this drag ends armed: the size the page
    // was left at, not one this drag passed through on the way to the snap.
    const settled: Size = { ...pg.size };
    // A drag on a full-screen page leaves the mode and continues from the
    // page box ([[ui/app/stage/index.md]], Full-screen): the drag's baseline
    // is the box, so an unmoved axis holds the box extent; cancellation
    // restores the mode with the size beneath untouched. The mode clears on
    // the first actual movement — a moveless press changes nothing.
    const wasFullScreen = Boolean(pg.full_screen);
    const baseline: Size = wasFullScreen
      ? { w: box.w / factor.w, h: box.h / factor.h }
      : { ...pg.size };
    document.body.classList.add("resizing");
    handle.setPointerCapture(event.pointerId);

    // Live snap: a corner carried within the arming distance of the stage's
    // extents on both axes takes the whole page box at once — the edge leaves
    // the pointer, which nothing else in this gesture does, so the magnet is
    // felt rather than announced. Pulling clear hands the edge back. An edge
    // drag never arms: one axis cannot reach both extents.
    //
    // Option held suppresses the magnet, so a page can be sized right up to
    // the stage without going full-screen. It is read per move rather than at
    // pointerdown, so it can be taken and released mid-drag.
    let armed = false;
    // The armed outline is the spec's markup and styling ([[ui/app/stage/
    // template.liquid]]'s `snap_armed`); this vehicle only poses that branch
    // rather than restating it, since a re-render mid-drag is not this
    // board's behaviour.
    const zone = (on: boolean) => {
      const el = stageEl.querySelector(".snap-outline");
      if (on && !el) stageEl.insertAdjacentHTML("beforeend", '<div class="snap-outline" aria-hidden="true"></div>');
      else if (!on) el?.remove();
    };

    // The pointer's last position and whether Option is down, kept so either
    // can change alone: taking or releasing Option resizes on the spot rather
    // than waiting for the pointer to move again.
    let lastX = startX;
    let lastY = startY;
    let option = false;

    // The rendered size the drag last produced, per axis, so release can tell
    // an axis that actually moved from one that ended where it began.
    const rendered: Size = { w: start.width, h: start.height };
    const resize = () => {
      if (pg.full_screen) {
        pg.full_screen = false;
        pg.size = { ...baseline };
      }
      let w = pg.size!.w * factor.w;
      let h = pg.size!.h * factor.h;
      if (horizontal) {
        const delta = (lastX - startX) * (leftish ? -CENTRE_HELD : CENTRE_HELD);
        w = Math.min(Math.max(floor.w, start.width + delta), box.w);
      }
      if (vertical) {
        const delta = (lastY - startY) * (topish ? -CENTRE_HELD : CENTRE_HELD);
        h = Math.min(Math.max(floor.h, start.height + delta), box.h);
      }
      armed = !option && horizontal && vertical && w >= box.w - SNAP_ARM_PX && h >= box.h - SNAP_ARM_PX;
      zone(armed);
      rendered.w = armed ? box.w : w;
      rendered.h = armed ? box.h : h;
      pg.size!.w = rendered.w / factor.w;
      pg.size!.h = rendered.h / factor.h;
      host.apply();
    };

    const move = (ev: PointerEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      option = ev.altKey;
      resize();
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        end(false);
        return;
      }
      if (ev.altKey === option) return;
      option = ev.altKey;
      resize();
    };
    // Ordinary release commits. Cancellation — Escape, a browser pointer
    // cancellation, or unexpected capture loss — abandons the resize: the
    // page returns to the size the drag began at and no snap fires
    // ([[ui/app/stage/index.md]], The gesture). Either way the transient drag
    // state (the resizing class, the outline, the listeners) comes down.
    const end = (commit: boolean) => {
      activeCancel = null;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      handle.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      document.body.classList.remove("resizing");
      zone(false);
      // Releasing while armed enters the mode over the settled size.
      if (commit && armed) {
        pg.size = settled;
        pg.full_screen = true;
        host.apply();
      } else if (commit) {
        // A drag changes an axis only as far as it moved the page: an axis
        // that ends rendering where it began keeps the size the drag began
        // at — the page box for a drag that left full-screen, the settled
        // size otherwise. An outward pull at a bound commits nothing.
        if (rendered.w === start.width) pg.size!.w = baseline.w;
        if (rendered.h === start.height) pg.size!.h = baseline.h;
        host.apply();
      } else {
        pg.size = { ...settled };
        if (wasFullScreen) pg.full_screen = true;
        host.apply();
      }
    };
    const up = () => end(true);
    const cancel = () => end(false);
    activeCancel = cancel;
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
    handle.addEventListener("lostpointercapture", cancel);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
  });
}

// The filmstrip vehicle (staging, not spec content), shared by the App frame:
// the scripted selection crossing and centring that rides page-size and
// reorder morphs. The mechanisms here realize the spec's claims
// ([[ui/app/stage/index.md]]); the implementation may choose its own.
import { CROSSING_DURATION_MS } from "./stage-measures.ts";

// CSS `ease` (cubic-bezier 0.25, 0.1, 0.25, 1), solved numerically — the
// spec names the curve, and the page morphs use the same keyword.
// The solver's own constants: a cubic's polynomial degree, Newton's
// iteration budget, and the convergence epsilon.
const CUBIC = 3;
const NEWTON_ITERATIONS = 6;
const EPSILON = 1e-4;
const bezier = (p1x: number, p1y: number, p2x: number, p2y: number) => (x: number) => {
  let t = x;
  for (let i = 0; i < NEWTON_ITERATIONS; i++) {
    const cx = CUBIC * p1x, bx = CUBIC * (p2x - p1x) - cx, ax = 1 - cx - bx;
    const xt = ((ax * t + bx) * t + cx) * t - x;
    const dx = (CUBIC * ax * t + 2 * bx) * t + cx;
    if (Math.abs(xt) < EPSILON || dx === 0) break;
    t -= xt / dx;
  }
  const cy = CUBIC * p1y, by = CUBIC * (p2y - p1y) - cy, ay = 1 - cy - by;
  return ((ay * t + by) * t + cy) * t;
};
// CSS `ease`'s control points — the spec names the keyword; these are the
// platform's own definition of it.
const EASE_X1 = 0.25;
const EASE_Y1 = 0.1;
const EASE_X2 = 0.25;
const EASE_Y2 = 1;
const ease = bezier(EASE_X1, EASE_Y1, EASE_X2, EASE_Y2);

// The crossing is one fixed-time motion however far the pages sit apart (the
// spec's constant-time claim): the platform's smooth scroll times by
// distance, so the vehicle animates the scroll itself. Instant where asked,
// and where motion is unwelcome.
const scrollAnims = new WeakMap<HTMLElement, number>();
export const showPage = (strip: HTMLElement, index: number, instant = false, selector = ".page") => {
  const pageEl = strip.querySelectorAll(selector)[index];
  if (!pageEl) return;
  const pr = pageEl.getBoundingClientRect();
  const sr = strip.getBoundingClientRect();
  // Visual deltas move 1:1 with the scroll even while the strip's content
  // is scaled (the draw-back sits on a wrapper inside the scroller, and a
  // transform applies after the scroll offset) — no factor to divide by.
  const target = Math.max(
    0,
    Math.min(
      strip.scrollLeft + (pr.left + pr.width / 2) - (sr.left + sr.width / 2),
      strip.scrollWidth - strip.clientWidth,
    ),
  );
  cancelAnimationFrame(scrollAnims.get(strip) ?? 0);
  if (instant || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    strip.scrollLeft = target;
    return;
  }
  const from = strip.scrollLeft;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / CROSSING_DURATION_MS);
    strip.scrollLeft = from + (target - from) * ease(t);
    if (t < 1) scrollAnims.set(strip, requestAnimationFrame(step));
  };
  scrollAnims.set(strip, requestAnimationFrame(step));
};

// While a page-size or draw-back transition runs, the centring target moves
// with it — re-state the position each frame until the morph settles. The
// index may be a getter: a reorder can move the selected page's slot while
// the loop runs, and centring a stale slot shoves the strip a slot off.
// Staging vehicle window, not visual timing: it keeps centring alive 40 ms
// beyond the draw-back's authoritative 280 ms transition so the final painted
// frame is included. It does not change or compete with that duration.
const RECENTRE_MS = 320;
const recentreLoops = new WeakMap<HTMLElement, number>();
export const recentreThrough = (strip: HTMLElement, index: number | (() => number), ms = RECENTRE_MS) => {
  cancelAnimationFrame(recentreLoops.get(strip) ?? 0);
  const start = performance.now();
  const step = () => {
    showPage(strip, typeof index === "function" ? index() : index, true);
    if (performance.now() - start < ms) recentreLoops.set(strip, requestAnimationFrame(step));
  };
  recentreLoops.set(strip, requestAnimationFrame(step));
};

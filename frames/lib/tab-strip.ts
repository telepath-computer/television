// Workshop wiring for the tab strip's overflow pose. Production layout owns
// its measurement lifecycle; this rig makes the same states visible in frames.
import measures from "../../specs/ui/app/tab-strip/measures.yml";
import { mountItemEdgeFade } from "./item-edge-fade";

/** Pose label overflow from the actual text and space in the workshop. */
export const tabLabelsPrototype = (root: Document): (() => void) => {
  const labels = [...root.querySelectorAll<HTMLElement>(".tab-label")];
  if (labels.length === 0) return () => {};
  let pending = 0;
  const update = () => {
    pending = 0;
    for (const label of labels) {
      label.toggleAttribute("data-overflow", label.scrollWidth > label.clientWidth);
    }
  };
  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(update);
  };
  const resize = new ResizeObserver(schedule);
  const mutations = new MutationObserver(schedule);
  for (const label of labels) {
    resize.observe(label);
    mutations.observe(label, { childList: true, subtree: true, characterData: true });
  }
  root.fonts.addEventListener("loadingdone", schedule);
  root.addEventListener("television-theme-styles-changed", schedule);
  schedule();
  return () => {
    cancelAnimationFrame(pending);
    resize.disconnect();
    mutations.disconnect();
    root.fonts.removeEventListener("loadingdone", schedule);
    root.removeEventListener("television-theme-styles-changed", schedule);
  };
};

/** Wire the authored edge fades and overflow layout; return complete cleanup. */
export const tabStripPrototype = (strip: HTMLElement): (() => void) => {
  let pending = 0;
  const update = () => {
    pending = 0;
    strip.toggleAttribute("data-overflow", strip.scrollWidth > strip.clientWidth);
    fade.refresh();
  };
  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(update);
  };
  const resize = new ResizeObserver(schedule);
  const observeItems = () => {
    resize.disconnect();
    resize.observe(strip);
    strip.querySelectorAll<HTMLElement>(":scope > .tab").forEach((tab) => resize.observe(tab));
    schedule();
  };
  const mutations = new MutationObserver(observeItems);
  mutations.observe(strip, { childList: true, subtree: true, characterData: true });
  observeItems();
  const fade = mountItemEdgeFade(strip, {
    items: ":scope > .tab",
    distance: measures.overflow.fade_px,
    edges: "both",
  });
  document.addEventListener("television-theme-styles-changed", schedule);
  const appearance = new MutationObserver(schedule);
  appearance.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    document.removeEventListener("television-theme-styles-changed", schedule);
    appearance.disconnect();
    cancelAnimationFrame(pending);
    resize.disconnect();
    mutations.disconnect();
    fade.dispose();
    strip.removeAttribute("data-overflow");
  };
};

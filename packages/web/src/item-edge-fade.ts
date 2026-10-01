// Horizontal, left-to-right overflow fading. The scrollport must remain unmasked
// so each item's backdrop-filter can reach content behind the scrollport.
const properties = {
  start: "--item-fade-start",
  end: "--item-fade-end",
  left: "--item-fade-left",
  right: "--item-fade-right",
};

export interface ItemEdgeFadeOptions {
  items: string;
  distance: number;
  edges: "both" | "right";
}

export const mountItemEdgeFade = (
  scrollport: HTMLElement,
  { items, distance, edges }: ItemEdgeFadeOptions,
): { refresh(): void; dispose(): void } => {
  const observed = new Set<HTMLElement>();
  let pending = 0;
  let disposed = false;

  const clear = (item: HTMLElement) => {
    item.removeAttribute("data-item-edge-fade");
    for (const property of Object.values(properties)) item.style.removeProperty(property);
  };

  const update = () => {
    pending = 0;
    const current = new Set(scrollport.querySelectorAll<HTMLElement>(items));
    const removed: HTMLElement[] = [];
    for (const item of observed) {
      if (current.has(item)) continue;
      resize.unobserve(item);
      observed.delete(item);
      removed.push(item);
    }
    for (const item of current) {
      if (observed.has(item)) continue;
      observed.add(item);
      resize.observe(item);
    }

    const bounds = scrollport.getBoundingClientRect();
    const left = bounds.left + scrollport.clientLeft;
    const right = left + scrollport.clientWidth;
    const fade = Math.max(0, Math.min(distance, scrollport.clientWidth / 2));
    const fadeLeft = edges === "both" && scrollport.scrollLeft > 1 ? fade : 0;
    const fadeRight = scrollport.scrollLeft < scrollport.scrollWidth - scrollport.clientWidth - 1 ? fade : 0;
    // Read every rectangle before writing any mask styles.
    const measurements = [...current].map((item) => ({ item, bounds: item.getBoundingClientRect() }));
    for (const item of removed) clear(item);
    for (const { item, bounds: itemBounds } of measurements) {
      const atLeft = fadeLeft > 0 && itemBounds.left < left + fadeLeft && itemBounds.right > left;
      const atRight = fadeRight > 0 && itemBounds.right > right - fadeRight && itemBounds.left < right;
      if (!atLeft && !atRight) {
        clear(item);
        continue;
      }
      item.style.setProperty(properties.start, `${left - itemBounds.left}px`);
      item.style.setProperty(properties.end, `${right - itemBounds.left}px`);
      item.style.setProperty(properties.left, `${fadeLeft}px`);
      item.style.setProperty(properties.right, `${fadeRight}px`);
      item.setAttribute("data-item-edge-fade", "");
    }
  };

  const schedule = () => {
    if (!disposed && !pending) pending = requestAnimationFrame(update);
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(scrollport);
  const mutations = new MutationObserver(schedule);
  // Ignore our own style/marker writes. Item size changes are observed above.
  mutations.observe(scrollport, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  scrollport.addEventListener("scroll", schedule, { passive: true });
  schedule();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(pending);
    resize.disconnect();
    mutations.disconnect();
    scrollport.removeEventListener("scroll", schedule);
    for (const item of observed) clear(item);
    observed.clear();
  };
  return { refresh: schedule, dispose };
};

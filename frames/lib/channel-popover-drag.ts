import measures from "../../specs/ui/app/drag.yml";
import channelFrame from "../../specs/ui/app/sidebar/channel.frame";
import placeholderFrame from "../../specs/ui/app/sidebar/channel-placeholder.frame";

/** Local workshop state: initial fixture order stands for newest-created first. */
export const channelPopoverDrag = (panel: HTMLElement): { active: () => boolean; dispose: () => void } => {
  const body = panel.querySelector<HTMLElement>(".channel-switcher-pop-body")!;
  const pinned = panel.querySelector<HTMLElement>('[aria-labelledby="channel-group-pinned"]')!;
  const recent = panel.querySelector<HTMLElement>('[aria-labelledby="channel-group-unpinned"]')!;
  const originalOrder = [...panel.querySelectorAll<HTMLElement>(".channel-row")];
  const rowOrder = (row: HTMLElement) => originalOrder.indexOf(row);
  const removers: (() => void)[] = [];
  const on = (type: string, listener: EventListener, capture = false) => {
    document.addEventListener(type, listener, capture);
    removers.push(() => document.removeEventListener(type, listener, capture));
  };
  type Press = { row: HTMLElement; x: number; y: number; id: number };
  let press: Press | null = null;
  let drag: { row: HTMLElement; placeholder: HTMLElement; origin: HTMLElement; next: ChildNode | null;
    style: string | null; fromPinned: boolean; pinned: boolean; x: number; y: number; gripX: number; gripY: number } | null = null;
  let scrollFrame = 0;
  let lastTime: number | null = null;
  let suppressClick = false;
  const syncGroups = () => {
    for (const group of [pinned, recent]) group.hidden = !group.querySelector(".channel-row, .channel-placeholder");
  };
  const flip = (change: () => void) => {
    for (const row of originalOrder) row.getAnimations().forEach(animation => animation.cancel());
    const before = new Map(originalOrder.filter(row => row !== drag?.row).map(row => [row, row.getBoundingClientRect().top]));
    change();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const [row, top] of before) {
      const delta = top - row.getBoundingClientRect().top;
      if (delta) row.animate({ translate: [`0 ${delta}px`, "0 0"] }, { duration: measures.displacement.duration_ms, easing: "ease" });
    }
  };
  const track = () => {
    if (!drag) return;
    const d = drag;
    const bounds = panel.getBoundingClientRect();
    const recentHeading = recent.querySelector<HTMLElement>(".channel-group-label")!;
    const boundary = recent.hidden
      ? pinned.getBoundingClientRect().bottom + measures.zones.below_pinned_px
      : recentHeading.getBoundingClientRect().top;
    d.pinned = d.x >= bounds.left && d.x <= bounds.right && d.y >= bounds.top && d.y <= bounds.bottom && d.y < boundary;
    d.row.classList.toggle("unpinning", d.fromPinned && !d.pinned);
    const pill = d.row.querySelector(".channel-drag-action");
    if (d.fromPinned && !d.pinned && !pill) {
      const holder = document.createElement("div");
      holder.setHTMLUnsafe(channelFrame.render({ name: "", state: "unpinning" }, { serializableShadowRoots: true }));
      d.row.prepend(holder.querySelector(".channel-drag-action")!);
    } else if (d.pinned) pill?.remove();
    const group = d.pinned ? pinned : recent;
    const rows = [...group.querySelectorAll<HTMLElement>(".channel-row")];
    const next = d.pinned
      ? rows.find(row => d.y < row.getBoundingClientRect().top + row.offsetHeight / 2)
      : rows.find(row => rowOrder(row) > rowOrder(d.row));
    // An absent Recent group stays absent until release; the unpin pill is its signal.
    if (!d.pinned && !rows.length && d.fromPinned) {
      d.placeholder.remove();
      syncGroups();
    } else if (d.placeholder.parentElement !== group || d.placeholder.nextElementSibling !== (next ?? null)) {
      flip(() => { group.insertBefore(d.placeholder, next ?? null); syncGroups(); });
    }
    d.row.style.left = `${d.x - d.gripX}px`;
    d.row.style.top = `${d.y - d.gripY}px`;
  };
  const scroll = (time: number) => {
    if (!drag) return;
    const rect = body.getBoundingClientRect();
    const zone = measures.autoscroll.zone_px;
    const top = zone - (drag.y - rect.top);
    const bottom = zone - (rect.bottom - drag.y);
    if (drag.x >= rect.left && drag.x <= rect.right && Math.max(top, bottom) > 0) {
      const millisecondsPerSecond = 1000;
      body.scrollTop += (top > bottom ? -1 : 1) * measures.autoscroll.speed_px_s
        * Math.min(1, Math.max(top, bottom) / zone) * (lastTime === null ? 0 : (time - lastTime) / millisecondsPerSecond);
      track();
    }
    lastTime = time;
    scrollFrame = requestAnimationFrame(scroll);
  };
  const end = (commit: boolean) => {
    if (drag) {
      const d = drag;
      flip(() => {
        if (!commit) d.origin.insertBefore(d.row, d.next);
        else if (d.placeholder.isConnected) d.placeholder.before(d.row);
        else recent.append(d.row);
        d.placeholder.remove();
        d.row.classList.remove("dragged", "unpinning");
        d.row.querySelector(".channel-drag-action")?.remove();
        if (d.style === null) d.row.removeAttribute("style"); else d.row.setAttribute("style", d.style);
        syncGroups();
      });
    }
    cancelAnimationFrame(scrollFrame);
    const pointer = press?.id;
    drag = null; press = null; lastTime = null;
    if (pointer !== undefined && panel.hasPointerCapture(pointer)) panel.releasePointerCapture(pointer);
  };
  on("pointerdown", ((event: PointerEvent) => {
    suppressClick = false;
    if (event.button !== 0 || !panel.hasAttribute("open") || panel.querySelector("input, tv-menu[open]")) return;
    const target = event.target as Element;
    if (target.closest("button, tv-menu")) return;
    const row = target.closest<HTMLElement>(".channel-row");
    if (row && panel.contains(row)) press = { row, x: event.clientX, y: event.clientY, id: event.pointerId };
  }) as EventListener, true);
  on("pointermove", ((event: PointerEvent) => {
    if (!press || event.pointerId !== press.id) return;
    if (!drag) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) <= measures.press.threshold_px) return;
      const row = press.row;
      const rect = row.getBoundingClientRect();
      const holder = document.createElement("div");
      holder.setHTMLUnsafe(placeholderFrame.render({}));
      const placeholder = holder.querySelector<HTMLElement>(".channel-placeholder")!;
      const style = row.getAttribute("style");
      const origin = row.parentElement!;
      const next = row.nextSibling;
      row.before(placeholder);
      // Carry the actual row above clipping, retaining its panel colour roles.
      const computed = getComputedStyle(row);
      for (const token of ["--channel-background", "--channel-text-color", "--channel-background-selected", "--channel-text-color-selected"]) {
        row.style.setProperty(token, computed.getPropertyValue(token));
      }
      row.classList.add("dragged");
      Object.assign(row.style, { position: "fixed", pointerEvents: "none", zIndex: "var(--layer-panel)" });
      document.body.append(row);
      const gripInset = 12; // Workshop grip correction, matching the existing sidebar rig.
      drag = { row, placeholder, origin, next, style, fromPinned: origin === pinned, pinned: origin === pinned,
        x: event.clientX, y: event.clientY, gripX: Math.max(gripInset, Math.min(press.x - rect.left, row.getBoundingClientRect().width - gripInset)),
        gripY: Math.min(press.y - rect.top, rect.height) };
      panel.setPointerCapture(press.id);
      suppressClick = true;
      scrollFrame = requestAnimationFrame(scroll);
    }
    drag.x = event.clientX; drag.y = event.clientY;
    track();
    event.preventDefault();
  }) as EventListener, true);
  on("pointerup", ((event: PointerEvent) => {
    if (press?.id === event.pointerId) end(panel.hasPointerCapture(event.pointerId));
  }) as EventListener, true);
  on("pointercancel", (() => end(false)) as EventListener, true);
  on("lostpointercapture", ((event: PointerEvent) => { if (press?.id === event.pointerId) end(false); }) as EventListener, true);
  on("keydown", ((event: KeyboardEvent) => {
    if (drag && event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); end(false); }
  }) as EventListener, true);
  on("click", ((event: MouseEvent) => {
    if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); }
  }) as EventListener, true);
  return { active: () => drag !== null, dispose: () => { end(false); removers.forEach(remove => remove()); } };
};

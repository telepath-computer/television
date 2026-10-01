// The sidebar prototype: wiring for the sidebar spec frames — staging,
// never a conformance target. One module per component; the host frame's
// script imports it and applies it to the staged region:
//   const cleanup = sidebarPrototype(root)
import appMeasures from "../../specs/ui/app/measures.yml";
import dragMeasures from "../../specs/ui/app/drag.yml";
import channelMenu from "../../specs/ui/app/sidebar/channel-menu.frame";
import { closeMenus, openMenu, wireMenuDismiss } from "./menu";
import channelFrame from "../../specs/ui/app/sidebar/channel.frame";
import channelPlaceholder from "../../specs/ui/app/sidebar/channel-placeholder.frame";

export const sidebarPrototype = (root: HTMLElement, options: { selection?: boolean } = {}): (() => void) => {
const surface = (): HTMLElement | null => root.matches(".sidebar") ? root : root.querySelector(".sidebar");
// Sub-pixel movement is layout jitter, not displacement worth animating.
const LAYOUT_TOLERANCE_PX = 0.5;
// The grip keeps at least this much of the compact preview on either side
// of the pointer, so the row never hangs beside it.
const GRIP_INSET_PX = 12;

const removers: (() => void)[] = [];
const on = (target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
  target.addEventListener(type, fn, opts);
  removers.push(() => target.removeEventListener(type, fn, opts));
};

const DRAG_THRESHOLD_PX = dragMeasures.press.threshold_px;
const DISPLACEMENT_MS = dragMeasures.displacement.duration_ms;
const SCROLL_ZONE_PX = dragMeasures.autoscroll.zone_px;
const SCROLL_SPEED_PX_S = dragMeasures.autoscroll.speed_px_s;

const guard = (ok: boolean, why: string) => {
  if (!ok) console.error(`rig guard: ${why}`);
};

// The unpin action is rendered markup (state "unpinning"), absent from a
// rest-rendered row — the prototype plucks it from a spec render on demand,
// so its copy and icon exist in one place. setHTMLUnsafe instantiates the
// icon's declarative shadow root.
const unpinPill = (): HTMLElement => {
  const holder = document.createElement("div");
  holder.setHTMLUnsafe(channelFrame.render({ name: "", state: "unpinning" }, { serializableShadowRoots: true }));
  return holder.querySelector<HTMLElement>(".channel-drag-action")!;
};

// Rows displaced by a change slide to their new place over the shared
// displacement duration.
const flip = (mutate: () => void) => {
  const rows = [...surface()!.querySelectorAll<HTMLElement>(".channel-row:not(.dragged)")];
  const before = new Map(rows.map((r) => [r, r.getBoundingClientRect()]));
  mutate();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const r of rows) {
    const b = before.get(r);
    if (!b || !r.isConnected) continue;
    const a = r.getBoundingClientRect();
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    if (Math.hypot(dx, dy) <= LAYOUT_TOLERANCE_PX) continue;
    r.animate({ translate: [`${dx}px ${dy}px`, "0px 0px"] }, { duration: DISPLACEMENT_MS, easing: "ease" });
  }
};

// Selection: singular, moved on click; a latched drag's click never
// reaches here (suppressed below), so rearranging never selects. A host
// that owns selection as application state passes selection: false.
if (options.selection !== false) on(document, "click", (e) => {
  const channel = (e.target as HTMLElement).closest<HTMLElement>(".sidebar .channel");
  if (!channel || (e.target as HTMLElement).closest(".channel-menu-trigger, tv-menu")) return;
  surface()!.querySelector('.channel[aria-selected="true"]')?.removeAttribute("aria-selected");
  channel.setAttribute("aria-selected", "true");
});

// Menus: rendered on demand from the menu frame — the spec frames carry
// no closed menus, so the prototype supplies one when a trigger is pressed
// (frames/lib/menu.ts owns opening, placement, and dismissal), computing
// pinned from the row's group.
removers.push(wireMenuDismiss(root));
on(document, "click", (e) => {
  const trigger = (e.target as HTMLElement).closest<HTMLElement>(".channel-menu-trigger");
  const row = trigger?.closest<HTMLElement>(".channel-row") ?? null;
  if (!row) return;
  const wasOpen = !!row.querySelector("tv-menu[open]");
  closeMenus(root);
  if (!wasOpen) {
    const pinned = row.closest(".channel-group") === surface()?.querySelector(".channel-group");
    openMenu(trigger!, channelMenu.render({ pinned, open: true }, { serializableShadowRoots: true }));
  }
});

// Rename renders the authored editing state on demand, just like the menu.
const startRename = (row: HTMLElement) => {
  const holder = document.createElement("div");
  holder.setHTMLUnsafe(channelFrame.render({
    name: row.querySelector(".channel")?.textContent?.trim() ?? "",
    state: "renaming",
  }, { serializableShadowRoots: true }));
  const editor = holder.querySelector<HTMLElement>(".channel-row")!;
  const input = editor.querySelector<HTMLInputElement>(".channel-rename")!;
  row.hidden = true;
  row.after(editor);
  input.focus();
  input.select();
  let finished = false;
  const finish = (commit: boolean) => {
    if (finished) return; // Enter commits, then the field's blur fires too
    finished = true;
    if (commit && input.value.trim()) {
      row.querySelector(".channel")!.textContent = input.value.trim();
    }
    editor.remove();
    row.hidden = false;
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  editor.querySelector(".channel-rename-commit")?.addEventListener("pointerdown", (e) => {
    e.preventDefault(); // beat the input's blur
    finish(true);
  });
};

on(document, "dblclick", (e) => {
  const channel = (e.target as HTMLElement).closest<HTMLElement>(".sidebar .channel");
  const row = channel?.closest<HTMLElement>(".channel-row");
  if (row) startRename(row);
});

// Menu actions: rename, pin/unpin (a move between groups, displaced rows
// sliding), delete (the row shrinks away, the list closing over it).
on(document, "click", (e) => {
  const item = (e.target as HTMLElement).closest<HTMLElement>(".sidebar tv-menu-item");
  if (!item) return;
  const row = item.closest<HTMLElement>(".channel-row")!;
  closeMenus(root);
  const action = item.textContent?.trim();
  const groups = surface()?.querySelectorAll<HTMLElement>(".channel-group");
  if (action === "Rename") startRename(row);
  if ((action === "Pin" || action === "Unpin") && groups?.length === 2) {
    flip(() => groups[action === "Pin" ? 0 : 1].append(row));
  }
  if (action === "Delete") {
    guard(!row.querySelector('[aria-selected="true"]'), "deleted the selected channel — selection invariant unspecified");
    const shrink = row.animate(
      { maxHeight: [`${row.getBoundingClientRect().height}px`, "0px"] },
      { duration: DISPLACEMENT_MS, easing: "ease" },
    );
    shrink.finished.then(() => row.remove()).catch(() => row.remove());
  }
});

// Drag: press, threshold latch, pointer capture, the compact carried row
// under a corrected grip, the placeholder tracking slots with FLIP
// displacement, edge autoscroll, drop commits, Escape or capture loss
// abandons and restores. Not wired: the unpinned group's created-order
// slot (drops append).
let press: { row: HTMLElement; x: number; y: number; pointerId: number } | null = null;
let drag: {
  row: HTMLElement; placeholder: HTMLElement; fromPinned: boolean;
  gripX: number; gripY: number; lastRef: Node | null;
  x: number; y: number; scrollFrame: number; scrollAt: number | null;
} | null = null;

on(document, "pointerdown", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>(".sidebar .channel-row");
  if (!row || row.querySelector(".channel-rename") || (e.target as HTMLElement).closest("tv-menu, .channel-menu-trigger")) return;
  press = { row, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
});

// The carried preview shrinks to its name; grabbed far along a wide row,
// the grip moves in with the shrink rather than leaving the preview
// hanging beside the pointer.
const compactWidth = (row: HTMLElement): number => {
  const preview = row.cloneNode(true) as HTMLElement;
  for (const el of [preview, ...preview.querySelectorAll<HTMLElement>("[id]")]) el.removeAttribute("id");
  preview.classList.add("dragged");
  preview.style.cssText = "position: fixed; left: -10000px; top: -10000px; visibility: hidden; pointer-events: none;";
  document.body.append(preview);
  const width = preview.getBoundingClientRect().width;
  preview.remove();
  return width;
};

const placeCarried = () => {
  if (!drag) return;
  drag.row.style.left = `${drag.x - drag.gripX}px`;
  drag.row.style.top = `${drag.y - drag.gripY}px`;
};

// The placeholder tracks the pointer through the slots; displaced rows
// slide aside. Only an actual slot change mutates and animates.
const trackSlot = () => {
  if (!drag) return;
  const { row, placeholder, fromPinned } = drag;
  const groups = surface()!.querySelectorAll<HTMLElement>(".channel-group");
  const overPinned = drag.y < groups[0].getBoundingClientRect().bottom;
  row.classList.toggle("unpinning", fromPinned && !overPinned);
  const unpinning = fromPinned && !overPinned;
  const pill = row.querySelector(".channel-drag-action");
  if (unpinning && !pill) row.prepend(unpinPill());
  if (!unpinning && pill) pill.remove();
  let parent: HTMLElement;
  let ref: Node | null;
  if (overPinned) {
    const siblings = [...groups[0].querySelectorAll<HTMLElement>(".channel-row:not(.dragged)")];
    const next = siblings.find((s) => drag!.y < s.getBoundingClientRect().top + s.offsetHeight / 2);
    parent = groups[0];
    ref = next ?? null;
  } else {
    parent = groups[1] ?? groups[0];
    ref = null; // created-order slot approximated with the group's end
  }
  const target = ref ?? parent.lastChild;
  if (drag.lastRef === (ref ?? parent)) return;
  drag.lastRef = ref ?? parent;
  flip(() => (ref ? (ref as HTMLElement).before(placeholder) : parent.append(placeholder)));
};

// Holding a drag at the scrolling region's edge scrolls it, full speed at
// the very edge tapering to nothing across the zone.
const edgeScroll = (timestamp: number) => {
  if (!drag) return;
  const body = surface()!.querySelector<HTMLElement>(".sidebar-body")!;
  const rect = body.getBoundingClientRect();
  const topInto = SCROLL_ZONE_PX - (drag.y - rect.top);
  const bottomInto = SCROLL_ZONE_PX - (rect.bottom - drag.y);
  const into = Math.max(topInto, bottomInto);
  if (into > 0) {
    const speed = SCROLL_SPEED_PX_S * Math.min(into / SCROLL_ZONE_PX, 1);
    const dt = drag.scrollAt === null ? 0 : (timestamp - drag.scrollAt) / 1000;
    body.scrollTop += (topInto > bottomInto ? -1 : 1) * speed * dt;
    trackSlot();
  }
  drag.scrollAt = timestamp;
  drag.scrollFrame = requestAnimationFrame(edgeScroll);
};

on(document, "pointermove", (e) => {
  if (press && !drag) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD_PX) return;
    const { row } = press;
    const rect = row.getBoundingClientRect();
    const compact = compactWidth(row);
    const holder = document.createElement("div");
    holder.setHTMLUnsafe(channelPlaceholder.render({}));
    const placeholder = holder.querySelector<HTMLElement>(".channel-placeholder")!;
    row.before(placeholder);
    row.classList.add("dragged");
    row.style.position = "fixed";
    try { surface()!.setPointerCapture(press.pointerId); } catch {}
    drag = {
      row, placeholder,
      fromPinned: row.closest(".channel-group") === surface()!.querySelector(".channel-group"),
      gripX: Math.min(Math.max(press.x - rect.left, GRIP_INSET_PX), compact - GRIP_INSET_PX),
      gripY: Math.min(Math.max(press.y - rect.top, 0), rect.height),
      lastRef: placeholder.parentNode, x: e.clientX, y: e.clientY,
      scrollFrame: 0, scrollAt: null,
    };
    drag.scrollFrame = requestAnimationFrame(edgeScroll);
    // The latched drag's click must not select.
    on(document, "click", (ev) => ev.stopPropagation(), { capture: true, once: true });
  }
  if (!drag) return;
  drag.x = e.clientX;
  drag.y = e.clientY;
  placeCarried();
  trackSlot();
});

const endDrag = (commit: boolean) => {
  if (drag) {
    const { row, placeholder, scrollFrame } = drag;
    cancelAnimationFrame(scrollFrame);
    if (commit) flip(() => placeholder.before(row));
    placeholder.remove();
    row.classList.remove("dragged", "unpinning");
    row.querySelector(".channel-drag-action")?.remove();
    row.style.position = row.style.left = row.style.top = "";
    guard(!!row.isConnected, "carried row lost from the document");
  }
  press = drag = null;
};
on(document, "pointerup", () => endDrag(true));
on(document, "pointercancel", () => endDrag(false));
on(document, "lostpointercapture", (e) => {
  if (drag && (e.target as HTMLElement).closest?.(".sidebar")) endDrag(false);
});
on(document, "keydown", (e) => { if (e.key === "Escape" && drag) endDrag(false); });

// Resize: the standard column-resize affordance on the edge against the
// main region — a grab zone straddling the hairline. Width is clamped and
// prototype-local; where production stores it is the app state's, per the
// spec work this rig precedes.
const SIDEBAR_MIN_PX = appMeasures.sidebar.min_width_px;
const SIDEBAR_MAX_PX = appMeasures.sidebar.max_width_px;
const RESIZE_ZONE_PX = appMeasures.sidebar.resize_band_px;
const RESIZE_OFFSET_PX = -RESIZE_ZONE_PX / 2; // straddles the edge
const region = surface()?.parentElement;
if (region) {
  const handle = document.createElement("div");
  handle.className = "rig-sidebar-resize";
  handle.setAttribute("aria-hidden", "true");
  handle.style.cssText = `position: absolute; top: 0; bottom: 0; right: ${RESIZE_OFFSET_PX}px; width: ${RESIZE_ZONE_PX}px; cursor: col-resize; z-index: 2;`;
  const priorPosition = region.style.position;
  if (getComputedStyle(region).position === "static") region.style.position = "relative";
  region.append(handle);
  // Delta from the grab point, not distance from the live edge: a centered
  // stage moves its own left edge as it widens, and live-edge math feeds
  // back on itself.
  let resizing: { pointerId: number; startX: number; startWidth: number } | null = null;
  on(handle, "pointerdown", (e) => {
    const pointer = e as PointerEvent;
    resizing = { pointerId: pointer.pointerId, startX: pointer.clientX, startWidth: region.getBoundingClientRect().width };
    handle.setPointerCapture(pointer.pointerId);
    pointer.preventDefault();
  });
  on(handle, "pointermove", (e) => {
    if (resizing === null) return;
    const pointer = e as PointerEvent;
    const width = Math.min(Math.max(resizing.startWidth + pointer.clientX - resizing.startX, SIDEBAR_MIN_PX), SIDEBAR_MAX_PX);
    region.style.width = `${width}px`;
  });
  const endResize = () => { resizing = null; };
  on(handle, "pointerup", endResize);
  on(handle, "pointercancel", endResize);
  removers.push(() => { handle.remove(); region.style.position = priorPosition; });
}

return () => {
  endDrag(false);
  for (const remover of removers) remover();
};
};

// The channel sidebar's staged behaviors, wired onto a live sidebar render — one
// module so every frame runs the same wiring. What each piece enforces is
// the spec's ([[ui/app/sidebar/index.md]]); what is here is mechanism only:
// event plumbing, positions, and the model mutations.
//
// The model is CHANNELS (state.ts). Every repaint is a fresh spec render.
import { CHANNELS, pinned, unpinned, nextCreated } from "./state.ts";
import type { Channel } from "./state.ts";
import { AUTOSCROLL_SPEED_PX_S, AUTOSCROLL_ZONE_PX, BELOW_PINNED_PX, DRAG_DISPLACEMENT_MS, DRAG_THRESHOLD_PX } from "./drag.ts";
import icon from "../../specs/ui/foundation/icons/template.liquid";
import deleteConfirm from "../../specs/ui/app/sidebar/delete-confirm.liquid";
import sidebarContent from "../../specs/ui/app/sidebar/content.yml?raw";

const injectedStyles = new Set<string>();
const injectStyles = (styles: string[]) => {
  for (const css of styles) {
    if (injectedStyles.has(css)) continue;
    injectedStyles.add(css);
    document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
  }
};

const UNPIN_LABEL = sidebarContent.match(/^unpin_label:\s*(.+)$/m)![1];
const PINNED_HEADING = sidebarContent.match(/^pinned_heading:\s*(.+)$/m)![1];
const UNPINNED_HEADING = sidebarContent.match(/^unpinned_heading:\s*(.+)$/m)![1];
export const CREATE_NAME = sidebarContent.match(/^create_name:\s*(.+)$/m)![1];

type Rendering = { markup: string; styles: string[] };
type SidebarTemplate = (args: {
  pinned: { id: string; name: string; selected?: boolean; renaming?: boolean }[];
  unpinned: { id: string; name: string; selected?: boolean; renaming?: boolean }[];
}) => Rendering;

let workshopMenuCounter = 0;

export function pairChannelRowMenus(container: HTMLElement): void {
  for (const row of container.querySelectorAll<HTMLElement>(".channel-row")) {
    const trigger = row.querySelector<HTMLElement>(".channel-menu-trigger");
    const panel = trigger?.nextElementSibling;
    if (trigger && panel instanceof HTMLElement && panel.matches(".menu")) {
      panel.id = `workshop-channel-menu-${++workshopMenuCounter}`;
      trigger.setAttribute("popovertarget", panel.id);
    }
  }
}

export function prepareChannelRows(container: HTMLElement): void {
  const channels = [...pinned(), ...unpinned()];
  for (const [index, row] of [...container.querySelectorAll<HTMLElement>(".channel-row")].entries()) {
    const channel = channels[index];
    if (channel) row.dataset.channelId = channel.id;
  }
  pairChannelRowMenus(container);
}

/**
 * Wires a freshly rendered rename field in `container`, if one is there
 * ([[ui/app/sidebar/index.md]], Renaming): focus, the name selected whole;
 * Enter, the check, or blur commits, Escape abandons; an emptied name
 * commits nothing. `finish` runs once, after any commit has been applied
 * to `channel` — the caller clears its renaming mark and repaints there.
 */
export function wireRenameField(container: HTMLElement, channel: Channel | null, finish: () => void): void {
  const field = container.querySelector<HTMLInputElement>(".channel-rename");
  if (!field) return;
  field.focus();
  field.select();
  // One exit only: Enter and blur race (committing repaints, and the
  // repaint would fire the field's blur), so the first exit wins.
  let done = false;
  const settle = (commit: boolean): void => {
    if (done) return;
    done = true;
    const name = field.value.trim();
    if (commit && name && channel) channel.name = name;
    finish();
  };
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") settle(true);
    if (event.key === "Escape") settle(false);
  });
  field.addEventListener("blur", () => settle(true));
  // The check commits on pointer down: waiting for the click would let
  // the field's blur commit-and-repaint first and the press land on air.
  container.querySelector(".channel-rename-commit")?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    settle(true);
  });
}

/** Interaction-driven rows enter and leave by size, not by snap
 *  ([[ui/app/sidebar/index.md]], Creating and Deleting): a removed row
 *  shrinks away and a born row grows into place, both on the shared
 *  displacement duration — neighbours ride the height change. */
export const collapseRow = (row: HTMLElement): Promise<unknown> => {
  row.style.overflow = "hidden";
  return row.animate(
    [{ height: `${row.getBoundingClientRect().height}px`, opacity: 1 }, { height: "0px", opacity: 0 }],
    { duration: DRAG_DISPLACEMENT_MS, easing: "ease" },
  ).finished;
};

export const growRow = (row: HTMLElement | null): Promise<unknown> => {
  if (!row) return Promise.resolve();
  row.style.overflow = "hidden";
  const height = row.getBoundingClientRect().height;
  const grown = row.animate(
    [{ height: "0px", opacity: 0 }, { height: `${height}px`, opacity: 1 }],
    { duration: DRAG_DISPLACEMENT_MS, easing: "ease" },
  );
  return grown.finished.then(() => { row.style.overflow = ""; });
};

/**
 * Throwaway selection, rename, and create wiring for the standalone Sidebar
 * frames: a channel selects on release without movement, the row menu's
 * Rename edits the name in place, and the foot's button creates the newest
 * channel born renaming. The list is re-rendered from the template rather
 * than having classes toggled, so what is on screen is always a spec
 * render. The App frame does not use this — its selection also moves the
 * stage, so it carries its own wiring — but shares wireRenameField,
 * wirePinning and wireScrollEdge. Returns the painter, for wirePinning.
 */
export function wireSelection(container: HTMLElement, sidebar: SidebarTemplate): (() => void) {
  // While channels exist, one is selected, starting with the first pinned
  // channel. Clicking moves the selection; deleting the last leaves none.
  let selected = [...pinned(), ...unpinned()][0];
  let renaming: Channel | null = null;

  // Rows map to channels by position — every row has a .channel-row whether
  // it holds the button or the rename field. The order reads fresh each
  // time: creating grows the list.
  const channelAt = (target: HTMLElement): Channel | undefined =>
    [...pinned(), ...unpinned()][[...container.querySelectorAll(".channel-row")].indexOf(target.closest(".channel-row")!)];

  const paint = (): void => {
    const mark = (channel: Channel) => ({ id: channel.id, name: channel.name, selected: channel === selected, renaming: channel === renaming });
    // A repaint replaces the scrolling region, which would silently reset
    // its scroll; the reader's place survives the redraw.
    const scrolled = container.querySelector(".sidebar-body")?.scrollTop ?? 0;
    container.innerHTML = sidebar({ pinned: pinned().map(mark), unpinned: unpinned().map(mark) }).markup;
    prepareChannelRows(container);
    if (scrolled) container.querySelector(".sidebar-body")!.scrollTop = scrolled;
    wireRenameField(container, renaming, () => {
      renaming = null;
      paint();
    });
  };

  // Selection on release without movement ([[ui/app/sidebar/index.md]],
  // Interaction): the press records the channel (before any rename commit
  // repaints the rows), the release selects it.
  let pressed: { channel: Channel | undefined; x: number; y: number } | null = null;
  container.addEventListener("pointerdown", (event) => {
    const row = (event.target as HTMLElement).closest(".channel");
    if (!row) return;
    pressed = { channel: channelAt(row as HTMLElement), x: event.clientX, y: event.clientY };
    // Pressing elsewhere commits any edit in flight (leaving the field
    // commits).
    container.querySelector<HTMLInputElement>(".channel-rename")?.blur();
  });
  container.addEventListener("pointerup", (event) => {
    if (!pressed) return;
    const { channel, x, y } = pressed;
    pressed = null;
    if (Math.hypot(event.clientX - x, event.clientY - y) > DRAG_THRESHOLD_PX) return;
    selected = channel ?? selected;
    paint();
  });

  container.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest(".menu-item");
    if (!item || item.textContent?.trim() !== "Rename") return;
    renaming = channelAt(item as HTMLElement) ?? null;
    paint();
  });

  // Creating ([[ui/app/sidebar/index.md]], Creating): the newest channel,
  // born "New channel", selected, renaming in place.
  let made = 0;
  container.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest(".channel-create")) return;
    const channel: Channel = { id: `made-${++made}`, name: CREATE_NAME, created: nextCreated(), pages: [] };
    CHANNELS.unshift(channel);
    selected = channel;
    paint();
    // The row grows in plainly first; the rename field (and its selection)
    // takes the seat when the growth lands — a field mid-grow flickers its
    // highlight. The swap is invisible: the field wears the row's box.
    const row = [...container.querySelectorAll<HTMLElement>(".channel-row")]
      .find((candidate) => candidate.dataset.channelId === channel.id) ?? null;
    growRow(row).then(() => {
      renaming = channel;
      paint();
    });
  });

  // Deleting ([[ui/app/sidebar/index.md]], Deleting): confirms with the
  // alert; deleting the selected channel moves selection to the first
  // pinned channel, or the first there is; deleting the last leaves the
  // no-channels state.
  container.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest(".menu-item");
    if (!item || item.textContent?.trim() !== "Delete") return;
    (item.closest(".menu") as HTMLElement & { hidePopover(): void }).hidePopover();
    const channel = channelAt(item as HTMLElement);
    if (!channel) return;
    const rendered = deleteConfirm({ name: channel.name });
    injectStyles(rendered.styles);
    document.body.insertAdjacentHTML("beforeend", rendered.markup);
    const overlay = document.body.lastElementChild as HTMLElement;
    const [cancelBtn, deleteBtn] = overlay.querySelectorAll("button");
    (cancelBtn as HTMLElement).focus();
    cancelBtn.addEventListener("click", () => overlay.remove());
    deleteBtn.addEventListener("click", async () => {
      overlay.remove();
      const rowEl = [...container.querySelectorAll<HTMLElement>(".channel-row")]
        .find((candidate) => candidate.dataset.channelId === channel.id);
      if (rowEl) await collapseRow(rowEl);
      const wasSelected = channel === selected;
      CHANNELS.splice(CHANNELS.indexOf(channel), 1);
      // Deleting the last channel leaves no channels at all
      // ([[ui/app/sidebar/index.md]], Deleting): no groups, nothing
      // selected; the create affordance stays.
      if (wasSelected) selected = pinned()[0] ?? unpinned()[0];
      paint();
    });
  });

  paint();
  return paint;
}

/** The scrolled top edge's state mirror ([[ui/app/sidebar/index.md]],
 *  Interaction): the body carries `continues-start` while anything is
 *  scrolled past its top edge; the titlebar's line is styles.css's.
 *  Survives repaints — the attribute re-mirrors on every scroll and on
 *  wiring. */
export function wireScrollEdge(container: HTMLElement): void {
  const mirror = () => {
    const body = container.querySelector(".sidebar-body");
    body?.toggleAttribute("continues-start", body.scrollTop > 0);
  };
  container.addEventListener("scroll", mirror, true);
  mirror();
}

// The carried preview's grab point clamps this far inside its right edge,
// so the compact preview does not fly out from under the pointer.
const GRAB_MARGIN = 24;

/**
 * Pinning and reordering ([[ui/app/sidebar/index.md]], Pinning and
 * reordering): the row menu's Pin joins the end of the pinned group and
 * Unpin returns to created order; dragging past the press threshold lifts
 * the row as a compact preview. Over the pinned group a placeholder marks
 * the pointer's slot; over the unpinned group a recent row's placeholder
 * holds its own created-order slot, while a pinned row shows no placeholder
 * — the preview wears the unpin action instead. Rows make way on drag.yml's
 * displacement duration; release commits wherever the pointer is; Escape,
 * pointer cancellation, and unexpected capture loss abandon.
 *
 * A pinned-arrangement commit rebuilds CHANNELS to display order (the
 * pinned block first, in its new order), so index-based consumers stay
 * coherent; `aroundCommit` lets a frame bracket the mutation (the App
 * re-points its index-based selection through it).
 */
export function wirePinning(
  container: HTMLElement,
  opts: { repaint: () => void; aroundCommit?: (commit: () => void) => void },
): void {
  const apply = opts.aroundCommit ?? ((commit: () => void) => commit());

  // Staging stamps domain identity onto each rendered row so lookup survives
  // a lifted row leaving the list; menu pairing ids are deliberately opaque.
  const rowChannel = (row: Element): Channel | undefined => {
    const id = (row as HTMLElement).dataset.channelId;
    return CHANNELS.find((c) => c.id === id);
  };

  // Commit: slot null unpins; a number pins at that position in the
  // arrangement. The array is rebuilt to display order.
  const commit = (channel: Channel, slot: number | null): void => {
    if (slot == null) {
      channel.pinned = false;
    } else {
      channel.pinned = true;
      const arrangement = pinned().filter((c) => c !== channel);
      arrangement.splice(slot, 0, channel);
      const rest = CHANNELS.filter((c) => !arrangement.includes(c));
      CHANNELS.splice(0, CHANNELS.length, ...arrangement, ...rest);
    }
  };

  container.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest(".menu .menu-item");
    if (!item) return;
    const label = item.textContent?.trim();
    if (label !== "Pin" && label !== "Unpin") return;
    (item.closest(".menu") as HTMLElement & { hidePopover(): void }).hidePopover();
    const channel = rowChannel(item.closest(".channel-row")!);
    if (!channel) return;
    apply(() => commit(channel, label === "Pin" ? pinned().length : null));
    opts.repaint();
  });

  let press: { channel: Channel; pointerId: number; x: number; y: number } | null = null;
  let drag: { channel: Channel; pointerId: number; row: HTMLElement; slotEl: HTMLElement; offsetX: number; offsetY: number; slot: number | null; lastX: number; lastY: number } | null = null;

  // With nothing pinned the group materializes mid-drag ([[ui/app/sidebar/index.md]],
  // Pinning and reordering): entering its zone brings heading and placeholder
  // down from the top; leaving collapses it back. The markup restates the
  // template's group — a drag never re-renders — and the negative margin
  // counters the sibling gap the recent group gains while it exists.
  let ghostGroup: HTMLElement | null = null;
  const materializeGroup = (label: string): HTMLElement => {
    if (ghostGroup?.isConnected && ghostGroup.querySelector(".channel-group-label")?.textContent === label) return ghostGroup;
    const section = document.createElement("section");
    section.className = "channel-group";
    section.setAttribute("data-materialized", "");
    section.innerHTML = `<h2 class="channel-group-label">${label}</h2>`;
    const body = container.querySelector(".sidebar-body")!;
    const { pinnedGroup, recentGroup } = groups();
    if (label === PINNED_HEADING) (recentGroup ? recentGroup.before(section) : body.prepend(section));
    else (pinnedGroup ? pinnedGroup.after(section) : body.prepend(section));
    ghostGroup = section;
    return section;
  };
  // Marked so the group query ignores it while it leaves — re-entering
  // the zone mid-collapse materializes a fresh one.
  const collapseGroup = (section: HTMLElement) => {
    section.setAttribute("data-collapsing", "");
    const height = section.getBoundingClientRect().height;
    section.style.overflow = "hidden";
    section
      .animate(
        [{ height: `${height}px`, marginBottom: "0px", opacity: 1 }, { height: "0px", marginBottom: "-24px", opacity: 0 }],
        { duration: DRAG_DISPLACEMENT_MS, easing: "ease" },
      )
      .finished.then(() => section.remove());
  };
  const settleGhost = () => {
    const section = ghostGroup;
    if (!section?.isConnected) return;
    ghostGroup = null;
    collapseGroup(section);
  };
  const growGroup = (section: HTMLElement) => {
    const height = section.getBoundingClientRect().height;
    section.style.overflow = "hidden";
    section
      .animate(
        [{ height: "0px", marginBottom: "-24px", opacity: 0 }, { height: `${height}px`, marginBottom: "0px", opacity: 1 }],
        { duration: DRAG_DISPLACEMENT_MS, easing: "ease" },
      )
      .finished.then(() => { section.style.overflow = ""; });
  };

  // Carrying a row near the scrolling region's edge scrolls the list,
  // faster the nearer the edge (drag.yml's zone and speed). The loop runs
  // only while a drag holds inside a zone, and re-reads the slot after
  // each scrolled frame — the rows moved under the pointer.
  let scrollFrame = 0;
  let lastTick = 0;
  const autoScroll = (now: number) => {
    scrollFrame = 0;
    if (!drag) return;
    const body = container.querySelector(".sidebar-body");
    if (!body) return;
    const dt = lastTick ? (now - lastTick) / 1000 : 0;
    lastTick = now;
    const rect = body.getBoundingClientRect();
    const fromTop = drag.lastY - rect.top;
    const fromBottom = rect.bottom - drag.lastY;
    let velocity = 0;
    if (fromTop < AUTOSCROLL_ZONE_PX) velocity = -AUTOSCROLL_SPEED_PX_S * (1 - Math.max(0, fromTop) / AUTOSCROLL_ZONE_PX);
    else if (fromBottom < AUTOSCROLL_ZONE_PX) velocity = AUTOSCROLL_SPEED_PX_S * (1 - Math.max(0, fromBottom) / AUTOSCROLL_ZONE_PX);
    if (velocity !== 0) {
      const before = body.scrollTop;
      body.scrollTop += velocity * dt;
      if (body.scrollTop !== before) placeDrag();
      scrollFrame = requestAnimationFrame(autoScroll);
    } else {
      lastTick = 0;
    }
  };
  const armAutoScroll = () => {
    if (!scrollFrame) {
      lastTick = 0;
      scrollFrame = requestAnimationFrame(autoScroll);
    }
  };

  container.addEventListener("pointerdown", (event) => {
    const channelBtn = (event.target as HTMLElement).closest(".channel");
    if (!channelBtn) return;
    const channel = rowChannel(channelBtn.closest(".channel-row")!);
    if (!channel) return;
    press = { channel, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  });

  // An empty group never renders ([[ui/app/sidebar/index.md]]), so either
  // may be absent; the headings name them.
  const groups = (): { pinnedGroup: Element | null; recentGroup: Element | null } => {
    const els = [...container.querySelectorAll(".channel-group:not([data-collapsing])")];
    const byLabel = (label: string) => els.find((e) => e.querySelector(".channel-group-label")?.textContent === label) ?? null;
    return { pinnedGroup: byLabel(PINNED_HEADING), recentGroup: byLabel(UNPINNED_HEADING) };
  };

  const beginDrag = (event: PointerEvent) => {
    const { channel } = press!;
    // Resolved from the live DOM at lift, not at press: a rename commit may
    // have repainted the rows in between (leaving the field commits).
    const row = ([...container.querySelectorAll(".channel-row")].find((r) => rowChannel(r) === channel) ?? null) as HTMLElement | null;
    if (!row) { press = null; return; }
    const rect = row.getBoundingClientRect();
    container.setPointerCapture(event.pointerId);
    // The placeholder, the carried row's compact preview, and the unpin
    // action are the spec's (channel.liquid / channel.css); position and
    // the placeholder's size arrive from here.
    const slotEl = document.createElement("span");
    slotEl.className = "channel-placeholder";
    slotEl.setAttribute("aria-hidden", "true");
    slotEl.style.height = `${rect.height}px`;
    row.replaceWith(slotEl);
    row.setAttribute("dragged", "");
    row.style.position = "fixed";
    row.style.pointerEvents = "none";
    document.body.append(row);
    const width = row.getBoundingClientRect().width;
    drag = { channel, pointerId: event.pointerId, row, slotEl, offsetX: Math.min(press!.x - rect.left, width - GRAB_MARGIN), offsetY: press!.y - rect.top, slot: null, lastX: press!.x, lastY: press!.y };
    moveDrag(event);
  };

  // Displaced rows slide rather than snap — the shared displacement
  // duration, via first/last-position inversion around the slot move.
  const withSlide = (mutate: () => void) => {
    const rows = [...container.querySelectorAll<HTMLElement>(".channel-row")];
    const before = rows.map((r) => r.getBoundingClientRect().top);
    mutate();
    rows.forEach((r, i) => {
      const d = before[i] - r.getBoundingClientRect().top;
      if (!d) return;
      r.style.transition = "none";
      r.style.translate = `0 ${d}px`;
      requestAnimationFrame(() => {
        r.style.transition = `translate ${DRAG_DISPLACEMENT_MS}ms ease`;
        r.style.translate = "0 0";
      });
    });
  };

  const moveDrag = (event: PointerEvent) => {
    drag!.lastX = event.clientX;
    drag!.lastY = event.clientY;
    placeDrag();
    armAutoScroll();
  };

  const placeDrag = () => {
    const { row, offsetX, offsetY, slotEl, channel, lastX, lastY } = drag!;
    row.style.left = `${lastX - offsetX}px`;
    row.style.top = `${lastY - offsetY}px`;
    const { pinnedGroup, recentGroup } = groups();
    // The unpinned zone begins at its group's heading — or, with no
    // unpinned group to mark it, drag.yml's stated distance below the last
    // pinned row. The pinned zone lives only within the sidebar: outside
    // it, sideways included, is the unpinned side, so dragging a pinned
    // row out and releasing unpins.
    const sidebarRect = container.querySelector(".sidebar")!.getBoundingClientRect();
    const outside = lastX < sidebarRect.left || lastX > sidebarRect.right;
    const boundary = recentGroup
      ? recentGroup.querySelector(".channel-group-label")!.getBoundingClientRect().top
      : pinnedGroup
        ? pinnedGroup.getBoundingClientRect().bottom + BELOW_PINNED_PX
        : Number.NEGATIVE_INFINITY;
    if (!outside && lastY < boundary) {
      row.removeAttribute("unpinning");
      row.querySelector(".channel-drag-action")?.remove();
      let group = pinnedGroup as HTMLElement | null;
      if (!group) {
        // The group a drop would create comes down from the top, the
        // placeholder inside it.
        group = materializeGroup(PINNED_HEADING);
        if (slotEl.parentElement !== group) {
          group.append(slotEl);
          growGroup(group);
        }
        drag!.slot = 0;
        return;
      }
      // Carrying the only unpinned row up empties the other group; it
      // leaves the same way and returns if the row comes back.
      if (recentGroup && !recentGroup.querySelector(".channel-row") && !recentGroup.contains(slotEl)) {
        collapseGroup(recentGroup as HTMLElement);
      }
      const rows = [...group.querySelectorAll(".channel-row")];
      let index = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (lastY < r.top + r.height / 2) { index = i; break; }
      }
      const anchor = rows[index] ?? null;
      if (slotEl.parentElement !== group || slotEl.nextElementSibling !== anchor) {
        withSlide(() => group!.insertBefore(slotEl, anchor));
      }
      drag!.slot = index;
    } else {
      settleGhost();
      // A recent row's placeholder holds its own created-order slot —
      // where it came from, so nothing moves. An unpinning row shows no
      // placeholder at all: the carried row wears the unpin action, and
      // the list closes. The injected markup restates channel.liquid's
      // `unpinning` render — a drag never re-renders the template, the
      // same trade the tab placeholder makes — so it must match it.
      if (channel.pinned) {
        if (!row.hasAttribute("unpinning")) {
          row.setAttribute("unpinning", "");
          row.insertAdjacentHTML("afterbegin", `<span class="channel-drag-action" aria-hidden="true">${icon({ name: "unpin" }).markup}${UNPIN_LABEL}</span>`);
        }
        // Carrying the only pinned row out empties its group: it leaves
        // the way the materialized one does, and re-entering brings it
        // back (the ghost path).
        if (pinnedGroup && !pinnedGroup.querySelector(".channel-row")) collapseGroup(pinnedGroup as HTMLElement);
      } else {
        row.removeAttribute("unpinning");
        row.querySelector(".channel-drag-action")?.remove();
      }
      // The placeholder sits at the created-order slot in the existing
      // group, whatever the row's origin. With no unpinned group nothing
      // materializes and nothing is marked — the unpin action is the whole
      // signal, and the drop creates the group. A recent-origin row whose
      // group emptied mid-drag gets it back, its own slot inside.
      let group = recentGroup as HTMLElement | null;
      if (!group) {
        if (channel.pinned) {
          if (slotEl.parentElement) withSlide(() => slotEl.remove());
          drag!.slot = null;
          return;
        }
        group = materializeGroup(UNPINNED_HEADING);
        if (slotEl.parentElement !== group) {
          group.append(slotEl);
          growGroup(group);
        }
        drag!.slot = null;
        return;
      }
      const after = unpinned().filter((c) => c !== channel && c.created < channel.created);
      const anchor = after.length
        ? [...group.querySelectorAll(".channel-row")].find((r) => rowChannel(r) === after[0]) ?? null
        : null;
      if (slotEl.parentElement !== group || slotEl.nextElementSibling !== anchor) {
        withSlide(() => group!.insertBefore(slotEl, anchor));
      }
      drag!.slot = null;
    }
  };

  container.addEventListener("pointermove", (event) => {
    if (drag) {
      if (event.pointerId === drag.pointerId) moveDrag(event);
      return;
    }
    if (!press || event.pointerId !== press.pointerId) return;
    // pointermove also fires with no button held: a press survives only
    // while its button does.
    if (event.buttons === 0) { press = null; return; }
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_THRESHOLD_PX) beginDrag(event);
  });

  const endDrag = (commitIt: boolean) => {
    if (!drag) return;
    const { channel, pointerId, row, slot } = drag;
    if (scrollFrame) { cancelAnimationFrame(scrollFrame); scrollFrame = 0; }
    row.remove();
    drag = null;
    press = null;
    if (commitIt) apply(() => commit(channel, slot));
    if (!commitIt && container.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId);
    opts.repaint();
  };

  container.addEventListener("pointerup", (event) => {
    if (drag) {
      if (event.pointerId === drag.pointerId) endDrag(true);
      return;
    }
    if (press?.pointerId === event.pointerId) press = null;
  });

  container.addEventListener("pointercancel", (event) => {
    if (drag?.pointerId === event.pointerId) {
      endDrag(false);
      return;
    }
    if (press?.pointerId === event.pointerId) press = null;
  });

  container.addEventListener("lostpointercapture", (event) => {
    if (drag?.pointerId === event.pointerId) endDrag(false);
  });

  // On the window (focus may sit anywhere), but self-detaching once the
  // container leaves the document — the App re-wires per render, and
  // without this each render's listener would linger for the session.
  const onKeydown = (event: KeyboardEvent) => {
    if (!container.isConnected) {
      window.removeEventListener("keydown", onKeydown);
      return;
    }
    if (event.key === "Escape" && drag) endDrag(false);
  };
  window.addEventListener("keydown", onKeydown);
}

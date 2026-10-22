// Motion for the calendar: events arriving, leaving and moving, and the days
// sliding when the range changes. Nothing moves when the person has asked for
// reduced motion.
//
// An event that moves or changes size starts where it was drawn and glides
// to its new place (first, last, invert, play). Days kept across a change in
// how many days show glide the same way. A day, or an event, that stops
// showing is put back where it was drawn as a copy that fades out and is then
// removed. A change of start date slides the whole calendar sideways with a
// view transition, so the days on screen before and after line up as one
// strip.

const ARRIVE = [
  { opacity: 0, scale: "0.92", translate: "0 6px" },
  { opacity: 1, scale: "1", translate: "0 0" },
];
const ARRIVE_MS = 520;
const ARRIVE_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
// Events that arrive together follow one another in time order, all within
// a short span however many there are.
const STAGGER_MS = 40;
const STAGGER_MAX_MS = 360;

// Leaving starts from the event as it is drawn, even part-way through
// arriving, so it has only an end.
const LEAVE = [{ opacity: 0, scale: "0.94" }];
const LEAVE_MS = 260;
const LEAVE_EASE = "cubic-bezier(0.4, 0, 1, 1)";

const MOVE_MS = 450;
const MOVE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const MOVE_ID = "calendar-move";

const SLIDE_MS = 520;
const SLIDE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const DAY_FADE_MS = MOVE_MS;
const DAY_FADE_EASE = "ease";

// Day parts still shown; the copies of days on their way out are left out.
const DAY_PARTS = ":is(calendar-day, calendar-column, calendar-cell):not([data-leaving])";

export function motionAllowed() {
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const innerOf = (event) => event.querySelector(":scope > .event-block > .event-block-inner");

/** Whether an event is drawn on the calendar now, and not on its way out. */
function isPlaced(event) {
  const parent = event.parentElement?.localName;
  return (parent === "calendar-grid" || parent === "calendar-allday") && !event.hasAttribute("data-leaving") && innerOf(event) !== null;
}

/** Where an element's layout box sits inside a positioned ancestor, ignoring transforms. */
function offsetIn(element, container) {
  let left = 0;
  let top = 0;
  for (let node = element; node && node !== container; node = node.offsetParent) {
    left += node.offsetLeft;
    top += node.offsetTop;
  }
  return { left, top, width: element.offsetWidth, height: element.offsetHeight };
}

/**
 * Where every drawn event and day is now, as the person sees it, and what is
 * needed to draw it again in place if it stops showing.
 */
export function measure(week) {
  const events = new Map();
  for (const event of week.querySelectorAll("calendar-event")) {
    if (!isPlaced(event)) continue;
    const inner = innerOf(event);
    const box = inner.getBoundingClientRect();
    const container = event.parentElement;
    events.set(event, {
      left: box.left,
      top: box.top,
      width: inner.offsetWidth,
      height: inner.offsetHeight,
      block: inner.parentElement,
      container,
      size: event.dataset.size,
      place: offsetIn(inner, container),
    });
  }
  const days = new Map();
  for (const part of week.querySelectorAll(DAY_PARTS)) {
    const box = part.getBoundingClientRect();
    days.set(`${part.localName} ${part.getAttribute("date")}`, {
      left: box.left,
      width: box.width,
      part,
      container: part.parentElement,
      background: getComputedStyle(part).backgroundColor,
      place: offsetIn(part, part.parentElement),
    });
  }
  return { events, days };
}

/** The container to draw a copy in: the one it was in, or the one now in its place. */
function containerFor(week, container) {
  return container.isConnected ? container : week.querySelector(`:scope > ${container.localName}`);
}

/** Pins an element at a layout box inside its positioned container. */
function pin(element, { left, top, width, height }) {
  Object.assign(element.style, { position: "absolute", margin: "0", left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
}

/**
 * Draws an event that is still in the calendar but no longer shown, as on a
 * day that stops showing, as a copy where it was, and lets the copy leave.
 */
function leaveCopy(week, event, from) {
  const container = containerFor(week, from.container);
  if (!container) return;
  const copy = event.cloneNode(false);
  copy.removeAttribute("data-key");
  copy.removeAttribute("style");
  if (from.size) copy.dataset.size = from.size;
  // The block covers the container, and the block inside sits where it was.
  Object.assign(from.block.style, { position: "absolute", inset: "0", padding: "0", gridArea: "auto" });
  pin(from.block.firstElementChild, from.place);
  copy.append(from.block);
  container.append(copy);
  leave(copy);
}

/** Draws a day part that has stopped showing where it was, and fades it out. */
function fadeOutDay(week, from) {
  const container = containerFor(week, from.container);
  if (!container) return;
  const { part } = from;
  part.setAttribute("data-leaving", "");
  part.style.gridArea = "auto";
  part.style.backgroundColor = from.background;
  pin(part, from.place);
  container.append(part);
  const animation = part.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DAY_FADE_MS, easing: DAY_FADE_EASE, fill: "forwards" });
  animation.finished.then(() => part.remove(), () => part.remove());
}

/**
 * Moves what changed from where it was to where it now is: events that moved
 * or resized glide, new events arrive, and events that stopped showing leave.
 * Days kept across a change in the number of days glide to their new
 * columns, new days fade in, and days that stopped showing fade out.
 */
export function play(week, before) {
  const arriving = [];
  for (const [event, from] of before.events) {
    if (event.isConnected && !isPlaced(event) && from.block.parentElement !== event) leaveCopy(week, event, from);
  }
  for (const event of week.querySelectorAll("calendar-event")) {
    if (!isPlaced(event)) continue;
    const inner = innerOf(event);
    const from = before.events.get(event);
    if (!from) {
      arriving.push(event);
      continue;
    }
    for (const animation of inner.getAnimations()) if (animation.id === MOVE_ID) animation.cancel();
    const box = inner.getBoundingClientRect();
    const to = { left: box.left, top: box.top, width: inner.offsetWidth, height: inner.offsetHeight };
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(from.width - to.width) < 0.5 && Math.abs(from.height - to.height) < 0.5) continue;
    const animation = inner.animate([
      { translate: `${dx}px ${dy}px`, width: `${from.width}px`, height: `${from.height}px` },
      { translate: "0 0", width: `${to.width}px`, height: `${to.height}px` },
    ], { duration: MOVE_MS, easing: MOVE_EASE });
    animation.id = MOVE_ID;
  }
  arrive(arriving);

  if (before.days.size === 0) return;
  const shown = new Set();
  for (const part of week.querySelectorAll(DAY_PARTS)) {
    const key = `${part.localName} ${part.getAttribute("date")}`;
    shown.add(key);
    const from = before.days.get(key);
    if (!from) {
      part.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DAY_FADE_MS, easing: DAY_FADE_EASE });
      continue;
    }
    const box = part.getBoundingClientRect();
    const dx = from.left - box.left;
    // Headers keep their size, so their text never stretches; the columns
    // and all-day cells behind the events stretch to their new width.
    const scale = part.localName === "calendar-day" || box.width === 0 ? 1 : from.width / box.width;
    if (Math.abs(dx) < 0.5 && Math.abs(scale - 1) < 0.005) continue;
    part.animate([
      { translate: `${dx}px 0`, scale: `${scale} 1`, transformOrigin: "0 0" },
      { translate: "0 0", scale: "1 1", transformOrigin: "0 0" },
    ], { duration: MOVE_MS, easing: MOVE_EASE });
  }
  for (const [key, from] of before.days) {
    if (!shown.has(key) && !from.part.isConnected) fadeOutDay(week, from);
  }
}

/** Plays the arrival of new events, in start order. */
function arrive(events) {
  const ordered = [...events].sort((a, b) => (a.getAttribute("start") ?? "").localeCompare(b.getAttribute("start") ?? ""));
  const step = ordered.length > 1 ? Math.min(STAGGER_MS, STAGGER_MAX_MS / (ordered.length - 1)) : 0;
  ordered.forEach((event, index) => {
    innerOf(event).animate(ARRIVE, { duration: ARRIVE_MS, delay: index * step, easing: ARRIVE_EASE, fill: "backwards" });
  });
}

/** Plays an event leaving, then removes it. */
export function leave(event) {
  event.setAttribute("data-leaving", "");
  const animation = innerOf(event).animate(LEAVE, { duration: LEAVE_MS, easing: LEAVE_EASE, fill: "forwards" });
  animation.finished.then(() => event.remove(), () => event.remove());
}

// Each hour label in view is captured on its own, so it stays put while the
// days slide. Labels scrolled away, or under the pinned headers, stay in the
// days' capture, where the clip hides them.
function nameHourLabels(week, named) {
  const top = week.querySelector("calendar-headers")?.getBoundingClientRect().bottom ?? 0;
  const bottom = week.getBoundingClientRect().bottom;
  week.querySelectorAll(".hour-label").forEach((label, index) => {
    const box = label.getBoundingClientRect();
    label.style.viewTransitionName = named && box.top >= top && box.bottom <= bottom ? `calendar-hour-${index}` : "";
  });
}

// The slide under way, so that the end of one cut short by the next leaves
// the next one's names in place.
let sliding = null;

/**
 * Slides the calendar to a new start date: forward slides left, back slides
 * right. A move of up to the days shown slides by that many columns; a
 * longer one brings the new days in right beside the old. When the month
 * title changes, the old title fades out and then the new one fades in.
 * `update` changes the calendar. Returns false, having done nothing, when
 * the browser cannot play the slide or motion is reduced, so the caller
 * updates directly.
 */
export function slide(week, { shiftDays, dayCount, titleChanges }, update) {
  if (!document.startViewTransition || !motionAllowed() || shiftDays === 0) return false;
  const root = document.documentElement;
  const column = week.querySelector("calendar-column")?.offsetWidth ?? 0;
  const gutter = parseFloat(getComputedStyle(week).getPropertyValue("--calendar-gutter")) || 0;
  const distance = Math.sign(shiftDays) * Math.min(Math.abs(shiftDays), dayCount) * column;
  root.style.setProperty("--calendar-move-gutter", `${gutter}px`);
  root.dataset.calendarMove = titleChanges ? "month" : "";
  nameHourLabels(week, true);
  const transition = document.startViewTransition(() => {
    update();
    nameHourLabels(week, true);
  });
  transition.ready.then(() => {
    const options = { duration: SLIDE_MS, easing: SLIDE_EASE };
    root.animate({ transform: ["translateX(0)", `translateX(${-distance}px)`] }, { ...options, pseudoElement: "::view-transition-old(calendar-days)" });
    root.animate({ transform: [`translateX(${distance}px)`, "translateX(0)"] }, { ...options, pseudoElement: "::view-transition-new(calendar-days)" });
  }, () => {});
  sliding = transition;
  transition.finished.finally(() => {
    if (sliding !== transition) return;
    sliding = null;
    delete root.dataset.calendarMove;
    root.style.removeProperty("--calendar-move-gutter");
    nameHourLabels(week, false);
  });
  return transition;
}

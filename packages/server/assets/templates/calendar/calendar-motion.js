// Motion for the calendar: events arriving, leaving and moving, and the days
// sliding when the range changes. Nothing moves when the person has asked for
// reduced motion.
//
// An event that moves or changes size starts where it was drawn and glides
// to its new place (first, last, invert, play). Days kept across a change in
// how many days show glide the same way. A change of start date slides the
// whole calendar sideways with a view transition, so the days on screen
// before and after line up as one strip.

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

const LEAVE = [
  { opacity: 1, scale: "1" },
  { opacity: 0, scale: "0.94" },
];
const LEAVE_MS = 260;
const LEAVE_EASE = "cubic-bezier(0.4, 0, 1, 1)";

const MOVE_MS = 450;
const MOVE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const MOVE_ID = "calendar-move";

const SLIDE_MS = 520;
const SLIDE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const DAY_PARTS = "calendar-day, calendar-column, calendar-cell";

export function motionAllowed() {
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const innerOf = (event) => event.querySelector(":scope > .event-block > .event-block-inner");

/** Whether an event is drawn on the calendar now, and not on its way out. */
function isPlaced(event) {
  const parent = event.parentElement?.localName;
  return (parent === "calendar-grid" || parent === "calendar-allday") && !event.hasAttribute("data-leaving") && innerOf(event) !== null;
}

/** Where every drawn event and day is now, as the person sees it. */
export function measure(week) {
  const events = new Map();
  for (const event of week.querySelectorAll("calendar-event")) {
    if (!isPlaced(event)) continue;
    const inner = innerOf(event);
    const box = inner.getBoundingClientRect();
    events.set(event, { left: box.left, top: box.top, width: inner.offsetWidth, height: inner.offsetHeight });
  }
  const days = new Map();
  for (const part of week.querySelectorAll(DAY_PARTS)) {
    const box = part.getBoundingClientRect();
    days.set(`${part.localName} ${part.getAttribute("date")}`, { left: box.left, width: box.width });
  }
  return { events, days };
}

/**
 * Moves what changed from where it was to where it now is: events that moved
 * or resized glide, new events arrive, and days kept across a change in the
 * number of days glide to their new columns while new days fade in.
 */
export function play(week, before) {
  const arriving = [];
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
  for (const part of week.querySelectorAll(DAY_PARTS)) {
    const from = before.days.get(`${part.localName} ${part.getAttribute("date")}`);
    if (!from) {
      part.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOVE_MS, easing: "ease" });
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

/**
 * Slides the calendar to a new start date: forward slides left, back slides
 * right. A move of up to the days shown slides by that many columns; a
 * longer one brings the new days in right beside the old. `update` changes
 * the calendar. Returns false, having done nothing, when the browser cannot
 * play the slide or motion is reduced, so the caller updates directly.
 */
export function slide(week, shiftDays, dayCount, update) {
  if (!document.startViewTransition || !motionAllowed() || shiftDays === 0) return false;
  const root = document.documentElement;
  const column = week.querySelector("calendar-column")?.offsetWidth ?? 0;
  const gutter = parseFloat(getComputedStyle(week).getPropertyValue("--calendar-gutter")) || 0;
  const distance = Math.sign(shiftDays) * Math.min(Math.abs(shiftDays), dayCount) * column;
  root.style.setProperty("--calendar-move-gutter", `${gutter}px`);
  root.dataset.calendarMove = "";
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
  transition.finished.finally(() => {
    delete root.dataset.calendarMove;
    nameHourLabels(week, false);
  });
  return transition;
}

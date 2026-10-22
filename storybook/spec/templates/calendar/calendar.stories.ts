// The Calendar template's spec: each story is one state of its page, with its
// markup written here. The prose is specs/ui/templates/calendar.mdx; the
// styles are styles.css, beside this file.
//
// The helpers below write the page's markup from each story's days and
// events. They turn times into the custom properties that place a block on
// the grid; everything a person reads, such as the time text, the fitted
// attendee names and an event's overlap column, is written in the story.
//
// The motion stories each play one kind of change after rendering, with the
// motion written in the Motion section below and the view-transition rules
// in styles.css; each ends in the state after its last change.

import "../../../../specs/ui/foundation/index.css";
import "./styles.css";
import { html, Html } from "../../../lib/html.ts";
import iconFrame from "../../../../specs/ui/foundation/icons/icon.frame";

const icon = (params: { name: string; size?: string }): Html =>
  new Html(iconFrame.render(params, { serializableShadowRoots: true }));

type Color = "red" | "orange" | "yellow" | "green" | "blue" | "purple";

interface Day {
  // The date, as YYYY-MM-DD.
  date: string;
  weekday: string;
  weekend?: boolean;
  today?: boolean;
}

interface AllDayEvent {
  key: string;
  title: string;
  color: Color;
  // The first day and the day after the last, as YYYY-MM-DD.
  start: string;
  end: string;
  // The band's row, from 1.
  lane: number;
}

interface TimedEvent {
  key: string;
  title: string;
  color: Color;
  // YYYY-MM-DDTHH:MM, on one day.
  start: string;
  end: string;
  // The time as the block shows it.
  time: string;
  detail?: string;
  // The names, and the count of the rest, as fitted to the block's width.
  attendees?: string;
  // Where the block sits among the events it overlaps: its column from 0,
  // how many columns it spans (1 when absent), and how many columns the
  // overlapping group has.
  overlap?: { column: number; span?: number; columns: number };
  highlight?: boolean;
}

interface Args {
  theme: "light" | "dark";
  month: string;
  year: string;
  days: Day[];
  allDay: AllDayEvent[];
  events: TimedEvent[];
  // The hour the calendar first scrolls to: an hour before the earliest
  // timed event, or 8 AM with none, or the first hour in view.
  startHour: number;
  // The hours that fill the view, from `start` up to `end`; absent for
  // hours of the usual height.
  visibleHours?: { start: number; end: number };
  // The current time on today's column, or null when today is not shown.
  now: { time: string; label: string } | null;
  // The stored data breaks the store contract, so the page shows its error
  // page instead of the calendar.
  unreadable: boolean;
}

// ------------------------------------------------------------------
// Markup
// ------------------------------------------------------------------

const HOURS_PER_DAY = 24;
const HOURS_PER_HALF_DAY = 12;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;
// An event this long or shorter shows its start time beside its title.
const SHORT_EVENT_MAX_MINUTES = 30;
// With no timed events, the calendar first scrolls to 8 AM.
const DEFAULT_START_HOUR = 8;
// On first load the start hour's line sits this far below the pinned headers.
const START_HOUR_OFFSET_PX = 12;

// Phosphor's "user" icon, fill weight.
const personIcon = html`<svg class="event-attendees-icon" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M230.93,220a8,8,0,0,1-6.93,4H32a8,8,0,0,1-6.92-12c15.23-26.33,38.7-45.21,66.09-54.16a72,72,0,1,1,73.66,0c27.39,8.95,50.86,27.83,66.09,54.16A8,8,0,0,1,230.93,220Z"></path></svg>`;

/** A time range as the page formats it: thin spaces around the dash. */
const range = (from: string, to: string) => `${from}\u2009–\u2009${to}`;

/** Minutes after midnight of a YYYY-MM-DDTHH:MM or HH:MM value. */
const minutesOf = (value: string) => {
  const [, hours, minutes] = /(\d\d):(\d\d)$/.exec(value)!;
  return Number(hours) * MINUTES_PER_HOUR + Number(minutes);
};

const fraction = (value: string) => String(minutesOf(value) / MINUTES_PER_DAY);

const hourLabel = (hour: number) =>
  `${hour % HOURS_PER_HALF_DAY === 0 ? HOURS_PER_HALF_DAY : hour % HOURS_PER_HALF_DAY} ${hour < HOURS_PER_HALF_DAY ? "AM" : "PM"}`;

// Every event block has the same four lines; the ones an event lacks are
// hidden.
const block = (title: string, time: string | null, detail: string | null, attendees: string | null) => html`
      <div class="event-block"><div class="event-block-inner">
        <h3>${title}</h3>
        <div class="event-time"${time === null ? html` hidden` : ""}>${time ?? ""}</div>
        <div class="event-detail"${detail === null ? html` hidden` : ""}>${detail ?? ""}</div>
        <div class="event-attendees"${attendees === null ? html` hidden` : ""}>${personIcon}<span class="event-attendees-names">${attendees ?? ""}</span></div>
      </div></div>`;

const allDayEvent = (event: AllDayEvent, days: Day[]) => {
  const first = days.findIndex((day) => day.date >= event.start) + 1;
  const span = days.filter((day) => day.date >= event.start && day.date < event.end).length;
  return html`
    <calendar-event data-key="${event.key}" title="${event.title}" start="${event.start}" end="${event.end}" color="${event.color}" all-day style="--day-start: ${first}; --day-span: ${span}; --lane-index: ${event.lane};">${block(event.title, null, null, null)}
    </calendar-event>`;
};

const timedEvent = (event: TimedEvent, days: Day[]) => {
  const day = days.findIndex((candidate) => event.start.startsWith(candidate.date)) + 1;
  const { column, span = 1, columns } = event.overlap ?? { column: 0, columns: 1 };
  const size = minutesOf(event.end) - minutesOf(event.start) <= SHORT_EVENT_MAX_MINUTES ? "short" : "long";
  return html`
    <calendar-event data-key="${event.key}" title="${event.title}" start="${event.start}" end="${event.end}"${event.detail ? html` detail="${event.detail}"` : ""} color="${event.color}"${event.highlight ? html` highlight` : ""} style="--day-index: ${day}; --y-start: ${fraction(event.start)}; --y-end: ${fraction(event.end)}; --column-index: ${column}; --column-span: ${span}; --column-count: ${columns};" data-size="${size}">${block(event.title, event.time, event.detail ?? null, event.attendees ?? null)}
    </calendar-event>`;
};

const nowLine = (now: NonNullable<Args["now"]>, days: Day[]) => {
  const day = days.findIndex((candidate) => candidate.today) + 1;
  return html`
    <div class="now-line-faint" style="--y-fraction: ${fraction(now.time)};"></div>
    <div class="now-line" style="--day-index: ${day}; --y-fraction: ${fraction(now.time)};"></div>
    <div class="now-label" style="--y-fraction: ${fraction(now.time)};"><span>${now.label}</span></div>`;
};

const render = ({ theme, month, year, days, allDay, events, startHour, visibleHours, now, unreadable }: Args) => {
  // The theme goes on the document, as in an artifact. Docs pages render each
  // story in its own frame, so stories don't share it.
  document.documentElement.dataset.theme = theme;
  if (unreadable) return html`
<main>
  <section class="calendar-unreadable" role="alert">
    <span class="calendar-unreadable-icon">${icon({ name: "warning", size: "xl" })}</span>
    <h1 class="calendar-unreadable-title">This calendar can't be shown</h1>
    <p class="calendar-unreadable-text">Its saved data isn't in the form this page reads. Ask your agent to check it.</p>
  </section>
</main>`;
  const lanes = Math.max(0, ...allDay.map((event) => event.lane));
  return html`
<main>
  <header class="masthead">
    <h1 id="range-label">${month} <span class="year">${year}</span></h1>
  </header>
  <calendar-week id="calendar" days="${days.length}" start-date="${days[0]!.date}"${visibleHours ? html` start-hour="${visibleHours.start}"` : ""} data-ready style="--day-count: ${days.length}; --start-hour: ${startHour};${lanes > 0 ? ` --allday-lane-count: ${lanes};` : ""}">
    <calendar-headers>${days.map((day, index) => html`
      <calendar-day date="${day.date}"${day.weekend ? html` data-weekend` : ""}${day.today ? html` data-today` : ""} style="--day-index: ${index + 1};"><span class="weekday">${day.weekday}</span><span class="date-num">${Number(day.date.split("-")[2])}</span></calendar-day>`)}
    </calendar-headers>${lanes === 0 ? "" : html`
    <calendar-allday>
      <div class="allday-label">all-day</div>${days.map((day, index) => html`
      <calendar-cell date="${day.date}"${day.weekend ? html` data-weekend` : ""} style="--day-index: ${index + 1};"></calendar-cell>`)}${allDay.map((event) => allDayEvent(event, days))}
    </calendar-allday>`}
    <calendar-grid>
      <calendar-time-axis>${Array.from({ length: HOURS_PER_DAY }, (_, hour) => html`
        <div class="hour-label" data-hour="${hour}" style="--hour-index: ${hour};">${hourLabel(hour)}</div>`)}
      </calendar-time-axis>${days.map((day, index) => html`
      <calendar-column date="${day.date}"${day.weekend ? html` data-weekend` : ""} style="--day-index: ${index + 1};"></calendar-column>`)}
      <div class="start-hour-marker"></div>${events.map((event) => timedEvent(event, days))}${now ? nowLine(now, days) : ""}
    </calendar-grid>
  </calendar-week>
</main>`;
};

// ------------------------------------------------------------------
// Setup after rendering
// ------------------------------------------------------------------

type Play = { canvasElement: HTMLElement };

const pinnedHeight = (week: HTMLElement) =>
  (week.querySelector<HTMLElement>("calendar-headers")?.offsetHeight ?? 0)
  + (week.querySelector<HTMLElement>("calendar-allday")?.offsetHeight ?? 0);

// On first load the page scrolls the hours so the start hour's line sits
// just below the day headers and the all-day band.
const scrollToStartHour = ({ canvasElement }: Play) => {
  const week = canvasElement.querySelector<HTMLElement>("calendar-week")!;
  const marker = week.querySelector<HTMLElement>(".start-hour-marker")!;
  week.scrollTop += marker.getBoundingClientRect().top - week.getBoundingClientRect().top - pinnedHeight(week) - START_HOUR_OFFSET_PX;
};

// With hours in view, each hour is as tall as fills the height below the
// pinned rows with the range, leaving room for its first and last labels,
// and the calendar scrolls to the first.
const MIN_HOUR_PX = 16;

type Hours = NonNullable<Args["visibleHours"]>;

const hourHeight = (week: HTMLElement) => week.querySelector<HTMLElement>("calendar-grid")!.offsetHeight / HOURS_PER_DAY;

/**
 * The hour height and scroll that show `hours`; with none, the usual hour
 * height, keeping the hour at the top of the view where it is.
 */
const hoursTarget = (week: HTMLElement, hours: Hours | null) => {
  if (hours) {
    const height = Math.max(MIN_HOUR_PX, (week.clientHeight - pinnedHeight(week) - 2 * START_HOUR_OFFSET_PX) / (hours.end - hours.start));
    return { height, scroll: hours.start * height - START_HOUR_OFFSET_PX };
  }
  const topHour = (week.scrollTop + START_HOUR_OFFSET_PX) / hourHeight(week);
  const shown = week.style.getPropertyValue("--hour-min-height");
  week.style.removeProperty("--hour-min-height");
  const height = hourHeight(week);
  week.style.setProperty("--hour-min-height", shown);
  return { height, scroll: topHour * height - START_HOUR_OFFSET_PX };
};

/** Draws the hours at a height, and scrolls them. */
const setHours = (week: HTMLElement, height: number, scroll: number) => {
  week.style.setProperty("--hour-min-height", `${height}px`);
  week.scrollTop = scroll;
};

/** Sizes and scrolls the hours so the story's hours in view fill it. */
const fitHours = ({ canvasElement }: Play, hours: Hours) => {
  const week = canvasElement.querySelector<HTMLElement>("calendar-week")!;
  const { height, scroll } = hoursTarget(week, hours);
  setHours(week, height, scroll);
};

// ------------------------------------------------------------------
// Motion
// ------------------------------------------------------------------

// A motion story renders the calendar before a change. Its play function
// waits, then makes the change an agent's store write would make, and moves
// it into place; it ends with the calendar settled after the change.

// How long each state shows before the next change.
const PAUSE_MS = 1200;

const ARRIVE: Keyframe[] = [
  { opacity: 0, scale: "0.92", translate: "0 6px" },
  { opacity: 1, scale: "1", translate: "0 0" },
];
const ARRIVE_MS = 520;
const ARRIVE_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const STAGGER_MS = 40;
const STAGGER_MAX_MS = 360;

const LEAVE: Keyframe[] = [
  { opacity: 1, scale: "1" },
  { opacity: 0, scale: "0.94" },
];
const LEAVE_MS = 260;
const LEAVE_EASE = "cubic-bezier(0.4, 0, 1, 1)";

const GLIDE_MS = 450;
// A change smaller than this is not drawn as a glide.
const MIN_MOVE_PX = 0.5;
const GLIDE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const DAY_FADE_MS = 450;
const DAY_FADE_EASE = "ease";

const SLIDE_MS = 520;
const SLIDE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const HOURS_MS = 520;
const HOURS_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

// The day parts that move with their day, keyed by kind and date.
const DAY_PARTS = "calendar-headers > calendar-day, calendar-allday > calendar-cell, calendar-grid > calendar-column";
const dayKey = (part: Element) => `${part.localName} ${part.getAttribute("date")}`;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const settled = async (animations: Animation[]) => { await Promise.allSettled(animations.map((animation) => animation.finished)); };
const innerOf = (event: Element) => event.querySelector<HTMLElement>(":scope > .event-block > .event-block-inner")!;

/** A CSS cubic-bezier() timing curve as a function of progress, from 0 to 1. */
const BISECTION_STEPS = 24;
const timingCurve = (curve: string) => {
  const [x1, y1, x2, y2] = curve.match(/[\d.]+/g)!.map(Number) as [number, number, number, number];
  const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
  const along = (p1: number, p2: number, t: number) =>
    lerp(lerp(lerp(0, p1, t), lerp(p1, p2, t), t), lerp(lerp(p1, p2, t), lerp(p2, 1, t), t), t);
  return (progress: number) => {
    let low = 0;
    let high = 1;
    for (let step = 0; step < BISECTION_STEPS; step += 1) {
      const middle = (low + high) / 2;
      if (along(x1, x2, middle) < progress) low = middle;
      else high = middle;
    }
    return along(y1, y2, (low + high) / 2);
  };
};

interface Box { left: number; top: number; width: number; height: number }

/** Where an element's layout box sits inside a positioned ancestor, ignoring transforms. */
const offsetIn = (element: HTMLElement, container: Element): Box => {
  let left = 0;
  let top = 0;
  for (let node: Element | null = element; node && node !== container; node = (node as HTMLElement).offsetParent) {
    left += (node as HTMLElement).offsetLeft;
    top += (node as HTMLElement).offsetTop;
  }
  return { left, top, width: element.offsetWidth, height: element.offsetHeight };
};

interface Drawn {
  element: HTMLElement;
  // Where it is on screen, and its layout box in its container.
  left: number;
  top: number;
  width: number;
  height: number;
  place: Box;
  background: string;
}

const drawn = (element: HTMLElement, sized: HTMLElement = element): Drawn => {
  const box = sized.getBoundingClientRect();
  return {
    element,
    left: box.left,
    top: box.top,
    width: sized.offsetWidth,
    height: sized.offsetHeight,
    place: offsetIn(sized, element.parentElement!),
    background: getComputedStyle(element).backgroundColor,
  };
};

/** Where every event and day is drawn now, as the person sees it. */
const measure = (week: HTMLElement) => ({
  dayCount: week.querySelectorAll("calendar-headers > calendar-day").length,
  events: new Map([...week.querySelectorAll<HTMLElement>("calendar-event")].map((event) => [event.dataset.key!, drawn(event, innerOf(event))])),
  days: new Map([...week.querySelectorAll<HTMLElement>(DAY_PARTS)].map((part) => [dayKey(part), drawn(part)])),
});

/** Draws the page for `args` in place of the one shown, keeping the scroll position. */
const redraw = (canvasElement: HTMLElement, args: Args) => {
  const week = canvasElement.querySelector<HTMLElement>("calendar-week")!;
  const { scrollTop, scrollLeft } = week;
  canvasElement.querySelector("main")!.replaceWith(Document.parseHTMLUnsafe(String(render(args))).querySelector("main")!);
  const next = canvasElement.querySelector<HTMLElement>("calendar-week")!;
  next.scrollTop = scrollTop;
  next.scrollLeft = scrollLeft;
  return next;
};

/** Pins an element at a layout box inside its positioned container. */
const pin = (element: HTMLElement, { left, top, width, height }: Box) =>
  Object.assign(element.style, { position: "absolute", margin: "0", left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });

/** Glides an event from where it was drawn to where it now is. */
const glide = (event: HTMLElement, from: Drawn) => {
  const inner = innerOf(event);
  const box = inner.getBoundingClientRect();
  const to = { left: box.left, top: box.top, width: inner.offsetWidth, height: inner.offsetHeight };
  const moved = [from.left - to.left, from.top - to.top, from.width - to.width, from.height - to.height].some((delta) => Math.abs(delta) >= MIN_MOVE_PX);
  if (!moved) return [];
  return [inner.animate([
    { translate: `${from.left - to.left}px ${from.top - to.top}px`, width: `${from.width}px`, height: `${from.height}px` },
    { translate: "0 0", width: `${to.width}px`, height: `${to.height}px` },
  ], { duration: GLIDE_MS, easing: GLIDE_EASE })];
};

/** Plays the arrival of new events, in start order. */
const arrive = (events: HTMLElement[]) => {
  const ordered = [...events].sort((a, b) => (a.getAttribute("start") ?? "").localeCompare(b.getAttribute("start") ?? ""));
  const step = ordered.length > 1 ? Math.min(STAGGER_MS, STAGGER_MAX_MS / (ordered.length - 1)) : 0;
  return ordered.map((event, index) =>
    innerOf(event).animate(ARRIVE, { duration: ARRIVE_MS, delay: index * step, easing: ARRIVE_EASE, fill: "backwards" }));
};

/** Draws an event no longer shown where it was, lets it leave, and removes it. */
const leave = (week: HTMLElement, from: Drawn) => {
  const container = week.querySelector(`:scope > ${from.element.parentElement!.localName}`);
  if (!container) return [];
  const event = from.element;
  event.removeAttribute("data-key");
  event.setAttribute("data-leaving", "");
  Object.assign(event.querySelector<HTMLElement>(".event-block")!.style, { position: "absolute", inset: "0", padding: "0", gridArea: "auto" });
  pin(innerOf(event), from.place);
  container.append(event);
  const animation = innerOf(event).animate(LEAVE, { duration: LEAVE_MS, easing: LEAVE_EASE, fill: "forwards" });
  void animation.finished.finally(() => event.remove());
  return [animation];
};

/**
 * Moves the days to a new number of days: the days kept glide to their new
 * columns, the headers keeping their size; new days fade in; and the days no
 * longer shown fade out where they were.
 */
const moveDays = (week: HTMLElement, before: Map<string, Drawn>) => {
  const animations: Animation[] = [];
  const shown = new Set<string>();
  for (const part of week.querySelectorAll<HTMLElement>(DAY_PARTS)) {
    shown.add(dayKey(part));
    const from = before.get(dayKey(part));
    if (!from) {
      animations.push(part.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DAY_FADE_MS, easing: DAY_FADE_EASE }));
      continue;
    }
    const box = part.getBoundingClientRect();
    const scale = part.localName === "calendar-day" ? 1 : from.width / box.width;
    animations.push(part.animate([
      { translate: `${from.left - box.left}px 0`, scale: `${scale} 1`, transformOrigin: "0 0" },
      { translate: "0 0", scale: "1 1", transformOrigin: "0 0" },
    ], { duration: GLIDE_MS, easing: GLIDE_EASE }));
  }
  for (const [key, from] of before) {
    const container = week.querySelector(`:scope > ${from.element.parentElement!.localName}`);
    if (shown.has(key) || !container) continue;
    const part = from.element;
    part.setAttribute("data-leaving", "");
    Object.assign(part.style, { gridArea: "auto", backgroundColor: from.background });
    pin(part, from.place);
    container.append(part);
    const animation = part.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DAY_FADE_MS, easing: DAY_FADE_EASE, fill: "forwards" });
    void animation.finished.finally(() => part.remove());
    animations.push(animation);
  }
  return animations;
};

/**
 * Changes the page to `args`, as a store write would, and moves the change
 * into place: events that moved glide, new events arrive, removed events
 * leave, and a new number of days moves the days. `redrawn` runs on the new
 * calendar before anything moves.
 */
const change = async (canvasElement: HTMLElement, args: Args, redrawn?: (week: HTMLElement) => void) => {
  if (reducedMotion()) {
    redrawn?.(redraw(canvasElement, args));
    return;
  }
  const before = measure(canvasElement.querySelector<HTMLElement>("calendar-week")!);
  const week = redraw(canvasElement, args);
  redrawn?.(week);
  const animations: Animation[] = [];
  const arriving: HTMLElement[] = [];
  for (const event of week.querySelectorAll<HTMLElement>("calendar-event")) {
    const from = before.events.get(event.dataset.key!);
    if (from) animations.push(...glide(event, from));
    else arriving.push(event);
  }
  animations.push(...arrive(arriving));
  for (const [key, from] of before.events) {
    if (!week.querySelector(`calendar-event[data-key="${key}"]`)) animations.push(...leave(week, from));
  }
  if (before.dayCount !== args.days.length) animations.push(...moveDays(week, before.days));
  await settled(animations);
};

// Each hour label in view is captured on its own, so it stays put while the
// days slide. Labels scrolled away, or under the pinned headers, stay in the
// days' capture, where the clip hides them.
const nameHourLabels = (week: HTMLElement, named: boolean) => {
  const top = week.querySelector("calendar-headers")!.getBoundingClientRect().bottom;
  const { bottom } = week.getBoundingClientRect();
  week.querySelectorAll<HTMLElement>(".hour-label").forEach((label, index) => {
    const box = label.getBoundingClientRect();
    label.style.viewTransitionName = named && box.top >= top && box.bottom <= bottom ? `calendar-hour-${index}` : "";
  });
};

/**
 * Changes the page to `args`, a new start date `shiftDays` from the one
 * shown with the same number of days, sliding the days sideways: a move of
 * up to the days shown slides by that many columns, a longer one by one
 * width. When the title changes, the old one fades out and the new one in.
 */
const slide = async (canvasElement: HTMLElement, args: Args, shiftDays: number) => {
  if (reducedMotion() || !document.startViewTransition) {
    redraw(canvasElement, args);
    return;
  }
  const root = document.documentElement;
  const week = canvasElement.querySelector<HTMLElement>("calendar-week")!;
  const column = week.querySelector<HTMLElement>("calendar-column")!.offsetWidth;
  const distance = Math.sign(shiftDays) * Math.min(Math.abs(shiftDays), args.days.length) * column;
  const titleChanges = canvasElement.querySelector("#range-label")!.textContent !== `${args.month} ${args.year}`;
  root.style.setProperty("--calendar-move-gutter", getComputedStyle(week).getPropertyValue("--calendar-gutter"));
  root.dataset.calendarMove = titleChanges ? "month" : "";
  nameHourLabels(week, true);
  const transition = document.startViewTransition(() => nameHourLabels(redraw(canvasElement, args), true));
  await transition.ready;
  const options = { duration: SLIDE_MS, easing: SLIDE_EASE };
  root.animate({ transform: ["translateX(0)", `translateX(${-distance}px)`] }, { ...options, pseudoElement: "::view-transition-old(calendar-days)" });
  root.animate({ transform: [`translateX(${distance}px)`, "translateX(0)"] }, { ...options, pseudoElement: "::view-transition-new(calendar-days)" });
  await transition.finished;
  delete root.dataset.calendarMove;
  root.style.removeProperty("--calendar-move-gutter");
  nameHourLabels(canvasElement.querySelector<HTMLElement>("calendar-week")!, false);
};

/**
 * Changes the hours in view to `hours`, or to the usual hour height with
 * none: the hours grow or shrink and the view scrolls with them.
 */
const moveHours = ({ canvasElement }: Play, hours: Hours | null, startHour: number) => new Promise<void>((resolve) => {
  const week = canvasElement.querySelector<HTMLElement>("calendar-week")!;
  if (hours) week.setAttribute("start-hour", String(hours.start));
  else week.removeAttribute("start-hour");
  week.style.setProperty("--start-hour", String(hours?.start ?? startHour));
  const target = hoursTarget(week, hours);
  const finish = () => {
    if (hours) setHours(week, target.height, target.scroll);
    else {
      week.style.removeProperty("--hour-min-height");
      week.scrollTop = target.scroll;
    }
    resolve();
  };
  if (reducedMotion()) {
    finish();
    return;
  }
  const from = { height: hourHeight(week), scroll: week.scrollTop };
  const ease = timingCurve(HOURS_EASE);
  const began = performance.now();
  const frame = (now: number) => {
    const progress = Math.min(1, Math.max(0, now - began) / HOURS_MS);
    const eased = ease(progress);
    setHours(week, from.height + (target.height - from.height) * eased, from.scroll + (target.scroll - from.scroll) * eased);
    if (progress < 1) requestAnimationFrame(frame);
    else finish();
  };
  requestAnimationFrame(frame);
});

// The run playing on each canvas, so that a rerun stops the one before it.
const runs = new WeakMap<HTMLElement, object>();

/** Plays each change in turn, after a pause, while the story has not been rerun. */
const playChanges = async (context: Play, changes: ((context: Play) => Promise<void>)[]) => {
  const run = {};
  runs.set(context.canvasElement, run);
  for (const next of changes) {
    await wait(PAUSE_MS);
    if (runs.get(context.canvasElement) !== run) return;
    await next(context);
  }
};

// ------------------------------------------------------------------
// Example data
// ------------------------------------------------------------------

const workingWeek: Day[] = [
  { date: "2026-11-02", weekday: "Mon" },
  { date: "2026-11-03", weekday: "Tue" },
  { date: "2026-11-04", weekday: "Wed" },
  { date: "2026-11-05", weekday: "Thu" },
  { date: "2026-11-06", weekday: "Fri" },
];

const fullWeek = (today: string | null): Day[] => [
  ...workingWeek,
  { date: "2026-11-07", weekday: "Sat", weekend: true },
  { date: "2026-11-08", weekday: "Sun", weekend: true },
].map((day) => (day.date === today ? { ...day, today: true } : day));

const weekEvents: TimedEvent[] = [
  { key: "checkin-mon", title: "Team check-in", color: "blue", start: "2026-11-02T09:00", end: "2026-11-02T09:30", time: "9:00 AM" },
  { key: "roadmap", title: "Roadmap review", color: "purple", start: "2026-11-02T10:00", end: "2026-11-02T11:30", time: range("10:00", "11:30 AM"), detail: "Room 4 · Slides in the shared folder", attendees: "3", overlap: { column: 0, columns: 2 } },
  { key: "budget", title: "Budget call", color: "orange", start: "2026-11-02T11:00", end: "2026-11-02T12:00", time: range("11:00 AM", "12:00 PM"), detail: "Video call", attendees: "Jordan, Alex", overlap: { column: 1, columns: 2 } },
  { key: "lunch-mon", title: "Lunch", color: "yellow", start: "2026-11-02T12:30", end: "2026-11-02T13:30", time: range("12:30", "1:30 PM") },
  { key: "checkin-tue", title: "Team check-in", color: "blue", start: "2026-11-03T09:00", end: "2026-11-03T09:30", time: "9:00 AM" },
  { key: "interview", title: "Customer interview", color: "green", start: "2026-11-03T10:30", end: "2026-11-03T12:00", time: range("10:30 AM", "12:00 PM"), detail: "Video call", attendees: "Mei, Priya" },
  { key: "dentist", title: "Dentist", color: "red", start: "2026-11-03T14:00", end: "2026-11-03T14:45", time: range("2:00", "2:45 PM") },
  { key: "design", title: "Design review", color: "orange", start: "2026-11-04T09:30", end: "2026-11-04T11:00", time: range("9:30", "11:00 AM"), detail: "Final screens", attendees: "Alex, Priya +3" },
  { key: "one-to-one", title: "1:1 with Jordan", color: "blue", start: "2026-11-04T11:15", end: "2026-11-04T12:00", time: range("11:15 AM", "12:00 PM") },
  { key: "workshop", title: "Planning workshop", color: "red", start: "2026-11-05T13:00", end: "2026-11-05T15:30", time: range("1:00", "3:30 PM"), detail: "Main hall", attendees: "Alex, Priya +2" },
  { key: "retro", title: "Retrospective", color: "green", start: "2026-11-06T10:00", end: "2026-11-06T11:30", time: range("10:00", "11:30 AM"), detail: "What worked and what to change", attendees: "Alex, Priya, Sam" },
  { key: "wrap", title: "Week wrap-up", color: "purple", start: "2026-11-06T15:00", end: "2026-11-06T16:00", time: range("3:00", "4:00 PM") },
];

const weekAllDay: AllDayEvent[] = [
  { key: "leave", title: "Sam on leave", color: "green", start: "2026-11-02", end: "2026-11-04", lane: 1 },
  { key: "planning", title: "Quarterly planning", color: "purple", start: "2026-11-02", end: "2026-11-05", lane: 2 },
  { key: "offsite", title: "Team offsite", color: "blue", start: "2026-11-05", end: "2026-11-06", lane: 1 },
];

const oneDay: Day[] = [{ date: "2026-11-04", weekday: "Wednesday", today: true }];

const dayEvents: TimedEvent[] = [
  { key: "standup", title: "Team check-in", color: "blue", start: "2026-11-04T09:00", end: "2026-11-04T09:30", time: "9:00 AM" },
  { key: "design", title: "Design review", color: "orange", start: "2026-11-04T10:00", end: "2026-11-04T11:30", time: range("10:00", "11:30 AM"), detail: "Room 4 · Final screens", attendees: "Alex, Priya, Jordan" },
  { key: "lunch", title: "Lunch with Mei", color: "yellow", start: "2026-11-04T12:30", end: "2026-11-04T13:30", time: range("12:30", "1:30 PM"), detail: "Corner café", attendees: "Mei" },
  { key: "launch", title: "Launch rehearsal", color: "purple", start: "2026-11-04T14:00", end: "2026-11-04T15:30", time: range("2:00", "3:30 PM"), detail: "Main hall · Bring a laptop", attendees: "Alex, Priya, Jordan, Mei, Sam" },
  { key: "review", title: "Weekly review", color: "green", start: "2026-11-04T16:00", end: "2026-11-04T17:00", time: range("4:00", "5:00 PM"), detail: "Notes and next steps", attendees: "Alex, Sam" },
];

const raised = (events: TimedEvent[], key: string, highlight = true) =>
  events.map((event) => (event.key === key ? { ...event, highlight } : event));

const sevenDayEvents = (attendees: Record<string, string>): TimedEvent[] => [
  { key: "roadmap", title: "Roadmap review", color: "purple", start: "2026-11-02T10:00", end: "2026-11-02T11:30", time: range("10:00", "11:30 AM"), detail: "Room 4", attendees: attendees.roadmap },
  { key: "interview", title: "Customer interview", color: "green", start: "2026-11-03T13:00", end: "2026-11-03T14:30", time: range("1:00", "2:30 PM"), detail: "Video call", attendees: "Mei, Priya" },
  { key: "design", title: "Design review", color: "orange", start: "2026-11-04T09:30", end: "2026-11-04T11:00", time: range("9:30", "11:00 AM"), detail: "Final screens", attendees: attendees.design },
  { key: "workshop", title: "Planning workshop", color: "red", start: "2026-11-05T15:00", end: "2026-11-05T17:00", time: range("3:00", "5:00 PM"), detail: "Main hall", attendees: attendees.workshop },
  { key: "retro", title: "Retrospective", color: "green", start: "2026-11-06T10:00", end: "2026-11-06T11:00", time: range("10:00", "11:00 AM") },
  { key: "market", title: "Farmers market", color: "yellow", start: "2026-11-07T09:30", end: "2026-11-07T11:00", time: range("9:30", "11:00 AM") },
  { key: "hike", title: "Hike", color: "blue", start: "2026-11-08T13:00", end: "2026-11-08T16:00", time: range("1:00", "4:00 PM"), detail: "Ridge trail" },
];

const sevenDayAllDay: AllDayEvent[] = [
  { key: "planning", title: "Quarterly planning", color: "purple", start: "2026-11-02", end: "2026-11-05", lane: 1 },
];

const fourFortyTwo = { time: "16:42", label: "4:42 PM" };

// The attendees as fitted to the columns of a 1280-pixel artifact, with seven
// days and with five.
const sevenDayAttendees = { roadmap: "Alex, Priya, Jordan", design: "Alex, Priya, Jordan, Mei +1", workshop: "Alex, Priya, Jordan, Mei" };
const fiveDayAttendees = { roadmap: "Alex, Priya, Jordan", design: "Alex, Priya, Jordan, Mei, Sam", workshop: "Alex, Priya, Jordan, Mei" };

// The week's events with their attendees fitted to five columns of a
// 1280-pixel artifact.
const wideWeekAttendees: Record<string, string> = {
  roadmap: "Alex, Priya +1",
  budget: "Jordan, Alex",
  design: "Alex, Priya, Jordan, Mei, Sam",
  workshop: "Alex, Priya, Jordan, Mei",
};
const wideWeekEvents = weekEvents.map((event) => (event.key in wideWeekAttendees ? { ...event, attendees: wideWeekAttendees[event.key] } : event));

const NINE_TO_SIX: Hours = { start: 9, end: 18 };

// ------------------------------------------------------------------
// Example data for motion
// ------------------------------------------------------------------

// A whole week with no today, as the motion stories start.
const motionWeek = {
  days: fullWeek(null),
  allDay: sevenDayAllDay,
  events: sevenDayEvents(sevenDayAttendees),
  now: null,
};

// The same week's working days.
const motionWorkingWeek = {
  days: workingWeek,
  allDay: sevenDayAllDay,
  events: sevenDayEvents(fiveDayAttendees).filter((event) => workingWeek.some((day) => event.start.startsWith(day.date))),
  now: null,
};

// The retrospective moves to Saturday morning and lengthens, beside the
// farmers market, which narrows to share the time.
const retroMoved = motionWeek.events.map((event) => {
  if (event.key === "retro") return { ...event, start: "2026-11-07T10:00", end: "2026-11-07T11:30", time: range("10:00", "11:30 AM"), overlap: { column: 1, columns: 2 } };
  if (event.key === "market") return { ...event, overlap: { column: 0, columns: 2 } };
  return event;
});

// Weeks for the slide. Each date has its own events, so a day looks the same
// wherever it is shown.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SUNDAY = 0;
const SATURDAY = 6;

type Plan = Pick<TimedEvent, "title" | "color" | "time" | "detail"> & { from: string; to: string };

const checkIn: Plan = { title: "Team check-in", color: "blue", from: "09:00", to: "09:30", time: "9:00 AM" };
const weekdayPlans: Plan[] = [
  { title: "Roadmap review", color: "purple", from: "10:00", to: "11:30", time: range("10:00", "11:30 AM"), detail: "Room 4" },
  { title: "Customer interview", color: "green", from: "13:00", to: "14:30", time: range("1:00", "2:30 PM"), detail: "Video call" },
  { title: "Design review", color: "orange", from: "09:30", to: "11:00", time: range("9:30", "11:00 AM"), detail: "Final screens" },
  { title: "Planning workshop", color: "red", from: "14:00", to: "16:00", time: range("2:00", "4:00 PM"), detail: "Main hall" },
  { title: "Lunch with Sam", color: "yellow", from: "12:30", to: "13:30", time: range("12:30", "1:30 PM") },
  { title: "Budget call", color: "blue", from: "11:00", to: "12:00", time: range("11:00 AM", "12:00 PM"), detail: "Video call" },
];
const weekendPlans: Plan[] = [
  { title: "Farmers market", color: "yellow", from: "09:30", to: "11:00", time: range("9:30", "11:00 AM") },
  { title: "Hike", color: "blue", from: "13:00", to: "16:00", time: range("1:00", "4:00 PM"), detail: "Ridge trail" },
  { title: "Brunch", color: "orange", from: "10:30", to: "12:00", time: range("10:30 AM", "12:00 PM") },
];

const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Seven days from a Monday, each with the events of its date. */
const weekFrom = (monday: string) => {
  const first = new Date(`${monday}T12:00:00`);
  const dates = Array.from({ length: WEEKDAYS.length }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index));
  const days: Day[] = dates.map((date) => ({
    date: isoDate(date),
    weekday: WEEKDAYS[date.getDay()]!,
    ...(date.getDay() === SUNDAY || date.getDay() === SATURDAY ? { weekend: true } : {}),
  }));
  const events = dates.flatMap((date): TimedEvent[] => {
    const weekend = date.getDay() === SUNDAY || date.getDay() === SATURDAY;
    const plans = weekend ? [weekendPlans[date.getDate() % weekendPlans.length]!] : [checkIn, weekdayPlans[date.getDate() % weekdayPlans.length]!];
    return plans.map(({ from, to, ...plan }, index) => ({ key: `${isoDate(date)}-${index}`, ...plan, start: `${isoDate(date)}T${from}`, end: `${isoDate(date)}T${to}` }));
  });
  return { month: MONTHS[first.getMonth()]!, year: String(first.getFullYear()), days, allDay: [], events, now: null };
};

// Each story's frame is the artifact: the shared starting size, a full-screen
// artifact, or a narrow one. On the docs page each story renders in its own
// frame.
const viewports = {
  artifact: { name: "Artifact, starting size", styles: { width: "760px", height: "770px" }, type: "desktop" },
  wide: { name: "Wide artifact", styles: { width: "1280px", height: "800px" }, type: "desktop" },
  fullScreen: { name: "Full screen", styles: { width: "1440px", height: "900px" }, type: "desktop" },
  narrow: { name: "Narrow artifact", styles: { width: "400px", height: "600px" }, type: "mobile" },
};

const sized = (viewport: keyof typeof viewports) => ({
  globals: { viewport: { value: viewport, isRotated: false } },
  parameters: { docs: { story: { height: viewports[viewport].styles.height } } },
});

const defaults: Args = {
  theme: "light",
  month: "November",
  year: "2026",
  days: workingWeek,
  allDay: weekAllDay,
  events: weekEvents,
  startHour: DEFAULT_START_HOUR,
  now: null,
  unreadable: false,
};

export default {
  title: "Spec/Templates/Calendar",
  parameters: {
    layout: "fullscreen",
    viewport: { options: viewports },
    docs: { story: { inline: false, height: "770px" } },
  },
  globals: { viewport: { value: "artifact", isRotated: false } },
  render,
  play: scrollToStartHour,
  args: defaults,
};

// Five working days with all-day, timed, overlapping and short events.
export const Week = { name: "A working week" };

// What a person sees after creating a Calendar from the Templates popover, on
// a Wednesday morning: this week, from Monday, and no events.
export const New = {
  args: { days: fullWeek("2026-11-04"), allDay: [], events: [], now: { time: "10:15", label: "10:15 AM" } },
};

// One day filling a full-screen artifact.
export const OneDay = {
  name: "One day",
  ...sized("fullScreen"),
  args: { days: oneDay, allDay: [], events: dayEvents, now: { time: "13:20", label: "1:20 PM" } },
};

// An agent has raised the launch rehearsal.
export const Highlighted = {
  name: "A highlighted event",
  ...sized("fullScreen"),
  args: { days: oneDay, allDay: [], events: raised(dayEvents, "launch"), now: { time: "13:20", label: "1:20 PM" } },
};

// A whole week on a Thursday afternoon: the weekend days are shaded, and
// the current time is marked on today's column, across the planning
// workshop, and in the hour labels.
export const SevenDays = {
  name: "Seven days",
  ...sized("wide"),
  args: {
    days: fullWeek("2026-11-05"),
    allDay: sevenDayAllDay,
    events: sevenDayEvents(sevenDayAttendees),
    now: fourFortyTwo,
  },
};

const crowdedWeek: Day[] = [
  { date: "2026-11-09", weekday: "Mon" },
  { date: "2026-11-10", weekday: "Tue" },
  { date: "2026-11-11", weekday: "Wed" },
  { date: "2026-11-12", weekday: "Thu" },
  { date: "2026-11-13", weekday: "Fri" },
];

// Fifteen-minute and half-hour events, two events side by side, and three.
export const ShortAndOverlapping = {
  name: "Short and overlapping events",
  args: {
    days: crowdedWeek,
    allDay: [],
    events: [
      { key: "standup-mon", title: "Standup", color: "blue", start: "2026-11-09T09:00", end: "2026-11-09T09:15", time: "9:00 AM" },
      { key: "coffee-mon", title: "Coffee with Sam", color: "yellow", start: "2026-11-09T09:30", end: "2026-11-09T10:00", time: "9:30 AM" },
      { key: "hiring", title: "Hiring panel", color: "purple", start: "2026-11-09T10:00", end: "2026-11-09T11:30", time: range("10:00", "11:30 AM"), detail: "Room 2", attendees: "3", overlap: { column: 0, columns: 3 } },
      { key: "vendor", title: "Vendor call", color: "orange", start: "2026-11-09T10:30", end: "2026-11-09T11:30", time: range("10:30", "11:30 AM"), attendees: "Jordan, Sam", overlap: { column: 2, columns: 3 } },
      { key: "sync", title: "Design sync", color: "green", start: "2026-11-09T10:30", end: "2026-11-09T12:00", time: range("10:30 AM", "12:00 PM"), attendees: "3", overlap: { column: 1, columns: 3 } },
      { key: "standup-tue", title: "Standup", color: "blue", start: "2026-11-10T09:00", end: "2026-11-10T09:15", time: "9:00 AM" },
      { key: "review", title: "Code review", color: "green", start: "2026-11-10T09:30", end: "2026-11-10T10:30", time: range("9:30", "10:30 AM"), overlap: { column: 0, columns: 2 } },
      { key: "pairing", title: "Pairing", color: "blue", start: "2026-11-10T10:00", end: "2026-11-10T11:00", time: range("10:00", "11:00 AM"), attendees: "Priya, Sam", overlap: { column: 1, columns: 2 } },
      { key: "standup-wed", title: "Standup", color: "blue", start: "2026-11-11T09:00", end: "2026-11-11T09:15", time: "9:00 AM" },
      { key: "call", title: "Quick call", color: "red", start: "2026-11-11T09:15", end: "2026-11-11T09:30", time: "9:15 AM" },
      { key: "focus", title: "Focus time", color: "purple", start: "2026-11-11T09:30", end: "2026-11-11T12:00", time: range("9:30 AM", "12:00 PM") },
      { key: "standup-thu", title: "Standup", color: "blue", start: "2026-11-12T09:00", end: "2026-11-12T09:15", time: "9:00 AM" },
      { key: "demo", title: "Demo prep", color: "orange", start: "2026-11-12T13:00", end: "2026-11-12T14:30", time: range("1:00", "2:30 PM"), detail: "Room 1", attendees: "Alex, Jordan" },
      { key: "standup-fri", title: "Standup", color: "blue", start: "2026-11-13T09:00", end: "2026-11-13T09:15", time: "9:00 AM" },
      { key: "lunch", title: "Team lunch", color: "yellow", start: "2026-11-13T12:00", end: "2026-11-13T13:00", time: range("12:00", "1:00 PM") },
    ],
  },
};

// Seven days in a 400-pixel artifact, scrolled sideways by 150 pixels: each
// day keeps 100 pixels and the hour labels stay in place.
export const Narrow = {
  ...sized("narrow"),
  args: {
    days: fullWeek("2026-11-05"),
    allDay: sevenDayAllDay,
    events: sevenDayEvents({ roadmap: "Alex +2", design: "Alex +4", workshop: "Alex +3" }),
    now: fourFortyTwo,
  },
  play: (context: Play) => {
    scrollToStartHour(context);
    context.canvasElement.querySelector("calendar-week")!.scrollLeft = 150;
  },
};

// The working week in the dark appearance.
export const Dark = { name: "Dark appearance", args: { theme: "dark" } };

// The stored data breaks the store contract, as after an agent wrote `events`
// as a list. There are no hours to scroll.
export const Unreadable = { args: { unreadable: true }, play: () => {} };

// The error page in the dark appearance.
export const UnreadableDark = { name: "Unreadable, dark", args: { unreadable: true, theme: "dark" }, play: () => {} };

// The working week with 9 AM to 6 PM filling a wide artifact.
export const VisibleHours = {
  name: "Hours in view",
  ...sized("wide"),
  args: { events: wideWeekEvents, startHour: NINE_TO_SIX.start, visibleHours: NINE_TO_SIX },
  // The hours take their height, and the first scroll lands on the start hour.
  play: (context: Play) => {
    fitHours(context, NINE_TO_SIX);
    scrollToStartHour(context);
  },
};

// ------------------------------------------------------------------
// Motion stories
// ------------------------------------------------------------------

// The calendar opens on an empty week; then its data arrives, and the events
// arrive in order of start time.
export const EventsArriving = {
  name: "Events arriving",
  ...sized("wide"),
  args: { ...motionWeek, allDay: [], events: [] },
  play: async (context: Play) => {
    scrollToStartHour(context);
    await playChanges(context, [
      ({ canvasElement }) => change(canvasElement, { ...defaults, ...motionWeek }, () => scrollToStartHour(context)),
    ]);
  },
};

// The customer interview is removed.
export const EventLeaving = {
  name: "An event leaving",
  ...sized("wide"),
  args: motionWeek,
  play: async (context: Play) => {
    scrollToStartHour(context);
    await playChanges(context, [
      ({ canvasElement }) => change(canvasElement, { ...defaults, ...motionWeek, events: motionWeek.events.filter((event) => event.key !== "interview") }),
    ]);
  },
};

// The retrospective moves from Friday to Saturday, later and longer, and
// the farmers market beside it narrows to share the time.
export const EventMoving = {
  name: "An event moving",
  ...sized("wide"),
  args: motionWeek,
  play: async (context: Play) => {
    scrollToStartHour(context);
    await playChanges(context, [
      ({ canvasElement }) => change(canvasElement, { ...defaults, ...motionWeek, events: retroMoved }),
    ]);
  },
};

const slideWeeks = { first: weekFrom("2026-11-02"), next: weekFrom("2026-11-09"), later: weekFrom("2026-12-14") };
const WEEK_DAYS = 7;
const FIVE_WEEKS_DAYS = 35;

// `startDate` moves a week later, and the days slide one width to the left.
// Then it moves five weeks later: the days still slide one width, and the
// month changes.
export const NewRangeOfDays = {
  name: "A new range of days",
  ...sized("wide"),
  args: slideWeeks.first,
  play: async (context: Play) => {
    scrollToStartHour(context);
    await playChanges(context, [
      ({ canvasElement }) => slide(canvasElement, { ...defaults, ...slideWeeks.next }, WEEK_DAYS),
      ({ canvasElement }) => slide(canvasElement, { ...defaults, ...slideWeeks.later }, FIVE_WEEKS_DAYS),
    ]);
  },
};

// `days` changes from seven to five: the weekend fades out and its events
// leave as the working days widen. Then it changes back to seven: the
// working days narrow, and the weekend fades in with its events arriving.
export const NewNumberOfDays = {
  name: "A new number of days",
  ...sized("wide"),
  args: motionWeek,
  play: async (context: Play) => {
    scrollToStartHour(context);
    await playChanges(context, [
      ({ canvasElement }) => change(canvasElement, { ...defaults, ...motionWorkingWeek }),
      ({ canvasElement }) => change(canvasElement, { ...defaults, ...motionWeek }),
    ]);
  },
};

const NOON_TO_FIVE: Hours = { start: 12, end: 17 };

// `visibleHours` is added as 9 AM to 6 PM, changed to noon to 5 PM, and
// removed, which returns the hours to their usual height with noon kept at
// the top.
export const NewRangeOfHours = {
  name: "A new range of hours",
  ...sized("wide"),
  args: motionWeek,
  play: async (context: Play) => {
    scrollToStartHour(context);
    await playChanges(context, [
      (next) => moveHours(next, NINE_TO_SIX, DEFAULT_START_HOUR),
      (next) => moveHours(next, NOON_TO_FIVE, DEFAULT_START_HOUR),
      (next) => moveHours(next, null, DEFAULT_START_HOUR),
    ]);
  },
};

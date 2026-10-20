// The Calendar template's spec: each story is one state of its page, with its
// markup written here. The prose is specs/ui/templates/calendar.mdx; the
// styles are styles.css, beside this file.
//
// The helpers below write the page's markup from each story's days and
// events. They turn times into the custom properties that place a block on
// the grid; everything a person reads, such as the time text, the fitted
// attendee names and an event's overlap column, is written in the story.

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
  // timed event, or 8 AM with none.
  startHour: number;
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

const render = ({ theme, month, year, days, allDay, events, startHour, now, unreadable }: Args) => {
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
  <calendar-week id="calendar" days="${days.length}" start-date="${days[0]!.date}" data-ready style="--day-count: ${days.length}; --start-hour: ${startHour};${lanes > 0 ? ` --allday-lane-count: ${lanes};` : ""}">
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

// On first load the page scrolls the hours so the start hour's line sits
// just below the day headers and the all-day band.
const scrollToStartHour = ({ canvasElement }: Play) => {
  const week = canvasElement.querySelector<HTMLElement>("calendar-week")!;
  const marker = week.querySelector<HTMLElement>(".start-hour-marker")!;
  const pinned = (week.querySelector<HTMLElement>("calendar-headers")?.offsetHeight ?? 0)
    + (week.querySelector<HTMLElement>("calendar-allday")?.offsetHeight ?? 0);
  week.scrollTop = marker.getBoundingClientRect().top - week.getBoundingClientRect().top - pinned - START_HOUR_OFFSET_PX;
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
  args: {
    theme: "light",
    month: "November",
    year: "2026",
    days: workingWeek,
    allDay: weekAllDay,
    events: weekEvents,
    startHour: DEFAULT_START_HOUR,
    now: null,
    unreadable: false,
  } satisfies Args,
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
    events: sevenDayEvents({ roadmap: "Alex, Priya, Jordan", design: "Alex, Priya, Jordan, Mei +1", workshop: "Alex, Priya, Jordan, Mei" }),
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


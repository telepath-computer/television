import type { Page } from "playwright";
import { conform } from "@telepath-computer/conform";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { test, expect } from "@playwright/test";
import { CALENDAR_DAY, CALENDAR_WEEK, calendarShown, motionSettled, type CalendarEvent as Event, type CalendarValue as Calendar } from "./calendar-harness.ts";
import { artifactURL, client, createArtifact, specStories, storybook, useConformance } from "./conformance-harness.ts";

const run = useConformance();

// The stories' artifact sizes, from their viewport globals.
const VIEWPORTS = {
  artifact: { width: 760, height: 770 },
  wide: { width: 1280, height: 800 },
  fullScreen: { width: 1440, height: 900 },
  narrow: { width: 400, height: 600 },
};

// A clock outside every story's days, for the stories that show no today.
const NO_TODAY = "2026-10-01T12:00:00";

const week = CALENDAR_WEEK;
const day = CALENDAR_DAY;

// The stories' whole week of seven days, with the planning all-day event.
const sevenDays: Calendar = {
  startDate: "2026-11-02",
  days: 7,
  events: {
    planning: { title: "Quarterly planning", start: "2026-11-02", end: "2026-11-05", allDay: true, color: "purple" },
    roadmap: { title: "Roadmap review", start: "2026-11-02T10:00", end: "2026-11-02T11:30", color: "purple", detail: "Room 4", attendees: ["Alex", "Priya", "Jordan"] },
    interview: { title: "Customer interview", start: "2026-11-03T13:00", end: "2026-11-03T14:30", color: "green", detail: "Video call", attendees: ["Mei", "Priya"] },
    design: { title: "Design review", start: "2026-11-04T09:30", end: "2026-11-04T11:00", color: "orange", detail: "Final screens", attendees: ["Alex", "Priya", "Jordan", "Mei", "Sam"] },
    workshop: { title: "Planning workshop", start: "2026-11-05T15:00", end: "2026-11-05T17:00", color: "red", detail: "Main hall", attendees: ["Alex", "Priya", "Jordan", "Mei"] },
    retro: { title: "Retrospective", start: "2026-11-06T10:00", end: "2026-11-06T11:00", color: "green" },
    market: { title: "Farmers market", start: "2026-11-07T09:30", end: "2026-11-07T11:00", color: "yellow" },
    hike: { title: "Hike", start: "2026-11-08T13:00", end: "2026-11-08T16:00", color: "blue", detail: "Ridge trail" },
  },
};

const shortAndOverlapping: Calendar = {
  startDate: "2026-11-09",
  days: 5,
  events: {
    "standup-mon": { title: "Standup", start: "2026-11-09T09:00", end: "2026-11-09T09:15", color: "blue" },
    "coffee-mon": { title: "Coffee with Sam", start: "2026-11-09T09:30", end: "2026-11-09T10:00", color: "yellow" },
    hiring: { title: "Hiring panel", start: "2026-11-09T10:00", end: "2026-11-09T11:30", color: "purple", detail: "Room 2", attendees: ["Alex", "Priya", "Jordan"] },
    vendor: { title: "Vendor call", start: "2026-11-09T10:30", end: "2026-11-09T11:30", color: "orange", attendees: ["Jordan", "Sam"] },
    sync: { title: "Design sync", start: "2026-11-09T10:30", end: "2026-11-09T12:00", color: "green", attendees: ["Alex", "Priya", "Mei"] },
    "standup-tue": { title: "Standup", start: "2026-11-10T09:00", end: "2026-11-10T09:15", color: "blue" },
    review: { title: "Code review", start: "2026-11-10T09:30", end: "2026-11-10T10:30", color: "green" },
    pairing: { title: "Pairing", start: "2026-11-10T10:00", end: "2026-11-10T11:00", color: "blue", attendees: ["Priya", "Sam"] },
    "standup-wed": { title: "Standup", start: "2026-11-11T09:00", end: "2026-11-11T09:15", color: "blue" },
    call: { title: "Quick call", start: "2026-11-11T09:15", end: "2026-11-11T09:30", color: "red" },
    focus: { title: "Focus time", start: "2026-11-11T09:30", end: "2026-11-11T12:00", color: "purple" },
    "standup-thu": { title: "Standup", start: "2026-11-12T09:00", end: "2026-11-12T09:15", color: "blue" },
    demo: { title: "Demo prep", start: "2026-11-12T13:00", end: "2026-11-12T14:30", color: "orange", detail: "Room 1", attendees: ["Alex", "Jordan"] },
    "standup-fri": { title: "Standup", start: "2026-11-13T09:00", end: "2026-11-13T09:15", color: "blue" },
    lunch: { title: "Team lunch", start: "2026-11-13T12:00", end: "2026-11-13T13:00", color: "yellow" },
  },
};

// The weeks the days slide between, from Monday. Each date has its own
// events, as in the story, so a day looks the same wherever it is shown.
type Plan = Omit<Event, "start" | "end"> & { from: string; to: string };
const checkIn: Plan = { title: "Team check-in", color: "blue", from: "09:00", to: "09:30" };
const weekdayPlans: Plan[] = [
  { title: "Roadmap review", color: "purple", from: "10:00", to: "11:30", detail: "Room 4" },
  { title: "Customer interview", color: "green", from: "13:00", to: "14:30", detail: "Video call" },
  { title: "Design review", color: "orange", from: "09:30", to: "11:00", detail: "Final screens" },
  { title: "Planning workshop", color: "red", from: "14:00", to: "16:00", detail: "Main hall" },
  { title: "Lunch with Sam", color: "yellow", from: "12:30", to: "13:30" },
  { title: "Budget call", color: "blue", from: "11:00", to: "12:00", detail: "Video call" },
];
const weekendPlans: Plan[] = [
  { title: "Farmers market", color: "yellow", from: "09:30", to: "11:00" },
  { title: "Hike", color: "blue", from: "13:00", to: "16:00", detail: "Ridge trail" },
  { title: "Brunch", color: "orange", from: "10:30", to: "12:00" },
];
const SUNDAY = 0;
const SATURDAY = 6;
const WEEK_DAYS = 7;

const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function weekEvents(monday: string): Record<string, Event> {
  const first = new Date(`${monday}T12:00:00`);
  return Object.fromEntries(Array.from({ length: WEEK_DAYS }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index))
    .flatMap((date) => {
      const weekend = date.getDay() === SUNDAY || date.getDay() === SATURDAY;
      const plans = weekend ? [weekendPlans[date.getDate() % weekendPlans.length]!] : [checkIn, weekdayPlans[date.getDate() % weekdayPlans.length]!];
      return plans.map(({ from, to, ...plan }, index): [string, Event] =>
        [`${isoDate(date)}-${index}`, { ...plan, start: `${isoDate(date)}T${from}`, end: `${isoDate(date)}T${to}` }]);
    }));
}

const slideWeeks: Calendar = {
  startDate: "2026-11-02",
  days: 7,
  events: { ...weekEvents("2026-11-02"), ...weekEvents("2026-11-09"), ...weekEvents("2026-12-14") },
};

/** A store write after the page shows its data, and a wait for the page to have applied it. */
interface Change {
  write: (artifactID: string) => Promise<void>;
  applied: (page: Page) => Promise<void>;
}

const shows = (selector: string) => (page: Page) => page.locator(selector).waitFor({ state: "attached" });
const removed = (selector: string) => (page: Page) => page.locator(selector).waitFor({ state: "detached" });

const set = (path: string, value: JSONValue) => async (artifactID: string) => {
  await client.resources.json.set({ store: { artifactID }, path, value });
};
const remove = (path: string) => async (artifactID: string) => {
  await client.resources.json.remove({ store: { artifactID }, path });
};

/** How production reaches one story's state: what is stored, how the page is opened, and what changes after. */
interface State {
  // Stored before the page opens; the template's seed when absent.
  data?: JSONValue;
  viewport: keyof typeof VIEWPORTS;
  // The page's clock, which decides today and the current time.
  now?: string;
  dark?: boolean;
  // The page shows its error page instead of the calendar.
  unreadable?: boolean;
  // The data is held back until the page shows the empty week, then arrives.
  arriving?: boolean;
  // Store writes the story's play makes, each followed by its motion.
  changes?: Change[];
  ready?: (page: Page) => Promise<void>;
}

const states: Record<string, State> = {
  "week": { data: week, viewport: "artifact" },
  "new": { viewport: "artifact", now: "2026-11-04T10:15:00" },
  "one-day": { data: day, viewport: "fullScreen", now: "2026-11-04T13:20:00" },
  "highlighted": {
    data: { ...day, events: { ...day.events, launch: { ...day.events.launch!, highlight: true } } },
    viewport: "fullScreen",
    now: "2026-11-04T13:20:00",
  },
  "seven-days": { data: sevenDays, viewport: "wide", now: "2026-11-05T16:42:00" },
  "short-and-overlapping": { data: shortAndOverlapping, viewport: "artifact" },
  "narrow": {
    data: sevenDays,
    viewport: "narrow",
    now: "2026-11-05T16:42:00",
    // The person scrolls the days 150 pixels sideways.
    ready: async (page) => {
      const calendar = page.locator("calendar-week");
      await calendar.hover();
      await page.mouse.wheel(150, 0);
      await page.waitForFunction(() => document.querySelector("calendar-week")!.scrollLeft === 150);
    },
  },
  "dark": { data: week, viewport: "artifact", dark: true },
  "unreadable": { data: { ...week, events: [] }, viewport: "artifact", unreadable: true },
  "unreadable-dark": { data: { ...week, events: [] }, viewport: "artifact", unreadable: true, dark: true },
  "visible-hours": { data: { ...week, visibleHours: { start: 9, end: 18 } }, viewport: "wide" },
  "events-arriving": { data: sevenDays, viewport: "wide", arriving: true },
  "event-leaving": {
    data: sevenDays,
    viewport: "wide",
    changes: [{ write: remove("events/interview"), applied: removed('calendar-event[data-key="interview"]') }],
  },
  "event-moving": {
    data: sevenDays,
    viewport: "wide",
    changes: [{
      write: set("events/retro", { ...sevenDays.events.retro!, start: "2026-11-07T10:00", end: "2026-11-07T11:30" }),
      applied: shows('calendar-event[data-key="retro"][start="2026-11-07T10:00"]'),
    }],
  },
  "new-range-of-days": {
    data: slideWeeks,
    viewport: "wide",
    changes: [
      { write: set("startDate", "2026-11-09"), applied: shows('calendar-week[start-date="2026-11-09"]') },
      { write: set("startDate", "2026-12-14"), applied: shows('calendar-week[start-date="2026-12-14"]') },
    ],
  },
  "new-number-of-days": {
    data: sevenDays,
    viewport: "wide",
    changes: [
      { write: set("days", 5), applied: shows('calendar-week[days="5"]') },
      { write: set("days", 7), applied: shows('calendar-week[days="7"]') },
    ],
  },
  "new-range-of-hours": {
    data: sevenDays,
    viewport: "wide",
    changes: [
      { write: set("visibleHours", { start: 9, end: 18 }), applied: shows('calendar-week[start-hour="9"]') },
      { write: set("visibleHours", { start: 12, end: 17 }), applied: shows('calendar-week[start-hour="12"]') },
      { write: remove("visibleHours"), applied: shows("calendar-week:not([start-hour])") },
    ],
  },
};

// proofs/ui/templates/calendar.md#^calendar-ac-conformance
for (const storyID of specStories("./spec/templates/calendar/calendar.stories.ts")) {
  test(`Calendar conforms: ${storyID}`, async () => {
    const state = states[storyID.replace("spec-templates-calendar--", "")];
    expect(state, `No production state for the Calendar story ${storyID}`).toBeDefined();
    const { data, viewport, now = NO_TODAY, dark, unreadable, arriving, changes = [], ready } = state!;

    const id = await createArtifact("calendar", data);
    if (arriving) run.proxy.hold("to-browser");

    // Both pages compare their main element: the story's is inside Storybook's root.
    const story = storybook.page(storyID);
    if (typeof story === "string") throw new Error(`Storybook gave no page options for ${storyID}`);
    await conform({ ...story, root: "main" }, {
      url: artifactURL(run.proxy, id),
      setup: async (page) => {
        await page.clock.setFixedTime(new Date(now));
        await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
      },
      ready: async (page) => {
        if (unreadable) {
          await page.getByRole("alert").waitFor();
          return;
        }
        if (arriving) {
          // The page has drawn the empty week before its data arrives.
          await run.proxy.waitFor(() => run.proxy.openWebSockets > 0);
          await page.locator("calendar-headers > calendar-day").first().waitFor();
          run.proxy.release("to-browser");
        }
        await calendarShown(page);
        await motionSettled(page);
        for (const { write, applied } of changes) {
          await write(id);
          await applied(page);
          await motionSettled(page);
        }
        await ready?.(page);
        await page.mouse.move(0, 0);
      },
    }, { browser: run.browser, root: "main", ...VIEWPORTS[viewport] });
  });
}

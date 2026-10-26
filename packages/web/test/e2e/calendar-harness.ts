// What the Calendar's browser tests share: the authored store values and
// the waits for the page to show its data and for its motion to finish.
import { readFileSync } from "node:fs";
import path from "node:path";

export type Color = "red" | "orange" | "yellow" | "green" | "blue" | "purple";

/** One event as an agent stores it. */
export type CalendarEvent = {
  title: string;
  start: string;
  end: string;
  color?: Color;
  detail?: string;
  attendees?: string[];
  allDay?: boolean;
  highlight?: boolean;
};

/** A Calendar store value that follows the store contract. */
export type CalendarValue = {
  startDate?: string;
  days?: number;
  visibleHours?: { start: number; end: number };
  events: Record<string, CalendarEvent>;
};

const fixture = (name: string): CalendarValue => JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8"));

/** Five working days with all-day, timed, overlapping and short events. */
export const CALENDAR_WEEK = fixture("calendar-week.json");
/** One day, Wednesday, with five timed events. */
export const CALENDAR_DAY = fixture("calendar-day.json");

// The parts of a page these waits use, which the runner's Playwright and
// conform's both provide.
interface CalendarPage {
  locator(selector: string): { waitFor(options: { timeout: number }): Promise<void> };
  evaluate<R, Arg>(pageFunction: (arg: Arg) => R | Promise<R>, arg: Arg): Promise<R>;
}

// Each case creates an artifact and loads its page, which can take several
// seconds on a busy host.
export const PAGE_READY_TIMEOUT_MS = 15_000;

/** Waits for the calendar to show the store's data, after which changes move into place. */
export async function calendarShown(page: CalendarPage): Promise<void> {
  await page.locator("calendar-week[data-ready]").waitFor({ timeout: PAGE_READY_TIMEOUT_MS });
}

// The hours stand still for this many frames once a change of hours in view has finished.
const STILL_FRAMES = 2;

/**
 * Waits for the page's motion to finish: its Web Animations, a slide's view
 * transition, and a change of hours in view, which steps on animation frames
 * and is finished once the hours stand still.
 */
export async function motionSettled(page: CalendarPage): Promise<void> {
  await page.evaluate(async (stillFrames) => {
    const calendar = document.querySelector<HTMLElement>("calendar-week");
    const hours = () => `${calendar?.style.getPropertyValue("--hour-min-height")} ${calendar?.scrollTop}`;
    let drawn = hours();
    for (let still = 0; still < stillFrames;) {
      await Promise.allSettled(document.getAnimations().map((animation) => animation.finished));
      await new Promise(requestAnimationFrame);
      const moving = document.getAnimations().length > 0 || "calendarMove" in document.documentElement.dataset;
      still = !moving && hours() === drawn ? still + 1 : 0;
      drawn = hours();
    }
  }, STILL_FRAMES);
}

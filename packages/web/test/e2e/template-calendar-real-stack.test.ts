// Browser walks of the bundled Calendar page. One running server serves every
// case: each case creates its own Calendar artifact with its own starting
// store value, opens the page directly in a real browser, and writes through
// the page's real resource SDK or a spawned `tv` command.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { TelevisionClient, type CreateTemplateArtifactRequest } from "@telepath-computer/television-shared";
import { disposeAllProductServers, launchProductServer, type ProductServer } from "../../../../test/helpers/product-server.ts";
import { configureTestMotion } from "./helpers.ts";

const templatesBundle = path.resolve(import.meta.dirname, "../../../server/assets/templates");
const fixture = (name: string) => JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8"));
const week = fixture("calendar-week.json");
const day = fixture("calendar-day.json");

// Each case creates an artifact and loads its page, which can take several
// seconds on a busy host.
const PAGE_READY_TIMEOUT_MS = 15_000;
test.describe.configure({ timeout: 60_000 });

let product: ProductServer;
let channelID: string;

test.beforeAll(async () => {
  product = await launchProductServer({ bundledTemplatesBundle: templatesBundle });
  const { channels } = await new TelevisionClient(product.serverURL).channels.list();
  channelID = channels[0]!.id;
});

test.afterAll(async () => {
  await disposeAllProductServers();
});

interface OpenOptions {
  // Fixes the page's clock, which decides today and the now line.
  now?: string;
  // Keeps the page's CSS transitions for a real-motion assertion.
  allowCSSMotion?: boolean;
  // The page's address for the new artifact; its own address by default.
  address?: (artifactID: string) => Promise<string>;
  // Waits for the calendar to show the data; false for a page that shows
  // something else, such as the error page.
  showsCalendar?: boolean;
}

/** Creates a Calendar artifact starting from `data` and opens its page. */
async function openCalendar(page: Page, data: CreateTemplateArtifactRequest["data"], options: OpenOptions = {}): Promise<string> {
  const { now, allowCSSMotion = false, showsCalendar = true } = options;
  const client = new TelevisionClient(product.serverURL);
  const created = await client.templates.create({ templateID: "calendar", channelID, source: "cli", ...(data === undefined ? {} : { data }) });
  if (now) await page.clock.setFixedTime(new Date(now));
  const address = options.address
    ? await options.address(created.artifactID)
    : new URL(`/artifact/${created.artifactID}/index.html`, product.serverURL).toString();
  await page.goto(address);
  if (showsCalendar) await expect(page.locator("calendar-week")).toHaveAttribute("data-ready", "", { timeout: PAGE_READY_TIMEOUT_MS });
  await configureTestMotion(page, { allowCSSMotion });
  return created.artifactID;
}

const errorPage = (page: Page) => page.getByRole("alert");

/** Expects the error page in place of the calendar. */
async function expectErrorPage(page: Page): Promise<void> {
  await expect(errorPage(page)).toBeVisible({ timeout: PAGE_READY_TIMEOUT_MS });
  await expect(errorPage(page).locator("h1")).toHaveText("This calendar can't be shown");
  await expect(errorPage(page).locator("p")).toHaveText("Its saved data isn't in the form this page reads. Ask your agent to check it.");
  await expect(errorPage(page).locator('tv-icon[name="warning"]')).toBeVisible();
  await expect(page.locator("calendar-week")).toHaveCount(0);
}

/** Expects the calendar, showing the working week's events, in place of the error page. */
async function expectWeek(page: Page): Promise<void> {
  await expect(event(page, "retro").locator("h3")).toHaveText("Retrospective", { timeout: PAGE_READY_TIMEOUT_MS });
  await expect(page.locator("h1")).toHaveText("November 2026");
  await expect(errorPage(page)).toHaveCount(0);
}

/** Writes `value` at `path` in the open page's store through the real SDK. */
async function write(page: Page, storePath: string, value: unknown): Promise<void> {
  await page.evaluate(async ({ storePath, value }) => {
    const sdk = "/sdk/v1/resources.js";
    const { getStore, ref, remove, set } = await import(sdk);
    const target = ref(getStore(), storePath);
    await (value === undefined ? remove(target) : set(target, value));
  }, { storePath, value });
}

const event = (page: Page, key: string) => page.locator(`calendar-event[data-key="${key}"]`);

// proofs/ui/templates/calendar/index.md#^calendar-ac-new
test("a new Calendar shows this week from Monday with today and the now line, and no events", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await openCalendar(page, undefined, { now: "2026-11-04T10:15:00" });
  await expect(page.locator("h1")).toHaveText("November 2026");
  await expect(page.locator("calendar-headers > calendar-day")).toHaveCount(7);
  await expect(page.locator("calendar-headers > calendar-day").first()).toHaveAttribute("date", "2026-11-02");
  await expect(page.locator("calendar-headers > calendar-day[data-today]")).toHaveAttribute("date", "2026-11-04");
  await expect(page.locator("calendar-grid > .now-label")).toHaveText(/^10:15\sAM$/);
  await expect(page.locator("calendar-event")).toHaveCount(0);
  await expect(page.locator("calendar-allday")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// proofs/arch/templates/bundled-templates.md#^templates-calendar-ac-live
test("a spawned tv write adds an event to the open page", async ({ page }) => {
  const artifactID = await openCalendar(page, week);
  await expect(page.locator('link[href="/canonical/v2/styles.css?authoredForAppVersion=1.5.4"]')).toHaveCount(1);
  expect(product.runCLI(["resource", "json", "set", "--artifact", artifactID, "events/added",
    JSON.stringify({ title: "Added by an agent", start: "2026-11-03T15:00", end: "2026-11-03T16:00", color: "green" })]))
    .toContain(`JSON store of artifact ${artifactID} updated.`);
  await expect(event(page, "added").locator("h3")).toHaveText("Added by an agent");
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-week
test("the working week shows titles, times, details, attendees and all-day events", async ({ page }) => {
  await openCalendar(page, week);
  await expect(page.locator("h1")).toHaveText("November 2026");
  await expect(page.locator("h1 .year")).toHaveText("2026");
  await expect(page.locator("calendar-headers > calendar-day")).toHaveCount(5);
  await expect(event(page, "retro").locator("h3")).toHaveText("Retrospective");
  await expect(event(page, "retro").locator(".event-time")).toHaveText(/^10:00\s–\s11:30\sAM$/);
  await expect(event(page, "retro").locator(".event-detail")).toHaveText(week.events.retro.detail);
  await expect(event(page, "retro").locator(".event-attendees")).toHaveText("Alex, Priya, Sam");
  await expect(event(page, "retro").locator(".event-attendees svg")).toBeVisible();
  // An event of half an hour or less shows only its start time.
  await expect(event(page, "checkin-mon")).toHaveAttribute("data-size", "short");
  await expect(event(page, "checkin-mon").locator(".event-time")).toHaveText(/^9:00\sAM$/);
  await expect(page.locator("calendar-allday > calendar-event")).toHaveCount(3);
  await expect(event(page, "planning").locator(".event-time")).toBeHidden();
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-scroll
test("first load scrolls to an hour before the earliest event, and a later range change keeps the scroll", async ({ page }) => {
  await openCalendar(page, week);
  const calendar = page.locator("calendar-week");
  // The earliest event starts at 9 AM, so 8 AM sits just below the pinned headers.
  await expect.poll(() => calendar.evaluate((element) => {
    const label = element.querySelector('.hour-label[data-hour="8"]')!.getBoundingClientRect();
    const pinned = element.querySelector("calendar-allday")!.getBoundingClientRect().bottom;
    return Math.abs(label.top + label.height / 2 - pinned - 12) <= 1;
  })).toBe(true);
  await calendar.evaluate((element) => { element.scrollTop = 120; });
  await write(page, "startDate", "2026-11-09");
  await expect(page.locator("calendar-headers > calendar-day").first()).toHaveAttribute("date", "2026-11-09");
  expect(await calendar.evaluate((element) => element.scrollTop)).toBe(120);
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-in-place
test("adding, highlighting, changing and removing events keeps every other block and the scroll position", async ({ page }) => {
  await openCalendar(page, week);
  await expect(event(page, "roadmap").locator(".event-block")).toBeVisible();
  await page.evaluate(() => {
    const week = document.querySelector("calendar-week")!;
    Object.assign(window, {
      before: {
        week,
        roadmap: document.querySelector('calendar-event[data-key="roadmap"] .event-block'),
        checkin: document.querySelector('calendar-event[data-key="checkin-mon"] .event-block'),
      },
    });
    week.scrollTop = 240;
  });
  const unchanged = () => page.evaluate(() => {
    const { before } = window as unknown as { before: Record<string, Element> };
    return {
      week: document.querySelector("calendar-week") === before.week,
      roadmap: document.querySelector('calendar-event[data-key="roadmap"] .event-block') === before.roadmap,
      checkin: document.querySelector('calendar-event[data-key="checkin-mon"] .event-block') === before.checkin,
      scrollTop: document.querySelector("calendar-week")!.scrollTop,
    };
  });
  const same = { week: true, roadmap: true, checkin: true, scrollTop: 240 };

  await write(page, "events/new-event", { title: "New event", start: "2026-11-02T14:00", end: "2026-11-02T15:00", detail: "Added live" });
  await write(page, "events/roadmap/highlight", true);
  await expect(event(page, "new-event").locator("h3")).toHaveText("New event");
  await expect(event(page, "roadmap")).toHaveAttribute("highlight", "");
  expect(await unchanged()).toEqual(same);

  await write(page, "events/roadmap/detail", "Updated live");
  await write(page, "events/new-event", undefined);
  await expect(event(page, "roadmap").locator(".event-detail")).toHaveText("Updated live");
  await expect(event(page, "new-event")).toHaveCount(0);
  expect(await unchanged()).toEqual(same);
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-no-redraw
test("changing one event mutates only that event", async ({ page }) => {
  type Check = { marked: Element[]; otherBlocks: Record<string, string | undefined>; mutations: Node[] };
  await openCalendar(page, week);
  await expect(event(page, "one-to-one").locator(".event-block")).toBeVisible();
  // The calendar's sections, every event and every block, in document order.
  const markedSelector = "calendar-headers, calendar-allday, calendar-grid, calendar-event, calendar-event .event-block";
  await page.evaluate((selector) => {
    const week = document.querySelector("calendar-week")!;
    week.scrollTop = 200;
    const otherBlocks = Object.fromEntries([...week.querySelectorAll<HTMLElement>("calendar-event")]
      .filter((element) => element.dataset.key !== "one-to-one")
      .map((element) => [element.dataset.key, element.querySelector(".event-block")?.outerHTML]));
    const mutations: Node[] = [];
    new MutationObserver((records) => mutations.push(...records.map((record) => record.target)))
      .observe(week, { subtree: true, childList: true, attributes: true, characterData: true });
    const check: Check = { marked: [week, ...week.querySelectorAll(selector)], otherBlocks, mutations };
    Object.assign(window, { calendarCheck: check });
  }, markedSelector);
  await write(page, "events/one-to-one/detail", "Small meeting room");
  await expect(event(page, "one-to-one").locator(".event-detail")).toHaveText("Small meeting room");
  const result = await page.evaluate((selector) => {
    const { marked, otherBlocks, mutations } = (window as unknown as { calendarCheck: Check }).calendarCheck;
    const week = document.querySelector("calendar-week")!;
    const changed = document.querySelector('calendar-event[data-key="one-to-one"]')!;
    const current = [week, ...week.querySelectorAll(selector)];
    return {
      sameNodes: current.length === marked.length && current.every((element, index) => element === marked[index]),
      otherBlocksUnchanged: Object.entries(otherBlocks).every(([key, html]) =>
        document.querySelector(`calendar-event[data-key="${key}"] .event-block`)?.outerHTML === html),
      changedOnlyInEvent: mutations.length > 0 && mutations.every((node) => changed.contains(node)),
      scrollTop: week.scrollTop,
    };
  }, markedSelector);
  expect(result).toEqual({ sameNodes: true, otherBlocksUnchanged: true, changedOnlyInEvent: true, scrollTop: 200 });
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-invalid
test("invalid events are not shown and valid ones still are", async ({ page }) => {
  await openCalendar(page, week);
  await write(page, "events/bad-end", { title: "Bad end", start: "2026-11-02T12:00", end: "2026-11-02T11:00" });
  await write(page, "events/bad-detail", { title: "Bad detail", start: "2026-11-02T12:00", end: "2026-11-02T13:00", detail: 4 });
  await write(page, "events/bad-attendees", { title: "Bad attendees", start: "2026-11-02T12:00", end: "2026-11-02T13:00", attendees: ["Alex", 2] });
  await write(page, "events/bad-color", { title: "Bad colour", start: "2026-11-02T12:00", end: "2026-11-02T13:00", color: "teal" });
  await write(page, "events/good", { title: "Still here", start: "2026-11-02T16:00", end: "2026-11-02T17:00" });
  await expect(event(page, "good").locator(".event-block")).toBeVisible();
  await expect(page.locator('calendar-event[data-key^="bad-"] .event-block')).toHaveCount(0);
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-overlap
test("overlapping events sit side by side and an event with no overlap keeps the day's width", async ({ page }) => {
  await openCalendar(page, week);
  const roadmap = (await event(page, "roadmap").locator(".event-block-inner").boundingBox())!;
  const budget = (await event(page, "budget").locator(".event-block-inner").boundingBox())!;
  const lunch = (await event(page, "lunch-mon").locator(".event-block-inner").boundingBox())!;
  expect(roadmap.x + roadmap.width).toBeLessThanOrEqual(budget.x);
  expect(Math.abs(roadmap.width - budget.width)).toBeLessThan(2);
  expect(lunch.width).toBeGreaterThan(roadmap.width * 2 - 4);
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-attendees
test("attendees show as many whole names as fit and a count, and refit when the column width changes", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 770 });
  await openCalendar(page, week);
  const names = (key: string) => event(page, key).locator(".event-attendees-names");
  await expect(names("retro")).toHaveText("Alex, Priya, Sam");
  await expect(names("design")).toHaveText("Alex, Priya +3");
  // Roadmap review shares its column with the budget call: too narrow for a name.
  await expect(names("roadmap")).toHaveText("3");
  const fitsWhole = (key: string) => names(key).evaluate((label) => label.scrollWidth <= label.clientWidth);
  for (const key of ["retro", "design", "roadmap", "workshop"]) expect(await fitsWhole(key)).toBe(true);
  // A wider window gives the design review room for every name.
  await page.setViewportSize({ width: 1600, height: 770 });
  await expect(names("design")).toHaveText("Alex, Priya, Jordan, Mei, Sam");
  await page.setViewportSize({ width: 760, height: 770 });
  await expect(names("design")).toHaveText("Alex, Priya +3");
  for (const key of ["retro", "design", "roadmap", "workshop"]) expect(await fitsWhole(key)).toBe(true);
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-one-day
test("one day has one column and shows a highlighted event raised without motion on load", async ({ page }) => {
  const data = structuredClone(day);
  data.events.launch.highlight = true;
  await openCalendar(page, data, { allowCSSMotion: true });
  await expect(page.locator("calendar-headers > calendar-day")).toHaveCount(1);
  await expect(page.locator("calendar-grid > calendar-column")).toHaveCount(1);
  await expect(page.locator("calendar-headers .weekday")).toHaveText("Wednesday");
  await expect(event(page, "launch")).toHaveAttribute("highlight", "");
  expect(await event(page, "launch").locator(".event-block-inner").evaluate((block) => block.getAnimations().length)).toBe(0);
  expect(await event(page, "launch").locator(".event-block-inner").evaluate((block) => getComputedStyle(block).transform)).not.toBe("none");
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-highlight-motion
test("a highlight lifts only its event over 700ms, and clearing it settles the event over 450ms", async ({ page }) => {
  await openCalendar(page, day, { allowCSSMotion: true });
  const block = event(page, "launch").locator(".event-block-inner");
  // Record every block's transform transitions from start to end, so the
  // assertions do not depend on sampling the motion while it runs.
  await page.evaluate(() => {
    const seen: { key: string; type: string; elapsedMs: number }[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("calendar-event .event-block-inner")) {
      const key = element.closest<HTMLElement>("calendar-event")!.dataset.key!;
      for (const type of ["transitionrun", "transitionend"]) {
        element.addEventListener(type, (transition) => {
          const { propertyName, elapsedTime } = transition as TransitionEvent;
          if (propertyName === "transform") seen.push({ key, type, elapsedMs: Math.round(elapsedTime * 1000) });
        });
      }
    }
    Object.assign(window, { liftTransitions: seen });
  });
  const transitions = () => page.evaluate(() =>
    (window as unknown as { liftTransitions: { key: string; type: string; elapsedMs: number }[] }).liftTransitions.splice(0));
  const transformDuration = () => block.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.transitionDuration.split(", ")[style.transitionProperty.split(", ").indexOf("transform")];
  });

  await write(page, "events/launch/highlight", true);
  await expect(event(page, "launch")).toHaveAttribute("highlight", "");
  expect(await transformDuration()).toBe("0.7s");
  await expect.poll(() => block.evaluate((element) => element.getAnimations().length)).toBe(0);
  expect(await transitions()).toEqual([
    { key: "launch", type: "transitionrun", elapsedMs: 0 },
    { key: "launch", type: "transitionend", elapsedMs: 700 },
  ]);
  expect(await block.evaluate((element) => getComputedStyle(element).transform)).not.toBe("none");

  await write(page, "events/launch/highlight", false);
  await expect(event(page, "launch")).not.toHaveAttribute("highlight", "");
  expect(await transformDuration()).toBe("0.45s");
  await expect.poll(() => block.evaluate((element) => element.getAnimations().length)).toBe(0);
  expect(await transitions()).toEqual([
    { key: "launch", type: "transitionrun", elapsedMs: 0 },
    { key: "launch", type: "transitionend", elapsedMs: 450 },
  ]);
  await expect(block).toHaveCSS("transform", "none");
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-highlight-motion
test("with reduced motion a highlight raises and settles its event with no motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openCalendar(page, day, { allowCSSMotion: true });
  const block = event(page, "launch").locator(".event-block-inner");
  await write(page, "events/launch/highlight", true);
  await expect(event(page, "launch")).toHaveAttribute("highlight", "");
  expect(await block.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
  expect(await block.evaluate((element) => element.getAnimations().length)).toBe(0);
  expect(await block.evaluate((element) => getComputedStyle(element).transform)).not.toBe("none");
  await write(page, "events/launch/highlight", false);
  await expect(event(page, "launch")).not.toHaveAttribute("highlight", "");
  await expect(block).toHaveCSS("transform", "none");
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  // proofs/ui/templates/calendar/index.md#^calendar-ac-layout
  test(`one day fills the width and keeps a raised event in view at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const data = structuredClone(day);
    data.events.launch.highlight = true;
    await openCalendar(page, data);
    const calendar = await page.locator("calendar-week").evaluate((element) => ({
      right: element.getBoundingClientRect().left + element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    const column = (await page.locator("calendar-grid > calendar-column").boundingBox())!;
    const resting = (await event(page, "review").locator(".event-block-inner").boundingBox())!;
    const raised = (await event(page, "launch").locator(".event-block-inner").boundingBox())!;
    expect(column.x + column.width).toBeGreaterThan(calendar.right - 2);
    expect(resting.x + resting.width).toBeGreaterThan(column.x + column.width * 0.95);
    expect(raised.x + raised.width).toBeLessThan(calendar.right);
    expect(raised.x).toBeGreaterThan(column.x - 8);
    expect(calendar.scrollWidth).toBe(calendar.clientWidth);
  });
}

// proofs/ui/templates/calendar/index.md#^calendar-ac-layout
test("days share the width down to 100 pixels, then scroll sideways under pinned hour labels", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 620 });
  await openCalendar(page, { ...week, days: 7 });
  await expect(page.locator("calendar-grid > calendar-column")).toHaveCount(7);
  const wide = await page.locator("calendar-week").evaluate((calendar) => ({
    scrollWidth: calendar.scrollWidth,
    clientWidth: calendar.clientWidth,
    bottom: calendar.getBoundingClientRect().bottom,
  }));
  expect(wide.scrollWidth).toBe(wide.clientWidth);
  expect(wide.bottom).toBe(620);
  await page.setViewportSize({ width: 400, height: 500 });
  await expect.poll(() => page.locator("calendar-week").evaluate((calendar) => calendar.scrollWidth > calendar.clientWidth)).toBe(true);
  expect(Math.round((await page.locator("calendar-grid > calendar-column").first().boundingBox())!.width)).toBe(100);
  const label = page.locator('calendar-time-axis .hour-label[data-hour="10"]');
  const header = page.locator('calendar-headers > calendar-day[date="2026-11-04"]');
  const before = { label: (await label.boundingBox())!.x, header: (await header.boundingBox())!.x };
  await page.locator("calendar-week").evaluate((calendar) => { calendar.scrollLeft = 150; });
  await expect.poll(async () => (await header.boundingBox())!.x).toBeCloseTo(before.header - 150, 0);
  expect((await label.boundingBox())!.x).toBeCloseTo(before.label, 0);
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-now
test("the current time is marked on today's column and in the hour labels, over events and beneath a raised one", async ({ page }) => {
  await openCalendar(page, { ...week, days: 7 }, { now: "2026-11-05T16:42:00" });
  await expect(page.locator("calendar-headers > calendar-day[data-today] .weekday")).toHaveText("Thu");
  await expect(page.locator("calendar-grid > .now-line")).toHaveCount(1);
  await expect(page.locator("calendar-grid > .now-label")).toHaveText(/^4:42\sPM$/);
  // An event the line crosses: the line and its dot stack over its block,
  // the faint line across the other days under it, and a raised event over the line.
  await write(page, "events/late", { title: "Late review", start: "2026-11-05T16:00", end: "2026-11-05T17:30" });
  await expect(event(page, "late").locator(".event-block")).toBeVisible();
  const zIndex = (selector: string) => page.locator(selector).evaluate((element) => Number(getComputedStyle(element).zIndex));
  const lateBlock = 'calendar-event[data-key="late"] .event-block';
  expect(await zIndex("calendar-grid > .now-line")).toBeGreaterThan(await zIndex(lateBlock));
  expect(await zIndex("calendar-grid > .now-line-faint")).toBeLessThan(await zIndex(lateBlock));
  await write(page, "events/late/highlight", true);
  await expect(event(page, "late")).toHaveAttribute("highlight", "");
  expect(await zIndex(lateBlock)).toBeGreaterThan(await zIndex("calendar-grid > .now-line"));
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-weekend
test("weekend days are shaded in the hour grid and the all-day band only when six or seven days are shown", async ({ page }) => {
  await openCalendar(page, week);
  const background = (date: string) => page.locator(`calendar-grid > calendar-column[date="${date}"]`)
    .evaluate((column) => getComputedStyle(column).backgroundColor);
  const bandBackground = (date: string) => page.locator(`calendar-allday > calendar-cell[date="${date}"]`)
    .evaluate((cell) => getComputedStyle(cell).backgroundColor);
  await page.evaluate(async () => {
    const sdk = "/sdk/v1/resources.js";
    const { getStore, ref, update } = await import(sdk);
    await update(ref(getStore()), { startDate: "2026-11-04", days: 5 });
  });
  await expect(page.locator("calendar-grid > calendar-column[data-weekend]")).toHaveCount(2);
  expect(await background("2026-11-07")).toBe(await background("2026-11-06"));
  expect(await bandBackground("2026-11-07")).toBe(await bandBackground("2026-11-06"));
  await page.evaluate(async () => {
    const sdk = "/sdk/v1/resources.js";
    const { getStore, ref, update } = await import(sdk);
    await update(ref(getStore()), { startDate: "2026-11-02", days: 7 });
  });
  await expect(page.locator("calendar-grid > calendar-column")).toHaveCount(7);
  expect(await background("2026-11-07")).not.toBe(await background("2026-11-06"));
  // The all-day band shades the weekend as the hour grid does.
  expect(await bandBackground("2026-11-07")).toBe(await background("2026-11-07"));
  expect(await bandBackground("2026-11-06")).toBe(await background("2026-11-06"));
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-title-wrap
test("titles in narrow blocks wrap only between words, and a word too wide for its block ends in an ellipsis", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 770 });
  await openCalendar(page, week);
  // Roadmap review shares its column with the budget call, so its title wraps.
  const linesPerWord = await event(page, "roadmap").locator("h3").evaluate((title) => {
    const text = title.firstChild!;
    return [...title.textContent!.matchAll(/\S+/g)].map((word) => {
      const range = document.createRange();
      range.setStart(text, word.index!);
      range.setEnd(text, word.index! + word[0].length);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    });
  });
  expect(linesPerWord).toEqual([1, 1]);
  await write(page, "events/budget/title", "Supercalifragilistic");
  const title = event(page, "budget").locator("h3");
  await expect(title).toHaveText("Supercalifragilistic");
  expect(await title.evaluate((element) => ({
    overflowWrap: getComputedStyle(element).overflowWrap,
    textOverflow: getComputedStyle(element).textOverflow,
    clipped: element.scrollWidth > element.clientWidth,
  }))).toEqual({ overflowWrap: "normal", textOverflow: "ellipsis", clipped: true });
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-appearance
test("the page follows the artifact document's light and dark appearance", async ({ page }) => {
  await openCalendar(page, week);
  const colors = () => page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    calendar: getComputedStyle(document.querySelector("calendar-week")!).backgroundColor,
    ink: getComputedStyle(document.querySelector('calendar-event[data-key="retro"] h3')!).color,
  }));
  const light = await colors();
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  const dark = await colors();
  expect(light.body).toBe(light.calendar);
  expect(dark.body).toBe(dark.calendar);
  expect(dark.body).not.toBe(light.body);
  expect(dark.ink).not.toBe(light.ink);
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-opening
test("before the data arrives, the page shows the month and an empty grid for this week", async ({ page }) => {
  // The page connection is held open and never reaches the server, so the
  // data does not arrive.
  await page.routeWebSocket(/\/artifact-resources\//, () => {});
  await openCalendar(page, week, { now: "2026-11-04T10:15:00", showsCalendar: false });
  await expect(page.locator("calendar-headers > calendar-day")).toHaveCount(7);
  await expect(page.locator("calendar-headers > calendar-day").first()).toHaveAttribute("date", "2026-11-02");
  await expect(page.locator("calendar-headers > calendar-day[data-today]")).toHaveAttribute("date", "2026-11-04");
  await expect(page.locator("h1")).toHaveText("November 2026");
  await expect(page.locator("calendar-grid > .now-label")).toHaveText(/^10:15\sAM$/);
  await expect(page.locator("calendar-event")).toHaveCount(0);
  await expect(errorPage(page)).toHaveCount(0);
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-read-only
test("through a read-only share link the calendar shows as it does through its own address", async ({ page }) => {
  // Share links need a server that requires its token, so this case has its own.
  const shared = await launchProductServer({ bundledTemplatesBundle: templatesBundle, auth: true });
  const client = new TelevisionClient(shared.serverURL, { token: shared.token });
  const { channels } = await client.channels.list();
  const created = await client.templates.create({ templateID: "calendar", channelID: channels[0]!.id, source: "cli", data: week });
  const share = await client.resources.share({ artifactID: created.artifactID, access: "read" });
  await page.goto(new URL(`${share.path}index.html`, shared.serverURL).toString());
  await expect(page.locator("calendar-week")).toHaveAttribute("data-ready", "", { timeout: PAGE_READY_TIMEOUT_MS });
  await expectWeek(page);
  await expect(event(page, "retro").locator(".event-attendees")).toHaveText("Alex, Priya, Sam");
});


// proofs/ui/templates/calendar/index.md#^calendar-ac-disconnection
test("while disconnected the page keeps what it showed with no message, and catches up after reconnecting", async ({ page }) => {
  // Every page connection passes through to the server until `cut` closes it;
  // while `blocked`, new connections are refused.
  let blocked = false;
  const open: { close: () => Promise<void> }[] = [];
  await page.routeWebSocket(/\/artifact-resources\//, (route) => {
    if (blocked) {
      void route.close();
      return;
    }
    const server = route.connectToServer();
    open.push({ close: async () => { await route.close(); await server.close(); } });
  });
  const artifactID = await openCalendar(page, week);
  await expectWeek(page);
  const before = await page.locator("main").innerText();
  blocked = true;
  for (const connection of open.splice(0)) await connection.close();
  expect(product.runCLI(["resource", "json", "set", "--artifact", artifactID, "events/retro/title", '"Retro, moved"']))
    .toContain(`JSON store of artifact ${artifactID} updated.`);
  await expect.poll(() => page.evaluate(async () => {
    const sdk = "/sdk/v1/resources.js";
    const { getConnectionStatus } = await import(sdk);
    return getConnectionStatus();
  })).toBe("disconnected");
  expect(await page.locator("main").innerText()).toBe(before);
  await expect(page.getByText(/reconnecting|disconnected|offline/i)).toHaveCount(0);
  blocked = false;
  await expect(event(page, "retro").locator("h3")).toHaveText("Retro, moved", { timeout: 40_000 });
  await expect(errorPage(page)).toHaveCount(0);
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-unreadable
test("a value that breaks the store contract, or no value, shows the error page, which follows the data back to the calendar", async ({ page }) => {
  await openCalendar(page, week);
  const writeRoot = (value: unknown) => page.evaluate(async (root) => {
    const sdk = "/sdk/v1/resources.js";
    const { getStore, ref, remove, set } = await import(sdk);
    await (root === undefined ? remove(ref(getStore())) : set(ref(getStore()), root));
  }, value);
  for (const [label, value] of [
    ["events is a list", { ...week, events: [] }],
    ["events is missing", { startDate: week.startDate, days: week.days }],
    ["the root is not an object", "November"],
    ["the store has no value", undefined],
  ] as const) {
    await test.step(label, async () => {
      await writeRoot(value);
      await expectErrorPage(page);
      await writeRoot(week);
      await expectWeek(page);
    });
  }
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-unavailable
test("stored data the server reports unavailable shows the error page, and the calendar returns once it can be read", async ({ page, baseURL }) => {
  // The page is opened through a proxy that follows the server across restarts.
  const proxy = await product.appURL(baseURL!);
  const artifactID = await openCalendar(page, week, {
    address: async (id) => new URL(`/artifact/${id}/index.html`, proxy).toString(),
  });
  await expectWeek(page);
  const record = JSON.parse(product.runCLI(["get-artifact", "--id", artifactID])) as { artifact: { store: string } };
  const content = path.join(product.home, "resources", "json", record.artifact.store, "content.json");
  const saved = readFileSync(content);
  // The stored file cannot be read when the server next loads it.
  writeFileSync(content, "not json {");
  await product.restart();
  await expectErrorPage(page);
  writeFileSync(content, saved);
  await product.restart();
  await expectWeek(page);
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-unreadable-range
test("a startDate or days the page cannot read falls back to its default", async ({ page }) => {
  await openCalendar(page, week, { now: "2026-11-04T10:15:00" });
  const days = page.locator("calendar-headers > calendar-day");
  // Not a real date: five days from today, as with no startDate.
  await write(page, "startDate", "2026-11-31");
  await expect(days.first()).toHaveAttribute("date", "2026-11-04");
  await expect(days).toHaveCount(5);
  await write(page, "startDate", week.startDate);
  // Outside 1 to 7: seven days, as with no days.
  await write(page, "days", 9);
  await expect(days).toHaveCount(7);
  await expect(days.first()).toHaveAttribute("date", "2026-11-02");
  await write(page, "days", week.days);
  await expect(days).toHaveCount(5);
  await expect(days.first()).toHaveAttribute("date", "2026-11-02");
  await expect(errorPage(page)).toHaveCount(0);
});

// proofs/ui/templates/calendar/index.md#^calendar-ac-access-lost
test("when the share link the page was opened through is revoked, the page keeps showing the calendar", async ({ page }) => {
  // Share links need a server that requires its token, so this case has its own.
  const shared = await launchProductServer({ bundledTemplatesBundle: templatesBundle, auth: true });
  const client = new TelevisionClient(shared.serverURL, { token: shared.token });
  const { channels } = await client.channels.list();
  const created = await client.templates.create({ templateID: "calendar", channelID: channels[0]!.id, source: "cli", data: week });
  const share = await client.resources.share({ artifactID: created.artifactID, access: "read" });
  await page.goto(new URL(`${share.path}index.html`, shared.serverURL).toString());
  await expect(page.locator("calendar-week")).toHaveAttribute("data-ready", "", { timeout: PAGE_READY_TIMEOUT_MS });
  await expectWeek(page);
  const before = await page.locator("main").innerHTML();
  // A second listener on the same store hears the error the page's own
  // listener hears, so the test knows when the page has heard it.
  await page.evaluate(async () => {
    const sdk = "/sdk/v1/resources.js";
    const { getStore, onValue, ref } = await import(sdk);
    onValue(ref(getStore()), () => {}, (error: { code: string }) => Object.assign(window, { lostAccess: error.code }));
  });
  await client.resources.unshare({ artifactID: created.artifactID });
  await expect.poll(() => page.evaluate(() => (window as unknown as { lostAccess?: string }).lostAccess), { timeout: PAGE_READY_TIMEOUT_MS })
    .toBe("no-store");
  expect(await page.locator("main").innerHTML()).toBe(before);
  await expect(errorPage(page)).toHaveCount(0);
});

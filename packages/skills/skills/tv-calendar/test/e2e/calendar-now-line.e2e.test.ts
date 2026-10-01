import { expect, test } from "@playwright/test";

const EPSILON = 0.001;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const ALIGNMENT_TOLERANCE_PX = 2;
const NOW_LINE_Z_INDEX = "1";
const HEADER_Z_INDEX = "3";
const ALL_DAY_Z_INDEX = "2";
const DOT_LEFT_EDGE = "0px";

test.beforeEach(async ({ page }) => {
  await page.goto("/test/e2e/fixture.html");
});

function todayLocalISO(): string {
  return `(() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  })()`;
}

test("renders faint and bold now-line segments when today falls within the visible range", async ({
  page,
}) => {
  const result = await page.evaluate(async (todayExpr) => {
    const toLocalISO = (date: Date) => {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const today = eval(todayExpr) as string;
    const rangeStart = new Date(`${today}T00:00:00`);
    rangeStart.setDate(rangeStart.getDate() - 1);
    const allDayEnd = new Date(`${today}T00:00:00`);
    allDayEnd.setDate(allDayEnd.getDate() + 1);

    const frame = document.createElement("div");
    frame.style.cssText = "width: 640px; height: 420px;";
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", toLocalISO(rangeStart));
    week.setAttribute("days", "3");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Today");
    event.setAttribute("start", today);
    event.setAttribute("end", toLocalISO(allDayEnd));
    event.setAttribute("all-day", "");
    week.append(event);

    frame.append(week);
    document.body.append(frame);
    await window.flushReactiveMicrotasks();

    const faintLine = week.querySelector<HTMLElement>("calendar-grid > .now-line-faint");
    const line = week.querySelector<HTMLElement>("calendar-grid > .now-line");
    const todayColumn = week.querySelector<HTMLElement>(`calendar-grid > calendar-column[date="${today}"]`);
    const headers = week.querySelector<HTMLElement>(":scope > calendar-headers");
    const allDay = week.querySelector<HTMLElement>(":scope > calendar-allday");

    const faintRect = faintLine?.getBoundingClientRect();
    const lineRect = line?.getBoundingClientRect();
    const todayRect = todayColumn?.getBoundingClientRect();
    const dotStyles = line ? getComputedStyle(line, "::after") : null;

    return {
      allDayZIndex: allDay ? getComputedStyle(allDay).zIndex : null,
      boldCount: week.querySelectorAll("calendar-grid > .now-line").length,
      boldLeft: lineRect?.left ?? null,
      boldRight: lineRect?.right ?? null,
      boldZIndex: line ? getComputedStyle(line).zIndex : null,
      columnLeft: todayRect?.left ?? null,
      columnRight: todayRect?.right ?? null,
      columnWidth: todayRect?.width ?? null,
      dotLeft: dotStyles?.left ?? null,
      dotWidth: dotStyles?.width ?? null,
      faintCount: week.querySelectorAll("calendar-grid > .now-line-faint").length,
      faintWidth: faintRect?.width ?? null,
      faintZIndex: faintLine ? getComputedStyle(faintLine).zIndex : null,
      headerZIndex: headers ? getComputedStyle(headers).zIndex : null,
    };
  }, todayLocalISO());

  expect(result.faintCount).toBe(1);
  expect(result.boldCount).toBe(1);
  expect(result.faintWidth).not.toBeNull();
  expect(result.columnWidth).not.toBeNull();
  expect(result.faintWidth!).toBeGreaterThan(result.columnWidth!);
  expect(result.boldLeft).not.toBeNull();
  expect(result.boldRight).not.toBeNull();
  expect(result.columnLeft).not.toBeNull();
  expect(result.columnRight).not.toBeNull();
  expect(Math.abs(result.boldLeft! - result.columnLeft!)).toBeLessThanOrEqual(
    ALIGNMENT_TOLERANCE_PX,
  );
  expect(Math.abs(result.boldRight! - result.columnRight!)).toBeLessThanOrEqual(
    ALIGNMENT_TOLERANCE_PX,
  );
  expect(result.dotLeft).toBe(DOT_LEFT_EDGE);
  expect(result.dotWidth).not.toBe("0px");
  expect(result.faintZIndex).toBe(NOW_LINE_Z_INDEX);
  expect(result.boldZIndex).toBe(NOW_LINE_Z_INDEX);
  expect(result.headerZIndex).toBe(HEADER_Z_INDEX);
  expect(result.allDayZIndex).toBe(ALL_DAY_Z_INDEX);
});

test("does not render a now-line when today is outside the visible range", async ({ page }) => {
  const counts = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2000-01-01");
    week.setAttribute("days", "1");
    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return {
      bold: week.querySelectorAll("calendar-grid > .now-line").length,
      faint: week.querySelectorAll("calendar-grid > .now-line-faint").length,
    };
  });

  expect(counts).toEqual({ bold: 0, faint: 0 });
});

test("now-line --y-fraction matches the current time of day", async ({ page }) => {
  const fraction = await page.evaluate(async (todayExpr) => {
    const today = eval(todayExpr) as string;
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", today);
    week.setAttribute("days", "1");
    document.body.append(week);
    await window.flushReactiveMicrotasks();

    const line = week.querySelector<HTMLElement>("calendar-grid > .now-line");
    return Number(line?.style.getPropertyValue("--y-fraction").trim());
  }, todayLocalISO());

  const expectedFraction = await page.evaluate(({ hoursPerDay, minutesPerHour }) => {
    const d = new Date();
    return (d.getHours() + d.getMinutes() / minutesPerHour) / hoursPerDay;
  }, { hoursPerDay: HOURS_PER_DAY, minutesPerHour: MINUTES_PER_HOUR });

  expect(fraction).toBeGreaterThan(expectedFraction - EPSILON);
  expect(fraction).toBeLessThan(expectedFraction + EPSILON);
});

import { expect, test } from "@playwright/test";

const HOURS_PER_DAY = 24;
const NOON_INDEX = 12;
const ONE_PM_INDEX = 13;
const LAST_HOUR_INDEX = 23;

test.beforeEach(async ({ page }) => {
  await page.goto("/test/e2e/fixture.html");
});

test("calendar-grid auto-renders calendar-time-axis", async ({ page }) => {
  const tagName = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "1");
    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return week.querySelector("calendar-grid > calendar-time-axis")?.tagName ?? null;
  });

  expect(tagName).toBe("CALENDAR-TIME-AXIS");
});

test("calendar-time-axis renders 24 labels in 12-hour format", async ({ page }) => {
  const labels = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "1");
    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return Array.from(
      week.querySelectorAll<HTMLElement>("calendar-grid calendar-time-axis .hour-label"),
    ).map((label) => label.textContent?.trim());
  });

  expect(labels).toHaveLength(HOURS_PER_DAY);
  expect(labels[0]).toBe("12 AM");
  expect(labels[1]).toBe("1 AM");
  expect(labels[NOON_INDEX]).toBe("12 PM");
  expect(labels[ONE_PM_INDEX]).toBe("1 PM");
  expect(labels[LAST_HOUR_INDEX]).toBe("11 PM");
});

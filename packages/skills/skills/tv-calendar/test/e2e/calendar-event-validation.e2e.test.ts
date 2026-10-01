import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/test/e2e/fixture.html");
});

test("event missing a required attribute is dropped", async ({ page }) => {
  const blocks = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("start", "2026-05-06T09:00");
    event.setAttribute("end", "2026-05-06T10:00");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return event.querySelectorAll(":scope > .event-block").length;
  });

  expect(blocks).toBe(0);
});

test("event with end less than or equal to start is dropped", async ({ page }) => {
  const blocks = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Broken");
    event.setAttribute("start", "2026-05-06T09:00");
    event.setAttribute("end", "2026-05-06T09:00");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return event.querySelectorAll(":scope > .event-block").length;
  });

  expect(blocks).toBe(0);
});

test("all-day event with datetime values is dropped", async ({ page }) => {
  const blocks = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Mismatch");
    event.setAttribute("start", "2026-05-06T09:00");
    event.setAttribute("end", "2026-05-06T10:00");
    event.setAttribute("all-day", "");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return event.querySelectorAll(":scope > .event-block").length;
  });

  expect(blocks).toBe(0);
});

test("event with datetime start and date-only end is dropped", async ({ page }) => {
  const blocks = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Mixed shape");
    event.setAttribute("start", "2026-05-06T09:00");
    event.setAttribute("end", "2026-05-06");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return event.querySelectorAll(":scope > .event-block").length;
  });

  expect(blocks).toBe(0);
});

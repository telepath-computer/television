import { expect, test } from "@playwright/test";

const VISIBLE_DAY_COUNT = 5;

test.beforeEach(async ({ page }) => {
  await page.goto("/test/e2e/fixture.html");
});

test("single-day all-day event renders inside calendar-allday with span 1", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Holiday");
    event.setAttribute("start", "2026-05-04");
    event.setAttribute("end", "2026-05-05");
    event.setAttribute("all-day", "");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return {
      cellCount: week.querySelectorAll("calendar-allday > calendar-cell").length,
      sectionCount: week.querySelectorAll(":scope > calendar-allday").length,
      parent: event.parentElement?.tagName,
      blocks: event.querySelectorAll(":scope > .event-block").length,
      title: event.querySelector("h3")?.textContent?.trim(),
      dayStart: event.style.getPropertyValue("--day-start").trim(),
      daySpan: event.style.getPropertyValue("--day-span").trim(),
    };
  });

  expect(result.sectionCount).toBe(1);
  expect(result.cellCount).toBe(VISIBLE_DAY_COUNT);
  expect(result.parent).toBe("CALENDAR-ALLDAY");
  expect(result.blocks).toBe(1);
  expect(result.title).toBe("Holiday");
  expect(result.dayStart).toBe("1");
  expect(result.daySpan).toBe("1");
});

test("single-day all-day event on Wednesday uses day-start 3 and span 1", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Midweek holiday");
    event.setAttribute("start", "2026-05-06");
    event.setAttribute("end", "2026-05-07");
    event.setAttribute("all-day", "");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return {
      dayStart: event.style.getPropertyValue("--day-start").trim(),
      daySpan: event.style.getPropertyValue("--day-span").trim(),
    };
  });

  expect(result).toEqual({ dayStart: "3", daySpan: "1" });
});

test("week omits calendar-allday when no all-day events are placed", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Standup");
    event.setAttribute("start", "2026-05-04T09:00");
    event.setAttribute("end", "2026-05-04T09:30");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return {
      allDayCount: week.querySelectorAll(":scope > calendar-allday").length,
      parent: event.parentElement?.tagName,
    };
  });

  expect(result).toEqual({ allDayCount: 0, parent: "CALENDAR-GRID" });
});

test("multi-day all-day event spans the visible columns using a non-inclusive end date", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Vacation");
    event.setAttribute("start", "2026-05-04");
    event.setAttribute("end", "2026-05-09");
    event.setAttribute("all-day", "");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return {
      dayStart: event.style.getPropertyValue("--day-start").trim(),
      daySpan: event.style.getPropertyValue("--day-span").trim(),
    };
  });

  expect(result).toEqual({ dayStart: "1", daySpan: "5" });
});

test("all-day event color applies the blue palette treatment", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const resolveBackgroundColor = (token: string): string => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    };

    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "OOO");
    event.setAttribute("start", "2026-05-05");
    event.setAttribute("end", "2026-05-06");
    event.setAttribute("all-day", "");
    event.setAttribute("color", "blue");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    const inner = event.querySelector<HTMLElement>(":scope > .event-block > .event-block-inner");
    const styles = inner ? getComputedStyle(inner) : null;

    return {
      backgroundColor: styles?.backgroundColor ?? null,
      borderLeftStyle: styles?.borderLeftStyle ?? null,
      borderLeftWidth: styles?.borderLeftWidth ?? null,
      expectedBackgroundColor: resolveBackgroundColor("--blue-200"),
    };
  });

  expect(result.backgroundColor).toBe(result.expectedBackgroundColor);
  expect(result.borderLeftStyle).toBe("none");
  expect(result.borderLeftWidth).toBe("0px");
});

test("start-only-clipped all-day event keeps the visible Monday-Wednesday span", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Conference");
    event.setAttribute("start", "2026-05-01");
    event.setAttribute("end", "2026-05-07");
    event.setAttribute("all-day", "");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return {
      dayStart: event.style.getPropertyValue("--day-start").trim(),
      daySpan: event.style.getPropertyValue("--day-span").trim(),
    };
  });

  expect(result).toEqual({ dayStart: "1", daySpan: "3" });
});

test("end-only-clipped all-day event keeps the visible Wednesday-Friday span", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Release prep");
    event.setAttribute("start", "2026-05-06");
    event.setAttribute("end", "2026-05-15");
    event.setAttribute("all-day", "");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return {
      dayStart: event.style.getPropertyValue("--day-start").trim(),
      daySpan: event.style.getPropertyValue("--day-span").trim(),
    };
  });

  expect(result).toEqual({ dayStart: "3", daySpan: "3" });
});

test("partially overlapping all-day event is clipped to the visible range", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Long vacation");
    event.setAttribute("start", "2026-05-01");
    event.setAttribute("end", "2026-05-15");
    event.setAttribute("all-day", "");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return {
      dayStart: event.style.getPropertyValue("--day-start").trim(),
      daySpan: event.style.getPropertyValue("--day-span").trim(),
    };
  });

  expect(result).toEqual({ dayStart: "1", daySpan: "5" });
});

test("all-day event entirely outside the visible range is dropped", async ({ page }) => {
  const blocks = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Past");
    event.setAttribute("start", "2026-04-20");
    event.setAttribute("end", "2026-04-22");
    event.setAttribute("all-day", "");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return event.querySelectorAll(":scope > .event-block").length;
  });

  expect(blocks).toBe(0);
});

test("all-day event stays visible within the week viewport while the hour grid scrolls", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const frame = document.createElement("div");
    frame.style.cssText = "width: 640px; height: 420px;";

    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Holiday");
    event.setAttribute("start", "2026-05-04");
    event.setAttribute("end", "2026-05-05");
    event.setAttribute("all-day", "");
    week.append(event);

    frame.append(week);
    document.body.append(frame);
    await window.flushReactiveMicrotasks();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    week.scrollTop = week.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    const block = event.querySelector<HTMLElement>(":scope > .event-block");
    const weekRect = week.getBoundingClientRect();
    const blockRect = block?.getBoundingClientRect();
    return {
      sectionCount: week.querySelectorAll(":scope > calendar-allday").length,
      blockBottom: blockRect?.bottom ?? null,
      blockTop: blockRect?.top ?? null,
      weekBottom: weekRect.bottom,
      weekTop: weekRect.top,
    };
  });

  expect(result.sectionCount).toBe(1);
  expect(result.blockTop).not.toBeNull();
  expect(result.blockBottom).not.toBeNull();
  expect(result.blockTop!).toBeGreaterThanOrEqual(result.weekTop);
  expect(result.blockBottom!).toBeLessThanOrEqual(result.weekBottom);
});

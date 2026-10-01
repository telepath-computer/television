import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/test/e2e/fixture.html");
});

test("week renders one header chip and grid column per day", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "3");
    document.body.append(week);
    await window.flushReactiveMicrotasks();

    const headers = Array.from(
      week.querySelectorAll<HTMLElement>("calendar-headers > calendar-day"),
    ).map((day) => ({
      date: day.getAttribute("date"),
      index: day.style.getPropertyValue("--day-index").trim(),
      label: `${day.querySelector(".weekday")?.textContent?.trim() ?? ""} ${day.querySelector(".date-num")?.textContent?.trim() ?? ""}`.trim(),
    }));
    const columns = Array.from(
      week.querySelectorAll<HTMLElement>("calendar-grid > calendar-column"),
    ).map((column) => ({
      date: column.getAttribute("date"),
      index: column.style.getPropertyValue("--day-index").trim(),
    }));

    return {
      dayCount: week.style.getPropertyValue("--day-count").trim(),
      hourCount: week.style.getPropertyValue("--hour-count").trim(),
      headers,
      columns,
    };
  });

  expect(result.dayCount).toBe("3");
  expect(result.hourCount).toBe("24");
  expect(result.headers).toEqual([
    { date: "2026-05-04", index: "1", label: "Mon 4" },
    { date: "2026-05-05", index: "2", label: "Tue 5" },
    { date: "2026-05-06", index: "3", label: "Wed 6" },
  ]);
  expect(result.columns).toEqual([
    { date: "2026-05-04", index: "1" },
    { date: "2026-05-05", index: "2" },
    { date: "2026-05-06", index: "3" },
  ]);
});

test("explicit start-hour sets the initial scroll target", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const frame = document.createElement("div");
    frame.style.cssText = "width: 640px; height: 420px;";
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");
    week.setAttribute("start-hour", "14");
    frame.append(week);
    document.body.append(frame);
    await window.flushReactiveMicrotasks();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    return {
      startHour: week.style.getPropertyValue("--start-hour").trim(),
      scrollTop: week.scrollTop,
    };
  });

  expect(result.startHour).toBe("14");
  expect(result.scrollTop).toBeGreaterThan(0);
});

test("omitting start-hour infers it from the earliest visible timed event", async ({ page }) => {
  const startHour = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Late deploy");
    event.setAttribute("start", "2026-05-06T22:00");
    event.setAttribute("end", "2026-05-06T23:00");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return week.style.getPropertyValue("--start-hour").trim();
  });

  expect(startHour).toBe("21");
});

test("omitting start-hour falls back to 8 when there are no timed events", async ({ page }) => {
  const startHour = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");
    await window.flushReactiveMicrotasks();
    document.body.append(week);
    await window.flushReactiveMicrotasks();
    return week.style.getPropertyValue("--start-hour").trim();
  });

  expect(startHour).toBe("8");
});

test("week with invalid range attributes renders no generated sections", async ({ page }) => {
  const counts = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return {
      headers: week.querySelectorAll("calendar-headers").length,
      allDay: week.querySelectorAll("calendar-allday").length,
      grid: week.querySelectorAll("calendar-grid").length,
    };
  });

  expect(counts).toEqual({ headers: 0, allDay: 0, grid: 0 });
});

test("the start-hour marker scrolls below the sticky headers strip", async ({ page }) => {
  const offsets = await page.evaluate(async () => {
    const frame = document.createElement("div");
    frame.style.cssText = "width: 600px; height: 400px;";
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");
    week.setAttribute("start-hour", "6");
    frame.append(week);
    document.body.append(frame);

    await window.flushReactiveMicrotasks();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const marker = week.querySelector<HTMLElement>("calendar-grid > .start-hour-marker");
    const strip = week.querySelector<HTMLElement>("calendar-headers");
    const weekRect = week.getBoundingClientRect();
    const markerRect = marker?.getBoundingClientRect();
    const stripRect = strip?.getBoundingClientRect();
    return {
      markerTopRelativeToWeek: markerRect ? markerRect.top - weekRect.top : null,
      stripBottomRelativeToWeek: stripRect ? stripRect.bottom - weekRect.top : null,
    };
  });

  expect(offsets.markerTopRelativeToWeek).not.toBeNull();
  expect(offsets.stripBottomRelativeToWeek).not.toBeNull();
  expect(offsets.markerTopRelativeToWeek!).toBeGreaterThanOrEqual(
    (offsets.stripBottomRelativeToWeek ?? 0) - 2,
  );
});

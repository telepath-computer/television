import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/test/e2e/fixture.html");
});

test("three same-day all-day events get lanes 1, 2, and 3", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const events = ["Offsite", "Birthday", "Travel"].map((title) => {
      const event = document.createElement("calendar-event");
      event.setAttribute("title", title);
      event.setAttribute("start", "2026-05-06");
      event.setAttribute("end", "2026-05-07");
      event.setAttribute("all-day", "");
      week.append(event);
      return event;
    });

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return {
      laneCount: week.style.getPropertyValue("--allday-lane-count").trim(),
      laneIndexes: events.map((event) => event.style.getPropertyValue("--lane-index").trim()),
    };
  });

  expect(result.laneCount).toBe("3");
  expect(result.laneIndexes).toEqual(["1", "2", "3"]);
});

test("non-overlapping all-day events both reuse lane 1", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const first = document.createElement("calendar-event");
    first.setAttribute("title", "Holiday");
    first.setAttribute("start", "2026-05-04");
    first.setAttribute("end", "2026-05-05");
    first.setAttribute("all-day", "");

    const second = document.createElement("calendar-event");
    second.setAttribute("title", "Field trip");
    second.setAttribute("start", "2026-05-07");
    second.setAttribute("end", "2026-05-08");
    second.setAttribute("all-day", "");

    week.append(first, second);
    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return {
      laneCount: week.style.getPropertyValue("--allday-lane-count").trim(),
      firstLane: first.style.getPropertyValue("--lane-index").trim(),
      secondLane: second.style.getPropertyValue("--lane-index").trim(),
    };
  });

  expect(result.laneCount).toBe("1");
  expect(result.firstLane).toBe("1");
  expect(result.secondLane).toBe("1");
});

test("an all-day event that overlaps two lane-1 neighbors lands in lane 2", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const a = document.createElement("calendar-event");
    a.setAttribute("title", "A");
    a.setAttribute("start", "2026-05-04");
    a.setAttribute("end", "2026-05-05");
    a.setAttribute("all-day", "");

    const b = document.createElement("calendar-event");
    b.setAttribute("title", "B");
    b.setAttribute("start", "2026-05-05");
    b.setAttribute("end", "2026-05-06");
    b.setAttribute("all-day", "");

    const c = document.createElement("calendar-event");
    c.setAttribute("title", "C");
    c.setAttribute("start", "2026-05-04");
    c.setAttribute("end", "2026-05-06");
    c.setAttribute("all-day", "");

    week.append(a, b, c);
    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return {
      laneCount: week.style.getPropertyValue("--allday-lane-count").trim(),
      laneA: a.style.getPropertyValue("--lane-index").trim(),
      laneB: b.style.getPropertyValue("--lane-index").trim(),
      laneC: c.style.getPropertyValue("--lane-index").trim(),
    };
  });

  expect(result.laneCount).toBe("2");
  expect(result.laneA).toBe("1");
  expect(result.laneB).toBe("1");
  expect(result.laneC).toBe("2");
});

test("later-starting timed overlap gets cascade depth 1 and paints on top", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const first = document.createElement("calendar-event");
    first.setAttribute("title", "Design review");
    first.setAttribute("start", "2026-05-06T09:00");
    first.setAttribute("end", "2026-05-06T10:30");

    const second = document.createElement("calendar-event");
    second.setAttribute("title", "Project sync");
    second.setAttribute("start", "2026-05-06T10:00");
    second.setAttribute("end", "2026-05-06T11:00");

    week.append(first, second);
    document.body.append(week);
    await window.flushReactiveMicrotasks();

    const firstInner = first.querySelector<HTMLElement>(":scope > .event-block > .event-block-inner");
    const secondInner = second.querySelector<HTMLElement>(":scope > .event-block > .event-block-inner");
    const firstStyles = firstInner ? getComputedStyle(firstInner) : null;
    const secondStyles = secondInner ? getComputedStyle(secondInner) : null;

    return {
      firstDepth: first.style.getPropertyValue("--cascade-depth").trim(),
      secondDepth: second.style.getPropertyValue("--cascade-depth").trim(),
      firstLeft: Number.parseFloat(firstStyles?.left ?? "0"),
      secondLeft: Number.parseFloat(secondStyles?.left ?? "0"),
      firstZIndex: Number.parseInt(firstStyles?.zIndex ?? "0", 10),
      secondZIndex: Number.parseInt(secondStyles?.zIndex ?? "0", 10),
    };
  });

  expect(result.firstDepth).toBe("0");
  expect(result.secondDepth).toBe("1");
  expect(result.secondLeft).toBeGreaterThan(result.firstLeft);
  expect(result.secondZIndex).toBeGreaterThan(result.firstZIndex);
});

test("timed overlap uses the 2px and 8px cascade offsets", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const first = document.createElement("calendar-event");
    first.setAttribute("title", "Design review");
    first.setAttribute("start", "2026-05-06T09:00");
    first.setAttribute("end", "2026-05-06T10:30");

    const second = document.createElement("calendar-event");
    second.setAttribute("title", "Project sync");
    second.setAttribute("start", "2026-05-06T10:00");
    second.setAttribute("end", "2026-05-06T11:00");

    week.append(first, second);
    document.body.append(week);
    await window.flushReactiveMicrotasks();

    const firstInner = first.querySelector<HTMLElement>(":scope > .event-block > .event-block-inner");
    const secondInner = second.querySelector<HTMLElement>(":scope > .event-block > .event-block-inner");
    const firstStyles = firstInner ? getComputedStyle(firstInner) : null;
    const secondStyles = secondInner ? getComputedStyle(secondInner) : null;

    return {
      firstLeft: firstStyles?.left ?? null,
      firstZIndex: Number.parseInt(firstStyles?.zIndex ?? "0", 10),
      secondLeft: secondStyles?.left ?? null,
      secondZIndex: Number.parseInt(secondStyles?.zIndex ?? "0", 10),
    };
  });

  expect(result.firstLeft).toBe("2px");
  expect(result.secondLeft).toBe("8px");
  expect(result.secondZIndex).toBeGreaterThan(result.firstZIndex);
});

test("three timed events overlapping one slot get cascade depths 0, 1, and 2", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const events = [
      ["Deep work", "2026-05-06T09:00", "2026-05-06T11:00"],
      ["Interview", "2026-05-06T09:30", "2026-05-06T10:30"],
      ["Stakeholder review", "2026-05-06T10:00", "2026-05-06T11:30"],
    ].map(([title, start, end]) => {
      const event = document.createElement("calendar-event");
      event.setAttribute("title", title);
      event.setAttribute("start", start);
      event.setAttribute("end", end);
      week.append(event);
      return event;
    });

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return events.map((event) => event.style.getPropertyValue("--cascade-depth").trim());
  });

  expect(result).toEqual(["0", "1", "2"]);
});

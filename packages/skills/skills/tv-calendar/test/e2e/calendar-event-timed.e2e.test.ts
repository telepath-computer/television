import { expect, test } from "@playwright/test";

const EXPECTED_END_HOUR = 10.5;
const EXPECTED_START_HOUR = 9;
const FRACTION_PRECISION = 5;
const HOURS_PER_DAY = 24;
const NAMED_COLOR_COUNT = 6;

test.beforeEach(async ({ page }) => {
  await page.goto("/test/e2e/fixture.html");
});

test("timed event renders inside calendar-grid with title and placement variables", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Standup");
    event.setAttribute("start", "2026-05-06T09:00");
    event.setAttribute("end", "2026-05-06T10:30");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return {
      parent: event.parentElement?.tagName,
      blocks: event.querySelectorAll(":scope > .event-block").length,
      title: event.querySelector("h3")?.textContent?.trim(),
      dayIndex: event.style.getPropertyValue("--day-index").trim(),
      yStart: Number(event.style.getPropertyValue("--y-start").trim()),
      yEnd: Number(event.style.getPropertyValue("--y-end").trim()),
    };
  });

  expect(result.parent).toBe("CALENDAR-GRID");
  expect(result.blocks).toBe(1);
  expect(result.title).toBe("Standup");
  expect(result.dayIndex).toBe("3");
  expect(result.yStart).toBeCloseTo(EXPECTED_START_HOUR / HOURS_PER_DAY, FRACTION_PRECISION);
  expect(result.yEnd).toBeCloseTo(EXPECTED_END_HOUR / HOURS_PER_DAY, FRACTION_PRECISION);
});

test("timed event color applies the blue palette treatment", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const resolveBackgroundColor = (token: string): string => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    };

    const resolveBorderColor = (token: string): string => {
      const probe = document.createElement("div");
      probe.style.borderLeft = `3px solid var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).borderLeftColor;
      probe.remove();
      return color;
    };

    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Design review");
    event.setAttribute("start", "2026-05-06T11:00");
    event.setAttribute("end", "2026-05-06T12:00");
    event.setAttribute("color", "blue");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    const block = event.querySelector<HTMLElement>(":scope > .event-block");
    const inner = event.querySelector<HTMLElement>(":scope > .event-block > .event-block-inner");
    const styles = inner ? getComputedStyle(inner) : null;

    return {
      backgroundColor: styles?.backgroundColor ?? null,
      borderLeftColor: styles?.borderLeftColor ?? null,
      borderLeftWidth: styles?.borderLeftWidth ?? null,
      blockClassName: block?.className ?? null,
      expectedBackgroundColor: resolveBackgroundColor("--blue-100"),
      expectedBorderColor: resolveBorderColor("--blue-500"),
    };
  });

  expect(result.backgroundColor).toBe(result.expectedBackgroundColor);
  expect(result.borderLeftColor).toBe(result.expectedBorderColor);
  expect(result.borderLeftWidth).toBe("3px");
  expect(result.blockClassName).not.toMatch(/\bcolor-(red|orange|yellow|green|purple)\b/);
});

test("named timed event colors all render distinct backgrounds from each other and neutral", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const colors = ["red", "orange", "yellow", "green", "blue", "purple"] as const;
    const dates = [
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
      "2026-05-09",
    ];
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
    week.setAttribute("days", "6");

    const backgroundColors: string[] = [];
    for (const [index, color] of colors.entries()) {
      const event = document.createElement("calendar-event");
      event.setAttribute("title", color);
      event.setAttribute("start", `${dates[index]}T09:00`);
      event.setAttribute("end", `${dates[index]}T10:00`);
      event.setAttribute("color", color);
      week.append(event);
    }

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    for (const event of week.querySelectorAll<HTMLElement>("calendar-event")) {
      const inner = event.querySelector<HTMLElement>(":scope > .event-block > .event-block-inner");
      backgroundColors.push(getComputedStyle(inner!).backgroundColor);
    }

    return {
      backgroundColors,
      neutralBackgroundColor: resolveBackgroundColor("--neutral-100"),
    };
  });

  expect(new Set(result.backgroundColors).size).toBe(NAMED_COLOR_COUNT);
  expect(result.backgroundColors).not.toContain(result.neutralBackgroundColor);
});

test("unknown timed event color falls back to the neutral default", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const resolveBackgroundColor = (token: string): string => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    };

    const resolveBorderColor = (token: string): string => {
      const probe = document.createElement("div");
      probe.style.borderLeft = `3px solid var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).borderLeftColor;
      probe.remove();
      return color;
    };

    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Unknown palette");
    event.setAttribute("start", "2026-05-06T13:00");
    event.setAttribute("end", "2026-05-06T14:00");
    event.setAttribute("color", "cerulean");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    const block = event.querySelector<HTMLElement>(":scope > .event-block");
    const inner = event.querySelector<HTMLElement>(":scope > .event-block > .event-block-inner");
    const styles = inner ? getComputedStyle(inner) : null;

    return {
      backgroundColor: styles?.backgroundColor ?? null,
      borderLeftColor: styles?.borderLeftColor ?? null,
      borderLeftWidth: styles?.borderLeftWidth ?? null,
      blockClassName: block?.className ?? null,
      expectedBackgroundColor: resolveBackgroundColor("--neutral-100"),
      expectedBorderColor: resolveBorderColor("--neutral-300"),
    };
  });

  expect(result.backgroundColor).toBe(result.expectedBackgroundColor);
  expect(result.borderLeftColor).toBe(result.expectedBorderColor);
  expect(result.borderLeftWidth).toBe("3px");
  expect(result.blockClassName).not.toMatch(/\bcolor-\w+\b/);
});

test("timed event outside the visible range is dropped", async ({ page }) => {
  const blocks = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Elsewhere");
    event.setAttribute("start", "2026-05-12T09:00");
    event.setAttribute("end", "2026-05-12T10:30");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return event.querySelectorAll(":scope > .event-block").length;
  });

  expect(blocks).toBe(0);
});

test("cross-midnight timed event is dropped", async ({ page }) => {
  const blocks = await page.evaluate(async () => {
    const week = document.createElement("calendar-week");
    week.setAttribute("start-date", "2026-05-04");
    week.setAttribute("days", "5");

    const event = document.createElement("calendar-event");
    event.setAttribute("title", "Overnight");
    event.setAttribute("start", "2026-05-06T23:00");
    event.setAttribute("end", "2026-05-07T01:00");
    week.append(event);

    document.body.append(week);
    await window.flushReactiveMicrotasks();

    return event.querySelectorAll(":scope > .event-block").length;
  });

  expect(blocks).toBe(0);
});

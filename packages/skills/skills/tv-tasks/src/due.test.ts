import { describe, expect, it } from "vitest";

import { dueState, formatDue, isValidDueDate } from "./due.js";

// Pinned reference clock: Fri Jun 26 2026, 14:00 local time. Named components so
// the test stays lint-clean (this file lives under src/, so the repo's test-file
// magic-number exemption does not reach it).
const YEAR = 2026;
const JUNE = 5; // zero-based month index
const DAY = 26;
const AFTERNOON_HOUR = 14;
const NOON_MINUTE = 0;
const FIRST_MINUTE_HOUR = 0;
const FIRST_MINUTE = 1;
const LAST_HOUR = 23;
const LAST_MINUTE = 59;

const NOW = new Date(YEAR, JUNE, DAY, AFTERNOON_HOUR, NOON_MINUTE);

describe("isValidDueDate", () => {
  it("accepts a date-only ISO string", () => {
    expect(isValidDueDate("2026-06-26")).toBe(true);
  });

  it("rejects strings that don't parse as YYYY-MM-DD", () => {
    expect(isValidDueDate("tomorrow")).toBe(false);
    expect(isValidDueDate("2026-06")).toBe(false);
    expect(isValidDueDate("2026-06-26T10:00")).toBe(false);
    expect(isValidDueDate("")).toBe(false);
  });
});

describe("dueState", () => {
  it("is 'today' for the same calendar day", () => {
    expect(dueState("2026-06-26", NOW)).toBe("today");
  });

  it("is 'today' regardless of the time component of now", () => {
    const earlyNow = new Date(YEAR, JUNE, DAY, FIRST_MINUTE_HOUR, FIRST_MINUTE);
    const lateNow = new Date(YEAR, JUNE, DAY, LAST_HOUR, LAST_MINUTE);
    expect(dueState("2026-06-26", earlyNow)).toBe("today");
    expect(dueState("2026-06-26", lateNow)).toBe("today");
  });

  it("is 'overdue' for a past calendar day", () => {
    expect(dueState("2026-06-25", NOW)).toBe("overdue");
    expect(dueState("2026-06-20", NOW)).toBe("overdue");
  });

  it("is 'overdue' for a date in a past year", () => {
    expect(dueState("2025-06-20", NOW)).toBe("overdue");
  });

  it("is 'upcoming' for a future calendar day", () => {
    expect(dueState("2026-06-27", NOW)).toBe("upcoming");
    expect(dueState("2026-06-30", NOW)).toBe("upcoming");
  });
});

describe("formatDue", () => {
  it("renders 'Today' for the same calendar day", () => {
    expect(formatDue("2026-06-26", NOW)).toBe("Today");
  });

  it("renders 'Tomorrow' for now + 1 day", () => {
    expect(formatDue("2026-06-27", NOW)).toBe("Tomorrow");
  });

  it("renders 'Yesterday' for now - 1 day", () => {
    expect(formatDue("2026-06-25", NOW)).toBe("Yesterday");
  });

  it("renders a short absolute date for a past date this year", () => {
    expect(formatDue("2026-06-20", NOW)).toBe("Jun 20");
  });

  it("renders a short absolute date for a future date this year", () => {
    expect(formatDue("2026-06-30", NOW)).toBe("Jun 30");
  });

  it("appends the year when the date's year differs from now's year", () => {
    expect(formatDue("2027-06-20", NOW)).toBe("Jun 20, 2027");
  });

  it("appends the year for a past date in a different year", () => {
    expect(formatDue("2025-06-20", NOW)).toBe("Jun 20, 2025");
  });
});

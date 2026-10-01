/*
 * Pure date logic for the <tv-task-meta-due> component (skill-local).
 *
 * Both functions take an injectable `now` so they stay deterministic and
 * testable — the component passes `new Date()` at the call site. Comparison is
 * by calendar day in local time: the time-of-day of `now` is stripped, and the
 * date-only ISO string is treated as a local calendar day.
 */

export type DueState = "today" | "overdue" | "upcoming";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Parse a date-only ISO string ("2026-06-26") into a local-midnight Date. Built
// component-wise (not `new Date(iso)`) so the value lands on the local calendar
// day rather than being interpreted as UTC.
function parseLocalDate(dateISO: string): Date {
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Whether a `date` attribute is usable: parseLocalDate on garbage that isn't
// a date-only ISO string ("tomorrow", "2026-06") yields an Invalid Date, whose
// time is NaN.
export function isValidDueDate(dateISO: string): boolean {
  return !Number.isNaN(parseLocalDate(dateISO).getTime());
}

// Local midnight for the calendar day `now` falls on, dropping its time.
function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_DAY =
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

// Whole-day delta from now's calendar day to the due date's calendar day:
// negative = past, 0 = today, positive = future.
function dayDelta(dateISO: string, now: Date): number {
  const due = parseLocalDate(dateISO);
  const today = startOfLocalDay(now);
  return Math.round((due.getTime() - today.getTime()) / MS_PER_DAY);
}

export function dueState(dateISO: string, now: Date): DueState {
  const delta = dayDelta(dateISO, now);
  if (delta === 0) return "today";
  if (delta < 0) return "overdue";
  return "upcoming";
}

export function formatDue(dateISO: string, now: Date): string {
  const delta = dayDelta(dateISO, now);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";

  const due = parseLocalDate(dateISO);
  const label = `${MONTHS[due.getMonth()]} ${due.getDate()}`;
  return due.getFullYear() === now.getFullYear()
    ? label
    : `${label}, ${due.getFullYear()}`;
}

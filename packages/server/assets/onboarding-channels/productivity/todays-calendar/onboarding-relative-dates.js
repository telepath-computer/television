// Today's Calendar is authored on the Productivity story day. Its dates move
// when the document opens, using the viewer's local calendar day
// (specs/ui/onboarding-artifacts/index.md#^productivity-relative-dates).
const dayMs = 86_400_000;
const storyDay = Date.UTC(2026, 6, 8);

/** Whole calendar days from July 8, 2026 to the local day of `now`. */
export function localDayShift(now) {
  return (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - storyDay) / dayMs;
}

/** Shift an ISO date or local date-time while retaining its clock-time suffix. */
export function shiftDate(value, days) {
  const shifted = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10) + value.slice(10);
}

if (typeof document !== "undefined") {
  const today = new Date();
  const days = localDayShift(today);

  const calendar = document.querySelector("calendar-week");
  if (calendar) {
    calendar.setAttribute("start-date", shiftDate(calendar.getAttribute("start-date"), days));
    for (const event of calendar.querySelectorAll("calendar-event")) {
      event.setAttribute("start", shiftDate(event.getAttribute("start"), days));
      event.setAttribute("end", shiftDate(event.getAttribute("end"), days));
    }
  }
}

import { describe, expect, it } from "vitest";

// The bundled Calendar page's fitting rule, which is a pure function of the
// names, the line's width and a text measure. The page module is plain
// browser JavaScript with no type declarations, so its one export is typed here.
type FitAttendees = (names: string[], availablePx: number, measure: (text: string) => number) => string;
const pageModule = new URL("../assets/templates/calendar/calendar-attendees.js", import.meta.url).href;
const { fitAttendees } = await import(pageModule) as { fitAttendees: FitAttendees };

// Every character is 5 pixels wide.
const measure = (text: string) => text.length * 5;
const names = ["Alex", "Priya", "Jordan"];

describe("Calendar attendees fitting", () => {
  // proofs/ui/templates/calendar.md#^calendar-t-attendees-fit
  it("shows every name when they all fit", () => {
    // "Alex, Priya, Jordan" is 19 characters.
    expect(fitAttendees(names, 95, measure)).toBe("Alex, Priya, Jordan");
  });

  // proofs/ui/templates/calendar.md#^calendar-t-attendees-fit
  it("shows as many whole names as fit, then a count of the rest", () => {
    // "Alex, Priya +1" is 14 characters; the full list does not fit in 90.
    expect(fitAttendees(names, 90, measure)).toBe("Alex, Priya +1");
    // "Alex +2" is 7 characters.
    expect(fitAttendees(names, 40, measure)).toBe("Alex +2");
  });

  // proofs/ui/templates/calendar.md#^calendar-t-attendees-fit
  it("shows the total count when not even one name fits", () => {
    expect(fitAttendees(names, 30, measure)).toBe("3");
    expect(fitAttendees(["Alexandra"], 30, measure)).toBe("1");
  });

  // proofs/ui/templates/calendar.md#^calendar-t-attendees-fit
  it("never cuts a name off", () => {
    for (let width = 0; width <= 120; width += 1) {
      const text = fitAttendees(names, width, measure);
      const shown = text.replace(/ \+\d+$/, "").split(", ");
      expect(/^\d+$/.test(text) || shown.every((name, index) => name === names[index])).toBe(true);
    }
  });
});

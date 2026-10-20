// The artifact store is the source of truth. Its keyed events are diffed into
// the copied calendar component, so a write changes only the affected block.
//
// The page shows one of two things in its main element: the calendar (the
// month title and the calendar-week element), or the error page for data it
// cannot read. Until the data first arrives, it shows the calendar of a new,
// empty store. It never writes to the store.
import "./calendar-event.js";
import "./calendar-week.js";
import { getStore, onConnectionStatusChanged, onValue, ref } from "/sdk/v1/resources.js";

const main = document.querySelector("main");
const masthead = document.querySelector(".masthead");
const calendar = document.querySelector("calendar-week");
const rangeLabel = document.getElementById("range-label");
// The error page, ready to replace the calendar.
const unreadable = document.importNode(document.getElementById("unreadable").content.firstElementChild, true);
const rendered = new Map();
const colors = new Set(["red", "orange", "yellow", "green", "blue", "purple"]);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_DAYS = 7;
// The parts the title shows, so an unchanged title is not rewritten.
let rangeLabelKey = null;
// Whether the calendar shows the store's data, rather than the empty week
// shown before the data arrives or the error page.
let showsData = false;

function localIso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startingDate(value, days) {
  if (typeof value === "string" && isDate(value)) return value;
  const today = new Date();
  if (days === 7) today.setDate(today.getDate() - (today.getDay() + 6) % 7);
  return localIso(today);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDate(value) {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * Whether the store value as a whole follows the store contract: an object
 * whose `events` is an object. A value that does not is shown as the error
 * page. A `startDate` or `days` the page cannot read is treated as absent,
 * and an unreadable event is left out.
 */
function isReadable(value) {
  return isObject(value) && isObject(value.events);
}

function isDayCount(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_DAYS;
}

function validEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value.title !== "string" || typeof value.start !== "string" || typeof value.end !== "string") return false;
  if (value.detail !== undefined && typeof value.detail !== "string") return false;
  if (value.allDay !== undefined && typeof value.allDay !== "boolean") return false;
  if (value.color !== undefined && !colors.has(value.color)) return false;
  if (value.attendees !== undefined && (!Array.isArray(value.attendees) || !value.attendees.every((name) => typeof name === "string"))) return false;
  if (value.highlight !== undefined && typeof value.highlight !== "boolean") return false;
  return true;
}

function setAttributeIfChanged(element, name, value) {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function patchEvent(element, value) {
  setAttributeIfChanged(element, "title", value.title);
  setAttributeIfChanged(element, "start", value.start);
  setAttributeIfChanged(element, "end", value.end);
  setAttributeIfChanged(element, "detail", value.detail ?? null);
  element.attendees = value.attendees ?? null;
  setAttributeIfChanged(element, "color", value.color ?? "blue");
  setAttributeIfChanged(element, "all-day", value.allDay ? "" : null);
  setAttributeIfChanged(element, "highlight", value.highlight ? "" : null);
}

// The title names the month and year shown, as a calendar app's toolbar does:
// "October 2026", or "Oct – Nov 2026" when the days cross a month. The year
// parts are set lighter than the month.
function describeRange(startDate, days) {
  const start = new Date(`${startDate}T12:00:00`);
  if (Number.isNaN(start.getTime())) return [];
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const format = new Intl.DateTimeFormat(undefined, { month: sameMonth ? "long" : "short", year: "numeric" });
  return sameMonth ? format.formatToParts(start) : format.formatRangeToParts(start, end);
}

function renderRangeLabel(parts) {
  const key = parts.map((part) => `${part.type}:${part.value}`).join("|");
  if (rangeLabelKey === key) return;
  rangeLabelKey = key;
  rangeLabel.replaceChildren(...parts.map((part) => {
    if (part.type !== "year") return part.value;
    const year = document.createElement("span");
    year.className = "year";
    year.textContent = part.value;
    return year;
  }));
}

/** Shows the calendar for a store value that follows the store contract. */
function render(store) {
  const days = isDayCount(store.days) ? store.days : MAX_DAYS;
  const startDate = startingDate(store.startDate, days);
  const valid = Object.entries(store.events).filter(([, event]) => validEvent(event));
  const nextKeys = new Set(valid.map(([key]) => key));
  let changed = false;

  // Remove stale keys before adding new ones. The component retains every
  // remaining event node and never scrolls again after its first layout.
  for (const [key, previous] of rendered) {
    if (nextKeys.has(key)) continue;
    previous.element.remove();
    rendered.delete(key);
    changed = true;
  }
  for (const [key, event] of valid) {
    const serialized = JSON.stringify(event);
    const previous = rendered.get(key);
    if (previous?.serialized === serialized) continue;
    const element = previous?.element ?? document.createElement("calendar-event");
    if (!previous) {
      element.dataset.key = key;
      calendar.append(element);
    }
    patchEvent(element, event);
    rendered.set(key, { element, serialized });
    changed = true;
  }

  const rangeChanged = calendar.getAttribute("days") !== String(days) || calendar.getAttribute("start-date") !== startDate;
  setAttributeIfChanged(calendar, "days", String(days));
  setAttributeIfChanged(calendar, "start-date", startDate);
  renderRangeLabel(describeRange(startDate, days));
  if (changed && !rangeChanged) calendar.refreshEvents();
}

/** Puts the calendar, or the error page, in the main element. */
function showCalendar(visible) {
  if (visible ? main.contains(calendar) : main.contains(unreadable)) return;
  main.replaceChildren(...(visible ? [masthead, calendar] : [unreadable]));
}

function showValue(value) {
  if (!isReadable(value)) {
    showError();
    return;
  }
  showCalendar(true);
  render(value);
  if (showsData) return;
  // The first data, or data after the error page: the hours scroll to an
  // hour before the earliest event, as on first load. Highlight motion starts
  // only after this first frame, so an event that arrives raised appears
  // raised.
  showsData = true;
  calendar.scrollToStartHour();
  requestAnimationFrame(() => { calendar.dataset.ready = ""; });
}

function showError() {
  showsData = false;
  showCalendar(false);
}

// Until the data arrives, the calendar of a new, empty store.
render({ events: {} });

// The SDK resubscribes a listener when the page reconnects, so the page
// catches up by itself. A listener that receives an error is removed; the
// page listens again the next time the connection opens, as after the server
// restarts. An error that the page has no access to the store (`no-store`,
// as after the share link it was opened through is revoked) leaves what it
// last showed; any other, such as stored data the server reports
// unavailable, shows the error page.
let listening = false;
function listen() {
  listening = true;
  onValue(ref(getStore()), (snapshot) => showValue(snapshot.val()), (error) => {
    listening = false;
    if (error.code !== "no-store") showError();
  });
}
listen();
onConnectionStatusChanged((status) => {
  if (status === "connected" && !listening) listen();
});

// The tv-calendar week component, ported to an unbundled JavaScript module.
// Store updates call refreshEvents; only a changed range rebuilds the calendar
// chrome, so existing event blocks can keep their DOM identity and scroll.
// The stylesheet derives the height of the day headers, which the all-day
// band sticks beneath, so nothing here measures them.
//
// Timed events that overlap share their day's width in side-by-side columns,
// as Apple Calendar lays them out: each overlapping cluster gets as many
// columns as it needs, and an event widens into columns to its right that
// stay free for its whole time. The CSS reads the result from --column-index,
// --column-span and --column-count on each calendar-event.
import "./calendar-time-axis.js";
import { createAttendeesLine, setAttendees } from "./calendar-attendees.js";
const HOUR_COUNT = 24;
const DEFAULT_START_HOUR = 8;
const NOW_LINE_INTERVAL_MS = 60_000;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MS_PER_SECOND = 1_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = HOUR_COUNT * MINUTES_PER_HOUR;
const DAY_MS = MINUTES_PER_DAY * MINUTES_PER_HOUR * MS_PER_SECOND;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const REACTIVE_PROPERTIES = ["days", "startDate", "startHour"];
// Events this short show their title and start time on one line.
const SHORT_EVENT_MAX_MINUTES = 30;
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
// The custom properties each kind of placement sets on a calendar-event.
const TIMED_PLACEMENT_PROPERTIES = ["--day-index", "--y-start", "--y-end", "--column-index", "--column-span", "--column-count"];
const ALL_DAY_PLACEMENT_PROPERTIES = ["--day-start", "--day-span", "--lane-index"];
/** Owns the day chrome and places authored calendar-event children. */
class CalendarWeekElement extends HTMLElement {
  static observedAttributes = ["days", "start-date", "start-hour"];
  #allDay = null;
  #days = 0;
  #grid = null;
  #hasConnected = false;
  #headers = null;
  #needsConnectedUpdate = false;
  #nowLineInterval = null;
  #pendingReflections = new Set();
  #preUpgradeProperties = new Map();
  #range = null;
  #rangeSignature = null;
  #didInitialScroll = false;
  #startDate = "";
  #startHour;
  #updateNeeded = false;
  #updateScheduled = false;
  constructor() {
    super();
    const instance = this;
    for (const property of REACTIVE_PROPERTIES) {
      if (!Object.hasOwn(this, property)) continue;
      this.#preUpgradeProperties.set(property, instance[property]);
      delete instance[property];
    }
  }
  get days() {
    return this.#days;
  }
  set days(value) {
    if (Object.is(this.#days, value)) return;
    this.#days = value;
    this.#requestPropertyUpdate("days");
  }
  get startDate() {
    return this.#startDate;
  }
  set startDate(value) {
    if (this.#startDate === value) return;
    this.#startDate = value;
    this.#requestPropertyUpdate("start-date");
  }
  get startHour() {
    return this.#startHour;
  }
  set startHour(value) {
    if (Object.is(this.#startHour, value)) return;
    this.#startHour = value;
    this.#requestPropertyUpdate("start-hour");
  }
  connectedCallback() {
    this.dispatchEvent(new Event("reactive:connect"));
    this.#nowLineInterval = setInterval(() => this.#renderNowLine(), NOW_LINE_INTERVAL_MS);
    if (!this.#hasConnected) {
      this.#hasConnected = true;
      this.#pendingReflections.add("days");
      this.#pendingReflections.add("start-date");
      this.#replayPreUpgradeProperties();
      this.#updateNeeded = true;
      this.#requestUpdate();
    } else if (this.#needsConnectedUpdate || this.#updateNeeded) {
      this.#requestUpdate();
    }
  }
  disconnectedCallback() {
    this.dispatchEvent(new Event("reactive:disconnect"));
    if (this.#nowLineInterval !== null) {
      clearInterval(this.#nowLineInterval);
      this.#nowLineInterval = null;
    }
  }
  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (!this.#setValueFromAttribute(name, newValue)) return;
    this.#updateNeeded = true;
    this.#requestUpdate();
  }
  #replayPreUpgradeProperties() {
    for (const [property, value] of this.#preUpgradeProperties) {
      switch (property) {
        case "days":
          this.days = value;
          break;
        case "startDate":
          this.startDate = value;
          break;
        case "startHour":
          this.startHour = value;
          break;
      }
    }
    this.#preUpgradeProperties.clear();
  }
  #requestPropertyUpdate(attribute) {
    this.#pendingReflections.add(attribute);
    this.#updateNeeded = true;
    this.#requestUpdate();
  }
  #requestUpdate() {
    if (this.#updateScheduled) return;
    this.#updateScheduled = true;
    queueMicrotask(() => this.#flushUpdate());
  }
  #flushUpdate() {
    this.#updateScheduled = false;
    if (!this.#hasConnected) return;
    const shouldRender = this.#updateNeeded || this.#needsConnectedUpdate;
    this.#updateNeeded = false;
    this.#needsConnectedUpdate = false;
    this.#reflectPendingProperties();
    if (!this.isConnected) {
      this.#needsConnectedUpdate = shouldRender;
      return;
    }
    if (shouldRender) this.#changed();
  }
  #reflectPendingProperties() {
    const attributes = [...this.#pendingReflections];
    this.#pendingReflections.clear();
    for (const attribute of attributes) {
      const value = attribute === "days" ? this.#days : attribute === "start-date" ? this.#startDate : this.#startHour;
      const serialized = value === undefined ? null : String(value);
      if (serialized === null) {
        this.removeAttribute(attribute);
      } else if (this.getAttribute(attribute) !== serialized) {
        this.setAttribute(attribute, serialized);
      }
    }
  }
  #setValueFromAttribute(name, value) {
    switch (name) {
      case "days": {
        const next = numberFromAttribute(value);
        if (Object.is(this.#days, next)) return false;
        this.#days = next;
        return true;
      }
      case "start-date": {
        const next = value ?? undefined;
        if (this.#startDate === next) return false;
        this.#startDate = next;
        return true;
      }
      case "start-hour": {
        const next = numberFromAttribute(value);
        if (Object.is(this.#startHour, next)) return false;
        this.#startHour = next;
        return true;
      }
      default:
        return false;
    }
  }
  #changed() {
    try {
      this.changed();
    } catch (error) {
      console.error(error);
    }
  }
  changed() {
    const previousScrollTop = this.#didInitialScroll ? this.scrollTop : null;
    const events = this.#collectEvents();
    const range = resolveVisibleRange(this.startDate, this.days);
    const placements = events.map((event) => ({
      event,
      placement: range ? resolveEventPlacement(event, range) : null
    }));
    const allDayLaneCount = assignOverlapMetadata(placements);
    const startHour = resolveStartHour(this.startHour, placements.map(({ placement }) => placement));
    const rangeSignature = range ? `${range.days[0].iso}/${range.dayCount}` : null;
    const rangeChanged = rangeSignature !== this.#rangeSignature;
    this.#range = range;
    this.#rangeSignature = rangeSignature;
    setStyleIfChanged(this, "--day-count", String(range?.dayCount ?? 0));
    setStyleIfChanged(this, "--start-hour", String(startHour));
    if (!range) {
      this.#removeSections();
      for (const { event } of placements) {
        clearEventPlacement(event);
        this.append(event);
      }
      return;
    }
    if (rangeChanged) {
      // The section nodes can be replaced only when the visible dates change.
      // Keep authored events attached while their parent section is rebuilt.
      for (const { event } of placements) this.append(event);
      this.#removeAllDaySection();
      this.#renderSections(range);
    }
    this.#routeEvents(placements, range, allDayLaneCount);
    this.#renderNowLine();
    if (previousScrollTop !== null) this.scrollTop = previousScrollTop;
    if (!this.#didInitialScroll) {
      this.#didInitialScroll = true;
      this.#scrollStartHourIntoView();
    }
  }
  /**
   * Scroll the hours to the start hour at the next update, as on first
   * layout; the page asks for this when its first data arrives.
   */
  scrollToStartHour() {
    this.#didInitialScroll = false;
    this.#updateNeeded = true;
    this.#requestUpdate();
  }

  /** Recompute placement after keyed children change, without rebuilding the range. */
  refreshEvents() {
    this.#updateNeeded = true;
    this.#requestUpdate();
  }
  #scrollStartHourIntoView() {
    requestAnimationFrame(() => {
      const target = this.#grid?.querySelector(":scope > .start-hour-marker");
      if (!target) return;
      const stickyOffset = (this.#headers?.offsetHeight ?? 0) + (this.#allDay?.offsetHeight ?? 0);
      const maxScrollTop = Math.max(this.scrollHeight - this.clientHeight, 0);
      if (maxScrollTop <= 0) return;
      // Hour labels are vertically centered on their line. Leave room for the
      // top half of the label below the sticky header and all-day band.
      const desiredScrollTop = this.scrollTop + (target.getBoundingClientRect().top - this.getBoundingClientRect().top) - stickyOffset - 12;
      this.scrollTop = Math.max(0, Math.min(desiredScrollTop, maxScrollTop));
    });
  }
  #collectEvents() {
    return Array.from(this.querySelectorAll("calendar-event")).sort((left, right) =>
      (left.getAttribute("start") ?? "").localeCompare(right.getAttribute("start") ?? "")
      || (left.dataset.key ?? "").localeCompare(right.dataset.key ?? ""));
  }
  #ensureBaseSections() {
    if (!this.#headers) {
      this.#headers = document.createElement("calendar-headers");
      this.append(this.#headers);
    }
    if (!this.#grid) {
      this.#grid = document.createElement("calendar-grid");
      this.append(this.#grid);
    }
  }
  #ensureAllDaySection(range) {
    if (!this.#allDay) {
      this.#allDay = document.createElement("calendar-allday");
      this.insertBefore(this.#allDay, this.#grid);
      const label = document.createElement("div");
      label.classList.add("allday-label");
      label.textContent = "all-day";
      this.#allDay.replaceChildren(label, ...range.days.map((day, index) => createAllDayCell(day, index + 1)));
    }
  }
  #removeAllDaySection() {
    this.#allDay?.remove();
    this.#allDay = null;
    this.style.removeProperty("--allday-lane-count");
  }
  #removeSections() {
    this.#headers?.remove();
    this.#removeAllDaySection();
    this.#grid?.remove();
    this.#headers = null;
    this.#grid = null;
    this.style.removeProperty("--allday-lane-count");
  }
  #renderSections(range) {
    this.#ensureBaseSections();
    const headerChildren = range.days.map((day, index) => createDayChip(day, index + 1, range.dayCount === 1));
    const gridChildren = [
      document.createElement("calendar-time-axis"),
      ...range.days.map((day, index) => createGridColumn(day, index + 1)),
      createStartHourMarker()
    ];
    this.#headers.replaceChildren(...headerChildren);
    this.#grid.replaceChildren(...gridChildren);
  }
  #routeEvents(entries, range, allDayLaneCount) {
    for (const { event } of entries.filter(({ placement }) => placement === null)) {
      clearEventPlacement(event);
      if (event.parentElement !== this) this.append(event);
    }
    const allDayEntries = entries.filter(isAllDayEntry);
    if (allDayEntries.length > 0) {
      this.#ensureAllDaySection(range);
      setStyleIfChanged(this, "--allday-lane-count", String(allDayLaneCount));
      for (const { event, placement } of allDayEntries) {
        renderEventPlacement(event, placement);
        if (event.parentElement !== this.#allDay) this.#allDay.append(event);
      }
    } else {
      this.#removeAllDaySection();
    }
    // Events go before the now line, so the grid's children keep one order
    // whenever an event is added.
    const nowLine = this.#grid.querySelector(":scope > .now-line-faint");
    for (const { event, placement } of entries.filter(isTimedEntry).sort(compareTimedEntries)) {
      renderEventPlacement(event, placement);
      if (event.parentElement !== this.#grid) this.#grid.insertBefore(event, nowLine);
    }
  }
  #renderNowLine() {
    const existing = this.#grid?.querySelector(":scope > .now-line");
    const existingFaint = this.#grid?.querySelector(":scope > .now-line-faint");
    const existingLabel = this.#grid?.querySelector(":scope > .now-label");
    const removeNowLine = () => {
      existingFaint?.remove();
      existing?.remove();
      existingLabel?.remove();
    };
    if (!this.#grid || !this.#range) {
      removeNowLine();
      return;
    }
    const now = new Date();
    const todayKey = dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const dayIndex = todayKey - this.#range.startDayKey + 1;
    if (dayIndex < 1 || dayIndex > this.#range.dayCount) {
      removeNowLine();
      return;
    }
    const fraction = (now.getHours() + now.getMinutes() / MINUTES_PER_HOUR) / HOUR_COUNT;
    const faintLine = existingFaint ?? document.createElement("div");
    if (!existingFaint) {
      faintLine.classList.add("now-line-faint");
      this.#grid.append(faintLine);
    }
    const line = existing ?? document.createElement("div");
    if (!existing) {
      line.classList.add("now-line");
      this.#grid.append(line);
    }
    // The current time sits in the hour gutter, over the hour label it meets.
    // The outer strip is pinned with the gutter; the time inside is placed.
    const label = existingLabel ?? document.createElement("div");
    if (!existingLabel) {
      label.classList.add("now-label");
      label.append(document.createElement("span"));
      this.#grid.append(label);
    }
    const time = TIME_FORMAT.format(now);
    if (label.textContent !== time) label.firstElementChild.textContent = time;
    setStyleIfChanged(faintLine, "--y-fraction", String(fraction));
    setStyleIfChanged(line, "--day-index", String(dayIndex));
    setStyleIfChanged(line, "--y-fraction", String(fraction));
    setStyleIfChanged(label, "--y-fraction", String(fraction));
  }
}
customElements.define("calendar-week", CalendarWeekElement);
function createAllDayCell(day, dayIndex) {
  const cell = document.createElement("calendar-cell");
  cell.setAttribute("date", day.iso);
  if (day.isWeekend) cell.setAttribute("data-weekend", "");
  cell.style.setProperty("--day-index", String(dayIndex));
  return cell;
}
function createDayChip(day, dayIndex, isOnlyDay) {
  const chip = document.createElement("calendar-day");
  chip.setAttribute("date", day.iso);
  if (day.isWeekend) chip.setAttribute("data-weekend", "");
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (day.iso === todayIso) chip.setAttribute("data-today", "");
  chip.style.setProperty("--day-index", String(dayIndex));
  const weekday = document.createElement("span");
  weekday.classList.add("weekday");
  weekday.textContent = isOnlyDay ? day.labelWeekdayLong : day.labelWeekday;
  const dateNum = document.createElement("span");
  dateNum.classList.add("date-num");
  dateNum.textContent = day.labelDay;
  chip.append(weekday, dateNum);
  return chip;
}
function createGridColumn(day, dayIndex) {
  const column = document.createElement("calendar-column");
  column.setAttribute("date", day.iso);
  if (day.isWeekend) column.setAttribute("data-weekend", "");
  column.style.setProperty("--day-index", String(dayIndex));
  return column;
}
function createStartHourMarker() {
  const marker = document.createElement("div");
  marker.classList.add("start-hour-marker");
  return marker;
}
function renderEventPlacement(event, placement) {
  const block = ensureEventBlock(event);
  const title = event.getAttribute("title") ?? "";
  if (block.querySelector("h3").textContent !== title) block.querySelector("h3").textContent = title;
  const detail = event.getAttribute("detail");
  const detailElement = block.querySelector(".event-detail");
  if (detail !== null && detailElement.textContent !== detail) detailElement.textContent = detail;
  if (detailElement.hidden !== (detail === null)) detailElement.hidden = detail === null;
  setAttendees(block.querySelector(".event-attendees"), event.attendees);
  const timeElement = block.querySelector(".event-time");
  if (placement.kind === "all-day") {
    setStyleIfChanged(event, "--day-start", String(placement.dayStart));
    setStyleIfChanged(event, "--day-span", String(placement.daySpan));
    setStyleIfChanged(event, "--lane-index", String(placement.laneIndex));
    if (!timeElement.hidden) timeElement.hidden = true;
    removeStyles(event, TIMED_PLACEMENT_PROPERTIES);
    delete event.dataset.size;
    return;
  }
  setStyleIfChanged(event, "--day-index", String(placement.dayIndex));
  setStyleIfChanged(event, "--y-start", String(placement.yStart));
  setStyleIfChanged(event, "--y-end", String(placement.yEnd));
  setStyleIfChanged(event, "--column-index", String(placement.columnIndex));
  setStyleIfChanged(event, "--column-span", String(placement.columnSpan));
  setStyleIfChanged(event, "--column-count", String(placement.columnCount));
  const isShort = placement.endMinutes - placement.startMinutes <= SHORT_EVENT_MAX_MINUTES;
  const size = isShort ? "short" : "long";
  if (event.dataset.size !== size) event.dataset.size = size;
  // A short event has room for one line, so it shows only its start time.
  const time = isShort
    ? TIME_FORMAT.format(timeOfDay(placement.startMinutes))
    : TIME_FORMAT.formatRange(timeOfDay(placement.startMinutes), timeOfDay(placement.endMinutes));
  if (timeElement.textContent !== time) timeElement.textContent = time;
  if (timeElement.hidden) timeElement.hidden = false;
  removeStyles(event, ALL_DAY_PLACEMENT_PROPERTIES);
}
function clearEventPlacement(event) {
  event.querySelector(":scope > .event-block")?.remove();
  removeStyles(event, TIMED_PLACEMENT_PROPERTIES);
  removeStyles(event, ALL_DAY_PLACEMENT_PROPERTIES);
  delete event.dataset.size;
}
function removeStyles(element, names) {
  for (const name of names) element.style.removeProperty(name);
}
/** A Date on an arbitrary day at the given minute, for formatting a time of day. */
function timeOfDay(totalMinutes) {
  return new Date(2000, 0, 1, Math.floor(totalMinutes / MINUTES_PER_HOUR), totalMinutes % MINUTES_PER_HOUR);
}
function ensureEventBlock(event) {
  let block = event.querySelector(":scope > .event-block");
  if (block) return block;
  block = document.createElement("div");
  block.classList.add("event-block");
  const inner = document.createElement("div");
  inner.classList.add("event-block-inner");
  const heading = document.createElement("h3");
  const time = document.createElement("div");
  time.className = "event-time";
  const detail = document.createElement("div");
  detail.className = "event-detail";
  inner.append(heading, time, detail, createAttendeesLine());
  block.append(inner);
  event.append(block);
  return block;
}
function resolveEventPlacement(event, range) {
  const title = event.getAttribute("title");
  const startValue = event.getAttribute("start");
  const endValue = event.getAttribute("end");
  if (title === null || startValue === null || endValue === null) return null;
  if (event.hasAttribute("all-day")) {
    const start2 = parseCalendarDate(startValue);
    const end2 = parseCalendarDate(endValue);
    if (!start2 || !end2 || end2.dayKey <= start2.dayKey) return null;
    const clippedStart = Math.max(start2.dayKey, range.startDayKey);
    const clippedEnd = Math.min(end2.dayKey, range.endDayKey);
    if (clippedEnd <= clippedStart) return null;
    return {
      kind: "all-day",
      daySpan: clippedEnd - clippedStart,
      dayStart: clippedStart - range.startDayKey + 1,
      laneIndex: 1
    };
  }
  const start = parseCalendarDateTime(startValue);
  const end = parseCalendarDateTime(endValue);
  if (!start || !end) return null;
  if (start.dayKey !== end.dayKey) return null;
  if (end.totalMinutes <= start.totalMinutes) return null;
  const dayIndex = start.dayKey - range.startDayKey + 1;
  if (dayIndex < 1 || dayIndex > range.dayCount) return null;
  return {
    columnCount: 1,
    columnIndex: 0,
    columnSpan: 1,
    kind: "timed",
    dayIndex,
    endMinutes: end.totalMinutes,
    startHour: start.hour,
    startMinutes: start.totalMinutes,
    yEnd: end.totalMinutes / MINUTES_PER_DAY,
    yStart: start.totalMinutes / MINUTES_PER_DAY
  };
}
function resolveStartHour(attributeValue, placements) {
  if (Number.isInteger(attributeValue) && attributeValue >= 0 && attributeValue <= MAX_HOUR) {
    return attributeValue;
  }
  const timed = placements.filter((placement) => placement?.kind === "timed").map((placement) => placement.startHour);
  if (timed.length > 0) {
    return Math.max(Math.min(...timed) - 1, 0);
  }
  return DEFAULT_START_HOUR;
}
function resolveVisibleRange(startDate, days) {
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1) return null;
  if (startDate === undefined) return null;
  const start = parseCalendarDate(startDate);
  if (!start) return null;
  const rangeDays = Array.from({ length: days }, (_, index) => shiftCalendarDate(start, index));
  return {
    dayCount: days,
    days: rangeDays,
    endDayKey: start.dayKey + days,
    startDayKey: start.dayKey
  };
}
function numberFromAttribute(value) {
  return value === null ? undefined : Number(value);
}
function parseCalendarDate(value) {
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!isValidCalendarDate(year, month, day)) return null;
  const displayDate = new Date(year, month - 1, day);
  const weekday = displayDate.getDay();
  return {
    dayKey: dateKey(year, month, day),
    iso: value,
    isWeekend: weekday === 0 || weekday === 6,
    labelDay: String(day),
    labelWeekday: displayDate.toLocaleDateString(undefined, { weekday: "short" }),
    labelWeekdayLong: displayDate.toLocaleDateString(undefined, { weekday: "long" })
  };
}
function parseCalendarDateTime(value) {
  const match = DATETIME_RE.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!isValidCalendarDate(year, month, day)) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > MAX_HOUR) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > MAX_MINUTE) return null;
  return {
    dayKey: dateKey(year, month, day),
    hour,
    totalMinutes: hour * MINUTES_PER_HOUR + minute
  };
}
function shiftCalendarDate(day, offset) {
  const next = new Date((day.dayKey + offset) * DAY_MS);
  const year = next.getUTCFullYear();
  const month = next.getUTCMonth() + 1;
  const date = next.getUTCDate();
  return parseCalendarDate(
    `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`
  );
}
function isValidCalendarDate(year, month, day) {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}
function dateKey(year, month, day) {
  return Date.UTC(year, month - 1, day) / DAY_MS;
}
function assignOverlapMetadata(entries) {
  const lanePlacements = [];
  for (const { placement } of entries.filter(isAllDayEntry)) {
    const placementEnd = placement.dayStart + placement.daySpan;
    let laneIndex = lanePlacements.findIndex(
      (lane) => lane.every((existing) => !overlaps(existing.dayStart, existing.dayStart + existing.daySpan, placement.dayStart, placementEnd))
    );
    if (laneIndex === -1) {
      lanePlacements.push([]);
      laneIndex = lanePlacements.length - 1;
    }
    placement.laneIndex = laneIndex + 1;
    lanePlacements[laneIndex].push(placement);
  }
  const timedPlacementsByDay = new Map();
  for (const { placement } of entries.filter(isTimedEntry)) {
    const dayPlacements = timedPlacementsByDay.get(placement.dayIndex) ?? [];
    dayPlacements.push(placement);
    timedPlacementsByDay.set(placement.dayIndex, dayPlacements);
  }
  for (const dayPlacements of timedPlacementsByDay.values()) {
    for (const cluster of overlapClusters(dayPlacements)) assignColumns(cluster);
  }
  return lanePlacements.length;
}
/** Groups one day's timed placements into runs linked by overlapping times. */
function overlapClusters(placements) {
  // Earlier events come first; among equal starts the longer one takes the
  // leftmost column, as in Apple Calendar.
  const sorted = [...placements].sort((left, right) => left.startMinutes - right.startMinutes || right.endMinutes - left.endMinutes);
  const clusters = [];
  let clusterEnd = -1;
  for (const placement of sorted) {
    if (placement.startMinutes >= clusterEnd) clusters.push([]);
    clusters.at(-1).push(placement);
    clusterEnd = Math.max(clusterEnd, placement.endMinutes);
  }
  return clusters;
}
/** Gives each placement in one cluster a column, a column count and a span. */
function assignColumns(cluster) {
  const columns = [];
  for (const placement of cluster) {
    let columnIndex = columns.findIndex((column) => column.at(-1).endMinutes <= placement.startMinutes);
    if (columnIndex === -1) {
      columns.push([]);
      columnIndex = columns.length - 1;
    }
    columns[columnIndex].push(placement);
    placement.columnIndex = columnIndex;
  }
  for (const placement of cluster) {
    placement.columnCount = columns.length;
    // Widen into each following column that has nothing at this event's time.
    let columnSpan = 1;
    while (
      placement.columnIndex + columnSpan < columns.length
      && columns[placement.columnIndex + columnSpan].every(
        (other) => !overlaps(other.startMinutes, other.endMinutes, placement.startMinutes, placement.endMinutes)
      )
    ) columnSpan += 1;
    placement.columnSpan = columnSpan;
  }
}
function compareTimedEntries(left, right) {
  return left.placement.dayIndex - right.placement.dayIndex || left.placement.startMinutes - right.placement.startMinutes || left.placement.endMinutes - right.placement.endMinutes;
}
function isAllDayEntry(entry) {
  return entry.placement?.kind === "all-day";
}
function isTimedEntry(entry) {
  return entry.placement?.kind === "timed";
}
function overlaps(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart < rightEnd && rightStart < leftEnd;
}
function setStyleIfChanged(element, name, value) {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}
export {
  CalendarWeekElement
};

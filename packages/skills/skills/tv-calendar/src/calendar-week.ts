import "./calendar-time-axis.ts";
import "./calendar-week.css";

const HOUR_COUNT = 24;
const DEFAULT_START_HOUR = 8;
const NOW_LINE_INTERVAL_MS = 60_000;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MS_PER_SECOND = 1000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = HOUR_COUNT * MINUTES_PER_HOUR;
const DAY_MS = MINUTES_PER_DAY * MINUTES_PER_HOUR * MS_PER_SECOND;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const REACTIVE_PROPERTIES = ["days", "startDate", "startHour"] as const;

type ReactiveProperty = (typeof REACTIVE_PROPERTIES)[number];

type CalendarDate = {
  dayKey: number;
  iso: string;
  labelDay: string;
  labelWeekday: string;
};

type VisibleRange = {
  dayCount: number;
  days: CalendarDate[];
  endDayKey: number;
  startDayKey: number;
};

type TimedPlacement = {
  cascadeDepth: number;
  kind: "timed";
  dayIndex: number;
  endMinutes: number;
  startHour: number;
  startMinutes: number;
  yEnd: number;
  yStart: number;
};

type AllDayPlacement = {
  kind: "all-day";
  daySpan: number;
  dayStart: number;
  laneIndex: number;
};

type EventPlacement = TimedPlacement | AllDayPlacement;
type PlacementEntry = { event: HTMLElement; placement: EventPlacement | null };

export class CalendarWeekElement extends HTMLElement {
  static observedAttributes = ["days", "start-date", "start-hour"];

  #allDay: HTMLElement | null = null;
  #days: number | undefined = 0;
  #grid: HTMLElement | null = null;
  #hasConnected = false;
  #headers: HTMLElement | null = null;
  #headersResizeObserver: ResizeObserver | null = null;
  #needsConnectedUpdate = false;
  #nowLineInterval: ReturnType<typeof setInterval> | null = null;
  #pendingReflections = new Set<string>();
  #preUpgradeProperties = new Map<ReactiveProperty, unknown>();
  #range: VisibleRange | null = null;
  #startDate: string | undefined = "";
  #startHour: number | undefined;
  #updateNeeded = false;
  #updateScheduled = false;

  constructor() {
    super();
    const instance = this as unknown as Record<ReactiveProperty, unknown>;
    for (const property of REACTIVE_PROPERTIES) {
      if (!Object.hasOwn(this, property)) continue;
      this.#preUpgradeProperties.set(property, instance[property]);
      delete instance[property];
    }
  }

  get days(): number | undefined {
    return this.#days;
  }

  set days(value: number | undefined) {
    if (Object.is(this.#days, value)) return;
    this.#days = value;
    this.#requestPropertyUpdate("days");
  }

  get startDate(): string | undefined {
    return this.#startDate;
  }

  set startDate(value: string | undefined) {
    if (this.#startDate === value) return;
    this.#startDate = value;
    this.#requestPropertyUpdate("start-date");
  }

  get startHour(): number | undefined {
    return this.#startHour;
  }

  set startHour(value: number | undefined) {
    if (Object.is(this.#startHour, value)) return;
    this.#startHour = value;
    this.#requestPropertyUpdate("start-hour");
  }

  connectedCallback(): void {
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

  disconnectedCallback(): void {
    this.dispatchEvent(new Event("reactive:disconnect"));
    if (this.#nowLineInterval !== null) {
      clearInterval(this.#nowLineInterval);
      this.#nowLineInterval = null;
    }
    this.#headersResizeObserver?.disconnect();
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    if (!this.#setValueFromAttribute(name, newValue)) return;
    this.#updateNeeded = true;
    this.#requestUpdate();
  }

  #replayPreUpgradeProperties(): void {
    for (const [property, value] of this.#preUpgradeProperties) {
      switch (property) {
        case "days":
          this.days = value as number | undefined;
          break;
        case "startDate":
          this.startDate = value as string | undefined;
          break;
        case "startHour":
          this.startHour = value as number | undefined;
          break;
      }
    }
    this.#preUpgradeProperties.clear();
  }

  #requestPropertyUpdate(attribute: string): void {
    this.#pendingReflections.add(attribute);
    this.#updateNeeded = true;
    this.#requestUpdate();
  }

  #requestUpdate(): void {
    if (this.#updateScheduled) return;
    this.#updateScheduled = true;
    queueMicrotask(() => this.#flushUpdate());
  }

  #flushUpdate(): void {
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

  #reflectPendingProperties(): void {
    const attributes = [...this.#pendingReflections];
    this.#pendingReflections.clear();
    for (const attribute of attributes) {
      const value = attribute === "days"
        ? this.#days
        : attribute === "start-date"
        ? this.#startDate
        : this.#startHour;
      const serialized = value === undefined ? null : String(value);
      if (serialized === null) {
        this.removeAttribute(attribute);
      } else if (this.getAttribute(attribute) !== serialized) {
        this.setAttribute(attribute, serialized);
      }
    }
  }

  #setValueFromAttribute(name: string, value: string | null): boolean {
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

  #changed(): void {
    try {
      this.changed();
    } catch (error) {
      console.error(error);
    }
  }

  changed(): void {
    const events = this.#collectEvents();
    const range = resolveVisibleRange(this.startDate, this.days);
    const placements: PlacementEntry[] = events.map((event) => ({
      event,
      placement: range ? resolveEventPlacement(event, range) : null,
    }));
    const allDayLaneCount = assignOverlapMetadata(placements);
    const startHour = resolveStartHour(this.startHour, placements.map(({ placement }) => placement));

    this.#range = range;
    this.style.setProperty("--day-count", String(range?.dayCount ?? 0));
    this.style.setProperty("--hour-count", String(HOUR_COUNT));
    this.style.setProperty("--start-hour", String(startHour));

    if (!range) {
      this.#removeSections();
      for (const { event } of placements) {
        clearEventPlacement(event);
        this.append(event);
      }
      return;
    }

    this.#renderSections(range);
    this.#routeEvents(placements, range, allDayLaneCount);
    this.#renderNowLine();
    this.#scrollToStartHour();
  }

  #scrollToStartHour(): void {
    requestAnimationFrame(() => {
      this.#syncHeadersHeight();
      const target = this.#grid?.querySelector<HTMLElement>(":scope > .start-hour-marker");
      if (!target) return;
      const stickyOffset = (this.#headers?.offsetHeight ?? 0) + (this.#allDay?.offsetHeight ?? 0);
      const maxScrollTop = Math.max(this.scrollHeight - this.clientHeight, 0);
      if (maxScrollTop <= 0) return;

      const desiredScrollTop = this.scrollTop +
        (target.getBoundingClientRect().top - this.getBoundingClientRect().top) -
        stickyOffset;
      this.scrollTop = Math.max(0, Math.min(desiredScrollTop, maxScrollTop));
    });
  }

  #collectEvents(): HTMLElement[] {
    return Array.from(this.querySelectorAll<HTMLElement>("calendar-event"));
  }

  #ensureBaseSections(): void {
    if (!this.#headers) {
      this.#headers = document.createElement("calendar-headers");
      this.append(this.#headers);
    }
    if (!this.#grid) {
      this.#grid = document.createElement("calendar-grid");
      this.append(this.#grid);
    }
  }

  #ensureAllDaySection(range: VisibleRange): void {
    if (!this.#allDay) {
      this.#allDay = document.createElement("calendar-allday");
      this.insertBefore(this.#allDay, this.#grid);
    }

    const allDayChildren = range.days.map((day, index) => createAllDayCell(day, index + 1));
    this.#allDay.replaceChildren(...allDayChildren);
  }

  #removeAllDaySection(): void {
    this.#allDay?.remove();
    this.#allDay = null;
    this.style.removeProperty("--allday-lane-count");
  }

  #removeSections(): void {
    this.#headersResizeObserver?.disconnect();
    this.#headers?.remove();
    this.#removeAllDaySection();
    this.#grid?.remove();
    this.#headers = null;
    this.#grid = null;
    this.style.removeProperty("--headers-height");
    this.style.removeProperty("--allday-lane-count");
  }

  #renderSections(range: VisibleRange): void {
    this.#ensureBaseSections();

    const headerChildren = range.days.map((day, index) => createDayChip(day, index + 1));
    const gridChildren = [
      document.createElement("calendar-time-axis"),
      ...range.days.map((day, index) => createGridColumn(day, index + 1)),
      createStartHourMarker(),
    ];

    this.#headers!.replaceChildren(...headerChildren);
    this.#grid!.replaceChildren(...gridChildren);
    this.#observeHeaders();
  }

  #routeEvents(
    entries: PlacementEntry[],
    range: VisibleRange,
    allDayLaneCount: number,
  ): void {
    const allDayEntries = entries.filter(isAllDayEntry);
    if (allDayEntries.length > 0) {
      this.#ensureAllDaySection(range);
      this.style.setProperty("--allday-lane-count", String(allDayLaneCount));
      for (const { event, placement } of allDayEntries) {
        renderEventPlacement(event, placement);
        this.#allDay!.append(event);
      }
    } else {
      this.#removeAllDaySection();
    }

    for (const { event, placement } of entries.filter(isTimedEntry).sort(compareTimedEntries)) {
      renderEventPlacement(event, placement);
      this.#grid!.append(event);
    }

    for (const { event } of entries.filter(({ placement }) => placement === null)) {
      clearEventPlacement(event);
      this.append(event);
    }
  }

  #renderNowLine(): void {
    const existing = this.#grid?.querySelector<HTMLElement>(":scope > .now-line");
    const existingFaint = this.#grid?.querySelector<HTMLElement>(":scope > .now-line-faint");
    if (!this.#grid || !this.#range) {
      existingFaint?.remove();
      existing?.remove();
      return;
    }

    const now = new Date();
    const todayKey = dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const dayIndex = todayKey - this.#range.startDayKey + 1;
    if (dayIndex < 1 || dayIndex > this.#range.dayCount) {
      existingFaint?.remove();
      existing?.remove();
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
    faintLine.style.setProperty("--y-fraction", String(fraction));
    line.style.setProperty("--day-index", String(dayIndex));
    line.style.setProperty("--y-fraction", String(fraction));
  }

  #observeHeaders(): void {
    if (!this.#headers) {
      this.#headersResizeObserver?.disconnect();
      this.style.removeProperty("--headers-height");
      return;
    }

    if (typeof ResizeObserver !== "function") {
      this.#syncHeadersHeight();
      return;
    }

    if (!this.#headersResizeObserver) {
      this.#headersResizeObserver = new ResizeObserver(() => this.#syncHeadersHeight());
    }

    this.#headersResizeObserver.disconnect();
    this.#headersResizeObserver.observe(this.#headers);
  }

  #syncHeadersHeight(): void {
    this.style.setProperty("--headers-height", `${this.#headers?.offsetHeight ?? 0}px`);
  }
}

customElements.define("calendar-week", CalendarWeekElement);

function createAllDayCell(day: CalendarDate, dayIndex: number): HTMLElement {
  const cell = document.createElement("calendar-cell");
  cell.setAttribute("date", day.iso);
  cell.style.setProperty("--day-index", String(dayIndex));
  return cell;
}

function createDayChip(day: CalendarDate, dayIndex: number): HTMLElement {
  const chip = document.createElement("calendar-day");
  chip.setAttribute("date", day.iso);
  chip.style.setProperty("--day-index", String(dayIndex));

  const weekday = document.createElement("span");
  weekday.classList.add("weekday");
  weekday.textContent = day.labelWeekday;

  const dateNum = document.createElement("span");
  dateNum.classList.add("date-num");
  dateNum.textContent = day.labelDay;

  chip.append(weekday, dateNum);
  return chip;
}

function createGridColumn(day: CalendarDate, dayIndex: number): HTMLElement {
  const column = document.createElement("calendar-column");
  column.setAttribute("date", day.iso);
  column.style.setProperty("--day-index", String(dayIndex));
  return column;
}

function createStartHourMarker(): HTMLElement {
  const marker = document.createElement("div");
  marker.classList.add("start-hour-marker");
  return marker;
}

function renderEventPlacement(event: HTMLElement, placement: EventPlacement): void {
  const block = ensureEventBlock(event);
  const title = event.getAttribute("title") ?? "";
  block.querySelector("h3")!.textContent = title;

  if (placement.kind === "all-day") {
    event.style.setProperty("--day-start", String(placement.dayStart));
    event.style.setProperty("--day-span", String(placement.daySpan));
    event.style.setProperty("--lane-index", String(placement.laneIndex));
    event.style.removeProperty("--day-index");
    event.style.removeProperty("--y-start");
    event.style.removeProperty("--y-end");
    event.style.removeProperty("--cascade-depth");
    return;
  }

  event.style.setProperty("--day-index", String(placement.dayIndex));
  event.style.setProperty("--y-start", String(placement.yStart));
  event.style.setProperty("--y-end", String(placement.yEnd));
  event.style.setProperty("--cascade-depth", String(placement.cascadeDepth));
  event.style.removeProperty("--day-start");
  event.style.removeProperty("--day-span");
  event.style.removeProperty("--lane-index");
}

function clearEventPlacement(event: HTMLElement): void {
  event.querySelector<HTMLElement>(":scope > .event-block")?.remove();
  event.style.removeProperty("--day-index");
  event.style.removeProperty("--y-start");
  event.style.removeProperty("--y-end");
  event.style.removeProperty("--day-start");
  event.style.removeProperty("--day-span");
  event.style.removeProperty("--lane-index");
  event.style.removeProperty("--cascade-depth");
}

function ensureEventBlock(event: HTMLElement): HTMLElement {
  let block = event.querySelector<HTMLElement>(":scope > .event-block");
  if (block) return block;

  block = document.createElement("div");
  block.classList.add("event-block");

  const inner = document.createElement("div");
  inner.classList.add("event-block-inner");

  const heading = document.createElement("h3");
  inner.append(heading);
  block.append(inner);
  event.append(block);

  return block;
}

function resolveEventPlacement(event: HTMLElement, range: VisibleRange): EventPlacement | null {
  const title = event.getAttribute("title");
  const startValue = event.getAttribute("start");
  const endValue = event.getAttribute("end");
  if (title === null || startValue === null || endValue === null) return null;

  if (event.hasAttribute("all-day")) {
    const start = parseCalendarDate(startValue);
    const end = parseCalendarDate(endValue);
    if (!start || !end || end.dayKey <= start.dayKey) return null;

    const clippedStart = Math.max(start.dayKey, range.startDayKey);
    const clippedEnd = Math.min(end.dayKey, range.endDayKey);
    if (clippedEnd <= clippedStart) return null;

    return {
      kind: "all-day",
      daySpan: clippedEnd - clippedStart,
      dayStart: clippedStart - range.startDayKey + 1,
      laneIndex: 1,
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
    cascadeDepth: 0,
    kind: "timed",
    dayIndex,
    endMinutes: end.totalMinutes,
    startHour: start.hour,
    startMinutes: start.totalMinutes,
    yEnd: end.totalMinutes / MINUTES_PER_DAY,
    yStart: start.totalMinutes / MINUTES_PER_DAY,
  };
}

function resolveStartHour(
  attributeValue: number | undefined,
  placements: Array<EventPlacement | null>,
): number {
  if (Number.isInteger(attributeValue) && attributeValue! >= 0 && attributeValue! <= MAX_HOUR) {
    return attributeValue!;
  }

  const timed = placements
    .filter((placement): placement is TimedPlacement => placement?.kind === "timed")
    .map((placement) => placement.startHour);
  if (timed.length > 0) {
    return Math.max(Math.min(...timed) - 1, 0);
  }

  return DEFAULT_START_HOUR;
}

function resolveVisibleRange(
  startDate: string | undefined,
  days: number | undefined,
): VisibleRange | null {
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1) return null;
  if (startDate === undefined) return null;

  const start = parseCalendarDate(startDate);
  if (!start) return null;

  const rangeDays = Array.from({ length: days }, (_, index) => shiftCalendarDate(start, index));
  return {
    dayCount: days,
    days: rangeDays,
    endDayKey: start.dayKey + days,
    startDayKey: start.dayKey,
  };
}

function numberFromAttribute(value: string | null): number | undefined {
  return value === null ? undefined : Number(value);
}

function parseCalendarDate(value: string): CalendarDate | null {
  const match = DATE_RE.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!isValidCalendarDate(year, month, day)) return null;

  const displayDate = new Date(year, month - 1, day);
  return {
    dayKey: dateKey(year, month, day),
    iso: value,
    labelDay: String(day),
    labelWeekday: displayDate.toLocaleDateString(undefined, { weekday: "short" }),
  };
}

function parseCalendarDateTime(value: string): {
  dayKey: number;
  hour: number;
  totalMinutes: number;
} | null {
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
    totalMinutes: hour * MINUTES_PER_HOUR + minute,
  };
}

function shiftCalendarDate(day: CalendarDate, offset: number): CalendarDate {
  const next = new Date((day.dayKey + offset) * DAY_MS);
  const year = next.getUTCFullYear();
  const month = next.getUTCMonth() + 1;
  const date = next.getUTCDate();
  return parseCalendarDate(
    `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`,
  )!;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day;
}

function dateKey(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function assignOverlapMetadata(entries: PlacementEntry[]): number {
  const lanePlacements: AllDayPlacement[][] = [];

  for (const { placement } of entries.filter(isAllDayEntry)) {
    const placementEnd = placement.dayStart + placement.daySpan;
    let laneIndex = lanePlacements.findIndex((lane) =>
      lane.every((existing) => !overlaps(existing.dayStart, existing.dayStart + existing.daySpan, placement.dayStart, placementEnd))
    );

    if (laneIndex === -1) {
      lanePlacements.push([]);
      laneIndex = lanePlacements.length - 1;
    }

    placement.laneIndex = laneIndex + 1;
    lanePlacements[laneIndex]!.push(placement);
  }

  const timedPlacementsByDay = new Map<number, TimedPlacement[]>();
  for (const { placement } of entries.filter(isTimedEntry).sort(compareTimedEntries)) {
    const priorPlacements = timedPlacementsByDay.get(placement.dayIndex) ?? [];
    placement.cascadeDepth = priorPlacements.filter((existing) =>
      existing.startMinutes < placement.startMinutes
      && overlaps(existing.startMinutes, existing.endMinutes, placement.startMinutes, placement.endMinutes)
    ).length;
    priorPlacements.push(placement);
    timedPlacementsByDay.set(placement.dayIndex, priorPlacements);
  }

  return lanePlacements.length;
}

function compareTimedEntries(
  left: { placement: TimedPlacement },
  right: { placement: TimedPlacement },
): number {
  return left.placement.dayIndex - right.placement.dayIndex
    || left.placement.startMinutes - right.placement.startMinutes
    || left.placement.endMinutes - right.placement.endMinutes;
}

function isAllDayEntry(entry: PlacementEntry): entry is { event: HTMLElement; placement: AllDayPlacement } {
  return entry.placement?.kind === "all-day";
}

function isTimedEntry(entry: PlacementEntry): entry is { event: HTMLElement; placement: TimedPlacement } {
  return entry.placement?.kind === "timed";
}

function overlaps(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

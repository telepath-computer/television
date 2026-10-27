// Pure validation, display-window, and request-state rules shared by the
// copied Weather page and its provider response normalizer.

const CONDITIONS = new Set([
  "clear",
  "partly-cloudy",
  "cloudy",
  "rain",
  "snow",
  "thunderstorm",
  "fog",
]);

const DATE_TIME = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const formattersByTimeZone = new Map();

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isUnits(value) {
  return value === "celsius" || value === "fahrenheit";
}

function isDate(value) {
  const match = typeof value === "string" ? DATE_ONLY.exec(value) : null;
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= daysInMonth;
}

function isDateTime(value) {
  if (typeof value !== "string" || !DATE_TIME.test(value)) return false;
  if (!isDate(value.slice(0, 10))) return false;
  return Number.isFinite(Date.parse(value));
}

export function isTimeZone(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function isConfiguration(value) {
  return isRecord(value)
    && typeof value.place === "string"
    && value.place.length > 0
    && isFiniteNumber(value.latitude)
    && value.latitude >= -90
    && value.latitude <= 90
    && isFiniteNumber(value.longitude)
    && value.longitude >= -180
    && value.longitude <= 180
    && isUnits(value.units);
}

function isCurrent(value) {
  return isRecord(value)
    && isFiniteNumber(value.temperature)
    && CONDITIONS.has(value.condition)
    && typeof value.summary === "string"
    && value.summary.length > 0
    && typeof value.isDay === "boolean";
}

export function isWeatherHour(value) {
  return isRecord(value)
    && isDateTime(value.time)
    && isFiniteNumber(value.temperature)
    && CONDITIONS.has(value.condition)
    && typeof value.isDay === "boolean";
}

export function isWeatherDay(value) {
  return isRecord(value)
    && isDate(value.date)
    && CONDITIONS.has(value.condition)
    && isFiniteNumber(value.high)
    && isFiniteNumber(value.low)
    && value.high >= value.low;
}

export function isWeatherForecast(value) {
  return isRecord(value)
    && isFiniteNumber(value.latitude)
    && value.latitude >= -90
    && value.latitude <= 90
    && isFiniteNumber(value.longitude)
    && value.longitude >= -180
    && value.longitude <= 180
    && isUnits(value.units)
    && isTimeZone(value.timeZone)
    && isDateTime(value.updatedAt)
    && isCurrent(value.current)
    && Array.isArray(value.hourly)
    && value.hourly.length <= 24
    && value.hourly.every(isWeatherHour)
    && Array.isArray(value.daily)
    && value.daily.every(isWeatherDay);
}

function identityOf(value) {
  return value && {
    latitude: value.latitude,
    longitude: value.longitude,
    units: value.units,
  };
}

function sameIdentity(left, right) {
  return left != null
    && right != null
    && left.latitude === right.latitude
    && left.longitude === right.longitude
    && left.units === right.units;
}

function compatible(forecast, configuration) {
  return isWeatherForecast(forecast) && sameIdentity(forecast, configuration);
}

export function readWeatherValue(value) {
  if (value === undefined || (isRecord(value) && Object.keys(value).length === 0)) {
    return { kind: "empty" };
  }
  if (!isConfiguration(value)) return { kind: "unreadable" };
  return {
    kind: "configured",
    configuration: value,
    forecast: compatible(value.forecast, value) ? value.forecast : null,
  };
}

function formatterForTimeZone(timeZone) {
  let formatter = formattersByTimeZone.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formattersByTimeZone.set(timeZone, formatter);
  }
  return formatter;
}

function partsAt(value, timeZone) {
  const parts = formatterForTimeZone(timeZone).formatToParts(new Date(value));
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function instantOf(value) {
  return typeof value === "number" ? value : new Date(value).getTime();
}

function localDate(value, timeZone) {
  const parts = partsAt(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localHourIdentity(value, timeZone) {
  const instant = instantOf(value);
  const parts = partsAt(instant, timeZone);
  const representedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  // The UTC offset is part of the identity so the repeated local hour during a
  // daylight-saving fallback remains two distinct forecast hours.
  const offset = representedAsUtc - Math.floor(instant / 1000) * 1000;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${offset}`;
}

function stableUnique(entries, key) {
  const seen = new Set();
  return entries
    .map((entry, index) => ({ entry, index, value: key(entry) }))
    .sort((left, right) => left.value - right.value || left.index - right.index)
    .filter(({ value }) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .map(({ entry }) => entry);
}

function compareDates(left, right) {
  if (left.date < right.date) return -1;
  if (left.date > right.date) return 1;
  return 0;
}

export function getHourlyWindow(forecast, now, limit = 23) {
  const nowInstant = instantOf(now);
  const currentHour = localHourIdentity(nowInstant, forecast.timeZone);
  return stableUnique(forecast.hourly, (entry) => Date.parse(entry.time))
    .filter((entry) => Date.parse(entry.time) > nowInstant && localHourIdentity(entry.time, forecast.timeZone) !== currentHour)
    .slice(0, limit);
}

export function getDailyWindow(forecast, now) {
  const currentDate = localDate(now, forecast.timeZone);
  const seen = new Set();
  return [...forecast.daily]
    .sort(compareDates)
    .filter((entry) => {
      if (entry.date < currentDate || seen.has(entry.date)) return false;
      seen.add(entry.date);
      return true;
    })
    .slice(0, 7);
}

export function getCurrentHighLow(forecast, now) {
  const date = localDate(now, forecast.timeZone);
  const entry = getDailyWindow(forecast, now).find((candidate) => candidate.date === date);
  return entry ? { high: entry.high, low: entry.low } : null;
}

export function roundTemperature(value) {
  const rounded = Math.floor(Math.abs(value) + 0.5) * Math.sign(value);
  return rounded === 0 ? 0 : rounded;
}

export function forecastAge(updatedAt, now) {
  const milliseconds = instantOf(now) - Date.parse(updatedAt);
  if (milliseconds < 60_000) return { unit: "now", value: 0 };
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) return { unit: "minute", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hour", value: hours };
  return { unit: "day", value: Math.floor(hours / 24) };
}

function emptyRequestState(identity = null, memoryForecast = null) {
  return {
    identity,
    runningAttemptId: null,
    runningStartedAt: null,
    failedStartedAt: null,
    memoryForecast,
  };
}

export function reconcileRequestContext(state, configuration) {
  const identity = configuration ? identityOf(configuration) : null;
  if (sameIdentity(state.identity, identity)) return { state, abortRunning: false };
  return {
    state: emptyRequestState(identity, identity ? state.memoryForecast : null),
    abortRunning: state.runningAttemptId !== null,
  };
}

export function settleRequestAttempt(state, attemptId, normalizedForecast) {
  if (state.runningAttemptId !== attemptId) return null;
  const failed = normalizedForecast === null;
  return {
    ...state,
    runningAttemptId: null,
    runningStartedAt: null,
    failedStartedAt: failed ? state.runningStartedAt : null,
    memoryForecast: failed ? state.memoryForecast : normalizedForecast,
  };
}

export function selectForecast(savedForecast, memoryForecast, now) {
  if (!savedForecast) return memoryForecast || null;
  if (!memoryForecast) return savedForecast;
  const instant = instantOf(now);
  const savedTime = Date.parse(savedForecast.updatedAt);
  const memoryTime = Date.parse(memoryForecast.updatedAt);
  const savedFuture = savedTime > instant;
  const memoryFuture = memoryTime > instant;
  if (savedFuture !== memoryFuture) return savedFuture ? memoryForecast : savedForecast;
  return memoryTime > savedTime ? memoryForecast : savedForecast;
}

export function shouldRequestForecast({ configuration, state, savedForecast, now }) {
  if (!configuration || !sameIdentity(state.identity, configuration)) return false;
  const instant = instantOf(now);
  if (state.runningAttemptId !== null) return false;
  if (state.failedStartedAt !== null) {
    const failureAge = instant - Date.parse(state.failedStartedAt);
    if (failureAge >= 0 && failureAge < FIFTEEN_MINUTES) return false;
  }
  const selected = selectForecast(
    compatible(savedForecast, configuration) ? savedForecast : null,
    compatible(state.memoryForecast, configuration) ? state.memoryForecast : null,
    now,
  );
  if (!selected) return true;
  const age = instant - Date.parse(selected.updatedAt);
  return age < 0 || age >= FIFTEEN_MINUTES;
}

export function updateForecastRoot(currentRoot, requestIdentity, normalizedForecast) {
  if (!isConfiguration(currentRoot) || !sameIdentity(currentRoot, requestIdentity)) return undefined;
  return { ...currentRoot, forecast: normalizedForecast };
}

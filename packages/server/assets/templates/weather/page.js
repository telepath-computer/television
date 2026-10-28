import {
  getStore,
  onAccessChanged,
  onConnectionStatusChanged,
  onValue,
  ref,
  runTransaction,
} from "/sdk/v1/resources.js";
import {
  forecastAge,
  getCurrentHighLow,
  getDailyWindow,
  getHourlyWindow,
  isCompatibleForecast,
  localDate,
  readWeatherValue,
  reconcileRequestContext,
  roundTemperature,
  selectForecast,
  settleRequestAttempt,
  shouldRequestForecast,
  startRequestAttempt,
  updateForecastRoot,
} from "./model.js";
import { buildOpenMeteoRequest, normalizeOpenMeteoResponse } from "./provider.js";

const CHECK_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const CONDITION_NAMES = {
  clear: "Clear",
  "partly-cloudy": "Partly cloudy",
  cloudy: "Cloudy",
  rain: "Rain",
  snow: "Snow",
  thunderstorm: "Thunderstorm",
  fog: "Fog",
};

const main = document.querySelector(".weather-page");
const warningTemplate = document.querySelector("#weather-warning");
const spinnerTemplate = document.querySelector("#weather-spinner");
const artworkTemplate = document.querySelector("#weather-artwork");
const storeRoot = ref(getStore());

let access;
let connection = "connecting";
let listening = false;
let receivedStoreResult = false;
let storeUnavailable = false;
let storeResult = null;
let activeAttempt = null;
let nextAttemptId = 1;
let requestState = {
  identity: null,
  runningAttemptId: null,
  runningStartedAt: null,
  failedStartedAt: null,
  memoryForecast: null,
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function atmosphere() {
  const node = element("div", "weather-atmosphere");
  node.setAttribute("aria-hidden", "true");
  node.append(element("span", "weather-haze weather-haze-one"), element("span", "weather-haze weather-haze-two"));
  return node;
}

function artworkId(condition, isDay) {
  if (condition === "clear" || condition === "partly-cloudy") {
    return `${condition}-${isDay ? "day" : "night"}`;
  }
  return condition;
}

function glyph(condition, isDay, size = "hero") {
  const artwork = artworkTemplate.content.firstElementChild.cloneNode(true);
  const selectedId = artworkId(condition, isDay);
  for (const drawing of [...artwork.children].filter((child) => child.classList.contains("weather-condition"))) {
    if (drawing.id === selectedId) {
      drawing.classList.remove("weather-condition");
      drawing.removeAttribute("id");
    } else {
      drawing.remove();
    }
  }
  for (const use of artwork.querySelectorAll("use")) {
    const target = artwork.querySelector(use.getAttribute("href"));
    const clone = target.cloneNode(true);
    clone.removeAttribute("id");
    use.replaceWith(clone);
  }
  artwork.querySelector("defs").remove();
  artwork.classList.add("weather-glyph", `weather-glyph-${size}`, `weather-glyph-${condition}`);
  artwork.dataset.artwork = selectedId;
  return artwork;
}

function warningIcon() {
  const icon = element("span", "weather-placeholder-icon");
  const svg = warningTemplate.content.firstElementChild.cloneNode(true);
  icon.append(svg);
  return icon;
}

function spinnerIcon() {
  const icon = element("span", "weather-placeholder-icon weather-loading-icon");
  const svg = spinnerTemplate.content.firstElementChild.cloneNode(true);
  icon.append(svg);
  return icon;
}

function placeholderCard(kind) {
  const card = element("article", `weather-card weather-card-${kind}`);
  card.dataset.condition = "clear";
  card.dataset.day = "true";
  card.append(atmosphere());
  const content = element("div", "weather-placeholder-content");

  if (kind === "loading") {
    content.setAttribute("role", "status");
    content.setAttribute("aria-label", "Loading weather");
    content.append(spinnerIcon(), element("h1", "", "Loading weather"));
  } else if (kind === "empty") {
    content.classList.add("weather-empty");
    content.append(
      glyph("partly-cloudy", true, "empty"),
      element("h1", "", "No location yet"),
      element("p", "", "Ask your agent to choose a place for this weather card."),
    );
  } else {
    content.classList.add("weather-error");
    const unavailable = kind === "unavailable";
    content.setAttribute("role", unavailable ? "status" : "alert");
    if (unavailable) content.setAttribute("aria-label", "Forecast unavailable");
    content.append(
      warningIcon(),
      element("h1", "", unavailable ? "Forecast unavailable" : "This forecast can't be shown"),
      element("p", "", unavailable
        ? "Weather couldn't be updated. It will try again in about 15 minutes."
        : "Its saved data isn't in the form this page reads. Ask your agent to check it."),
    );
  }
  card.append(content);
  return card;
}

function degree(value) {
  return `${String(roundTemperature(value)).replace("-", "−")}°`;
}

function ageLabel(updatedAt, now) {
  const age = forecastAge(updatedAt, now);
  if (age.unit === "now") return "now";
  if (age.unit === "minute") return `${age.value} min ago`;
  if (age.unit === "hour") return `${age.value} hr${age.value === 1 ? "" : "s"} ago`;
  return `${age.value} day${age.value === 1 ? "" : "s"} ago`;
}

function hourLabel(instant, timeZone) {
  const date = new Date(instant);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(date);
  const minute = parts.find((part) => part.type === "minute")?.value;
  const options = minute === "00" ? { timeZone, hour: "numeric" } : { timeZone, hour: "numeric", minute: "2-digit" };
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

function dayLabel(date, currentDate) {
  if (date === currentDate) return "Today";
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function currentSection(forecast, now) {
  const section = element("section", "weather-current");
  section.setAttribute("aria-label", "Current weather");
  const temperature = element("div", "weather-temperature");
  const rounded = roundTemperature(forecast.current.temperature);
  temperature.setAttribute("aria-label", `${rounded} degrees ${forecast.units === "celsius" ? "Celsius" : "Fahrenheit"}`);
  temperature.append(document.createTextNode(String(rounded).replace("-", "−")));
  const mark = element("span", "", "°");
  mark.setAttribute("aria-hidden", "true");
  temperature.append(mark);
  const currentGlyph = element("div", "weather-current-glyph");
  currentGlyph.append(glyph(forecast.current.condition, forecast.current.isDay));
  const detail = element("div", "weather-current-detail");
  detail.append(element("p", "weather-summary", forecast.current.summary));
  const highLow = getCurrentHighLow(forecast, now);
  if (highLow) {
    const line = element("p", "weather-high-low");
    line.append(element("span", "", `H:${degree(highLow.high)}`), element("span", "", `L:${degree(highLow.low)}`));
    detail.append(line);
  }
  section.append(temperature, currentGlyph, detail);
  return section;
}

function conditionGlyph(condition, isDay, size) {
  const holder = element("span", size === "hour" ? "weather-hour-condition" : "weather-day-condition");
  holder.setAttribute("role", "img");
  holder.setAttribute("aria-label", CONDITION_NAMES[condition]);
  holder.append(glyph(condition, isDay, size));
  return holder;
}

function hourlyPanel(forecast, hours) {
  const section = element("section", "weather-panel weather-hourly");
  section.setAttribute("aria-label", "Hourly forecast");
  section.append(element("h2", "", "Hourly forecast"));
  const strip = element("div", "weather-hourly-strip");
  strip.tabIndex = 0;
  strip.dataset.focusKey = "hourly-strip";
  strip.setAttribute("aria-label", "Hourly forecast; scroll for later hours");
  strip.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // Modified arrows belong to browser and assistive-technology shortcuts.
    // Plain arrows move by one complete forecast cell because the native
    // scroll distance varies by browser and can leave a cell barely exposed.
    if (event.altKey || event.metaKey) return;
    event.preventDefault();
    const firstCell = strip.firstElementChild;
    const step = firstCell?.getBoundingClientRect().width ?? 0;
    strip.scrollBy({ left: event.key === "ArrowRight" ? step : -step });
  });
  const entries = [{
    label: "Now",
    temperature: forecast.current.temperature,
    condition: forecast.current.condition,
    isDay: forecast.current.isDay,
  }, ...hours.map((hour) => ({ ...hour, label: hourLabel(hour.time, forecast.timeZone) }))];
  for (const entry of entries) {
    const row = element("div", "weather-hour");
    row.append(
      element("span", "weather-hour-label", entry.label),
      conditionGlyph(entry.condition, entry.isDay, "hour"),
      element("strong", "", degree(entry.temperature)),
    );
    strip.append(row);
  }
  section.append(strip);
  return section;
}

function dailyPanel(forecast, days, now) {
  const section = element("section", "weather-panel weather-daily");
  section.setAttribute("aria-label", `${days.length}-day forecast`);
  section.append(element("h2", "", `${days.length}-day forecast`));
  const rows = element("div", "weather-days");
  rows.style.setProperty("--day-count", String(days.length));
  const floor = Math.min(...days.map((day) => day.low));
  const ceiling = Math.max(...days.map((day) => day.high));
  const span = Math.max(1, ceiling - floor);
  const currentDate = localDate(now, forecast.timeZone);
  for (const day of days) {
    const row = element("div", "weather-day");
    const range = element("span", "weather-range");
    range.setAttribute("aria-hidden", "true");
    range.style.setProperty("--range-start", `${((day.low - floor) / span) * 100}%`);
    range.style.setProperty("--range-end", `${((day.high - floor) / span) * 100}%`);
    range.append(element("i"));
    row.append(
      element("span", "weather-day-label", dayLabel(day.date, currentDate)),
      conditionGlyph(day.condition, true, "day"),
      element("span", "weather-day-low", degree(day.low)),
      range,
      element("span", "weather-day-high", degree(day.high)),
    );
    rows.append(row);
  }
  section.append(rows);
  return section;
}

function credit() {
  const line = element("p", "weather-credit");
  const provider = element("a", "", "Open-Meteo");
  provider.href = "https://open-meteo.com/";
  provider.target = "_blank";
  provider.rel = "noreferrer";
  provider.dataset.focusKey = "provider-credit";
  const licence = element("a", "", "CC BY 4.0");
  licence.href = "https://creativecommons.org/licenses/by/4.0/";
  licence.target = "_blank";
  licence.rel = "noreferrer";
  licence.dataset.focusKey = "licence-credit";
  line.append(provider, document.createTextNode(" data · adapted · "), licence);
  return line;
}

function readyCard(configuration, forecast, now) {
  const card = element("article", "weather-card");
  card.dataset.condition = forecast.current.condition;
  card.dataset.day = String(forecast.current.isDay);
  const hours = getHourlyWindow(forecast, now);
  const days = getDailyWindow(forecast, now);
  card.dataset.hasDaily = String(days.length > 0);
  card.append(atmosphere());
  const content = element("div", "weather-content");
  const header = element("header", "weather-header");
  const heading = element("div");
  const meta = element("p", "weather-meta");
  meta.append(element("span", "weather-updated", `Updated ${ageLabel(forecast.updatedAt, now)}`));
  const separator = element("span", "", " · ");
  separator.setAttribute("aria-hidden", "true");
  const unit = element("span", "", forecast.units === "celsius" ? "°C" : "°F");
  unit.setAttribute("aria-label", `degrees ${forecast.units === "celsius" ? "Celsius" : "Fahrenheit"}`);
  meta.append(separator, unit);
  heading.append(element("h1", "", configuration.place), meta);
  header.append(heading);
  content.append(header, currentSection(forecast, now));
  if (hours.length > 0) content.append(hourlyPanel(forecast, hours));
  if (days.length > 0) content.append(dailyPanel(forecast, days, now));
  card.append(content, credit());
  return card;
}

function selectedForecast(now) {
  if (!storeResult || storeResult.kind !== "configured") return null;
  const configuration = storeResult.configuration;
  const saved = isCompatibleForecast(storeResult.forecast, configuration) ? storeResult.forecast : null;
  const memory = isCompatibleForecast(requestState.memoryForecast, configuration) ? requestState.memoryForecast : null;
  return selectForecast(saved, memory, now);
}

function render() {
  const now = new Date().toISOString();
  let card;
  if (!receivedStoreResult) {
    card = placeholderCard("loading");
  } else if (storeUnavailable || storeResult?.kind === "unreadable") {
    card = placeholderCard("unreadable");
  } else if (storeResult?.kind === "empty") {
    card = placeholderCard("empty");
  } else if (storeResult?.kind === "configured") {
    const forecast = selectedForecast(now);
    if (forecast) card = readyCard(storeResult.configuration, forecast, now);
    else card = placeholderCard(requestState.failedStartedAt ? "unavailable" : "loading");
  } else {
    card = placeholderCard("loading");
  }
  const previous = main.firstElementChild;
  const previousUpdated = previous?.querySelector(".weather-updated");
  const nextUpdated = card.querySelector(".weather-updated");
  // Patch an age-only tick before comparing the trees so it does not rebuild the card.
  if (previousUpdated && nextUpdated) previousUpdated.textContent = nextUpdated.textContent;
  if (previous?.outerHTML === card.outerHTML) return;
  const previousStrip = previous?.querySelector(".weather-hourly-strip");
  const stripScrollLeft = previousStrip?.scrollLeft ?? null;
  const focusedKey = previous?.contains(document.activeElement)
    ? document.activeElement?.dataset?.focusKey ?? null
    : null;
  main.replaceChildren(card);
  const nextStrip = card.querySelector(".weather-hourly-strip");
  if (nextStrip && stripScrollLeft !== null) nextStrip.scrollLeft = stripScrollLeft;
  if (focusedKey) card.querySelector(`[data-focus-key="${focusedKey}"]`)?.focus({ preventScroll: true });
}

function abortTrackedAttempt() {
  if (activeAttempt) activeAttempt.controller.abort();
}

function applyStoreValue(value) {
  receivedStoreResult = true;
  storeUnavailable = false;
  storeResult = readWeatherValue(value);
  const configuration = storeResult.kind === "configured" ? storeResult.configuration : null;
  const reconciled = reconcileRequestContext(requestState, configuration);
  requestState = reconciled.state;
  if (reconciled.abortRunning) abortTrackedAttempt();
  render();
  checkRequest();
}

function applyStoreUnavailable() {
  receivedStoreResult = true;
  storeUnavailable = true;
  storeResult = null;
  const reconciled = reconcileRequestContext(requestState, null);
  requestState = reconciled.state;
  if (reconciled.abortRunning) abortTrackedAttempt();
  render();
}

function subscribe() {
  if (listening) return;
  listening = true;
  // The SDK resubscribes an active listener after an ordinary reconnect. A
  // listener error removes it, so a later connected/access callback listens
  // again. Revocation reports `no-store`: keep the last store result and let
  // its retained location continue refreshing. Other store errors replace it
  // with the unavailable state until a later subscription recovers.
  onValue(storeRoot, (snapshot) => applyStoreValue(snapshot.val()), (error) => {
    listening = false;
    if (error.code !== "no-store") applyStoreUnavailable();
  });
}

async function saveForecast(identity, forecast) {
  if (access !== "read-write") return;
  try {
    await runTransaction(storeRoot, (current) => updateForecastRoot(current, identity, forecast));
  } catch {
    // Memory remains authoritative when access or the connection changed.
  }
}

async function requestForecast(configuration) {
  const attemptId = nextAttemptId;
  nextAttemptId += 1;
  const startedAt = new Date().toISOString();
  requestState = startRequestAttempt(requestState, attemptId, startedAt);
  const controller = new AbortController();
  activeAttempt = { id: attemptId, controller };
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const identity = {
    latitude: configuration.latitude,
    longitude: configuration.longitude,
    units: configuration.units,
  };
  render();

  let normalized = null;
  try {
    const response = await fetch(buildOpenMeteoRequest(identity), { signal: controller.signal });
    if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
    const body = await response.json();
    const receivedAt = new Date().toISOString();
    normalized = normalizeOpenMeteoResponse(body, identity, receivedAt);
    if (!normalized) throw new Error("Open-Meteo response was not display-safe");
  } catch {
    normalized = null;
  } finally {
    clearTimeout(timeout);
  }

  const settled = settleRequestAttempt(requestState, attemptId, normalized);
  if (activeAttempt?.id === attemptId) activeAttempt = null;
  if (!settled) return;
  requestState = settled;
  render();
  if (normalized) await saveForecast(identity, normalized);
}

function checkRequest() {
  if (document.visibilityState !== "visible" || storeUnavailable || storeResult?.kind !== "configured") return;
  const now = new Date().toISOString();
  const configuration = storeResult.configuration;
  if (!shouldRequestForecast({
    configuration,
    state: requestState,
    savedForecast: storeResult.forecast,
    now,
  })) return;
  void requestForecast(configuration);
}

onAccessChanged((next) => {
  access = next;
  if (next !== null && connection === "connected" && !listening) subscribe();
});

onConnectionStatusChanged((next) => {
  connection = next;
  if (next === "connected" && access !== null && !listening) subscribe();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    render();
    checkRequest();
  }
});

setInterval(() => {
  render();
  checkRequest();
}, CHECK_INTERVAL_MS);

render();
subscribe();

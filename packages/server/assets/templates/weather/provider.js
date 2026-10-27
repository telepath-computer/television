// Open-Meteo request construction and normalization into the Weather cache.
// Network and store effects remain in the copied page.

import {
  getHourlyWindow,
  isFiniteNumber,
  isRecord,
  isTimeZone,
  isWeatherDay,
  isWeatherForecast,
  isWeatherHour,
} from "./model.js";

const MAPPING = new Map([
  [0, ["clear", "Clear"]],
  [1, ["partly-cloudy", "Mainly clear"]],
  [2, ["partly-cloudy", "Partly cloudy"]],
  [3, ["cloudy", "Overcast"]],
  [45, ["fog", "Fog"]],
  [48, ["fog", "Rime fog"]],
  [51, ["rain", "Light drizzle"]],
  [53, ["rain", "Drizzle"]],
  [55, ["rain", "Dense drizzle"]],
  [56, ["rain", "Light freezing drizzle"]],
  [57, ["rain", "Dense freezing drizzle"]],
  [61, ["rain", "Light rain"]],
  [63, ["rain", "Rain"]],
  [65, ["rain", "Heavy rain"]],
  [66, ["rain", "Light freezing rain"]],
  [67, ["rain", "Heavy freezing rain"]],
  [71, ["snow", "Light snow"]],
  [73, ["snow", "Snow"]],
  [75, ["snow", "Heavy snow"]],
  [77, ["snow", "Snow grains"]],
  [80, ["rain", "Light rain showers"]],
  [81, ["rain", "Rain showers"]],
  [82, ["rain", "Heavy rain showers"]],
  [85, ["snow", "Light snow showers"]],
  [86, ["snow", "Heavy snow showers"]],
  [95, ["thunderstorm", "Thunderstorm"]],
  [96, ["thunderstorm", "Thunderstorm with slight hail"]],
  [97, ["thunderstorm", "Heavy thunderstorm"]],
  [99, ["thunderstorm", "Thunderstorm with heavy hail"]],
]);

function array(value) {
  return Array.isArray(value) ? value : null;
}

function unitSymbol(units) {
  return units === "celsius" ? "°C" : "°F";
}

function unitsMatch(body, units) {
  const symbol = unitSymbol(units);
  return body.current_units?.temperature_2m === symbol
    && body.hourly_units?.temperature_2m === symbol
    && body.daily_units?.temperature_2m_max === symbol
    && body.daily_units?.temperature_2m_min === symbol;
}

function isDayFlag(value) {
  return value === 0 || value === 1;
}

export function mapWeatherCode(code) {
  const value = MAPPING.get(code);
  return value ? { condition: value[0], summary: value[1] } : null;
}

export function buildOpenMeteoRequest(configuration) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(configuration.latitude),
    longitude: String(configuration.longitude),
    current: "temperature_2m,weather_code,is_day",
    hourly: "temperature_2m,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    temperature_unit: configuration.units,
    timeformat: "unixtime",
    timezone: "auto",
    forecast_days: "7",
  }).toString();
  return new Request(url, { method: "GET" });
}

function hourlyEntries(hourly) {
  const time = array(hourly.time);
  const temperature = array(hourly.temperature_2m);
  const code = array(hourly.weather_code);
  const day = array(hourly.is_day);
  if (!time || !temperature || !code || !day) return null;
  const entries = [];
  for (let index = 0; index < time.length; index += 1) {
    const instant = time[index];
    const mapping = mapWeatherCode(code[index]);
    if (!isFiniteNumber(instant)
      || !isFiniteNumber(temperature[index])
      || !mapping
      || !isDayFlag(day[index])) continue;
    const date = new Date(instant * 1000);
    if (!Number.isFinite(date.getTime())) continue;
    const entry = {
      time: date.toISOString(),
      temperature: temperature[index],
      condition: mapping.condition,
      isDay: day[index] === 1,
    };
    if (isWeatherHour(entry)) entries.push(entry);
  }
  return entries;
}

function dailyEntries(daily, offsetSeconds) {
  const time = array(daily.time);
  const high = array(daily.temperature_2m_max);
  const low = array(daily.temperature_2m_min);
  const code = array(daily.weather_code);
  if (!time || !high || !low || !code) return null;
  const entries = [];
  for (let index = 0; index < time.length; index += 1) {
    const instant = time[index];
    const mapping = mapWeatherCode(code[index]);
    if (!isFiniteNumber(instant)
      || !isFiniteNumber(high[index])
      || !isFiniteNumber(low[index])
      || !mapping
      || high[index] < low[index]) continue;
    const shifted = new Date((instant + offsetSeconds) * 1000);
    if (!Number.isFinite(shifted.getTime())) continue;
    // Open-Meteo daily UNIX values use one response-wide fixed offset. Shift
    // before taking the date so the cached date matches the provider response.
    const entry = {
      date: shifted.toISOString().slice(0, 10),
      condition: mapping.condition,
      high: high[index],
      low: low[index],
    };
    if (isWeatherDay(entry)) entries.push(entry);
  }
  return entries;
}

export function normalizeOpenMeteoResponse(body, requestIdentity, receivedAt) {
  if (!isRecord(body)
    || !Number.isInteger(body.utc_offset_seconds)
    || !isTimeZone(body.timezone)
    || !isRecord(body.current)
    || !isRecord(body.hourly)
    || !isRecord(body.daily)
    || !unitsMatch(body, requestIdentity.units)) return null;

  const currentMapping = mapWeatherCode(body.current.weather_code);
  if (!isFiniteNumber(body.current.temperature_2m) || !currentMapping || !isDayFlag(body.current.is_day)) return null;
  const hourly = hourlyEntries(body.hourly);
  const daily = dailyEntries(body.daily, body.utc_offset_seconds);
  if (!hourly || !daily) return null;
  const timestamp = new Date(receivedAt);
  if (!Number.isFinite(timestamp.getTime())) return null;

  const candidate = {
    latitude: requestIdentity.latitude,
    longitude: requestIdentity.longitude,
    units: requestIdentity.units,
    timeZone: body.timezone,
    updatedAt: timestamp.toISOString(),
    current: {
      temperature: body.current.temperature_2m,
      condition: currentMapping.condition,
      summary: currentMapping.summary,
      isDay: body.current.is_day === 1,
    },
    hourly,
    daily,
  };
  candidate.hourly = getHourlyWindow(candidate, timestamp.toISOString(), 24);
  return isWeatherForecast(candidate) ? candidate : null;
}

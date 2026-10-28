import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  forecastAge,
  getCurrentHighLow,
  getDailyWindow,
  getHourlyWindow,
  isCompatibleForecast,
  isWeatherForecast,
  localDate,
  readWeatherValue,
  reconcileRequestContext,
  roundTemperature,
  selectForecast,
  startRequestAttempt,
  settleRequestAttempt,
  shouldRequestForecast,
  updateForecastRoot,
} from "../assets/templates/weather/model.js";
import type { WeatherDay, WeatherForecast, WeatherHour } from "../assets/templates/weather/model.js";
import { validateTemplateData } from "../src/template-schema.ts";
import {
  buildOpenMeteoRequest,
  mapWeatherCode,
  normalizeOpenMeteoResponse,
} from "../assets/templates/weather/provider.js";

const fixtureRoot = path.resolve(import.meta.dirname, "../../../test/fixtures/weather/open-meteo");
const weatherFolder = path.resolve(import.meta.dirname, "../assets/templates/weather");
const weatherSchema = JSON.parse(readFileSync(path.join(weatherFolder, "manifest.json"), "utf8")).dataSchema;
const forecastSchema = {
  "$schema": weatherSchema.$schema,
  "$ref": "#/$defs/forecast",
  "$defs": weatherSchema.$defs,
};
const originalTimeZone = process.env.TZ;

beforeAll(() => { process.env.TZ = "UTC"; });
afterAll(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

interface ProviderFixture {
  request: { url: string };
  response: { body: Record<string, unknown> };
}

function fixture(name: string): ProviderFixture {
  return JSON.parse(readFileSync(path.join(fixtureRoot, name), "utf8"));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function localHourKey(value: string | number | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(new Date(value));
  return parts
    .filter(({ type }) => type !== "literal")
    .map(({ type, value: part }) => `${type}:${part}`)
    .join("|");
}

function expectedHourlyEntries(body: any, receivedAt: string): WeatherHour[] {
  const receivedInstant = Date.parse(receivedAt);
  const entries: Array<{ entry: WeatherHour; sourceIndex: number }> = body.hourly.time.flatMap((instant: unknown, sourceIndex: number) => {
    const temperature = body.hourly.temperature_2m[sourceIndex];
    const mapping = mapWeatherCode(body.hourly.weather_code[sourceIndex]);
    const day = body.hourly.is_day[sourceIndex];
    if (!Number.isFinite(instant) || !Number.isFinite(temperature) || !mapping || (day !== 0 && day !== 1)) return [];
    const date = new Date((instant as number) * 1000);
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 0 || date.getUTCFullYear() > 9999) return [];
    const entry = {
      time: date.toISOString(),
      temperature,
      condition: mapping.condition,
      isDay: day === 1,
    };
    return [{ entry, sourceIndex }];
  });
  const currentHour = localHourKey(receivedAt, body.timezone);
  const seen = new Set<number>();
  return entries
    .sort((left, right) => Date.parse(left.entry.time) - Date.parse(right.entry.time) || left.sourceIndex - right.sourceIndex)
    .filter(({ entry }) => {
      const instant = Date.parse(entry.time);
      if (instant <= receivedInstant
        || localHourKey(entry.time, body.timezone) === currentHour
        || seen.has(instant)) return false;
      seen.add(instant);
      return true;
    })
    .slice(0, 24)
    .map(({ entry }) => entry);
}

function expectedDailyEntries(body: any): WeatherDay[] {
  return body.daily.time.flatMap((instant: unknown, sourceIndex: number) => {
    const high = body.daily.temperature_2m_max[sourceIndex];
    const low = body.daily.temperature_2m_min[sourceIndex];
    const mapping = mapWeatherCode(body.daily.weather_code[sourceIndex]);
    if (!Number.isFinite(instant) || !Number.isFinite(high) || !Number.isFinite(low) || high < low || !mapping) return [];
    const shifted = new Date(((instant as number) + body.utc_offset_seconds) * 1000);
    if (!Number.isFinite(shifted.getTime()) || shifted.getUTCFullYear() < 0 || shifted.getUTCFullYear() > 9999) return [];
    const entry = {
      date: shifted.toISOString().slice(0, 10),
      condition: mapping.condition,
      high,
      low,
    };
    return [entry];
  });
}

const configuration = {
  place: "San Francisco",
  latitude: 37.7749,
  longitude: -122.4194,
  units: "celsius" as const,
};

function forecast(overrides: Record<string, unknown> = {}): WeatherForecast {
  return {
    latitude: configuration.latitude,
    longitude: configuration.longitude,
    units: configuration.units,
    timeZone: "America/Los_Angeles",
    updatedAt: "2026-10-27T17:00:00Z",
    current: { temperature: 18.5, condition: "clear", summary: "Clear", isDay: true },
    hourly: [
      { time: "2026-10-27T18:00:00Z", temperature: 19, condition: "clear", isDay: true },
      { time: "2026-10-27T19:00:00Z", temperature: 20, condition: "partly-cloudy", isDay: true },
    ],
    daily: [
      { date: "2026-10-27", condition: "clear", high: 22, low: 12 },
      { date: "2026-10-28", condition: "partly-cloudy", high: 21, low: 11 },
    ],
    ...overrides,
  } as WeatherForecast;
}

describe("Weather store validity", () => {
  // proofs/arch/templates/weather.md#^templates-weather-t-validity
  it("classifies empty, configured and unreadable roots without changing them", () => {
    expect(readWeatherValue(undefined)).toEqual({ kind: "empty" });
    expect(validateTemplateData(weatherSchema, {}, "weather")).toBeUndefined();
    expect(readWeatherValue({})).toEqual({ kind: "empty" });

    for (const units of ["celsius", "fahrenheit"] as const) {
      const value = { ...configuration, units, extra: { retained: true } };
      const original = clone(value);
      expect(validateTemplateData(weatherSchema, value, "weather")).toBeUndefined();
      expect(readWeatherValue(value)).toMatchObject({ kind: "configured", configuration: value, forecast: null });
      expect(value).toEqual(original);
    }

    for (const value of [
      null, [], "weather", 7, false,
      { place: "", latitude: 1, longitude: 1, units: "celsius" },
      { place: "Here", latitude: "37", longitude: 1, units: "celsius" },
      { place: "Here", latitude: 91, longitude: 1, units: "celsius" },
      { place: "Here", latitude: 1, longitude: -181, units: "celsius" },
      { place: "Here", latitude: 1, longitude: 1, units: "kelvin" },
      { place: "Here", latitude: 1, longitude: 1 },
    ]) {
      expect(() => validateTemplateData(weatherSchema, value, "weather")).toThrow();
      expect(readWeatherValue(value)).toEqual({ kind: "unreadable" });
    }
  });

  it("accepts only display-safe forecasts and ignores a bad or incompatible cache", () => {
    const valid = forecast();
    const validOriginal = clone(valid);
    expect(validateTemplateData(forecastSchema, valid, "weather forecast")).toBeUndefined();
    expect(isWeatherForecast(valid)).toBe(true);
    expect(valid).toEqual(validOriginal);
    expect(isWeatherForecast(forecast({ hourly: [], daily: [] }))).toBe(true);
    expect(readWeatherValue({ ...configuration, forecast: valid })).toMatchObject({ kind: "configured", forecast: valid });
    expect(readWeatherValue({ ...configuration, place: "Bay Area", forecast: valid })).toMatchObject({ kind: "configured", forecast: valid });

    const offsetForecast = forecast({
      updatedAt: "2026-10-27T22:30:00+05:30",
      hourly: [
        { time: "2026-10-27T23:30:00+05:30", temperature: 19, condition: "clear", isDay: false },
      ],
    });
    expect(validateTemplateData(forecastSchema, offsetForecast, "weather forecast")).toBeUndefined();
    expect(isWeatherForecast(offsetForecast)).toBe(true);
    expect(isCompatibleForecast(offsetForecast, configuration)).toBe(true);
    expect(isCompatibleForecast(offsetForecast, { ...configuration, units: "fahrenheit" })).toBe(false);
    expect(isCompatibleForecast({ ...offsetForecast, updatedAt: "invalid" }, configuration)).toBe(false);
    expect(readWeatherValue({ ...configuration, forecast: offsetForecast })).toMatchObject({
      kind: "configured",
      forecast: offsetForecast,
    });

    const invalid = [
      { value: null, schemaAccepts: false },
      { value: "forecast", schemaAccepts: false },
      { value: { ...valid, timeZone: "Not/A_Zone" }, schemaAccepts: true },
      { value: { ...valid, updatedAt: "2026-10-27T17:00:00" }, schemaAccepts: false },
      { value: { ...valid, daily: [{ date: "2026-10-00", condition: "clear", high: 4, low: 2 }] }, schemaAccepts: false },
      { value: { ...valid, updatedAt: "2026-10-27T17:00:00.123Z", daily: [{ date: "2026-02-30", condition: "clear", high: 4, low: 2 }] }, schemaAccepts: true },
      { value: { ...valid, current: { ...valid.current, condition: "wind" } }, schemaAccepts: false },
      { value: { ...valid, current: { temperature: 18.5, condition: "clear", isDay: true } }, schemaAccepts: false },
      { value: { ...valid, hourly: [...valid.hourly, ...Array.from({ length: 23 }, (_, index) => ({ ...valid.hourly[0], time: `2026-10-28T${String(index).padStart(2, "0")}:00:00Z` }))] }, schemaAccepts: false },
      { value: { ...valid, daily: [{ date: "2026-10-27", condition: "clear", high: 2, low: 4 }] }, schemaAccepts: true },
    ];
    for (const { value: candidate, schemaAccepts } of invalid) {
      const original = clone(candidate);
      expect(validateTemplateData(weatherSchema, { ...configuration, forecast: candidate }, "weather")).toBeUndefined();
      if (schemaAccepts) expect(validateTemplateData(forecastSchema, candidate, "weather forecast")).toBeUndefined();
      else expect(() => validateTemplateData(forecastSchema, candidate, "weather forecast")).toThrow();
      expect(isWeatherForecast(candidate)).toBe(false);
      expect(readWeatherValue({ ...configuration, forecast: candidate })).toMatchObject({ kind: "configured", forecast: null });
      expect(candidate).toEqual(original);
    }
    expect(readWeatherValue({ ...configuration, forecast: { ...valid, units: "fahrenheit" } })).toMatchObject({ kind: "configured", forecast: null });
    expect(readWeatherValue({ ...configuration, forecast: { ...valid, latitude: 38 } })).toMatchObject({ kind: "configured", forecast: null });
  });
});

describe("Weather display derivation", () => {
  // proofs/arch/templates/weather.md#^templates-weather-t-windows
  it("orders and bounds hours by instant while distinguishing repeated local hours", () => {
    const kolkata = forecast({
      timeZone: "Asia/Kolkata",
      hourly: [
        { time: "2026-10-28T02:30:00.500+05:30", temperature: 5, condition: "clear", isDay: false },
        { time: "2026-10-28T02:00:00+05:30", temperature: 4, condition: "clear", isDay: false },
        { time: "2026-10-27T20:15:00Z", temperature: 3, condition: "clear", isDay: false },
        { time: "2026-10-28T01:00:00.500+05:30", temperature: 2, condition: "clear", isDay: false },
        { time: "2026-10-28T03:00:00.500+06:00", temperature: 99, condition: "snow", isDay: false },
      ],
    });
    expect(getHourlyWindow(kolkata, "2026-10-27T20:00:00Z").map((entry: { time: string }) => entry.time)).toEqual([
      "2026-10-28T02:00:00+05:30",
      "2026-10-28T02:30:00.500+05:30",
    ]);

    const fallback = forecast({
      timeZone: "America/New_York",
      hourly: [
        { time: "2026-11-01T01:00:00-04:00", temperature: 1, condition: "clear", isDay: false },
        { time: "2026-11-01T01:00:00-05:00", temperature: 2, condition: "clear", isDay: false },
        { time: "2026-11-01T02:00:00-05:00", temperature: 3, condition: "clear", isDay: false },
      ],
    });
    expect(getHourlyWindow(fallback, "2026-11-01T05:30:00Z").map((entry: { temperature: number }) => entry.temperature)).toEqual([2, 3]);

    const many = forecast({ hourly: Array.from({ length: 30 }, (_, index) => ({
      time: new Date(Date.UTC(2026, 9, 28, index)).toISOString(), temperature: index, condition: "clear", isDay: true,
    })) });
    const bounded = getHourlyWindow(many, "2026-10-27T20:00:00Z");
    expect(bounded).toHaveLength(23);
    expect([bounded[0]!.time, bounded.at(-1)!.time]).toEqual([many.hourly[0]!.time, many.hourly[22]!.time]);
  });

  // proofs/arch/templates/weather.md#^templates-weather-t-windows
  it("orders and bounds dates in the forecast zone without parsing them as UTC instants", () => {
    const value = forecast({
      timeZone: "Pacific/Kiritimati",
      daily: [
        { date: "2026-10-29", condition: "clear", high: 4, low: 1 },
        { date: "2026-10-27", condition: "rain", high: 3, low: 1 },
        { date: "2026-10-28", condition: "snow", high: 2, low: -1 },
        { date: "2026-10-28", condition: "fog", high: 99, low: 90 },
        ...["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]
          .map((date) => ({ date, condition: "clear", high: 4, low: 1 })),
      ],
    });
    const window = getDailyWindow(value, "2026-10-27T12:30:00Z");
    const dates = window.map((entry: { date: string }) => entry.date);
    expect(dates.slice(0, 3)).toEqual(["2026-10-28", "2026-10-29", "2026-10-30"]);
    expect(window[0]).toMatchObject({ condition: "snow", high: 2, low: -1 });
    expect(dates).toHaveLength(7);

    const west = forecast({ timeZone: "America/Adak", daily: [
      { date: "2026-10-26", condition: "clear", high: 4, low: 1 },
      { date: "2026-10-27", condition: "clear", high: 4, low: 1 },
    ] });
    expect(getDailyWindow(west, "2026-10-28T06:00:00Z").map((entry: { date: string }) => entry.date)).toEqual(["2026-10-27"]);
  });

  // proofs/arch/templates/weather.md#^templates-weather-t-current-values
  it("derives only the current date high and low, elapsed age and half-away-from-zero readings", () => {
    const value = forecast({ daily: [
      { date: "2026-10-27", condition: "clear", high: 22.5, low: -0.5 },
      { date: "2026-10-28", condition: "clear", high: 30, low: 20 },
    ] });
    expect(getCurrentHighLow(value, "2026-10-27T18:00:00Z")).toEqual({ high: 22.5, low: -0.5 });
    expect(getCurrentHighLow({ ...value, daily: value.daily.slice(1) }, "2026-10-27T18:00:00Z")).toBeNull();
    expect([2.5, -2.5, 0.4, -0.4].map(roundTemperature)).toEqual([3, -3, 0, 0]);
    expect(Object.is(roundTemperature(-0.4), -0)).toBe(false);

    const updatedAt = "2026-10-27T17:00:00Z";
    expect(forecastAge(updatedAt, "2026-10-27T16:59:00Z")).toEqual({ unit: "now", value: 0 });
    expect(forecastAge(updatedAt, "2026-10-27T17:00:59Z")).toEqual({ unit: "now", value: 0 });
    expect(forecastAge(updatedAt, "2026-10-27T17:01:00Z")).toEqual({ unit: "minute", value: 1 });
    expect(forecastAge(updatedAt, "2026-10-27T17:01:30Z")).toEqual({ unit: "minute", value: 1 });
    expect(forecastAge(updatedAt, "2026-10-27T17:59:59Z")).toEqual({ unit: "minute", value: 59 });
    expect(forecastAge(updatedAt, "2026-10-27T18:00:00Z")).toEqual({ unit: "hour", value: 1 });
    expect(forecastAge(updatedAt, "2026-10-28T16:59:00Z")).toEqual({ unit: "hour", value: 23 });
    expect(forecastAge(updatedAt, "2026-10-28T17:00:00Z")).toEqual({ unit: "day", value: 1 });
  });
});

describe("Open-Meteo contract", () => {
  // proofs/arch/templates/weather.md#^templates-weather-t-request
  it("builds the exact provider request from coordinates and units only", () => {
    for (const input of [configuration, { ...configuration, place: "Elsewhere", latitude: -33.8688, longitude: 151.2093, units: "fahrenheit" as const, forecast: forecast() }]) {
      const original = clone(input);
      const request = buildOpenMeteoRequest(input);
      expect(request.method).toBe("GET");
      const url = new URL(request.url);
      expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        latitude: String(input.latitude),
        longitude: String(input.longitude),
        current: "temperature_2m,weather_code,is_day",
        hourly: "temperature_2m,weather_code,is_day",
        daily: "weather_code,temperature_2m_max,temperature_2m_min",
        temperature_unit: input.units,
        timeformat: "unixtime",
        timezone: "auto",
        forecast_days: "7",
      });
      for (const key of url.searchParams.keys()) expect(url.searchParams.getAll(key)).toHaveLength(1);
      expect(url.searchParams.has("place")).toBe(false);
      expect(input).toEqual(original);
    }
  });

  // proofs/arch/templates/weather.md#^templates-weather-t-response
  it("maps every documented WMO code and both day flags", () => {
    const expected = new Map<number, [string, string]>([
      [0, ["clear", "Clear"]], [1, ["partly-cloudy", "Mainly clear"]], [2, ["partly-cloudy", "Partly cloudy"]], [3, ["cloudy", "Overcast"]],
      [45, ["fog", "Fog"]], [48, ["fog", "Rime fog"]], [51, ["rain", "Light drizzle"]], [53, ["rain", "Drizzle"]], [55, ["rain", "Dense drizzle"]],
      [56, ["rain", "Light freezing drizzle"]], [57, ["rain", "Dense freezing drizzle"]], [61, ["rain", "Light rain"]], [63, ["rain", "Rain"]],
      [65, ["rain", "Heavy rain"]], [66, ["rain", "Light freezing rain"]], [67, ["rain", "Heavy freezing rain"]], [71, ["snow", "Light snow"]],
      [73, ["snow", "Snow"]], [75, ["snow", "Heavy snow"]], [77, ["snow", "Snow grains"]], [80, ["rain", "Light rain showers"]],
      [81, ["rain", "Rain showers"]], [82, ["rain", "Heavy rain showers"]], [85, ["snow", "Light snow showers"]], [86, ["snow", "Heavy snow showers"]],
      [95, ["thunderstorm", "Thunderstorm"]], [96, ["thunderstorm", "Thunderstorm with slight hail"]], [97, ["thunderstorm", "Heavy thunderstorm"]],
      [99, ["thunderstorm", "Thunderstorm with heavy hail"]],
    ]);
    for (const [code, [condition, summary]] of expected) expect(mapWeatherCode(code)).toEqual({ condition, summary });
    expect(mapWeatherCode(4)).toBeNull();
  });

  it.each([
    ["current-success.json", "celsius", "°C"],
    ["current-success-fahrenheit.json", "fahrenheit", "°F"],
  ] as const)("normalizes the captured %s response", (name, units, symbol) => {
    const captured = fixture(name);
    const body = captured.response.body as any;
    const bodyOriginal = clone(body);
    const identity = { latitude: configuration.latitude, longitude: configuration.longitude, units };
    const identityOriginal = clone(identity);
    const receivedAt = new Date(body.current.time * 1000 + 60_000).toISOString();
    const result = normalizeOpenMeteoResponse(body, identity, receivedAt);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      latitude: configuration.latitude,
      longitude: configuration.longitude,
      units,
      timeZone: body.timezone,
      updatedAt: receivedAt,
      current: {
        temperature: body.current.temperature_2m,
        condition: mapWeatherCode(body.current.weather_code)!.condition,
        summary: mapWeatherCode(body.current.weather_code)!.summary,
        isDay: body.current.is_day === 1,
      },
    });
    expect(body.current_units.temperature_2m).toBe(symbol);
    expect(result!.hourly).toEqual(expectedHourlyEntries(body, receivedAt));
    expect(new Set(result!.hourly.map(({ isDay }) => isDay))).toEqual(new Set([true, false]));
    expect(result!.daily).toEqual(expectedDailyEntries(body));
    expect(isWeatherForecast(result)).toBe(true);
    expect(body).toEqual(bodyOriginal);
    expect(identity).toEqual(identityOriginal);
  });

  it("orders and deduplicates the 24 saved hours at receipt", () => {
    const body = clone(fixture("current-success.json").response.body as any);
    const receivedAt = new Date(body.current.time * 1000 + 60_000).toISOString();
    const duplicateIndex = body.hourly.time.findIndex((instant: number) => instant * 1000 > Date.parse(receivedAt));
    const order = [duplicateIndex, ...Array.from({ length: body.hourly.time.length }, (_, index) => index).reverse()];
    for (const field of ["time", "temperature_2m", "weather_code", "is_day"] as const) {
      body.hourly[field] = order.map((index) => body.hourly[field][index]);
    }
    body.hourly.temperature_2m[0] += 100;
    const sameHourInstant = Date.parse(receivedAt) + 60_000;
    body.hourly.time.push(sameHourInstant / 1000);
    body.hourly.temperature_2m.push(77);
    body.hourly.weather_code.push(0);
    body.hourly.is_day.push(1);
    const original = clone(body);
    const result = normalizeOpenMeteoResponse(body, configuration, receivedAt)!;
    expect(result.hourly).toEqual(expectedHourlyEntries(body, receivedAt));
    expect(result.hourly.map(({ time }) => Date.parse(time))).not.toContain(sameHourInstant);
    expect(result.hourly.find(({ time }) => Date.parse(time) === body.hourly.time[0] * 1000)?.temperature)
      .toBe(body.hourly.temperature_2m[0]);
    expect(result.daily).toEqual(expectedDailyEntries(body));
    expect(body).toEqual(original);
  });

  it("rejects bad metadata and current data while dropping only bad list entries", () => {
    const captured = fixture("current-success.json");
    const body = captured.response.body as any;
    const receivedAt = new Date(body.current.time * 1000 + 60_000).toISOString();
    const identity = { latitude: configuration.latitude, longitude: configuration.longitude, units: "celsius" as const };
    const rejected = [
      { ...body, utc_offset_seconds: undefined },
      { ...body, utc_offset_seconds: 1.5 },
      { ...body, timezone: undefined },
      { ...body, timezone: "Not/A_Zone" },
      { ...body, current: { ...body.current, temperature_2m: null } },
      { ...body, current: { ...body.current, weather_code: 4 } },
      { ...body, current: { ...body.current, is_day: 2 } },
      { ...body, hourly: undefined },
      { ...body, hourly: { ...body.hourly, time: "not an array" } },
      { ...body, daily: undefined },
      { ...body, daily: { ...body.daily, time: "not an array" } },
    ];
    for (const [group, field] of [
      ["current_units", "temperature_2m"],
      ["hourly_units", "temperature_2m"],
      ["daily_units", "temperature_2m_max"],
      ["daily_units", "temperature_2m_min"],
    ] as const) rejected.push({ ...body, [group]: { ...body[group], [field]: "°F" } });
    for (const [group, field] of [
      ["hourly", "temperature_2m"],
      ["hourly", "weather_code"],
      ["hourly", "is_day"],
      ["daily", "temperature_2m_max"],
      ["daily", "temperature_2m_min"],
      ["daily", "weather_code"],
    ] as const) rejected.push({ ...body, [group]: { ...body[group], [field]: "not an array" } });
    for (const value of rejected) expect(normalizeOpenMeteoResponse(value, identity, receivedAt)).toBeNull();

    const capturedError = fixture("error-latitude-out-of-range.json").response.body;
    const capturedErrorOriginal = clone(capturedError);
    expect(normalizeOpenMeteoResponse(capturedError, identity, receivedAt)).toBeNull();
    expect(capturedError).toEqual(capturedErrorOriginal);

    const night = clone(body);
    night.current.is_day = 0;
    expect(normalizeOpenMeteoResponse(night, identity, receivedAt)!.current.isDay).toBe(false);

    const emptyLists = clone(body);
    emptyLists.hourly.temperature_2m.fill(null);
    emptyLists.daily.temperature_2m_max.fill(null);
    expect(normalizeOpenMeteoResponse(emptyLists, identity, receivedAt)).toMatchObject({ hourly: [], daily: [] });

    const baseline = normalizeOpenMeteoResponse(body, identity, receivedAt)!;
    const damagedTimes = baseline.hourly.slice(0, 3).map((entry) => Date.parse(entry.time) / 1000);
    const damagedIndices = damagedTimes.map((time) => body.hourly.time.indexOf(time));
    const edited = clone(body);
    edited.hourly.temperature_2m[damagedIndices[0]] = null;
    edited.hourly.weather_code[damagedIndices[1]] = 4;
    edited.hourly.is_day[damagedIndices[2]] = Number.NaN;
    edited.hourly.temperature_2m.pop();
    edited.hourly.temperature_2m.push(...[99, 100]);
    edited.daily.temperature_2m_max[1] = null;
    edited.daily.weather_code[2] = 4;
    edited.daily.temperature_2m_min[3] = edited.daily.temperature_2m_max[3] + 1;
    edited.daily.temperature_2m_max.push(999);
    edited.daily.temperature_2m_min.push(-999);
    edited.daily.weather_code.push(0);
    const editedOriginal = clone(edited);
    const normalized = normalizeOpenMeteoResponse(edited, identity, receivedAt);
    expect(normalized).not.toBeNull();
    expect(normalized!.hourly).toHaveLength(24);
    for (const time of damagedTimes) expect(normalized!.hourly.map(({ time: value }) => Date.parse(value) / 1000)).not.toContain(time);
    expect(normalized!.hourly).toEqual(expectedHourlyEntries(edited, receivedAt));
    expect(normalized!.daily).toEqual(expectedDailyEntries(edited));
    expect(isWeatherForecast(normalized)).toBe(true);
    expect(edited).toEqual(editedOriginal);

    const missingValue = clone(body);
    missingValue.hourly.temperature_2m.length = damagedIndices[0];
    expect(normalizeOpenMeteoResponse(missingValue, identity, receivedAt)).toMatchObject({ hourly: [] });

    const extendedYears = clone(body);
    for (const field of ["time", "temperature_2m", "weather_code", "is_day"] as const) {
      extendedYears.hourly[field] = extendedYears.hourly[field].slice(0, damagedIndices[0] + 2);
    }
    extendedYears.hourly.time[damagedIndices[0]] = 253402387200;
    extendedYears.daily.time[0] = 253402387200;
    const withoutExtendedYears = normalizeOpenMeteoResponse(extendedYears, identity, receivedAt);
    expect(withoutExtendedYears).not.toBeNull();
    expect(withoutExtendedYears!.hourly).toEqual(expectedHourlyEntries(extendedYears, receivedAt));
    expect(withoutExtendedYears!.daily).toEqual(expectedDailyEntries(extendedYears));
  });

  // proofs/arch/templates/weather.md#^templates-weather-t-provider-time-zones
  it("uses captured fixed offsets for daily dates across New York fallback and Kolkata half hours", () => {
    expect(localDate("2026-11-01T02:30:00Z", "America/New_York")).toBe("2026-10-31");
    expect(localDate("2026-10-27T20:00:00Z", "Asia/Kolkata")).toBe("2026-10-28");
    const newYork = fixture("new-york-dst-2026-10-27.json").response.body as any;
    const newYorkForecast = normalizeOpenMeteoResponse(newYork, { latitude: 40.7128, longitude: -74.006, units: "celsius" }, "2026-11-01T02:30:00Z")!;
    expect(newYorkForecast.daily.map((entry: { date: string }) => entry.date)).toEqual([
      "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02",
    ]);
    expect(newYorkForecast.hourly.map((entry) => entry.time)).toEqual([
      "2026-11-01T03:00:00.000Z", "2026-11-01T04:00:00.000Z", "2026-11-01T05:00:00.000Z",
      "2026-11-01T06:00:00.000Z", "2026-11-01T07:00:00.000Z", "2026-11-01T08:00:00.000Z",
      "2026-11-01T09:00:00.000Z", "2026-11-01T10:00:00.000Z", "2026-11-01T11:00:00.000Z",
      "2026-11-01T12:00:00.000Z", "2026-11-01T13:00:00.000Z", "2026-11-01T14:00:00.000Z",
      "2026-11-01T15:00:00.000Z", "2026-11-01T16:00:00.000Z", "2026-11-01T17:00:00.000Z",
      "2026-11-01T18:00:00.000Z", "2026-11-01T19:00:00.000Z", "2026-11-01T20:00:00.000Z",
      "2026-11-01T21:00:00.000Z", "2026-11-01T22:00:00.000Z", "2026-11-01T23:00:00.000Z",
      "2026-11-02T00:00:00.000Z", "2026-11-02T01:00:00.000Z", "2026-11-02T02:00:00.000Z",
    ]);
    expect(getDailyWindow(newYorkForecast, "2026-11-01T02:30:00Z").map((entry: { date: string }) => entry.date)).toEqual([
      "2026-10-31", "2026-11-01", "2026-11-02",
    ]);

    const kolkata = fixture("kolkata-2026-10-27.json").response.body as any;
    const kolkataForecast = normalizeOpenMeteoResponse(kolkata, { latitude: 22.5726, longitude: 88.3639, units: "celsius" }, "2026-10-27T20:00:00Z")!;
    expect(kolkataForecast.hourly.map((entry) => entry.time)).toEqual([
      "2026-10-27T20:30:00.000Z", "2026-10-27T21:30:00.000Z", "2026-10-27T22:30:00.000Z",
      "2026-10-27T23:30:00.000Z", "2026-10-28T00:30:00.000Z", "2026-10-28T01:30:00.000Z",
      "2026-10-28T02:30:00.000Z", "2026-10-28T03:30:00.000Z", "2026-10-28T04:30:00.000Z",
      "2026-10-28T05:30:00.000Z", "2026-10-28T06:30:00.000Z", "2026-10-28T07:30:00.000Z",
      "2026-10-28T08:30:00.000Z", "2026-10-28T09:30:00.000Z", "2026-10-28T10:30:00.000Z",
      "2026-10-28T11:30:00.000Z", "2026-10-28T12:30:00.000Z", "2026-10-28T13:30:00.000Z",
      "2026-10-28T14:30:00.000Z", "2026-10-28T15:30:00.000Z", "2026-10-28T16:30:00.000Z",
      "2026-10-28T17:30:00.000Z", "2026-10-28T18:30:00.000Z", "2026-10-28T19:30:00.000Z",
    ]);
    expect(kolkataForecast.daily.map((entry) => entry.date)).toEqual([
      "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02",
    ]);
    expect(getDailyWindow(kolkataForecast, "2026-10-27T20:00:00Z").map((entry) => entry.date)).toEqual([
      "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02",
    ]);
  });
});

describe("Weather request state and saving", () => {
  // proofs/arch/templates/weather.md#^templates-weather-t-request-check
  it("requests only without a fresh forecast, running attempt or recent failure", () => {
    const now = "2026-10-27T17:15:01Z";
    const emptyState = { identity: null, runningAttemptId: null, runningStartedAt: null, failedStartedAt: null, memoryForecast: null };
    const context = reconcileRequestContext(emptyState, configuration);
    expect(context.abortRunning).toBe(false);
    expect(shouldRequestForecast({ configuration, state: context.state, savedForecast: null, now })).toBe(true);
    expect(shouldRequestForecast({ configuration, state: { ...context.state, runningAttemptId: 1, runningStartedAt: "2026-10-27T17:14:00Z" }, savedForecast: null, now })).toBe(false);
    expect(shouldRequestForecast({ configuration, state: { ...context.state, failedStartedAt: "2026-10-27T17:00:02Z" }, savedForecast: null, now })).toBe(false);
    expect(shouldRequestForecast({ configuration, state: { ...context.state, failedStartedAt: "2026-10-27T17:00:00Z" }, savedForecast: null, now })).toBe(true);
    expect(shouldRequestForecast({ configuration, state: context.state, savedForecast: forecast({ updatedAt: "2026-10-27T17:00:02Z" }), now })).toBe(false);
    expect(shouldRequestForecast({ configuration: { ...configuration, place: "Bay Area" }, state: context.state, savedForecast: forecast({ updatedAt: "2026-10-27T17:00:02Z" }), now })).toBe(false);
    expect(shouldRequestForecast({ configuration, state: { ...context.state, memoryForecast: forecast({ updatedAt: "2026-10-27T17:00:02Z" }) }, savedForecast: null, now })).toBe(false);
    expect(shouldRequestForecast({ configuration, state: context.state, savedForecast: forecast({ latitude: 1, updatedAt: "2026-10-27T17:00:02Z" }), now })).toBe(true);
    expect(shouldRequestForecast({ configuration, state: context.state, savedForecast: forecast({ updatedAt: "2026-10-27T18:00:00Z" }), now })).toBe(true);
  });

  it("starts an attempt without changing identity or memory and clears the failure throttle", () => {
    const memoryForecast = forecast();
    const state = {
      identity: { latitude: configuration.latitude, longitude: configuration.longitude, units: configuration.units },
      runningAttemptId: null,
      runningStartedAt: null,
      failedStartedAt: "2026-10-27T16:59:00Z",
      memoryForecast,
    };
    expect(startRequestAttempt(state, 7, "2026-10-27T17:15:01Z")).toEqual({
      ...state,
      runningAttemptId: 7,
      runningStartedAt: "2026-10-27T17:15:01Z",
      failedStartedAt: null,
    });
    expect(state.failedStartedAt).toBe("2026-10-27T16:59:00Z");
    expect(state.memoryForecast).toBe(memoryForecast);
  });

  it.each([
    ["a stale saved forecast", forecast({ updatedAt: "2026-10-27T17:00:00Z" }), null, true],
    ["a stale in-memory forecast", null, forecast({ updatedAt: "2026-10-27T17:00:00Z" }), true],
    ["a stale saved and fresh in-memory forecast", forecast({ updatedAt: "2026-10-27T17:00:00Z" }), forecast({ updatedAt: "2026-10-27T17:00:02Z" }), false],
    ["a future saved and stale in-memory forecast", forecast({ updatedAt: "2026-10-27T18:00:00Z" }), forecast({ updatedAt: "2026-10-27T17:00:00Z" }), true],
  ] as const)("checks freshness across %s", (_name, savedForecast, memoryForecast, expected) => {
    const state = reconcileRequestContext(
      { identity: null, runningAttemptId: null, runningStartedAt: null, failedStartedAt: null, memoryForecast },
      configuration,
    ).state;
    expect(shouldRequestForecast({
      configuration,
      state,
      savedForecast,
      now: "2026-10-27T17:15:01Z",
    })).toBe(expected);
  });

  it("clears attempts on identity changes but keeps memory until readable configuration disappears", () => {
    const state = {
      identity: { latitude: configuration.latitude, longitude: configuration.longitude, units: "celsius" as const },
      runningAttemptId: 1,
      runningStartedAt: "2026-10-27T17:00:00Z",
      failedStartedAt: "2026-10-27T16:59:00Z",
      memoryForecast: forecast(),
    };
    expect(reconcileRequestContext(state, { ...configuration, place: "Bay Area" })).toEqual({ state, abortRunning: false });
    const fahrenheit = reconcileRequestContext(state, { ...configuration, units: "fahrenheit" });
    expect(fahrenheit.abortRunning).toBe(true);
    expect(fahrenheit.state).toEqual({
      identity: { latitude: configuration.latitude, longitude: configuration.longitude, units: "fahrenheit" },
      runningAttemptId: null, runningStartedAt: null, failedStartedAt: null, memoryForecast: state.memoryForecast,
    });
    const back = reconcileRequestContext(fahrenheit.state, configuration);
    expect(back.state.memoryForecast).toBe(state.memoryForecast);
    expect(shouldRequestForecast({ configuration, state: back.state, savedForecast: null, now: "2026-10-27T17:01:00Z" })).toBe(false);

    const fahrenheitSuccess = {
      ...fahrenheit.state,
      memoryForecast: forecast({ units: "fahrenheit" }),
    };
    const backAfterSuccess = reconcileRequestContext(fahrenheitSuccess, configuration);
    expect(shouldRequestForecast({ configuration, state: backAfterSuccess.state, savedForecast: null, now: "2026-10-27T17:01:00Z" })).toBe(true);

    const failedCelsius = {
      ...state,
      runningAttemptId: null,
      runningStartedAt: null,
      failedStartedAt: "2026-10-27T17:00:30Z",
      memoryForecast: null,
    };
    const afterFailureSwitch = reconcileRequestContext(failedCelsius, { ...configuration, units: "fahrenheit" });
    const backAfterFailure = reconcileRequestContext(afterFailureSwitch.state, configuration);
    expect(shouldRequestForecast({ configuration, state: backAfterFailure.state, savedForecast: null, now: "2026-10-27T17:01:00Z" })).toBe(true);
    const cleared = reconcileRequestContext(state, null);
    expect(cleared).toEqual({ state: { identity: null, runningAttemptId: null, runningStartedAt: null, failedStartedAt: null, memoryForecast: null }, abortRunning: true });
    expect(shouldRequestForecast({ configuration: null, state: cleared.state, savedForecast: null, now: "2026-10-27T17:01:00Z" })).toBe(false);
    const restored = reconcileRequestContext(cleared.state, configuration);
    expect(shouldRequestForecast({ configuration, state: restored.state, savedForecast: null, now: "2026-10-27T17:01:00Z" })).toBe(true);
  });

  it("settles success or failure only for the tracked attempt after A to B to A", () => {
    const firstAContext = reconcileRequestContext({
      identity: null,
      runningAttemptId: null,
      runningStartedAt: null,
      failedStartedAt: null,
      memoryForecast: null,
    }, configuration).state;
    const firstA = startRequestAttempt(firstAContext, 1, "2026-10-27T17:00:00Z");
    const bContext = reconcileRequestContext(firstA, { ...configuration, units: "fahrenheit" }).state;
    const b = startRequestAttempt(bContext, 2, "2026-10-27T17:00:10Z");
    const secondAContext = reconcileRequestContext(b, configuration).state;
    const secondA = startRequestAttempt(secondAContext, 3, "2026-10-27T17:00:20Z");

    const successfulForecast = forecast({ updatedAt: "2026-10-27T17:00:30Z" });
    expect(settleRequestAttempt(secondA, 1, successfulForecast)).toBeNull();
    expect(settleRequestAttempt(secondA, 1, null)).toBeNull();
    expect(secondA).toMatchObject({
      runningAttemptId: 3,
      runningStartedAt: "2026-10-27T17:00:20Z",
      failedStartedAt: null,
    });
    expect(settleRequestAttempt(secondA, 3, successfulForecast)).toEqual({
      ...secondA,
      runningAttemptId: null,
      runningStartedAt: null,
      failedStartedAt: null,
      memoryForecast: successfulForecast,
    });
    expect(settleRequestAttempt(secondA, 3, null)).toEqual({
      ...secondA,
      runningAttemptId: null,
      runningStartedAt: null,
      failedStartedAt: "2026-10-27T17:00:20Z",
    });
  });

  // proofs/arch/templates/weather.md#^templates-weather-t-selection
  it("selects a non-future forecast first, then the later update", () => {
    const now = "2026-10-27T18:00:00Z";
    const older = forecast({ updatedAt: "2026-10-27T16:00:00Z", current: { temperature: 1, condition: "clear", summary: "Clear", isDay: true } });
    const newer = forecast({ updatedAt: "2026-10-27T17:00:00Z", current: { temperature: 2, condition: "clear", summary: "Clear", isDay: true } });
    const future = forecast({ updatedAt: "2026-10-27T19:00:00Z", current: { temperature: 3, condition: "clear", summary: "Clear", isDay: true } });
    const laterFuture = forecast({ updatedAt: "2026-10-27T20:00:00Z", current: { temperature: 4, condition: "clear", summary: "Clear", isDay: true } });
    expect(selectForecast(older, newer, now)).toBe(newer);
    expect(selectForecast(newer, older, now)).toBe(newer);
    expect(selectForecast(newer, future, now)).toBe(newer);
    expect(selectForecast(future, newer, now)).toBe(newer);
    expect(selectForecast(future, laterFuture, now)).toBe(laterFuture);
    expect(selectForecast(laterFuture, future, now)).toBe(laterFuture);
    expect(selectForecast(null, newer, now)).toBe(newer);
    expect(selectForecast(newer, null, now)).toBe(newer);
    const equal = clone(newer);
    expect([newer, equal]).toContain(selectForecast(newer, equal, now));
    expect(older).toEqual(forecast({ updatedAt: "2026-10-27T16:00:00Z", current: { temperature: 1, condition: "clear", summary: "Clear", isDay: true } }));
    expect(newer).toEqual(forecast({ updatedAt: "2026-10-27T17:00:00Z", current: { temperature: 2, condition: "clear", summary: "Clear", isDay: true } }));
    expect(future).toEqual(forecast({ updatedAt: "2026-10-27T19:00:00Z", current: { temperature: 3, condition: "clear", summary: "Clear", isDay: true } }));
  });

  // proofs/arch/templates/weather.md#^templates-weather-t-transaction
  it("updates a matching configured root without restoring stale fields", () => {
    const normalized = forecast({ updatedAt: "2026-10-27T18:00:00Z" });
    const identity = { latitude: configuration.latitude, longitude: configuration.longitude, units: configuration.units };
    for (const prior of [undefined, { invalid: true }, forecast({ latitude: 1 }), forecast()]) {
      const root = { ...configuration, place: "Newest place", ...(prior === undefined ? {} : { forecast: prior }), extra: { retained: true } };
      const original = clone(root);
      expect(updateForecastRoot(root, identity, normalized)).toEqual({ ...root, forecast: normalized });
      expect(root).toEqual(original);
    }
    for (const current of [
      undefined,
      {},
      null,
      { latitude: configuration.latitude, longitude: configuration.longitude, units: configuration.units },
      { ...configuration, latitude: 1 },
      { ...configuration, longitude: 1 },
      { ...configuration, units: "fahrenheit" },
    ]) {
      expect(updateForecastRoot(current, identity, normalized)).toBeUndefined();
    }
  });
});

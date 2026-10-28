/** Temperature units accepted by the Weather store. */
export type Units = "celsius" | "fahrenheit";

/** Closed visual condition vocabulary used by Weather. */
export type Condition = "clear" | "partly-cloudy" | "cloudy" | "rain" | "snow" | "thunderstorm" | "fog";

/** Location and units written by a person or agent. */
export interface WeatherConfiguration {
  place: string;
  latitude: number;
  longitude: number;
  units: Units;
  forecast?: unknown;
  [key: string]: unknown;
}

/** Current conditions saved in the normalized forecast cache. */
export interface WeatherCurrent {
  temperature: number;
  condition: Condition;
  summary: string;
  isDay: boolean;
}

/** One normalized hourly forecast entry. */
export interface WeatherHour {
  time: string;
  temperature: number;
  condition: Condition;
  isDay: boolean;
}

/** One normalized daily forecast entry. */
export interface WeatherDay {
  date: string;
  condition: Condition;
  high: number;
  low: number;
}

/** Complete normalized Open-Meteo response saved by the page. */
export interface WeatherForecast {
  latitude: number;
  longitude: number;
  units: Units;
  timeZone: string;
  updatedAt: string;
  current: WeatherCurrent;
  hourly: WeatherHour[];
  daily: WeatherDay[];
}

/** Provider-attempt state retained by the Weather page. */
export interface RequestState {
  identity: Pick<WeatherConfiguration, "latitude" | "longitude" | "units"> | null;
  runningAttemptId: number | null;
  runningStartedAt: string | null;
  failedStartedAt: string | null;
  memoryForecast: WeatherForecast | null;
}

/** Reports whether a value is a non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown>;

/** Reports whether a value is a finite number. */
export function isFiniteNumber(value: unknown): value is number;

/** Reports whether a value names an IANA time zone recognized by the runtime. */
export function isTimeZone(value: unknown): value is string;

/** Reports whether a value is a valid normalized hourly entry. */
export function isWeatherHour(value: unknown): value is WeatherHour;

/** Reports whether a value is a valid normalized daily entry. */
export function isWeatherDay(value: unknown): value is WeatherDay;

/** Reports whether a value is a complete display-safe forecast. */
export function isWeatherForecast(value: unknown): value is WeatherForecast;

/** Reports whether a complete forecast matches the configured request values. */
export function isCompatibleForecast(
  forecast: unknown,
  configuration: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">,
): forecast is WeatherForecast;

/** Classifies a store value and returns a compatible saved forecast when present. */
export function readWeatherValue(value: unknown):
  | { kind: "empty" }
  | { kind: "unreadable" }
  | {
    kind: "configured";
    configuration: WeatherConfiguration;
    forecast: WeatherForecast | null;
  };

/** Returns the Gregorian calendar date for an instant in an IANA time zone. */
export function localDate(
  value: string | number | Date,
  timeZone: string,
): string;

/** Selects later hourly entries for display or response retention. */
export function getHourlyWindow(
  forecast: WeatherForecast,
  now: string | number | Date,
  limit?: number,
): WeatherHour[];

/** Selects the first seven daily entries on or after the current local date. */
export function getDailyWindow(
  forecast: WeatherForecast,
  now: string | number | Date,
): WeatherDay[];

/** Returns high and low only for the current local date. */
export function getCurrentHighLow(
  forecast: WeatherForecast,
  now: string | number | Date,
): { high: number; low: number } | null;

/** Rounds a temperature half away from zero without producing negative zero. */
export function roundTemperature(value: number): number;

/** Returns the completed unit and value used for the forecast age label. */
export function forecastAge(
  updatedAt: string,
  now: string | number | Date,
): { unit: "now" | "minute" | "hour" | "day"; value: number };

/** Resets attempt state for new request values while retaining usable memory. */
export function reconcileRequestContext(
  state: RequestState,
  configuration: WeatherConfiguration | null,
): { state: RequestState; abortRunning: boolean };

/** Starts an attempt and clears the earlier failure throttle. */
export function startRequestAttempt(
  state: RequestState,
  attemptId: number,
  startedAt: string,
): RequestState;

/** Settles only the tracked attempt, installing success or recording failure. */
export function settleRequestAttempt(
  state: RequestState,
  attemptId: number,
  normalizedForecast: WeatherForecast | null,
): RequestState | null;

/** Chooses between compatible saved and in-memory forecasts. */
export function selectForecast(
  savedForecast: WeatherForecast | null,
  memoryForecast: WeatherForecast | null,
  now: string | number | Date,
): WeatherForecast | null;

/** Reports whether the current request state permits a provider attempt. */
export function shouldRequestForecast(input: {
  configuration: WeatherConfiguration | null;
  state: RequestState;
  savedForecast: WeatherForecast | null;
  now: string | number | Date;
}): boolean;

/** Returns the transaction root for a response that still matches the store. */
export function updateForecastRoot(
  currentRoot: unknown,
  requestIdentity: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">,
  normalizedForecast: WeatherForecast,
): WeatherConfiguration | undefined;

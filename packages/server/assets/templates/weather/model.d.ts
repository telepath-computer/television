export type Units = "celsius" | "fahrenheit";
export type Condition = "clear" | "partly-cloudy" | "cloudy" | "rain" | "snow" | "thunderstorm" | "fog";
export interface WeatherConfiguration { place: string; latitude: number; longitude: number; units: Units; forecast?: unknown; [key: string]: unknown }
export interface WeatherForecast { latitude: number; longitude: number; units: Units; timeZone: string; updatedAt: string; current: { temperature: number; condition: Condition; summary: string; isDay: boolean }; hourly: Array<{ time: string; temperature: number; condition: Condition; isDay: boolean }>; daily: Array<{ date: string; condition: Condition; high: number; low: number }> }
export interface RequestState { identity: Pick<WeatherConfiguration, "latitude" | "longitude" | "units"> | null; runningStartedAt: string | null; failedStartedAt: string | null; memoryForecast: WeatherForecast | null }
export function isWeatherForecast(value: unknown): value is WeatherForecast;
export function readWeatherValue(value: unknown): { kind: "empty" } | { kind: "unreadable" } | { kind: "configured"; configuration: WeatherConfiguration; forecast: WeatherForecast | null };
export function getHourlyWindow(forecast: WeatherForecast, now: string | number | Date, limit?: number): WeatherForecast["hourly"];
export function getDailyWindow(forecast: WeatherForecast, now: string | number | Date): WeatherForecast["daily"];
export function getCurrentHighLow(forecast: WeatherForecast, now: string | number | Date): { high: number; low: number } | null;
export function roundTemperature(value: number): number;
export function forecastAge(updatedAt: string, now: string | number | Date): { unit: "now" | "minute" | "hour" | "day"; value: number };
export function reconcileRequestContext(state: RequestState, configuration: WeatherConfiguration | null): { state: RequestState; abortRunning: boolean };
export function selectForecast(savedForecast: WeatherForecast | null, memoryForecast: WeatherForecast | null, now: string | number | Date): WeatherForecast | null;
export function shouldRequestForecast(input: { configuration: WeatherConfiguration | null; state: RequestState; savedForecast: WeatherForecast | null; now: string | number | Date }): boolean;
export function updateForecastRoot(currentRoot: unknown, requestIdentity: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">, normalizedForecast: WeatherForecast): WeatherConfiguration | undefined;

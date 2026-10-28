import type { Condition, Units, WeatherForecast } from "./model.js";

/** Maps one documented WMO code into the Weather vocabulary. */
export function mapWeatherCode(code: unknown): { condition: Condition; summary: string } | null;

/** Builds the exact keyless Open-Meteo forecast request. */
export function buildOpenMeteoRequest(configuration: {
  latitude: number;
  longitude: number;
  units: Units;
}): Request;

/** Normalizes a parsed provider response or rejects it as unusable. */
export function normalizeOpenMeteoResponse(
  body: unknown,
  requestIdentity: { latitude: number; longitude: number; units: Units },
  receivedAt: string | number | Date,
): WeatherForecast | null;

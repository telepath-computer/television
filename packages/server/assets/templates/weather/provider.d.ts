import type { Condition, Units, WeatherForecast } from "./model.js";
export function mapWeatherCode(code: unknown): { condition: Condition; summary: string } | null;
export function buildOpenMeteoRequest(configuration: { latitude: number; longitude: number; units: Units }): Request;
export function normalizeOpenMeteoResponse(body: unknown, requestIdentity: { latitude: number; longitude: number; units: Units }, receivedAt: string | number | Date): WeatherForecast | null;

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Response } from "@playwright/test";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { buildOpenMeteoRequest } from "../../packages/server/assets/templates/weather/provider.js";
import type { WeatherConfiguration } from "../../packages/server/assets/templates/weather/model.js";
import { TemplateHarness, TEST_HOST_LAUNCH } from "../../packages/web/test/e2e/template-harness.ts";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/weather/open-meteo");
const API_HOST = "api.open-meteo.com";

test.describe.configure({ timeout: 120_000 });
test.use({ launchOptions: TEST_HOST_LAUNCH });

// proofs/arch/templates/weather.md#^templates-weather-live-provider
test("refreshes the Weather provider captures through a copied sandboxed page", async ({ page }) => {
  const harness = await TemplateHarness.start({ id: "weather", name: "Weather" });
  try {
    const celsius = configuration("celsius");
    const responses = new Map<string, Promise<CapturedResponse>>();
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.hostname === API_HOST) responses.set(url.searchParams.get("temperature_unit")!, capture(response));
    });

    const artifactID = await harness.createStored(celsius as unknown as JSONValue);
    await harness.openApp(page);
    const frame = await harness.frame(page, artifactID);
    expect(await frame.evaluate(() => window.origin)).toBe("null");
    await expect(frame.locator(".weather-header h1")).toHaveText("San Francisco", { timeout: 30_000 });
    await expect(frame.locator(".weather-credit")).toContainText("Open-Meteo data · adapted · CC BY 4.0");
    await expect.poll(() => harness.read<WeatherConfiguration>(artifactID)).toMatchObject({
      forecast: { units: "celsius", current: expect.any(Object), hourly: expect.any(Array), daily: expect.any(Array) },
    });

    const fahrenheit = configuration("fahrenheit");
    await harness.set(artifactID, fahrenheit as unknown as JSONValue);
    await expect(frame.locator(".weather-header p")).toContainText("°F", { timeout: 30_000 });
    await expect.poll(() => harness.read<WeatherConfiguration>(artifactID)).toMatchObject({
      forecast: { units: "fahrenheit", current: expect.any(Object), hourly: expect.any(Array), daily: expect.any(Array) },
    });

    const celsiusCapture = await requiredResponse(responses, "celsius");
    const fahrenheitCapture = await requiredResponse(responses, "fahrenheit");
    expect(celsiusCapture.request.url).toBe(buildOpenMeteoRequest(celsius).url);
    expect(fahrenheitCapture.request.url).toBe(buildOpenMeteoRequest(fahrenheit).url);
    writeCapture("current-success.json", celsiusCapture);
    writeCapture("current-success-fahrenheit.json", fahrenheitCapture);
  } finally {
    await harness.cleanup();
  }
});

function configuration(units: "celsius" | "fahrenheit"): WeatherConfiguration {
  return { place: "San Francisco", latitude: 37.7749, longitude: -122.4194, units };
}

interface CapturedResponse {
  request: { method: string; url: string; headers: { origin: string } };
  response: { status: number; headers: Record<string, string>; body: unknown };
}

async function capture(response: Response): Promise<CapturedResponse> {
  const requestHeaders = await response.request().allHeaders();
  const responseHeaders = await response.allHeaders();
  return {
    request: {
      method: response.request().method(),
      url: response.url(),
      headers: { origin: requestHeaders.origin ?? "" },
    },
    response: {
      status: response.status(),
      headers: {
        "access-control-allow-origin": responseHeaders["access-control-allow-origin"] ?? "",
        "content-type": responseHeaders["content-type"] ?? "",
      },
      body: await response.json(),
    },
  };
}

async function requiredResponse(
  responses: Map<string, Promise<CapturedResponse>>,
  units: string,
): Promise<CapturedResponse> {
  await expect.poll(() => responses.has(units)).toBe(true);
  const response = await responses.get(units)!;
  expect(response.request).toMatchObject({ method: "GET", headers: { origin: "null" } });
  expect(response.response.status).toBe(200);
  expect(response.response.headers["access-control-allow-origin"]).toBe("*");
  return response;
}

function writeCapture(name: string, captured: CapturedResponse): void {
  const file = path.join(FIXTURES, name);
  const prior = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  writeFileSync(file, `${JSON.stringify({
    ...prior,
    capturedAt: new Date().toISOString(),
    request: captured.request,
    response: captured.response,
  }, null, 2)}\n`);
}

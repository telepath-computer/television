import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Frame, type Route } from "@playwright/test";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import {
  buildOpenMeteoRequest,
  normalizeOpenMeteoResponse,
} from "../../../server/assets/templates/weather/provider.js";
import {
  getDailyWindow,
  getHourlyWindow,
  roundTemperature,
} from "../../../server/assets/templates/weather/model.js";
import type {
  Units,
  WeatherConfiguration,
  WeatherForecast,
} from "../../../server/assets/templates/weather/model.js";
import { TemplateHarness, TEST_HOST_LAUNCH } from "./template-harness.ts";

const API_HOST = "api.open-meteo.com";
const FIXTURES = path.resolve(import.meta.dirname, "../../../../test/fixtures/weather/open-meteo");
const WEATHER_SOURCE = path.resolve(import.meta.dirname, "../../../server/assets/templates/weather");

type Capture = {
  capturedAt: string;
  request: { method: string; url: string; headers: Record<string, string> };
  response: { status: number; headers: Record<string, string>; body: unknown };
};

type ProviderMode = "success" | "abort" | "malformed";

interface ProviderStep {
  configuration: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">;
  capture: Capture;
  mode: ProviderMode;
  gate?: Promise<void>;
  finish(): void;
}

interface ScriptedResponse {
  finished: Promise<void>;
}

interface HeldResponse extends ScriptedResponse {
  release(): void;
}

type StoredWeatherConfiguration = WeatherConfiguration & Record<string, JSONValue>;

class ScriptedProvider {
  readonly requests: string[] = [];
  readonly errors: string[] = [];
  private readonly steps: ProviderStep[] = [];

  static async install(context: BrowserContext): Promise<ScriptedProvider> {
    const provider = new ScriptedProvider();
    await context.route("**/*", (route) => provider.route(route));
    return provider;
  }

  success(
    configuration: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">,
    capture: Capture | string = captureName(configuration.units),
  ): ScriptedResponse {
    return this.enqueue(configuration, typeof capture === "string" ? fixture(capture) : capture, "success");
  }

  hold(
    configuration: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">,
    capture: Capture | string = captureName(configuration.units),
  ): HeldResponse {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    return { ...this.enqueue(configuration, typeof capture === "string" ? fixture(capture) : capture, "success", gate), release };
  }

  abort(configuration: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">): ScriptedResponse {
    return this.enqueue(configuration, fixture(captureName(configuration.units)), "abort");
  }

  malformed(configuration: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">): ScriptedResponse {
    return this.enqueue(configuration, fixture(captureName(configuration.units)), "malformed");
  }

  httpError(configuration: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">): ScriptedResponse {
    return this.enqueue(
      configuration,
      fixture("error-latitude-out-of-range.json"),
      "success",
    );
  }

  async saw(count: number): Promise<void> {
    await expect.poll(() => this.requests.length).toBe(count);
  }

  done(): void {
    expect(this.steps, "all scripted provider responses were consumed").toHaveLength(0);
    expect(this.errors, "every provider request matched its script").toEqual([]);
  }

  private enqueue(
    configuration: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">,
    capture: Capture,
    mode: ProviderMode,
    gate?: Promise<void>,
  ): ScriptedResponse {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    this.steps.push({ configuration, capture, mode, gate, finish });
    return { finished };
  }

  private async route(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== API_HOST) {
      if (url.protocol === "http:" && url.hostname === "tv-sdk.test") await route.continue();
      else if (url.protocol === "data:" || url.protocol === "blob:") await route.continue();
      else {
        this.errors.push(`unexpected external request: ${request.method()} ${request.url()}`);
        await route.abort("blockedbyclient");
      }
      return;
    }

    this.requests.push(request.url());
    const step = this.steps.shift();
    if (!step) {
      this.errors.push(`unexpected Open-Meteo request: ${request.method()} ${request.url()}`);
      await route.abort("failed");
      return;
    }

    const expectedURL = buildOpenMeteoRequest(step.configuration).url;
    const headers = await request.allHeaders();
    if (request.method() !== "GET") this.errors.push(`expected GET, received ${request.method()}`);
    if (request.url() !== expectedURL) this.errors.push(`expected ${expectedURL}, received ${request.url()}`);
    if (headers.origin !== "null") this.errors.push(`expected Origin: null, received ${headers.origin ?? "none"}`);
    if (step.gate) await step.gate;

    try {
      if (step.mode === "abort") {
        await route.abort("failed");
      } else {
        await route.fulfill({
          status: step.capture.response.status,
          headers: step.capture.response.headers,
          body: step.mode === "malformed" ? "{malformed" : JSON.stringify(step.capture.response.body),
        });
      }
    } catch {
      // A production AbortController may have already cancelled a held route.
    } finally {
      step.finish();
    }
  }
}

function fixture(name: string): Capture {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")) as Capture;
}

function captureName(units: Units): string {
  return units === "fahrenheit" ? "current-success-fahrenheit.json" : "current-success.json";
}

function captureClock(units: Units = "celsius"): Date {
  return new Date(fixture(captureName(units)).capturedAt);
}

function captureTime(offsetMs = 0, units: Units = "celsius"): string {
  return new Date(captureClock(units).getTime() + offsetMs).toISOString();
}

function shiftedCaptureForNow(name = "current-success.json"): Capture {
  const captured = structuredClone(fixture(name));
  const body = captured.response.body as {
    current: { time: number };
    hourly: { time: number[] };
    daily: { time: number[] };
  };
  const elapsedDays = Math.round((Date.now() - Date.parse(captured.capturedAt)) / 86_400_000);
  const shiftSeconds = elapsedDays * 86_400;
  body.current.time += shiftSeconds;
  body.hourly.time = body.hourly.time.map((instant) => instant + shiftSeconds);
  body.daily.time = body.daily.time.map((instant) => instant + shiftSeconds);
  captured.capturedAt = new Date(Date.parse(captured.capturedAt) + shiftSeconds * 1000).toISOString();
  return captured;
}

function captureWithCurrent(
  name: string,
  values: { temperature?: number; weatherCode?: number; isDay?: 0 | 1 },
): Capture {
  const captured = structuredClone(fixture(name));
  const current = (captured.response.body as {
    current: { temperature_2m: number; weather_code: number; is_day: 0 | 1 };
  }).current;
  if (values.temperature !== undefined) current.temperature_2m = values.temperature;
  if (values.weatherCode !== undefined) current.weather_code = values.weatherCode;
  if (values.isDay !== undefined) current.is_day = values.isDay;
  return captured;
}

function configuration(overrides: Partial<WeatherConfiguration> = {}): StoredWeatherConfiguration {
  return {
    place: "San Francisco",
    latitude: 37.7749,
    longitude: -122.4194,
    units: "celsius",
    ...overrides,
  } as StoredWeatherConfiguration;
}

function storeJSON(value: unknown): JSONValue {
  return value as JSONValue;
}

function capturedForecast(
  config: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">,
  updatedAt: string,
): WeatherForecast {
  const body = fixture(captureName(config.units)).response.body;
  const forecast = normalizeOpenMeteoResponse(body, config, updatedAt);
  if (!forecast) throw new Error("Captured Open-Meteo success did not normalize");
  return forecast;
}

async function installClock(
  frameOwner: { clock: { install(input: { time: Date }): Promise<void> } },
  units: Units = "celsius",
): Promise<void> {
  await frameOwner.clock.install({ time: captureClock(units) });
}

function degree(value: number): string {
  return `${String(roundTemperature(value)).replace("-", "−")}°`;
}

async function replaceStoreAndWait(frame: Frame, update: () => Promise<unknown>): Promise<void> {
  const previous = await frame.locator(".weather-card").elementHandle();
  await update();
  await expect.poll(async () => previous ? previous.evaluate((node) => node.isConnected) : false).toBe(false);
}

async function settleRevocation(
  page: { clock: { fastForward(milliseconds: number): Promise<void> } },
  advanceMs = 1,
): Promise<void> {
  await page.clock.fastForward(advanceMs);
}

async function cardState(frame: Frame): Promise<Record<string, unknown>> {
  return frame.locator(".weather-card").evaluate((card) => ({
    condition: (card as HTMLElement).dataset.condition,
    day: (card as HTMLElement).dataset.day,
    background: getComputedStyle(card).backgroundImage,
    artwork: [...card.querySelectorAll<HTMLImageElement>(".weather-glyph")].map((image) => image.getAttribute("src")),
    summary: card.querySelector(".weather-summary")?.textContent,
    temperature: card.querySelector(".weather-temperature")?.textContent,
    age: card.querySelector(".weather-header p")?.textContent,
    hourly: [...card.querySelectorAll(".weather-hour")].map((entry) => entry.textContent),
    daily: [...card.querySelectorAll(".weather-day")].map((entry) => entry.textContent),
  }));
}

async function expectEmpty(frame: Frame): Promise<void> {
  await expect(frame.getByRole("heading", { name: "No location yet" })).toBeVisible();
  await expect(frame.getByText("Ask your agent to choose a place for this weather card.")).toBeVisible();
  await expect(frame.locator(".weather-credit")).toHaveCount(0);
}

async function expectLoading(frame: Frame): Promise<void> {
  await expect(frame.getByRole("status", { name: "Loading weather" })).toBeVisible();
  await expect(frame.locator(".weather-credit")).toHaveCount(0);
}

async function expectReady(frame: Frame, place: string): Promise<void> {
  await expect(frame.locator(".weather-header h1")).toHaveText(place);
  await expect(frame.locator(".weather-temperature")).toBeVisible();
  await expect.poll(() => frame.locator(".weather-current-glyph img").evaluate(
    (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
  )).toBe(true);
  await expect(frame.locator(".weather-credit")).toContainText("Open-Meteo data · adapted · CC BY 4.0");
}

async function setVisibility(frame: Frame, visibility: "hidden" | "visible"): Promise<void> {
  await frame.evaluate((next) => {
    Object.defineProperties(document, {
      visibilityState: { configurable: true, get: () => next },
      hidden: { configurable: true, get: () => next === "hidden" },
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visibility);
}

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.use({ launchOptions: TEST_HOST_LAUNCH });

let harness: TemplateHarness;
let toolboxWeatherID: string;
let toolboxWeatherConfiguration: WeatherConfiguration;

test.beforeAll(async () => {
  harness = await TemplateHarness.start({ id: "weather", name: "Weather" });
});

test.afterAll(async () => {
  await harness.cleanup();
});

// proofs/arch/templates/weather.md#^templates-weather-ac-live
// proofs/ui/templates/weather.md#^weather-ui-ac-new
// specs/product/templates.md#^artifact-template-bundled
test("creates Weather, follows the README changes, and saves the newest whole root", async ({ page, context }) => {
  const provider = await ScriptedProvider.install(context);
  await installClock(page);
  await page.setViewportSize({ width: 1600, height: 1200 });
  const messageStart = harness.proxy.messages.length;
  const created = await harness.create(page);
  const { artifactID, frame } = created;
  await expectEmpty(frame);
  expect(provider.requests).toEqual([]);
  expect(await harness.read(artifactID)).toEqual({});
  const layout = (await harness.client.channels.get({ channelID: harness.channelID })).channel.layout;
  expect(layout.find(({ artifactIds }) => artifactIds.includes(artifactID))).toMatchObject({
    size: { width: 340, height: 340 },
    geometry: { kind: "single", full_screen: false },
  });
  expect((await harness.client.artifacts.get({ artifactID })).artifact).toMatchObject({ transparent: true });
  const rootSubscriptions = harness.proxy.messages.slice(messageStart).filter(({ message }) =>
    message.type === "subscribe" && message.path === "" && message.resourceID === undefined);
  expect(rootSubscriptions).toHaveLength(1);

  const celsius = configuration();
  provider.success(celsius);
  expect(harness.product.runCLI([
    "resource", "json", "set", "--artifact", artifactID, JSON.stringify(celsius),
  ])).toContain(`JSON store of artifact ${artifactID} updated.`);
  await expectReady(frame, "San Francisco");
  await provider.saw(1);
  await expect.poll(() => harness.read<WeatherConfiguration>(artifactID)).toMatchObject({
    place: "San Francisco",
    forecast: { units: "celsius", hourly: expect.any(Array), daily: expect.any(Array) },
  });
  const firstRoot = await harness.read<WeatherConfiguration>(artifactID);
  expect(firstRoot?.forecast).toMatchObject({ units: "celsius", hourly: expect.any(Array) });
  const visibleForecast = await frame.locator(".weather-current, .weather-panel, .weather-header p").allTextContents();

  harness.product.runCLI([
    "resource", "json", "set", "--artifact", artifactID, "place", JSON.stringify("San Francisco Bay Area"),
  ]);
  await expect(frame.locator(".weather-header h1")).toHaveText("San Francisco Bay Area");
  expect(await frame.locator(".weather-current, .weather-panel, .weather-header p").allTextContents()).toEqual(visibleForecast);
  expect((await harness.read<WeatherConfiguration>(artifactID))?.forecast).toEqual(firstRoot?.forecast);
  expect(provider.requests).toHaveLength(1);

  const fahrenheit = configuration({ place: "San Francisco Bay Area", units: "fahrenheit" });
  const held = provider.hold(fahrenheit);
  harness.product.runCLI([
    "resource", "json", "set", "--artifact", artifactID, "units", JSON.stringify("fahrenheit"),
  ]);
  await provider.saw(2);
  harness.product.runCLI([
    "resource", "json", "set", "--artifact", artifactID, "place", JSON.stringify("Newest Bay label"),
  ]);
  expect(harness.product.runCLI([
    "resource", "json", "set", "--artifact", artifactID, "extra", JSON.stringify({ retained: true }),
  ])).toContain(`JSON store of artifact ${artifactID} updated.`);
  const releasedAfter = Date.parse(await frame.evaluate(() => new Date().toISOString()));
  held.release();
  await expectReady(frame, "Newest Bay label");
  await expect(frame.locator(".weather-header p")).toContainText("°F");
  await expect.poll(() => harness.read<WeatherConfiguration>(artifactID)).toMatchObject({
    place: "Newest Bay label",
    units: "fahrenheit",
    extra: { retained: true },
    forecast: { units: "fahrenheit", hourly: expect.any(Array), daily: expect.any(Array) },
  });
  const newest = await harness.read<WeatherConfiguration>(artifactID);
  const saved = newest?.forecast as WeatherForecast;
  const expectedSaved = normalizeOpenMeteoResponse(
    fixture("current-success-fahrenheit.json").response.body,
    fahrenheit,
    saved.updatedAt,
  );
  expect(saved).toEqual(expectedSaved);
  expect(Date.parse(saved.updatedAt)).toBeGreaterThanOrEqual(releasedAfter);
  expect(Date.parse(saved.updatedAt)).toBeLessThanOrEqual(Date.parse(await frame.evaluate(() => new Date().toISOString())));
  expect(saved.hourly).toHaveLength(24);
  await held.finished;
  expect(await frame.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  toolboxWeatherID = artifactID;
  toolboxWeatherConfiguration = newest!;
  provider.done();
});

// proofs/arch/templates/weather.md#^templates-weather-ac-request-cycle
test("keeps checking an unselected Television page whose document is visible", async ({ page, context }) => {
  const provider = await ScriptedProvider.install(context);
  await page.clock.install({ time: new Date(captureClock().getTime() + 60_000) });
  const selectedID = await harness.createStored();
  await harness.openApp(page);
  const selectedFrame = await harness.frame(page, selectedID);
  await expectEmpty(selectedFrame);
  const selectedPage = page.locator(`.stage .page[data-page-key="${selectedID}"]`);
  if (await selectedPage.getAttribute("selected") === null) await selectedPage.click();
  await expect(selectedPage).toHaveAttribute("selected", "");
  const frame = await harness.frame(page, toolboxWeatherID);
  await expectReady(frame, toolboxWeatherConfiguration.place);
  expect(await frame.evaluate(() => document.visibilityState)).toBe("visible");
  provider.success(toolboxWeatherConfiguration);
  await page.clock.fastForward(16 * 60_000);
  await provider.saw(1);
  await expectReady(frame, toolboxWeatherConfiguration.place);
  provider.done();
});

// proofs/arch/templates/weather.md#^templates-weather-t-delivery
test("the copied page keeps every packaged dependency after the installed source is hidden", async ({ page, context }) => {
  const provider = await ScriptedProvider.install(context);
  await installClock(page);
  const config = configuration();
  const artifactID = await harness.createStored(config);
  const installed = path.join(harness.home, "templates", "weather");
  const hidden = path.join(harness.home, "templates", ".weather-review-hidden");
  const responseBodies = new Map<string, string>();
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes(`/artifact/${artifactID}/`)) {
      try { responseBodies.set(url.pathname.split("/").at(-1)!, await response.text()); } catch { /* asset may be cancelled */ }
    }
  });
  provider.success(config);
  renameSync(installed, hidden);
  try {
    const frame = await harness.open(page, artifactID);
    await expectReady(frame, "San Francisco");
    await provider.saw(1);
    await frame.evaluate(async () => {
      for (const file of ["artwork.svg", "THIRD-PARTY-NOTICES.txt"]) {
        const response = await fetch(`./${file}`);
        if (!response.ok) throw new Error(`${file} returned ${response.status}`);
        await response.text();
      }
    });
    await expect.poll(() => [...responseBodies.keys()]).toEqual(expect.arrayContaining([
      "index.html", "page.js", "model.js", "provider.js", "styles.css", "artwork.svg", "THIRD-PARTY-NOTICES.txt",
    ]));
    expect(responseBodies.get("styles.css")).toBe(readFileSync(path.join(WEATHER_SOURCE, "styles.css"), "utf8"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectReady(page.mainFrame(), "San Francisco");
  } finally {
    renameSync(hidden, installed);
  }
  provider.done();
});

// proofs/arch/templates/weather.md#^templates-weather-ac-request-cycle
// proofs/ui/templates/weather.md#^weather-ui-ac-new
test("changes request identity, discards late responses, and swaps a held refresh atomically", async ({ context }) => {
  const provider = await ScriptedProvider.install(context);
  for (const [field, value] of [
    ["latitude", 38.1],
    ["longitude", -121.9],
    ["units", "fahrenheit"],
  ] as const) {
    const page = await context.newPage();
    await installClock(page);
    const original = configuration({
      forecast: capturedForecast(configuration(), captureTime(-16 * 60_000)),
    });
    const artifactID = await harness.createStored(original);
    const requestCount = provider.requests.length;
    const old = provider.hold(original);
    const frame = await harness.open(page, artifactID);
    await provider.saw(requestCount + 1);
    const changed = { ...original, [field]: value } as WeatherConfiguration;
    const next = provider.hold(changed);
    const aborted = page.waitForEvent("requestfailed", {
      predicate: (request) => request.url() === buildOpenMeteoRequest(original).url,
      timeout: 5_000,
    });
    await harness.set(artifactID, storeJSON(value), field);
    await expectLoading(frame);
    await aborted;
    await provider.saw(requestCount + 2);
    expect(provider.requests.slice(requestCount)).toEqual([
      buildOpenMeteoRequest(original).url,
      buildOpenMeteoRequest(changed).url,
    ]);
    next.release();
    await expectReady(frame, changed.place);
    await expect.poll(() => harness.read<WeatherConfiguration>(artifactID)).toMatchObject({
      [field]: value,
      forecast: { [field]: value },
    });
    await next.finished;
    old.release();
    await old.finished;
    expect(await harness.read(artifactID)).toMatchObject({ [field]: value, forecast: { [field]: value } });
    expect(provider.requests).toHaveLength(requestCount + 2);
    await page.close();
  }

  const page = await context.newPage();
  await installClock(page);
  await page.setViewportSize({ width: 760, height: 740 });
  const expected = capturedForecast(configuration(), captureTime());
  const staleCondition = expected.current.condition === "rain" ? "snow" : "rain";
  const stale = capturedForecast(configuration(), captureTime(-16 * 60_000));
  stale.current = { temperature: expected.current.temperature + 20, condition: staleCondition, summary: "Old conditions", isDay: !expected.current.isDay };
  stale.hourly = stale.hourly.map((hour) => ({
    ...hour,
    temperature: hour.temperature + 20,
    condition: staleCondition,
    isDay: !hour.isDay,
  }));
  stale.daily = stale.daily.map((day) => ({ ...day, condition: staleCondition, high: day.high + 20, low: day.low + 20 }));
  const config = configuration({ forecast: stale });
  const artifactID = await harness.createStored(config);
  const held = provider.hold(config);
  const frame = await harness.open(page, artifactID);
  await expect(frame.getByText("Old conditions", { exact: true })).toBeVisible();
  await expect(frame.getByRole("status", { name: "Loading weather" })).toHaveCount(0);
  const before = await cardState(frame);
  await frame.evaluate(() => {
    const observed: Array<Record<string, unknown>> = [];
    (window as unknown as { __weatherRenderStates: Array<Record<string, unknown>> }).__weatherRenderStates = observed;
    const root = document.querySelector(".weather-page")!;
    new MutationObserver(() => {
      const card = document.querySelector(".weather-card");
      if (!card) return;
      observed.push({
        condition: (card as HTMLElement).dataset.condition,
        summary: card.querySelector(".weather-summary")?.textContent,
        temperature: card.querySelector(".weather-temperature")?.textContent,
        age: card.querySelector(".weather-header p")?.textContent,
        hourlyCount: card.querySelectorAll(".weather-hour").length,
        dailyCount: card.querySelectorAll(".weather-day").length,
      });
    }).observe(root, { childList: true });
  });
  held.release();
  await expect(frame.getByText(expected.current.summary, { exact: true })).toBeVisible();
  await held.finished;
  const after = await cardState(frame);
  expect(after).not.toEqual(before);
  expect(after).toMatchObject({
    condition: expected.current.condition,
    day: String(expected.current.isDay),
    summary: expected.current.summary,
    temperature: degree(expected.current.temperature),
    age: expect.stringContaining("Updated now"),
  });
  expect(after.background).not.toBe(before.background);
  expect(after.artwork).not.toEqual(before.artwork);
  const expectedHours = [expected.current, ...getHourlyWindow(expected, captureClock())];
  expect((after.hourly as string[])).toHaveLength(expectedHours.length);
  for (const [index, hour] of expectedHours.entries()) {
    expect((after.hourly as string[])[index]).toContain(degree(hour.temperature));
  }
  const expectedDays = getDailyWindow(expected, captureClock());
  expect((after.daily as string[])).toHaveLength(expectedDays.length);
  for (const [index, day] of expectedDays.entries()) {
    expect((after.daily as string[])[index]).toContain(degree(day.low));
    expect((after.daily as string[])[index]).toContain(degree(day.high));
  }
  const renders = await frame.evaluate(() =>
    (window as unknown as { __weatherRenderStates: Array<Record<string, unknown>> }).__weatherRenderStates);
  expect(renders.length).toBeGreaterThan(0);
  for (const render of renders) {
    expect(render).toEqual({
      condition: expected.current.condition,
      summary: expected.current.summary,
      temperature: degree(expected.current.temperature),
      age: expect.stringContaining("Updated now"),
      hourlyCount: getHourlyWindow(expected, captureClock()).length + 1,
      dailyCount: expectedDays.length,
    });
  }
  const saved = (await harness.read<WeatherConfiguration>(artifactID))?.forecast as WeatherForecast;
  expect(saved).toEqual(normalizeOpenMeteoResponse(fixture("current-success.json").response.body, config, saved.updatedAt));
  provider.done();
});

// proofs/arch/templates/weather.md#^templates-weather-ac-cache
test("keeps each owner result in memory, commits the last transaction, and selects the honest candidate", async ({ context }) => {
  const provider = await ScriptedProvider.install(context);
  const firstPage = await context.newPage();
  const secondPage = await context.newPage();
  await installClock(firstPage);
  await installClock(secondPage);
  const config = configuration({ place: "Two open owners" });
  const artifactID = await harness.createStored(config);
  const firstResponse = provider.hold(config);
  const firstFrame = await harness.open(firstPage, artifactID);
  await provider.saw(1);
  const secondResponse = provider.hold(config);
  const secondFrame = await harness.open(secondPage, artifactID);
  await provider.saw(2);

  const firstReleasedAfter = Date.parse(await firstFrame.evaluate(() => new Date().toISOString()));
  firstResponse.release();
  await expectReady(firstFrame, config.place);
  await expect.poll(async () => (await harness.read<WeatherConfiguration>(artifactID))?.forecast).not.toBeUndefined();
  const firstSaved = (await harness.read<WeatherConfiguration>(artifactID))!.forecast as WeatherForecast;
  expect(Date.parse(firstSaved.updatedAt)).toBeGreaterThanOrEqual(firstReleasedAfter);
  expect(Date.parse(firstSaved.updatedAt)).toBeLessThanOrEqual(Date.parse(await firstFrame.evaluate(() => new Date().toISOString())));
  await secondPage.clock.setFixedTime(new Date(captureClock().getTime() + 60_000));
  secondResponse.release();
  await expectReady(secondFrame, config.place);
  await expect.poll(async () => Date.parse(
    ((await harness.read<WeatherConfiguration>(artifactID))!.forecast as WeatherForecast).updatedAt,
  )).toBeGreaterThan(Date.parse(firstSaved.updatedAt));

  const laterSaved = capturedForecast(config, captureTime(90_000));
  laterSaved.current = { temperature: 3, condition: "rain", summary: "Rain", isDay: true };
  await firstPage.clock.setFixedTime(new Date(captureClock().getTime() + 120_000));
  expect(Date.parse(await firstFrame.evaluate(() => new Date().toISOString())))
    .toBeGreaterThan(Date.parse(laterSaved.updatedAt));
  await harness.set(artifactID, storeJSON({ ...config, forecast: laterSaved }));
  await expect.poll(async () => ((await harness.read<WeatherConfiguration>(artifactID))!.forecast as WeatherForecast).current.summary)
    .toBe("Rain");
  await expect(firstFrame.getByText("Rain", { exact: true })).toBeVisible();

  const futureSaved = structuredClone(laterSaved);
  futureSaved.updatedAt = captureTime(60 * 60_000);
  futureSaved.current = { temperature: -2, condition: "snow", summary: "Snow", isDay: true };
  await harness.set(artifactID, storeJSON({ ...config, forecast: futureSaved }));
  await expect(firstFrame.getByText(firstSaved.current.summary, { exact: true })).toBeVisible();
  provider.done();
});

// proofs/arch/templates/weather.md#^templates-weather-ac-cache
test("keeps successful results in memory when access or connection refuses the save", async ({ context }) => {
  const provider = await ScriptedProvider.install(context);
  const sharePage = await context.newPage();
  await installClock(sharePage);
  const shareConfig = configuration({ place: "Downgraded before save" });
  const shareID = await harness.createStored(shareConfig);
  const share = await harness.client.resources.share({ artifactID: shareID, access: "read-write" });
  const heldShare = provider.hold(shareConfig);
  const shareFrame = await harness.open(sharePage, shareID, share.shareID);
  await provider.saw(1);
  const shareConnection = harness.proxy.messages.filter(({ message }) => message.type === "subscribe").at(-1)!.connection;
  harness.proxy.holdServerMessages(shareConnection, (message) => message.type === "access");
  await harness.client.resources.share({ artifactID: shareID, access: "read" });
  await harness.proxy.waitFor(() => harness.proxy.heldServerMessageCount(shareConnection) > 0);
  harness.proxy.releaseServerMessages(shareConnection);
  await sharePage.clock.fastForward(1);
  heldShare.release();
  await expectReady(shareFrame, shareConfig.place);
  await heldShare.finished;
  expect((await harness.read<WeatherConfiguration>(shareID))?.forecast).toBeUndefined();
  await sharePage.close();

  const ownerPage = await context.newPage();
  await installClock(ownerPage);
  const ownerConfig = configuration({ place: "Disconnected before save" });
  const ownerID = await harness.createStored(ownerConfig);
  const heldOwner = provider.hold(ownerConfig);
  const ownerFrame = await harness.open(ownerPage, ownerID);
  await provider.saw(2);
  harness.proxy.refuse(true);
  harness.proxy.sever();
  heldOwner.release();
  await expectReady(ownerFrame, ownerConfig.place);
  await heldOwner.finished;
  expect((await harness.read<WeatherConfiguration>(ownerID))?.forecast).toBeUndefined();
  const reconnectMessages = harness.proxy.messages.length;
  harness.proxy.refuse(false);
  await harness.proxy.waitFor(() => harness.proxy.openWebSockets > 0);
  await ownerPage.clock.fastForward(60_000);
  expect(harness.proxy.messages.slice(reconnectMessages).filter(({ message }) => message.type === "write")).toEqual([]);
  expect((await harness.read<WeatherConfiguration>(ownerID))?.forecast).toBeUndefined();
  provider.done();
});

// proofs/arch/templates/weather.md#^templates-weather-ac-request-cycle
test("checks only while visible and times out one non-overlapping attempt", async ({ page, context }) => {
  const provider = await ScriptedProvider.install(context);
  await installClock(page);
  const config = configuration();
  provider.success(config);
  const artifactID = await harness.createStored(config);
  const frame = await harness.open(page, artifactID);
  await expectReady(frame, config.place);
  await provider.saw(1);

  const held = provider.hold(config);
  await setVisibility(frame, "hidden");
  await page.clock.fastForward(16 * 60_000);
  await harness.set(artifactID, storeJSON({
    ...await harness.read<WeatherConfiguration>(artifactID),
    place: "Hidden rename",
  }));
  await expect(frame.locator(".weather-header h1")).toHaveText("Hidden rename");
  expect(provider.requests).toHaveLength(1);
  await setVisibility(frame, "visible");
  await provider.saw(2);
  await page.clock.fastForward(9_900);
  expect(provider.requests).toHaveLength(2);
  await page.clock.fastForward(200);
  await expectReady(frame, "Hidden rename");
  const retry = provider.success(config);
  await page.clock.fastForward(14 * 60_000 + 49_000);
  expect(provider.requests).toHaveLength(2);
  await page.clock.fastForward(61_000);
  await provider.saw(3);
  await retry.finished;
  held.release();
  await held.finished;
  provider.done();
});

// proofs/arch/templates/weather.md#^templates-weather-ac-access
// proofs/ui/templates/weather.md#^weather-ui-ac-loading
// proofs/ui/templates/weather.md#^weather-ui-ac-failure
test("renders loading, empty and all uncached provider failures, then retries", async ({ context }) => {
  const provider = await ScriptedProvider.install(context);
  const loadingPage = await context.newPage();
  await installClock(loadingPage);
  const emptyID = await harness.createStored();
  harness.proxy.hold("to-browser");
  const opening = harness.open(loadingPage, emptyID);
  await harness.proxy.waitFor(() => harness.proxy.openWebSockets > 0);
  const loadingFrame = await opening;
  await expectLoading(loadingFrame);
  expect(provider.requests).toHaveLength(0);
  harness.proxy.release("to-browser");
  await expectEmpty(loadingFrame);
  await loadingPage.close();

  const fetchPage = await context.newPage();
  await installClock(fetchPage);
  const fetchConfig = configuration({ place: "First provider result" });
  const heldFetch = provider.hold(fetchConfig);
  const fetchID = await harness.createStored(fetchConfig);
  const fetchFrame = await harness.open(fetchPage, fetchID);
  await expectLoading(fetchFrame);
  heldFetch.release();
  await expectReady(fetchFrame, fetchConfig.place);
  await fetchPage.close();

  for (const mode of ["http", "malformed", "abort"] as const) {
    const page = await context.newPage();
    await installClock(page);
    const config = configuration({ place: `Failure ${mode}` });
    const requestURL = buildOpenMeteoRequest(config).url;
    const requestsBefore = provider.requests.filter((url) => url === requestURL).length;
    if (mode === "http") provider.httpError(config);
    else if (mode === "malformed") provider.malformed(config);
    else provider.abort(config);
    const artifactID = await harness.createStored(config);
    const frame = await harness.open(page, artifactID);
    await expect(frame.getByRole("status", { name: "Forecast unavailable" })).toBeVisible();
    await expect(frame.getByText("Weather couldn't be updated. It will try again in about 15 minutes.")).toBeVisible();
    await expect(frame.locator(".weather-credit")).toHaveCount(0);
    expect((await harness.read<WeatherConfiguration>(artifactID))?.forecast).toBeUndefined();
    if (mode === "http") {
      provider.success(config);
      await page.clock.fastForward(14 * 60_000 + 59_000);
      expect(provider.requests.filter((url) => url === requestURL)).toHaveLength(requestsBefore + 1);
      await page.clock.fastForward(62_000);
      await expectReady(frame, config.place);
    }
    await page.close();
  }

  const page = await context.newPage();
  await installClock(page);
  const saved = capturedForecast(configuration(), captureTime(-3 * 60 * 60_000));
  const withSaved = configuration({ place: "Saved after failure", forecast: saved });
  const failed = provider.abort(withSaved);
  const savedID = await harness.createStored(withSaved);
  const savedFrame = await harness.open(page, savedID);
  await failed.finished;
  await expectReady(savedFrame, withSaved.place);
  await expect(savedFrame.getByText("Forecast unavailable", { exact: true })).toHaveCount(0);
  expect((await harness.read<WeatherConfiguration>(savedID))?.forecast).toEqual(saved);
  provider.done();
});

// proofs/arch/templates/weather.md#^templates-weather-ac-cache
// proofs/arch/templates/weather.md#^templates-weather-ac-access
// proofs/ui/templates/weather.md#^weather-ui-ac-access
test("keeps read-only, disconnected and revoked forecasts in memory without saving", async ({ context }) => {
  const provider = await ScriptedProvider.install(context);

  const readPage = await context.newPage();
  await installClock(readPage);
  const readConfig = configuration({ place: "Read only" });
  const readID = await harness.createStored(readConfig);
  const readShare = await harness.client.resources.share({ artifactID: readID, access: "read" });
  const readRequestCount = provider.requests.length;
  provider.success(readConfig);
  const readFrame = await harness.open(readPage, readID, readShare.shareID);
  await expectReady(readFrame, readConfig.place);
  expect((await harness.read<WeatherConfiguration>(readID))?.forecast).toBeUndefined();
  provider.success(readConfig);
  await readPage.clock.fastForward(5 * 60_000);
  expect(provider.requests).toHaveLength(readRequestCount + 1);
  await readPage.clock.fastForward(9 * 60_000 + 59_000);
  expect(provider.requests).toHaveLength(readRequestCount + 1);
  await readPage.clock.fastForward(62_000);
  await provider.saw(readRequestCount + 2);
  expect((await harness.read<WeatherConfiguration>(readID))?.forecast).toBeUndefined();
  await readPage.close();

  const revokedPage = await context.newPage();
  await installClock(revokedPage);
  const revokedConfig = configuration({ place: "Revoked but live" });
  const revokedID = await harness.createStored(revokedConfig);
  const revokedShare = await harness.client.resources.share({ artifactID: revokedID, access: "read-write" });
  const revokedRequestCount = provider.requests.length;
  const held = provider.hold(revokedConfig);
  const revokedFrame = await harness.open(revokedPage, revokedID, revokedShare.shareID);
  await expectLoading(revokedFrame);
  await harness.client.resources.unshare({ artifactID: revokedID });
  await settleRevocation(revokedPage);
  held.release();
  await expectReady(revokedFrame, revokedConfig.place);
  expect((await harness.read<WeatherConfiguration>(revokedID))?.forecast).toBeUndefined();
  provider.success(revokedConfig);
  await revokedPage.clock.fastForward(16 * 60_000);
  await provider.saw(revokedRequestCount + 2);
  expect((await harness.read<WeatherConfiguration>(revokedID))?.forecast).toBeUndefined();
  await revokedPage.close();

  const ownerPage = await context.newPage();
  await installClock(ownerPage);
  const ownerConfig = configuration({ place: "Owner offline" });
  provider.success(ownerConfig);
  const ownerID = await harness.createStored(ownerConfig);
  const ownerFrame = await harness.open(ownerPage, ownerID);
  await expectReady(ownerFrame, ownerConfig.place);
  const storedBefore = (await harness.read<WeatherConfiguration>(ownerID))?.forecast;
  const shownBefore = await cardState(ownerFrame);
  harness.proxy.refuse(true);
  harness.proxy.sever();
  const changedCapture = captureWithCurrent("current-success.json", {
    temperature: (storedBefore as WeatherForecast).current.temperature + 9,
    weatherCode: (storedBefore as WeatherForecast).current.condition === "rain" ? 71 : 61,
    isDay: (storedBefore as WeatherForecast).current.isDay ? 0 : 1,
  });
  const refreshed = provider.success(ownerConfig, changedCapture);
  await ownerPage.clock.fastForward(16 * 60_000);
  await expectReady(ownerFrame, ownerConfig.place);
  await refreshed.finished;
  const shownAfter = await cardState(ownerFrame);
  expect(shownAfter).not.toEqual(shownBefore);
  const expectedRefresh = normalizeOpenMeteoResponse(changedCapture.response.body, ownerConfig, captureTime(16 * 60_000));
  expect(shownAfter).toMatchObject({
    condition: expectedRefresh?.current.condition,
    summary: expectedRefresh?.current.summary,
    temperature: degree(expectedRefresh!.current.temperature),
  });
  expect((await harness.read<WeatherConfiguration>(ownerID))?.forecast).toEqual(storedBefore);
  const moved = configuration({ place: "Caught up", latitude: 38.2 });
  await harness.set(ownerID, moved);
  provider.success(moved);
  harness.proxy.refuse(false);
  await expectReady(ownerFrame, moved.place);
  await expect.poll(() => harness.read<WeatherConfiguration>(ownerID)).toMatchObject({
    place: "Caught up",
    forecast: { latitude: 38.2 },
  });
  provider.done();
});

// proofs/arch/templates/weather.md#^templates-weather-ac-access
// proofs/ui/templates/weather.md#^weather-ui-ac-access
test("keeps loading before the first result and preserves empty or unreadable state after revocation", async ({ context }) => {
  const provider = await ScriptedProvider.install(context);

  const disconnectedPage = await context.newPage();
  await installClock(disconnectedPage);
  const disconnectedID = await harness.createStored(configuration({ place: "Not received" }));
  harness.proxy.hold("to-browser");
  const disconnectedFrame = await harness.open(disconnectedPage, disconnectedID);
  await harness.proxy.waitFor(() => harness.proxy.openWebSockets > 0);
  harness.proxy.refuse(true);
  harness.proxy.sever();
  await expect.poll(() => harness.proxy.openWebSockets).toBe(0);
  await expectLoading(disconnectedFrame);
  await disconnectedPage.close();
  harness.proxy.refuse(false);
  harness.proxy.release("to-browser");

  const revokedPage = await context.newPage();
  await installClock(revokedPage);
  const revokedID = await harness.createStored(configuration({ place: "Revoked before value" }));
  const revokedShare = await harness.client.resources.share({ artifactID: revokedID, access: "read" });
  harness.proxy.hold("to-server");
  const revokedFrame = await harness.open(revokedPage, revokedID, revokedShare.shareID);
  await harness.client.resources.unshare({ artifactID: revokedID });
  harness.proxy.release("to-server");
  await settleRevocation(revokedPage, 60_000);
  await expectLoading(revokedFrame);
  await revokedPage.close();

  const emptyPage = await context.newPage();
  await installClock(emptyPage);
  const emptyID = await harness.createStored();
  const emptyShare = await harness.client.resources.share({ artifactID: emptyID, access: "read" });
  const emptyFrame = await harness.open(emptyPage, emptyID, emptyShare.shareID);
  await expectEmpty(emptyFrame);
  await harness.client.resources.unshare({ artifactID: emptyID });
  await harness.set(emptyID, configuration({ place: "Must not arrive" }));
  await settleRevocation(emptyPage, 60_000);
  await expectEmpty(emptyFrame);
  await emptyPage.close();

  const unreadablePage = await context.newPage();
  await installClock(unreadablePage);
  const unreadableID = await harness.createStored();
  await harness.set(unreadableID, { place: 4 } as never);
  const unreadableShare = await harness.client.resources.share({ artifactID: unreadableID, access: "read" });
  const unreadableFrame = await harness.open(unreadablePage, unreadableID, unreadableShare.shareID);
  await expect(unreadableFrame.getByRole("alert")).toContainText("This forecast can't be shown");
  await harness.client.resources.unshare({ artifactID: unreadableID });
  await harness.set(unreadableID, configuration({ place: "Must stay unreadable" }));
  await settleRevocation(unreadablePage, 60_000);
  await expect(unreadableFrame.getByRole("alert")).toContainText("This forecast can't be shown");
  expect(provider.requests).toEqual([]);
  provider.done();
});

// proofs/arch/templates/weather.md#^templates-weather-ac-access
// proofs/ui/templates/weather.md#^weather-ui-ac-access
test("lets a revoked configured card recover and continue refreshing without writes", async ({ page, context }) => {
  const provider = await ScriptedProvider.install(context);
  await installClock(page);
  const stale = capturedForecast(configuration(), captureTime(-3 * 60 * 60_000));
  stale.current = { temperature: 1, condition: "rain", summary: "Rain", isDay: false };
  const config = configuration({ place: "Revoked refresh", forecast: stale });
  const artifactID = await harness.createStored(config);
  const share = await harness.client.resources.share({ artifactID, access: "read-write" });
  const first = provider.hold(config);
  const frame = await harness.open(page, artifactID, share.shareID);
  await expect(frame.getByText("Rain", { exact: true })).toBeVisible();
  await provider.saw(1);
  await harness.client.resources.unshare({ artifactID });
  await settleRevocation(page);
  first.release();
  const expected = capturedForecast(config, captureTime());
  await expect(frame.getByText(expected.current.summary, { exact: true })).toBeVisible();
  expect((await harness.read<WeatherConfiguration>(artifactID))?.forecast).toEqual(stale);

  provider.success(config);
  await page.clock.fastForward(16 * 60_000);
  await provider.saw(2);
  await expectReady(frame, config.place);
  expect((await harness.read<WeatherConfiguration>(artifactID))?.forecast).toEqual(stale);
  provider.done();
});

// proofs/arch/templates/weather.md#^templates-weather-ac-access
// proofs/ui/templates/weather.md#^weather-ui-ac-access
test("retries an uncached failure after revocation for the retained configured location", async ({ page, context }) => {
  const provider = await ScriptedProvider.install(context);
  await installClock(page);
  const config = configuration({ place: "Revoked failure" });
  const artifactID = await harness.createStored(config);
  const share = await harness.client.resources.share({ artifactID, access: "read-write" });
  provider.abort(config);
  const frame = await harness.open(page, artifactID, share.shareID);
  await expect(frame.getByRole("status", { name: "Forecast unavailable" })).toBeVisible();
  await harness.client.resources.unshare({ artifactID });
  await settleRevocation(page);
  provider.success(config);
  await page.clock.fastForward(16 * 60_000);
  await expectReady(frame, config.place);
  expect((await harness.read<WeatherConfiguration>(artifactID))?.forecast).toBeUndefined();
  provider.done();
});

// proofs/ui/templates/weather.md#^weather-ui-ac-invalid
test("ignores bad caches, rejects unreadable roots, and recovers after real store unavailability", async ({ page, context }) => {
  const provider = await ScriptedProvider.install(context);
  await installClock(page);
  const config = configuration({ forecast: { bad: true } });
  provider.success(config);
  const artifactID = await harness.createStored(config);
  const frame = await harness.open(page, artifactID);
  await expectReady(frame, config.place);
  await expect.poll(() => harness.read<WeatherConfiguration>(artifactID)).toMatchObject({
    forecast: { units: "celsius" },
  });

  await harness.set(artifactID, { ...configuration(), latitude: "wrong" } as never);
  await expect(frame.getByRole("alert")).toContainText("This forecast can't be shown");
  await expect(frame.getByText("Its saved data isn't in the form this page reads. Ask your agent to check it.")).toBeVisible();
  await expect(frame.locator(".weather-credit")).toHaveCount(0);
  const requestsBeforeRepair = provider.requests.length;
  await harness.set(artifactID, {});
  await expectEmpty(frame);
  expect(provider.requests).toHaveLength(requestsBeforeRepair);

  const repaired = configuration();
  provider.success(repaired);
  await harness.set(artifactID, repaired);
  await expectReady(frame, repaired.place);
  const requestCount = provider.requests.length;
  const late = provider.hold(repaired);
  await page.clock.fastForward(16 * 60_000);
  await provider.saw(requestCount + 1);
  const file = harness.contentFile(artifactID);
  const original = readFileSync(file);
  await harness.restart(() => writeFileSync(file, "{damaged json"));
  await expect(frame.getByRole("alert")).toContainText("This forecast can't be shown");
  late.release();
  await late.finished;
  await expect(frame.locator(".weather-header")).toHaveCount(0);
  provider.success(repaired);
  await harness.restart(() => writeFileSync(file, original));
  await expectReady(frame, repaired.place);
  provider.done();
});

// proofs/ui/templates/weather.md#^weather-ui-ac-current
// proofs/ui/templates/weather.md#^weather-ui-ac-fixed-condition-day-night
test("renders current values and takes only clear, partly-cloudy and thunderstorm day-night artwork from isDay", async ({ page, context }) => {
  const provider = await ScriptedProvider.install(context);

  const actualPage = await context.newPage();
  await actualPage.setViewportSize({ width: 760, height: 740 });
  const shifted = shiftedCaptureForNow();
  const actualConfig = configuration({ place: "Actual-clock fetch" });
  const actualResponse = provider.success(actualConfig, shifted);
  const actualID = await harness.createStored(actualConfig);
  const actualFrame = await harness.open(actualPage, actualID);
  await expectReady(actualFrame, actualConfig.place);
  await actualResponse.finished;
  await expect.poll(() => harness.read<WeatherConfiguration>(actualID)).toMatchObject({
    forecast: { units: "celsius", current: expect.any(Object) },
  });
  const actualSaved = (await harness.read<WeatherConfiguration>(actualID))?.forecast as WeatherForecast;
  const actualExpected = normalizeOpenMeteoResponse(shifted.response.body, actualConfig, actualSaved.updatedAt)!;
  expect(actualSaved).toEqual(actualExpected);
  await expect(actualFrame.locator(".weather-header p")).toContainText("Updated now");
  await expect(actualFrame.locator(".weather-temperature")).toContainText(degree(actualExpected.current.temperature));
  await actualPage.close();

  await installClock(page);
  await page.setViewportSize({ width: 760, height: 740 });
  const base = capturedForecast(configuration(), captureTime(-5 * 60_000));
  base.current = { temperature: -0.4, condition: "partly-cloudy", summary: "Partly cloudy", isDay: false };
  base.hourly = base.hourly.map((hour) => ({ ...hour, temperature: 2.5, condition: "partly-cloudy", isDay: true }));
  const currentDay = getDailyWindow(base, captureClock())[0];
  if (!currentDay) throw new Error("Everyday capture has no current daily entry");
  base.daily = base.daily.map((day) => day.date === currentDay.date ? { ...day, high: 3.5, low: -1.5 } : day);
  const config = configuration({ place: "Night values", forecast: base });
  const artifactID = await harness.createStored(config);
  const frame = await harness.open(page, artifactID);
  await expectReady(frame, config.place);
  await expect(frame.locator(".weather-temperature")).toContainText("0°");
  await expect(frame.locator(".weather-current-glyph img")).toHaveAttribute("src", "./artwork.svg#partly-cloudy-night");
  await expect(frame.locator(".weather-hour").first().locator("img")).toHaveAttribute("src", "./artwork.svg#partly-cloudy-night");
  await expect(frame.locator(".weather-hour").nth(1).locator("img")).toHaveAttribute("src", "./artwork.svg#partly-cloudy-day");
  await expect(frame.locator(".weather-hour").nth(1).locator("strong")).toHaveText("3°");
  await expect(frame.locator(".weather-high-low")).toHaveText("H:4°L:−2°");
  await expect(frame.locator(".weather-day").first().locator(".weather-day-low")).toHaveText("−2°");
  await expect(frame.locator(".weather-day").first().locator(".weather-day-high")).toHaveText("4°");
  await expect(frame.locator(".weather-header p")).toContainText("Updated 5 mins ago");

  const partlyCloudyDay = structuredClone(base);
  partlyCloudyDay.current.isDay = true;
  await replaceStoreAndWait(frame, () => harness.set(
    artifactID,
    configuration({ place: "Partly cloudy day", forecast: partlyCloudyDay }),
  ));
  await expect(frame.locator(".weather-current-glyph img")).toHaveAttribute("src", "./artwork.svg#partly-cloudy-day");
  await expect(frame.locator(".weather-hour").first().locator("img")).toHaveAttribute("src", "./artwork.svg#partly-cloudy-day");
  await expect(frame.locator(".weather-hour").nth(1).locator("img")).toHaveAttribute("src", "./artwork.svg#partly-cloudy-day");

  await page.setViewportSize({ width: 700, height: 540 });

  for (const condition of ["cloudy", "rain", "snow", "fog", "thunderstorm"] as const) {
    const day = structuredClone(base);
    day.current = { temperature: 8, condition, summary: condition, isDay: true };
    day.hourly = day.hourly.map((hour) => ({ ...hour, condition, isDay: true }));
    await replaceStoreAndWait(frame, () => harness.set(artifactID, configuration({ place: condition, forecast: day })));
    await expectReady(frame, condition);
    const daySignature = await frame.locator(".weather-card").evaluate((card) => ({
      background: getComputedStyle(card).backgroundImage,
      before: getComputedStyle(card, "::before").backgroundImage,
      after: getComputedStyle(card, "::after").backgroundImage,
    }));
    const dayPixels = await frame.locator(".weather-page").screenshot({ animations: "disabled" });
    await expect(frame.locator(".weather-current-glyph img")).toHaveAttribute("src", `./artwork.svg#${condition}`);
    await expect(frame.locator(".weather-hour").nth(1).locator("img")).toHaveAttribute("src", `./artwork.svg#${condition}`);

    const night = structuredClone(day);
    night.current.isDay = false;
    night.hourly = night.hourly.map((hour) => ({ ...hour, isDay: false }));
    await replaceStoreAndWait(frame, () => harness.set(artifactID, configuration({ place: condition, forecast: night })));
    await expectReady(frame, condition);
    expect(await frame.locator(".weather-card").evaluate((card) => ({
      background: getComputedStyle(card).backgroundImage,
      before: getComputedStyle(card, "::before").backgroundImage,
      after: getComputedStyle(card, "::after").backgroundImage,
    }))).toEqual(daySignature);
    expect(await frame.locator(".weather-page").screenshot({ animations: "disabled" })).toEqual(dayPixels);
    await expect(frame.locator(".weather-current-glyph img")).toHaveAttribute("src", `./artwork.svg#${condition}`);
    await expect(frame.locator(".weather-hour").nth(1).locator("img")).toHaveAttribute("src", `./artwork.svg#${condition}`);
  }

  const noToday = structuredClone(base);
  noToday.daily = noToday.daily.filter((day) => day.date !== currentDay.date);
  await replaceStoreAndWait(frame, () => harness.set(
    artifactID,
    configuration({ place: "No current daily row", forecast: noToday }),
  ));
  await expect(frame.locator(".weather-high-low")).toHaveCount(0);
  expect(provider.requests).toHaveLength(1);
  provider.done();
});

// proofs/ui/templates/weather.md#^weather-ui-ac-current
test("renders completed English age units and treats future clock skew as now", async ({ context }) => {
  const provider = await ScriptedProvider.install(context);
  const now = captureClock().getTime();
  const cases = [
    [new Date(now - 60_000).toISOString(), "Updated 1 min ago", false],
    [new Date(now - 2 * 60_000).toISOString(), "Updated 2 mins ago", false],
    [new Date(now - 60 * 60_000).toISOString(), "Updated 1 hr ago", true],
    [new Date(now - 2 * 60 * 60_000).toISOString(), "Updated 2 hrs ago", true],
    [new Date(now - 24 * 60 * 60_000).toISOString(), "Updated 1 day ago", true],
    [new Date(now - 2 * 24 * 60 * 60_000).toISOString(), "Updated 2 days ago", true],
    [new Date(now + 60_000).toISOString(), "Updated now", true],
  ] as const;

  for (const [updatedAt, expected, refreshes] of cases) {
    const page = await context.newPage();
    await installClock(page);
    const config = configuration({
      place: expected,
      forecast: capturedForecast(configuration(), updatedAt),
    });
    if (refreshes) provider.abort(config);
    const artifactID = await harness.createStored(config);
    const frame = await harness.open(page, artifactID);
    await expect(frame.locator(".weather-header p")).toContainText(expected);
    await page.close();
  }
  provider.done();
});

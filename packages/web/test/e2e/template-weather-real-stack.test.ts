import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Frame, type Route } from "@playwright/test";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import {
  buildOpenMeteoRequest,
  normalizeOpenMeteoResponse,
} from "../../../server/assets/templates/weather/provider.js";
import type {
  Units,
  WeatherConfiguration,
  WeatherForecast,
} from "../../../server/assets/templates/weather/model.js";
import { TemplateHarness, TEST_HOST_LAUNCH } from "./template-harness.ts";

const NOW = "2026-10-27T17:01:00.000Z";
const API_HOST = "api.open-meteo.com";
const FIXTURES = path.resolve(import.meta.dirname, "../../../../test/fixtures/weather/open-meteo");
const WEATHER_SOURCE = path.resolve(import.meta.dirname, "../../../server/assets/templates/weather");

type Capture = {
  request: { method: string; url: string; headers: Record<string, string> };
  response: { status: number; headers: Record<string, string>; body: unknown };
};

type ProviderMode = "success" | "abort" | "malformed";

interface ProviderStep {
  configuration: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">;
  capture: Capture;
  mode: ProviderMode;
  gate?: Promise<void>;
}

interface HeldResponse {
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

  success(configuration: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">, name = captureName(configuration.units)): void {
    this.steps.push({ configuration, capture: fixture(name), mode: "success" });
  }

  hold(configuration: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">, name = captureName(configuration.units)): HeldResponse {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.steps.push({ configuration, capture: fixture(name), mode: "success", gate });
    return { release };
  }

  abort(configuration: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">): void {
    this.steps.push({ configuration, capture: fixture(captureName(configuration.units)), mode: "abort" });
  }

  malformed(configuration: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">): void {
    this.steps.push({ configuration, capture: fixture(captureName(configuration.units)), mode: "malformed" });
  }

  httpError(configuration: Pick<WeatherConfiguration, "latitude" | "longitude" | "units">): void {
    this.steps.push({
      configuration,
      capture: fixture("error-latitude-out-of-range.json"),
      mode: "success",
    });
  }

  async saw(count: number): Promise<void> {
    await expect.poll(() => this.requests.length).toBe(count);
  }

  done(): void {
    expect(this.steps, "all scripted provider responses were consumed").toHaveLength(0);
    expect(this.errors, "every provider request matched its script").toEqual([]);
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
    }
  }
}

function fixture(name: string): Capture {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")) as Capture;
}

function captureName(units: Units): string {
  return units === "fahrenheit" ? "current-success-fahrenheit.json" : "current-success.json";
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

async function installClock(frameOwner: { clock: { install(input: { time: Date }): Promise<void> } }): Promise<void> {
  await frameOwner.clock.install({ time: new Date(NOW) });
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
  await harness.set(artifactID, { retained: true }, "extra");
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
  expect((newest?.forecast as WeatherForecast).hourly).toHaveLength(24);
  expect(await frame.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  toolboxWeatherID = artifactID;
  toolboxWeatherConfiguration = newest!;
  provider.done();
});

// proofs/arch/templates/weather.md#^templates-weather-ac-request-cycle
test("keeps checking an unselected Television page whose document is visible", async ({ page, context }) => {
  const provider = await ScriptedProvider.install(context);
  await page.clock.install({ time: new Date("2026-10-27T17:02:00.000Z") });
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
      forecast: capturedForecast(configuration(), "2026-10-27T16:45:00.000Z"),
    });
    const artifactID = await harness.createStored(original);
    const requestCount = provider.requests.length;
    const old = provider.hold(original);
    const frame = await harness.open(page, artifactID);
    await provider.saw(requestCount + 1);
    const changed = { ...original, [field]: value } as WeatherConfiguration;
    delete changed.forecast;
    const next = provider.hold(changed);
    await harness.set(artifactID, storeJSON(changed));
    await expectLoading(frame);
    await expect.poll(() => provider.requests.length).toBeGreaterThanOrEqual(2);
    next.release();
    await expectReady(frame, changed.place);
    await expect.poll(() => harness.read<WeatherConfiguration>(artifactID)).toMatchObject({
      [field]: value,
      forecast: { [field]: value },
    });
    old.release();
    await page.waitForTimeout(30);
    expect(await harness.read(artifactID)).toMatchObject({ [field]: value, forecast: { [field]: value } });
    await page.close();
  }

  const page = await context.newPage();
  await installClock(page);
  const stale = capturedForecast(configuration(), "2026-10-27T16:44:00.000Z");
  stale.current = { temperature: 1, condition: "rain", summary: "Heavy rain", isDay: false };
  stale.hourly = stale.hourly.map((hour) => ({ ...hour, temperature: 2, condition: "rain" }));
  stale.daily = stale.daily.map((day) => ({ ...day, condition: "rain", high: 4, low: 0 }));
  const config = configuration({ forecast: stale });
  const artifactID = await harness.createStored(config);
  const held = provider.hold(config);
  const frame = await harness.open(page, artifactID);
  await expect(frame.locator(".weather-temperature")).toContainText("1");
  await expect(frame.getByText("Heavy rain", { exact: true })).toBeVisible();
  await expect(frame.getByRole("status", { name: "Loading weather" })).toHaveCount(0);
  held.release();
  await expect(frame.getByText("Overcast", { exact: true })).toBeVisible();
  await expect(frame.locator(".weather-temperature")).not.toContainText(/^1°?$/);
  await expect.poll(() => harness.read<WeatherConfiguration>(artifactID)).toMatchObject({
    forecast: { current: { condition: "cloudy" } },
  });
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

  firstResponse.release();
  await expectReady(firstFrame, config.place);
  await expect.poll(async () => (await harness.read<WeatherConfiguration>(artifactID))?.forecast).not.toBeUndefined();
  const firstSaved = (await harness.read<WeatherConfiguration>(artifactID))!.forecast as WeatherForecast;
  expect(firstSaved.updatedAt).toMatch(/^2026-10-27T17:01:/);
  await secondPage.clock.setFixedTime(new Date("2026-10-27T17:02:00.000Z"));
  secondResponse.release();
  await expectReady(secondFrame, config.place);
  await expect.poll(async () => Date.parse(
    ((await harness.read<WeatherConfiguration>(artifactID))!.forecast as WeatherForecast).updatedAt,
  )).toBeGreaterThan(Date.parse(firstSaved.updatedAt));

  const laterSaved = capturedForecast(config, "2026-10-27T17:02:30.000Z");
  laterSaved.current = { temperature: 3, condition: "rain", summary: "Rain", isDay: true };
  await firstPage.clock.setFixedTime(new Date("2026-10-27T17:03:00.000Z"));
  expect(Date.parse(await firstFrame.evaluate(() => new Date().toISOString())))
    .toBeGreaterThan(Date.parse(laterSaved.updatedAt));
  await harness.set(artifactID, storeJSON({ ...config, forecast: laterSaved }));
  await expect.poll(async () => ((await harness.read<WeatherConfiguration>(artifactID))!.forecast as WeatherForecast).current.summary)
    .toBe("Rain");
  await expect(firstFrame.getByText("Rain", { exact: true })).toBeVisible();

  const futureSaved = structuredClone(laterSaved);
  futureSaved.updatedAt = "2026-10-27T18:00:00.000Z";
  futureSaved.current = { temperature: -2, condition: "snow", summary: "Snow", isDay: true };
  await harness.set(artifactID, storeJSON({ ...config, forecast: futureSaved }));
  await expect(firstFrame.getByText("Overcast", { exact: true })).toBeVisible();
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
  await sharePage.waitForTimeout(50);
  heldShare.release();
  await expectReady(shareFrame, shareConfig.place);
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
  expect((await harness.read<WeatherConfiguration>(ownerID))?.forecast).toBeUndefined();
  harness.proxy.refuse(false);
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
  expect(provider.requests).toHaveLength(1);
  await setVisibility(frame, "visible");
  await provider.saw(2);
  await page.clock.fastForward(9_900);
  expect(provider.requests).toHaveLength(2);
  await page.clock.fastForward(200);
  await expectReady(frame, "Hidden rename");
  await page.clock.fastForward(14 * 60_000);
  expect(provider.requests).toHaveLength(2);
  held.release();
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
  const saved = capturedForecast(configuration(), "2026-10-27T14:01:00.000Z");
  const withSaved = configuration({ place: "Saved after failure", forecast: saved });
  provider.abort(withSaved);
  const savedID = await harness.createStored(withSaved);
  const savedFrame = await harness.open(page, savedID);
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
  await readPage.clock.fastForward(16 * 60_000);
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
  harness.proxy.refuse(true);
  harness.proxy.sever();
  provider.success(ownerConfig);
  await ownerPage.clock.fastForward(16 * 60_000);
  await expectReady(ownerFrame, ownerConfig.place);
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
  await expectLoading(revokedFrame);
  await revokedPage.close();

  const emptyPage = await context.newPage();
  await installClock(emptyPage);
  const emptyID = await harness.createStored();
  const emptyShare = await harness.client.resources.share({ artifactID: emptyID, access: "read" });
  const emptyFrame = await harness.open(emptyPage, emptyID, emptyShare.shareID);
  await expectEmpty(emptyFrame);
  await harness.client.resources.unshare({ artifactID: emptyID });
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
  await expect(unreadableFrame.getByRole("alert")).toContainText("This forecast can't be shown");
  expect(provider.requests).toEqual([]);
  provider.done();
});

// proofs/arch/templates/weather.md#^templates-weather-ac-access
// proofs/ui/templates/weather.md#^weather-ui-ac-access
test("lets a revoked configured card recover and continue refreshing without writes", async ({ page, context }) => {
  const provider = await ScriptedProvider.install(context);
  await installClock(page);
  const stale = capturedForecast(configuration(), "2026-10-27T14:01:00.000Z");
  stale.current = { temperature: 1, condition: "rain", summary: "Rain", isDay: false };
  const config = configuration({ place: "Revoked refresh", forecast: stale });
  const artifactID = await harness.createStored(config);
  const share = await harness.client.resources.share({ artifactID, access: "read-write" });
  const first = provider.hold(config);
  const frame = await harness.open(page, artifactID, share.shareID);
  await expect(frame.getByText("Rain", { exact: true })).toBeVisible();
  await provider.saw(1);
  await harness.client.resources.unshare({ artifactID });
  first.release();
  await expect(frame.getByText("Overcast", { exact: true })).toBeVisible();
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
  await page.waitForTimeout(50);
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
  await installClock(page);
  await page.setViewportSize({ width: 760, height: 740 });
  const base = capturedForecast(configuration(), "2026-10-27T16:56:00.000Z");
  base.current = { temperature: -0.4, condition: "clear", summary: "Clear", isDay: false };
  base.hourly = base.hourly.map((hour) => ({ ...hour, temperature: 2.5, condition: "partly-cloudy", isDay: true }));
  base.daily = base.daily.map((day) => day.date === "2026-10-27" ? { ...day, high: 3.5, low: -1.5 } : day);
  const config = configuration({ place: "Night values", forecast: base });
  const artifactID = await harness.createStored(config);
  const frame = await harness.open(page, artifactID);
  await expectReady(frame, config.place);
  await expect(frame.locator(".weather-temperature")).toContainText("0°");
  await expect(frame.locator(".weather-current-glyph img")).toHaveAttribute("src", "./artwork.svg#clear-night");
  await expect(frame.locator(".weather-hour").first().locator("img")).toHaveAttribute("src", "./artwork.svg#clear-night");
  await expect(frame.locator(".weather-hour").nth(1).locator("img")).toHaveAttribute("src", "./artwork.svg#partly-cloudy-day");
  await expect(frame.locator(".weather-hour").nth(1).locator("strong")).toHaveText("3°");
  await expect(frame.locator(".weather-high-low")).toHaveText("H:4°L:−2°");
  await expect(frame.locator(".weather-day").first().locator(".weather-day-low")).toHaveText("−2°");
  await expect(frame.locator(".weather-day").first().locator(".weather-day-high")).toHaveText("4°");
  await expect(frame.locator(".weather-header p")).toContainText("Updated 5 mins ago");

  const clearDay = structuredClone(base);
  clearDay.current.isDay = true;
  await harness.set(artifactID, configuration({ place: "Clear day", forecast: clearDay }));
  await expect(frame.locator(".weather-current-glyph img")).toHaveAttribute("src", "./artwork.svg#clear-day");
  await expect(frame.locator(".weather-hour").first().locator("img")).toHaveAttribute("src", "./artwork.svg#clear-day");
  await expect(frame.locator(".weather-hour").nth(1).locator("img")).toHaveAttribute("src", "./artwork.svg#partly-cloudy-day");

  await page.setViewportSize({ width: 700, height: 540 });

  for (const condition of ["cloudy", "rain", "snow", "fog", "thunderstorm"] as const) {
    const day = structuredClone(base);
    day.current = { temperature: 8, condition, summary: condition, isDay: true };
    day.hourly = day.hourly.map((hour) => ({ ...hour, condition, isDay: true }));
    await harness.set(artifactID, configuration({ place: condition, forecast: day }));
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
    await harness.set(artifactID, configuration({ place: condition, forecast: night }));
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
  noToday.daily = noToday.daily.filter((day) => day.date !== "2026-10-27");
  await harness.set(artifactID, configuration({ place: "No current daily row", forecast: noToday }));
  await expect(frame.locator(".weather-high-low")).toHaveCount(0);
  expect(provider.requests).toEqual([]);
  provider.done();
});

// proofs/ui/templates/weather.md#^weather-ui-ac-current
test("renders completed English age units and treats future clock skew as now", async ({ context }) => {
  const provider = await ScriptedProvider.install(context);
  const cases = [
    ["2026-10-27T17:00:00.000Z", "Updated 1 min ago", false],
    ["2026-10-27T16:59:00.000Z", "Updated 2 mins ago", false],
    ["2026-10-27T16:01:00.000Z", "Updated 1 hr ago", true],
    ["2026-10-27T15:01:00.000Z", "Updated 2 hrs ago", true],
    ["2026-10-26T17:01:00.000Z", "Updated 1 day ago", true],
    ["2026-10-25T17:01:00.000Z", "Updated 2 days ago", true],
    ["2026-10-27T17:02:00.000Z", "Updated now", true],
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

import { expect, test } from "@playwright/test";
import { conform } from "@telepath-computer/conform";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import type { Condition, WeatherConfiguration, WeatherForecast } from "../../../server/assets/templates/weather/model.js";
import { artifactURL, createArtifact, specStories, storybook, useConformance } from "./conformance-harness.ts";
import { TemplateHarness } from "./template-harness.ts";

const run = useConformance();
// Each comparison owns two Chromium pages and can capture a 900×780 root.
// Default mode keeps this file on one worker in declaration order without
// serial mode's group-wide skip and retry behavior.
test.describe.configure({ mode: "default" });
const DAY_NOW = "2026-10-27T10:30:00Z";
const NIGHT_NOW = "2026-10-27T22:30:00Z";
const COORDINATES = { latitude: 37.7749, longitude: -122.4194 };

type Units = WeatherConfiguration["units"];
type Current = WeatherForecast["current"];
type DailyInput = [high: number, low: number, condition: Condition];

interface ForecastInput {
  place: string;
  units: Units;
  ageMinutes: number;
  current: Current;
  hourlyTemperatures: number[];
  hourlyConditions: Condition[];
  daily: DailyInput[];
  night?: boolean;
  nightFrom?: number;
}

interface State {
  viewport: { width: number; height: number };
  value: JSONValue;
  now?: string;
  provider?: "none" | "fail";
  loading?: boolean;
}

interface CardPresentation {
  theme: string | undefined;
  themeSurface: string;
  background: string;
  color: string;
  scheme: string;
  overflow: string;
  className: string;
  condition: string | undefined;
  day: string | undefined;
  text: string | null;
  creditCount: number;
  size: [number, number];
}

function forecast(input: ForecastInput): WeatherConfiguration {
  const now = input.night ? NIGHT_NOW : DAY_NOW;
  const firstHour = Date.parse(input.night ? "2026-10-27T23:00:00Z" : "2026-10-27T11:00:00Z");
  const firstDay = Date.parse("2026-10-27T12:00:00Z");
  const forecast: WeatherForecast = {
    ...COORDINATES,
    units: input.units,
    timeZone: "UTC",
    updatedAt: new Date(Date.parse(now) - input.ageMinutes * 60_000).toISOString(),
    current: input.current,
    hourly: input.hourlyTemperatures.map((temperature, index) => ({
      time: new Date(firstHour + index * 3_600_000).toISOString(),
      temperature,
      condition: input.hourlyConditions[index % input.hourlyConditions.length]!,
      isDay: input.night ? false : index < (input.nightFrom ?? input.hourlyTemperatures.length + 1),
    })),
    daily: input.daily.map(([high, low, condition], index) => ({
      date: new Date(firstDay + index * 86_400_000).toISOString().slice(0, 10),
      high,
      low,
      condition,
    })),
  };
  return { place: input.place, ...COORDINATES, units: input.units, forecast };
}

const sanFrancisco = forecast({
  place: "San Francisco", units: "fahrenheit", ageMinutes: 12,
  current: { temperature: 68, condition: "clear", summary: "Clear", isDay: true },
  hourlyTemperatures: [68, 69, 70, 71, 72, 71, 69, 66, 63, 61, 59, 58],
  hourlyConditions: ["clear", "clear", "partly-cloudy"], nightFrom: 8,
  daily: [[72, 55, "clear"], [69, 54, "fog"], [67, 53, "partly-cloudy"], [64, 51, "rain"], [66, 50, "partly-cloudy"], [70, 52, "clear"], [71, 54, "clear"]],
});
const sedonaNight = forecast({
  place: "Sedona", units: "fahrenheit", ageMinutes: 4, night: true,
  current: { temperature: 52, condition: "clear", summary: "Clear", isDay: false },
  hourlyTemperatures: [52, 50, 48, 46, 45, 44, 43, 44], hourlyConditions: ["clear"],
  daily: [[67, 43, "clear"], [69, 44, "clear"], [66, 42, "partly-cloudy"]],
});
const edinburghNight = forecast({
  place: "Edinburgh", units: "celsius", ageMinutes: 8, night: true,
  current: { temperature: 8, condition: "partly-cloudy", summary: "Partly cloudy", isDay: false },
  hourlyTemperatures: [8, 8, 7, 7, 6, 6, 5, 5], hourlyConditions: ["partly-cloudy", "cloudy"],
  daily: [[11, 5, "partly-cloudy"], [10, 4, "cloudy"], [9, 3, "rain"]],
});
const seattle = forecast({
  place: "Seattle", units: "fahrenheit", ageMinutes: 8,
  current: { temperature: 57, condition: "cloudy", summary: "Overcast", isDay: true },
  hourlyTemperatures: [57, 58, 59, 60, 60, 59, 58, 57], hourlyConditions: ["cloudy", "cloudy", "rain"], nightFrom: 7,
  daily: [[60, 51, "cloudy"], [58, 49, "rain"], [61, 50, "partly-cloudy"]],
});
const portland = forecast({
  place: "Portland", units: "celsius", ageMinutes: 10,
  current: { temperature: 11, condition: "rain", summary: "Rain", isDay: true },
  hourlyTemperatures: [11, 11, 12, 12, 13, 12, 11, 10, 10, 9], hourlyConditions: ["rain", "rain", "cloudy"], nightFrom: 8,
  daily: [[13, 8, "rain"], [12, 7, "rain"], [14, 8, "cloudy"]],
});
const montreal = forecast({
  place: "Montréal", units: "celsius", ageMinutes: 12,
  current: { temperature: -11.5, condition: "snow", summary: "Light snow", isDay: true },
  hourlyTemperatures: [-12, -11, -10, -9, -8, -9, -11, -13], hourlyConditions: ["snow", "snow", "cloudy"], nightFrom: 7,
  daily: [[-8, -15, "snow"], [-10, -17, "snow"], [-7, -14, "cloudy"]],
});
const newOrleans = forecast({
  place: "New Orleans", units: "fahrenheit", ageMinutes: 5, night: true,
  current: { temperature: 76, condition: "thunderstorm", summary: "Thunderstorm", isDay: false },
  hourlyTemperatures: [76, 75, 74, 73, 73, 72, 72, 71, 71], hourlyConditions: ["thunderstorm", "rain"],
  daily: [[82, 70, "thunderstorm"], [80, 69, "rain"], [83, 71, "cloudy"], [86, 72, "partly-cloudy"], [87, 73, "clear"], [85, 72, "rain"], [84, 71, "cloudy"]],
});
const foggy = forecast({
  place: "Point Reyes", units: "fahrenheit", ageMinutes: 14,
  current: { temperature: 54, condition: "fog", summary: "Fog", isDay: true },
  hourlyTemperatures: [54, 55, 56, 58, 60, 61, 59, 57], hourlyConditions: ["fog", "fog", "partly-cloudy"], nightFrom: 7,
  daily: [[61, 50, "fog"], [63, 51, "fog"], [66, 52, "partly-cloudy"]],
});
const london = forecast({
  place: "London", units: "celsius", ageMinutes: 9,
  current: { temperature: 16, condition: "partly-cloudy", summary: "Partly cloudy", isDay: true },
  hourlyTemperatures: [15, 17, 18, 18, 17, 16, 15, 14, 13, 12, 12, 11], hourlyConditions: ["rain", "clear", "cloudy", "rain"], nightFrom: 8,
  daily: [[18, 10, "partly-cloudy"], [16, 9, "rain"], [14, 7, "rain"], [15, 6, "fog"], [17, 8, "clear"], [13, 4, "rain"], [15, 6, "thunderstorm"]],
});
const deathValley = forecast({
  place: "Death Valley", units: "fahrenheit", ageMinutes: 7,
  current: { temperature: 104, condition: "clear", summary: "Clear", isDay: true },
  hourlyTemperatures: [104, 106, 108, 107, 105, 101], hourlyConditions: ["clear"], nightFrom: 6,
  daily: [[108, 81, "clear"], [107, 80, "clear"]],
});

function withForecast(value: WeatherConfiguration, change: (forecast: WeatherForecast) => void): WeatherConfiguration {
  const copy = structuredClone(value);
  change(copy.forecast as WeatherForecast);
  return copy;
}

const small = { width: 340, height: 340 };
const minimum = { width: 230, height: 230 };
const medium = { width: 700, height: 540 };
const largeBoundary = { width: 760, height: 740 };
const large = { width: 900, height: 780 };
const wideShort = { width: 760, height: 300 };
const empty = {} as JSONValue;
const unavailable = { place: "San Francisco", ...COORDINATES, units: "fahrenheit" } as JSONValue;
const unreadable = { place: "Broken" } as JSONValue;

const states: Record<string, State> = {
  "clear-day": { viewport: small, value: sanFrancisco as unknown as JSONValue },
  "clear-night": { viewport: small, value: sedonaNight as unknown as JSONValue, now: NIGHT_NOW },
  "partly-cloudy-night": { viewport: small, value: edinburghNight as unknown as JSONValue, now: NIGHT_NOW },
  cloudy: { viewport: small, value: seattle as unknown as JSONValue },
  rain: { viewport: medium, value: portland as unknown as JSONValue },
  snow: { viewport: small, value: montreal as unknown as JSONValue },
  "thunderstorm-night": { viewport: medium, value: newOrleans as unknown as JSONValue, now: NIGHT_NOW },
  "thunderstorm-night-large": { viewport: large, value: newOrleans as unknown as JSONValue, now: NIGHT_NOW },
  fog: { viewport: small, value: foggy as unknown as JSONValue },
  "three-digit-temperature": { viewport: small, value: deathValley as unknown as JSONValue },
  "minimum-size": { viewport: minimum, value: deathValley as unknown as JSONValue },
  "wide-short": { viewport: wideShort, value: foggy as unknown as JSONValue },
  "no-current-day": { viewport: small, value: withForecast(sanFrancisco, (value) => { value.daily = value.daily.slice(1); }) as unknown as JSONValue },
  medium: { viewport: medium, value: london as unknown as JSONValue },
  large: { viewport: largeBoundary, value: london as unknown as JSONValue },
  "large-no-hourly": { viewport: largeBoundary, value: withForecast(london, (value) => { value.hourly = []; }) as unknown as JSONValue },
  "short-forecast": { viewport: large, value: withForecast(london, (value) => { value.daily = value.daily.slice(0, 4); }) as unknown as JSONValue },
  loading: { viewport: small, value: unavailable, loading: true },
  empty: { viewport: small, value: empty },
  "minimum-empty": { viewport: minimum, value: empty },
  "saved-after-failure": {
    viewport: small,
    value: withForecast(sanFrancisco, (value) => { value.updatedAt = new Date(Date.parse(DAY_NOW) - 2 * 3_600_000).toISOString(); }) as unknown as JSONValue,
    provider: "fail",
  },
  unavailable: { viewport: small, value: unavailable, provider: "fail" },
  unreadable: { viewport: small, value: unreadable },
  "minimum-unreadable": { viewport: minimum, value: unreadable },
  "dark-appearance": { viewport: small, value: sanFrancisco as unknown as JSONValue },
};

const stories = specStories("./spec/templates/weather/weather.stories.ts");
if (stories.length !== 25) throw new Error(`Expected 25 Weather stories, found ${stories.length}`);

// proofs/ui/templates/weather.md#^weather-ui-ac-conformance
for (const storyID of stories) {
  test(`Weather conforms: ${storyID}`, async () => {
    const key = storyID.replace("spec-templates-weather--", "");
    const state = states[key];
    expect(state, `No production state for Weather story ${storyID}`).toBeDefined();
    const artifactID = await createArtifact("weather", state!.value);
    if (state!.loading) run.proxy.hold("to-browser");
    let requests = 0;
    const reference = storybook.page(storyID);
    if (typeof reference === "string") throw new Error(`Storybook gave no page options for ${storyID}`);
    await conform({
      ...reference,
      ready: async (page) => {
        await reference.ready?.(page);
        await page.evaluate(() => document.fonts.ready);
      },
    }, {
      url: artifactURL(run.proxy, artifactID),
      setup: async (page) => {
        await page.clock.setFixedTime(new Date(state!.now ?? DAY_NOW));
        if (key === "dark-appearance") await page.emulateMedia({ colorScheme: "dark" });
        await page.route("https://api.open-meteo.com/**", async (route) => {
          requests += 1;
          await route.abort("failed");
        });
      },
      ready: async (page) => {
        if (state!.loading) {
          await run.proxy.waitFor(() => run.proxy.openWebSockets > 0);
          await page.getByRole("status", { name: "Loading weather" }).waitFor();
        } else if (key === "unavailable") {
          await page.getByRole("status", { name: "Forecast unavailable" }).waitFor();
        } else if (key.includes("unreadable")) {
          await page.getByRole("alert").waitFor();
        } else if (key === "empty" || key === "minimum-empty") {
          await page.getByRole("heading", { name: "No location yet" }).waitFor();
        } else {
          await page.locator(".weather-temperature").waitFor();
        }
        await page.evaluate(() => document.fonts.ready);
        if (state!.provider === "fail") await expect.poll(() => requests).toBe(1);
        else expect(requests).toBe(0);
      },
    }, { browser: run.browser, root: ".weather-page", ...state!.viewport });
  });
}

// proofs/ui/templates/weather.md#^weather-ui-ac-appearance
test("Weather keeps its sky composition and legibility in dark appearance with the bundled Nord theme", async () => {
  test.setTimeout(120_000);
  const harness = await TemplateHarness.start({ id: "weather", name: "Weather" }, { bundledThemes: true });
  try {
    const cases = [
      { value: sanFrancisco as unknown as JSONValue, provider: "none", state: "populated" },
      { value: empty, provider: "none", state: "empty" },
      { value: unavailable, provider: "hold", state: "loading" },
      { value: unavailable, provider: "fail", state: "unavailable" },
      { value: unreadable, provider: "none", state: "unreadable" },
    ] as const;
    const artifacts = await Promise.all(cases.map(({ value }) => harness.createStored(value)));
    const presentations = async (colorScheme: "light" | "dark") => {
      const results: CardPresentation[] = [];
      const context = await run.browser.newContext({ colorScheme });
      try {
        await context.clock.setFixedTime(new Date(DAY_NOW));
        for (const [{ provider, state }, index] of cases.map((entry, index) => [entry, index] as const)) {
          await test.step(`${colorScheme} ${state}`, async () => {
            const page = await context.newPage();
            try {
              await page.route("https://api.open-meteo.com/**", async (route) => {
                if (provider !== "hold") await route.abort("failed");
              });
              await page.setViewportSize(small);
              await harness.client.display.focus({ artifactID: artifacts[index]! });
              await harness.openApp(page);
              const frame = await harness.frame(page, artifacts[index]!);
              const marker = { state: "attached" as const, timeout: 10_000 };
              if (state === "populated") await frame.locator(".weather-temperature").waitFor(marker);
              if (state === "empty") await frame.getByRole("heading", { name: "No location yet" }).waitFor(marker);
              if (state === "loading") await frame.getByRole("status", { name: "Loading weather" }).waitFor(marker);
              if (state === "unavailable") await frame.getByRole("status", { name: "Forecast unavailable" }).waitFor(marker);
              if (state === "unreadable") await frame.getByRole("alert").waitFor(marker);
              const card = frame.locator(".weather-card");
              const actualState = await card.evaluate((node) => {
                const stateClass = [...node.classList].find((name) => name.startsWith("weather-card-") && name !== "weather-card-loading");
                return stateClass?.slice("weather-card-".length) ?? (node.classList.contains("weather-card-loading") ? "loading" : "populated");
              });
              expect(actualState).toBe(state);
              results.push(await card.evaluate((card) => {
                const box = card.getBoundingClientRect();
                return {
                  theme: document.documentElement.dataset.theme,
                  themeSurface: getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim(),
                  background: getComputedStyle(card).backgroundImage,
                  color: getComputedStyle(card).color,
                  scheme: getComputedStyle(card).colorScheme,
                  overflow: getComputedStyle(card).overflow,
                  className: card.className,
                  condition: (card as HTMLElement).dataset.condition,
                  day: (card as HTMLElement).dataset.day,
                  text: card.textContent,
                  creditCount: card.querySelectorAll(".weather-credit").length,
                  size: [box.width, box.height],
                };
              }));
            } finally {
              await page.close();
            }
          });
        }
      } finally {
        await context.close();
      }
      return results;
    };

    await harness.client.display.patch({ activeThemeName: null, appearanceMode: "light" });
    await expect.poll(async () => harness.client.display.get()).toMatchObject({
      activeThemeName: null,
      appearanceMode: "light",
    });
    const light = await presentations("light");
    await harness.client.display.patch({ activeThemeName: "nord", appearanceMode: "dark" });
    await expect.poll(async () => harness.client.display.get()).toMatchObject({
      activeThemeName: "nord",
      appearanceMode: "dark",
    });
    const dark = await presentations("dark");
    for (let index = 0; index < light.length; index += 1) {
      const { theme: lightTheme, themeSurface: lightSurface, scheme: lightScheme, ...lightCard } = light[index]!;
      const { theme: darkTheme, themeSurface: darkSurface, scheme: darkScheme, ...darkCard } = dark[index]!;
      expect(lightTheme).toBe("light");
      expect(lightScheme).toBe("dark");
      expect(lightSurface).not.toBe("#2e3440");
      expect(darkTheme).toBe("dark");
      expect(darkScheme).toBe("dark");
      expect(darkSurface).toBe("#2e3440");
      expect(darkCard).toEqual(lightCard);
      expect(darkCard.background).toContain("linear-gradient");
      expect(darkCard.color).toBe("rgb(255, 255, 255)");
    }
  } finally {
    await harness.cleanup();
  }
});

import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import type { WeatherConfiguration, WeatherForecast } from "../../../server/assets/templates/weather/model.js";
import { TemplateHarness } from "./template-harness.ts";

const NOW = "2026-10-27T12:00:00Z";
const CONDITIONS = [
  ["clear", true],
  ["clear", false],
  ["partly-cloudy", true],
  ["partly-cloudy", false],
  ["cloudy", true],
  ["rain", true],
  ["snow", true],
  ["thunderstorm", false],
  ["fog", true],
] as const;

test.describe.configure({ mode: "serial", timeout: 120_000 });

let harness: TemplateHarness;

test.beforeAll(async () => {
  harness = await TemplateHarness.start({ id: "weather", name: "Weather" });
});

test.afterAll(async () => {
  await harness.cleanup();
});

// proofs/ui/templates/weather.md#^weather-ui-ac-cross-browser-artwork
test("every Weather condition and placeholder drawing paints pixels", async ({ page, context, browserName }) => {
  await context.clock.install({ time: new Date(NOW) });
  await page.setViewportSize({ width: 340, height: 340 });
  let pendingProviderRoute: Route | undefined;
  await context.route("https://api.open-meteo.com/**", async (route) => {
    pendingProviderRoute = route;
  });

  const config = configuration();
  const artifactID = await harness.createStored(config as unknown as JSONValue);
  // Loopback is portable across all three browser engines; the response still
  // places the artifact in its required sandboxed opaque origin.
  const frame = await harness.open(page, artifactID, undefined, "127.0.0.1");
  await expect.poll(() => pendingProviderRoute).toBeDefined();
  await expectPainted(page, frame.locator(".weather-loading-icon tv-icon svg"), `${browserName} loading spinner`);
  await pendingProviderRoute!.abort("failed");
  await expect(frame.getByRole("status", { name: "Forecast unavailable" })).toBeVisible();
  await expectPainted(page, frame.locator(".weather-error tv-icon svg"), `${browserName} unavailable warning`);

  await harness.set(artifactID, {});
  await expect(frame.getByRole("heading", { name: "No location yet" })).toBeVisible();
  await expectPainted(page, frame.locator(".weather-empty .weather-glyph"), `${browserName} empty glyph`);

  await harness.set(artifactID, { place: "Broken" } as unknown as JSONValue);
  await expect(frame.getByRole("alert")).toBeVisible();
  await expectPainted(page, frame.locator(".weather-error tv-icon svg"), `${browserName} unreadable warning`);

  for (const [condition, isDay] of CONDITIONS) {
    const ready = configuration({ forecast: forecast(condition, isDay) });
    await harness.set(artifactID, ready as unknown as JSONValue);
    const card = frame.locator(`.weather-card[data-condition="${condition}"][data-day="${String(isDay)}"]`);
    await expect(card).toBeVisible();
    await expectPainted(
      page,
      card.locator(".weather-current-glyph .weather-glyph"),
      `${browserName} ${condition} ${isDay ? "day" : "night"}`,
    );
  }
});

function configuration(overrides: Partial<WeatherConfiguration> = {}): WeatherConfiguration {
  return {
    place: "Artwork",
    latitude: 37.7749,
    longitude: -122.4194,
    units: "celsius",
    ...overrides,
  };
}

function forecast(condition: WeatherForecast["current"]["condition"], isDay: boolean): WeatherForecast {
  return {
    latitude: 37.7749,
    longitude: -122.4194,
    units: "celsius",
    timeZone: "UTC",
    updatedAt: "2026-10-27T11:55:00Z",
    current: { temperature: 18, condition, summary: condition, isDay },
    hourly: [],
    daily: [{ date: "2026-10-27", condition, high: 20, low: 12 }],
  };
}

async function expectPainted(page: Page, drawing: Locator, label: string): Promise<void> {
  await expect(drawing, label).toBeVisible();
  const box = await drawing.boundingBox();
  expect(box, `${label} must have a paint box`).not.toBeNull();
  const screenshot = await page.screenshot({ animations: "disabled", clip: box! });
  await drawing.evaluate((element) => { (element as HTMLElement).style.opacity = "0"; });
  const hidden = await page.screenshot({ animations: "disabled", clip: box! });
  await drawing.evaluate((element) => { (element as HTMLElement).style.opacity = ""; });
  const painted = await page.evaluate(async ({ visible, empty }) => {
    const decode = async (base64: string) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const visiblePixels = await decode(visible);
    const emptyPixels = await decode(empty);
    let count = 0;
    for (let index = 0; index < visiblePixels.length; index += 4) {
      if (
        visiblePixels[index] !== emptyPixels[index]
        || visiblePixels[index + 1] !== emptyPixels[index + 1]
        || visiblePixels[index + 2] !== emptyPixels[index + 2]
        || visiblePixels[index + 3] !== emptyPixels[index + 3]
      ) count += 1;
    }
    return count;
  }, { visible: screenshot.toString("base64"), empty: hidden.toString("base64") });
  expect(painted, `${label} must paint pixels`).toBeGreaterThan(0);
  if ((await drawing.getAttribute("class"))?.split(/\s+/).includes("weather-glyph")) {
    expect(await drawing.evaluate((element) => element.tagName), `${label} must use inline SVG`).toBe("svg");
  }
}

// Each story is one state of the bundled Weather page. Behaviour is specified
// in specs/ui/templates/weather.mdx; this file owns independent story markup
// and first-party condition artwork.

import "../../../../specs/ui/foundation/index.css";
import "./styles.css";
import { html, Html } from "../../../lib/html.ts";
import iconFrame from "../../../../specs/ui/foundation/icons/icon.frame";

const icon = (params: { name: string; size?: string; spinning?: boolean }): Html =>
  new Html(iconFrame.render(params, { serializableShadowRoots: true }));

type Theme = "light" | "dark";
type Condition = "clear" | "partly-cloudy" | "cloudy" | "rain" | "snow" | "thunderstorm" | "fog";
type State = "ready" | "empty" | "loading" | "unreadable";

interface Current {
  temperature: number;
  condition: Condition;
  summary: string;
  isDay: boolean;
}

interface Hour {
  label: string;
  temperature: number;
  condition: Condition;
  isDay: boolean;
}

interface Day {
  label: string;
  temperatureHigh: number;
  temperatureLow: number;
  condition: Condition;
}

interface Forecast {
  place: string;
  unit: "C" | "F";
  updated: string;
  current: Current;
  hourly: Hour[];
  daily: Day[];
}

interface Args {
  theme: Theme;
  state: State;
  forecast: Forecast;
}

const conditionNames: Record<Condition, string> = {
  clear: "Clear",
  "partly-cloudy": "Partly cloudy",
  cloudy: "Cloudy",
  rain: "Rain",
  snow: "Snow",
  thunderstorm: "Thunderstorm",
  fog: "Fog",
};

/** Original, first-party weather artwork shared by current, hourly and daily states. */
const weatherGlyph = (condition: Condition, isDay: boolean, size: "hero" | "hour" | "day" | "empty" = "hero") => {
  const orb = isDay
    ? html`
      <g class="weather-orb weather-sun">
        <circle cx="78" cy="70" r="25"></circle>
        <path d="M78 24v14M78 102v14M32 70h14M110 70h14M45 37l10 10M101 93l10 10M111 37l-10 10M55 93l-10 10"></path>
      </g>`
    : html`
      <g class="weather-orb weather-moon">
        <path d="M99 35c-28 5-42 38-25 60 9 12 25 17 40 12-10 13-28 19-45 12-25-10-36-39-24-63 10-20 33-30 54-21Z"></path>
      </g>`;

  const cloud = html`
    <path class="weather-cloud-shadow" d="M58 147c-21 0-38-15-38-35 0-19 15-34 34-35 7-25 30-42 57-42 31 0 57 23 60 53 18 3 31 17 31 35 0 20-17 36-38 36H58Z"></path>
    <path class="weather-cloud" d="M55 140c-18 0-32-13-32-29 0-17 14-29 31-29h6c6-24 27-40 52-40 29 0 52 21 55 48h2c17 0 30 12 30 28 0 17-14 30-32 30H55Z"></path>`;

  let artwork: Html;
  if (condition === "clear") {
    artwork = isDay
      ? html`
        <g class="weather-clear-orb weather-sun">
          <circle cx="112" cy="100" r="42"></circle>
          <path d="M112 26v22M112 152v22M38 100h22M164 100h22M60 48l16 16M148 136l16 16M164 48l-16 16M76 136l-16 16"></path>
        </g>`
      : html`
        <g class="weather-clear-orb weather-moon">
          <path d="M150 45c-40 8-59 54-35 85 14 19 38 25 59 17-15 21-43 29-68 18-35-15-49-55-31-88 14-27 46-41 75-32Z"></path>
          <circle class="weather-star" cx="56" cy="58" r="3"></circle>
          <circle class="weather-star" cx="164" cy="72" r="2.5"></circle>
        </g>`;
  } else if (condition === "partly-cloudy") {
    artwork = html`${orb}${cloud}`;
  } else if (condition === "cloudy") {
    artwork = html`
      <g class="weather-cloud-overcast-back" transform="translate(-20 -12) scale(.9)">${cloud}</g>
      <g class="weather-cloud-overcast-front">${cloud}</g>`;
  } else if (condition === "rain") {
    artwork = html`${cloud}
      <g class="weather-precip weather-rain">
        <path d="M65 165l-8 18M105 165l-8 18M145 165l-8 18M181 163l-7 16"></path>
      </g>`;
  } else if (condition === "snow") {
    artwork = html`${cloud}
      <g class="weather-precip weather-snow">
        <path d="M62 166v22M51 177h22M54 169l16 16M70 169l-16 16M115 166v22M104 177h22M107 169l16 16M123 169l-16 16M168 166v22M157 177h22M160 169l16 16M176 169l-16 16"></path>
      </g>`;
  } else if (condition === "thunderstorm") {
    artwork = html`${cloud}
      <path class="weather-lightning" d="M112 151h29l-22 28h18l-40 39 12-30H91l21-37Z"></path>
      <path class="weather-rain weather-rain-side" d="M64 167l-7 16M174 165l-7 16"></path>`;
  } else {
    artwork = html`
      ${cloud}
      <g class="weather-fog-lines">
        <path d="M31 154h150M48 174h143M27 194h118"></path>
      </g>`;
  }

  return html`<svg class="weather-glyph weather-glyph-${size} weather-glyph-${condition}" viewBox="0 0 224 224" aria-hidden="true">${artwork}</svg>`;
};

const roundedTemperature = (value: number) => {
  const magnitude = Math.round(Math.abs(value));
  if (magnitude === 0) return 0;
  return value < 0 ? -magnitude : magnitude;
};

const reading = (value: number) => String(roundedTemperature(value)).replace("-", "−");
const degree = (value: number) => `${reading(value)}°`;

const atmosphere = html`
  <div class="weather-atmosphere" aria-hidden="true">
    <span class="weather-haze weather-haze-one"></span>
    <span class="weather-haze weather-haze-two"></span>
  </div>`;

const currentWeather = (forecast: Forecast) => {
  const today = forecast.daily.find((day) => day.label === "Today");
  return html`
  <section class="weather-current" aria-label="Current weather">
    <div class="weather-temperature" aria-label="${roundedTemperature(forecast.current.temperature)} degrees ${forecast.unit === "C" ? "Celsius" : "Fahrenheit"}">
      ${reading(forecast.current.temperature)}<span aria-hidden="true">°</span>
    </div>
    <div class="weather-current-glyph">${weatherGlyph(forecast.current.condition, forecast.current.isDay)}</div>
    <div class="weather-current-detail">
      <p class="weather-summary">${forecast.current.summary}</p>
      ${today ? html`<p class="weather-high-low"><span>H:${degree(today.temperatureHigh)}</span><span>L:${degree(today.temperatureLow)}</span></p>` : html``}
    </div>
  </section>`;
};

const hourlyForecast = (forecast: Forecast) => {
  const hoursWithCurrent: Hour[] = [
    {
      label: "Now",
      temperature: forecast.current.temperature,
      condition: forecast.current.condition,
      isDay: forecast.current.isDay,
    },
    ...forecast.hourly,
  ];
  return html`
  <section class="weather-panel weather-hourly" aria-label="Hourly forecast">
    <h2>Hourly forecast</h2>
    <div class="weather-hourly-strip" tabindex="0" aria-label="Hourly forecast; scroll for later hours">${hoursWithCurrent.map((hour) => html`
      <div class="weather-hour">
        <span class="weather-hour-label">${hour.label}</span>
        <span class="weather-hour-condition" role="img" aria-label="${conditionNames[hour.condition]}">${weatherGlyph(hour.condition, hour.isDay, "hour")}</span>
        <strong>${degree(hour.temperature)}</strong>
      </div>`)}</div>
  </section>`;
};

const dailyForecast = (forecast: Forecast) => {
  const floor = Math.min(...forecast.daily.map((day) => day.temperatureLow));
  const ceiling = Math.max(...forecast.daily.map((day) => day.temperatureHigh));
  const span = Math.max(1, ceiling - floor);
  return html`
  <section class="weather-panel weather-daily" aria-label="${forecast.daily.length}-day forecast">
    <h2>${forecast.daily.length}-day forecast</h2>
    <div class="weather-days" style="--day-count: ${forecast.daily.length};">${forecast.daily.map((day) => {
      const start = ((day.temperatureLow - floor) / span) * 100;
      const end = ((day.temperatureHigh - floor) / span) * 100;
      return html`
      <div class="weather-day">
        <span class="weather-day-label">${day.label}</span>
        <span class="weather-day-condition" role="img" aria-label="${conditionNames[day.condition]}">${weatherGlyph(day.condition, true, "day")}</span>
        <span class="weather-day-low">${degree(day.temperatureLow)}</span>
        <span class="weather-range" style="--range-start: ${start}%; --range-end: ${end}%;"><i></i></span>
        <span class="weather-day-high">${degree(day.temperatureHigh)}</span>
      </div>`;
    })}</div>
  </section>`;
};

const placeholder = (state: Exclude<State, "ready">) => {
  if (state === "loading") return html`
    <div class="weather-placeholder-content" role="status" aria-label="Loading weather">
      <span class="weather-placeholder-icon weather-loading-icon">${icon({ name: "spinner", size: "xl", spinning: true })}</span>
      <h1>Loading weather</h1>
    </div>`;
  if (state === "unreadable") return html`
    <div class="weather-placeholder-content weather-error" role="alert">
      <span class="weather-placeholder-icon">${icon({ name: "warning", size: "xl" })}</span>
      <h1>This forecast can't be shown</h1>
      <p>Its saved data isn't in the form this page reads. Ask your agent to check it.</p>
    </div>`;
  return html`
    <div class="weather-placeholder-content weather-empty">
      ${weatherGlyph("partly-cloudy", true, "empty")}
      <h1>No forecast yet</h1>
      <p>Ask your agent to add a forecast for a place.</p>
    </div>`;
};

const render = ({ theme, state, forecast }: Args) => {
  document.documentElement.dataset.theme = theme;
  if (state !== "ready") return html`
  <main class="weather-page">
    <article class="weather-card weather-card-${state}" data-condition="clear" data-day="true">
      ${atmosphere}
      ${placeholder(state)}
    </article>
  </main>`;

  const { current } = forecast;
  return html`
  <main class="weather-page">
    <article class="weather-card" data-condition="${current.condition}" data-day="${String(current.isDay)}">
      ${atmosphere}
      <div class="weather-content">
        <header class="weather-header">
          <div>
            <h1>${forecast.place}</h1>
            <p>Updated ${forecast.updated}<span aria-hidden="true"> · </span><span aria-label="degrees ${forecast.unit === "C" ? "Celsius" : "Fahrenheit"}">°${forecast.unit}</span></p>
          </div>
        </header>
        ${currentWeather(forecast)}
        ${hourlyForecast(forecast)}
        ${forecast.daily.length > 0 ? dailyForecast(forecast) : html``}
      </div>
    </article>
  </main>`;
};

const daytimeLabels = ["11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM", "6 PM", "7 PM", "8 PM", "9 PM", "10 PM"];
const nightLabels = ["11 PM", "12 AM", "1 AM", "2 AM", "3 AM", "4 AM", "5 AM", "6 AM", "7 AM", "8 AM", "9 AM", "10 AM"];

const hours = (temperatures: number[], conditions: Condition[], labels = daytimeLabels, nightFrom = temperatures.length + 1): Hour[] => {
  return temperatures.map((temperature, index) => ({
    label: labels[index] ?? `${index + 10}:00`,
    temperature,
    condition: conditions[index % conditions.length]!,
    isDay: index < nightFrom,
  }));
};

/* eslint-disable @typescript-eslint/no-magic-numbers -- Weather fixtures are clearest as literal forecast readings. */
const sanFrancisco: Forecast = {
  place: "San Francisco",
  unit: "F",
  updated: "12 min ago",
  current: { temperature: 68, condition: "clear", summary: "Clear", isDay: true },
  hourly: hours([68, 69, 70, 71, 72, 71, 69, 66, 63, 61, 59, 58], ["clear", "clear", "partly-cloudy"], daytimeLabels, 8),
  daily: [
    { label: "Today", temperatureHigh: 72, temperatureLow: 55, condition: "clear" },
    { label: "Wed", temperatureHigh: 69, temperatureLow: 54, condition: "fog" },
    { label: "Thu", temperatureHigh: 67, temperatureLow: 53, condition: "partly-cloudy" },
    { label: "Fri", temperatureHigh: 64, temperatureLow: 51, condition: "rain" },
    { label: "Sat", temperatureHigh: 66, temperatureLow: 50, condition: "partly-cloudy" },
    { label: "Sun", temperatureHigh: 70, temperatureLow: 52, condition: "clear" },
    { label: "Mon", temperatureHigh: 71, temperatureLow: 54, condition: "clear" },
  ],
};

const edinburghNight: Forecast = {
  place: "Edinburgh",
  unit: "C",
  updated: "8 min ago",
  current: { temperature: 8, condition: "partly-cloudy", summary: "Clouds and moonlight", isDay: false },
  hourly: hours([8, 8, 7, 7, 6, 6, 5, 5], ["partly-cloudy", "cloudy"], nightLabels, 0),
  daily: [
    { label: "Today", temperatureHigh: 11, temperatureLow: 5, condition: "partly-cloudy" },
    { label: "Wed", temperatureHigh: 10, temperatureLow: 4, condition: "cloudy" },
    { label: "Thu", temperatureHigh: 9, temperatureLow: 3, condition: "rain" },
  ],
};

const sedonaNight: Forecast = {
  place: "Sedona",
  unit: "F",
  updated: "4 min ago",
  current: { temperature: 52, condition: "clear", summary: "Clear night", isDay: false },
  hourly: hours([52, 50, 48, 46, 45, 44, 43, 44], ["clear"], nightLabels, 0),
  daily: [
    { label: "Today", temperatureHigh: 67, temperatureLow: 43, condition: "clear" },
    { label: "Wed", temperatureHigh: 69, temperatureLow: 44, condition: "clear" },
    { label: "Thu", temperatureHigh: 66, temperatureLow: 42, condition: "partly-cloudy" },
  ],
};

const seattleCloudy: Forecast = {
  place: "Seattle",
  unit: "F",
  updated: "16 min ago",
  current: { temperature: 57, condition: "cloudy", summary: "Overcast", isDay: true },
  hourly: hours([57, 58, 59, 60, 60, 59, 58, 57], ["cloudy", "cloudy", "rain"], daytimeLabels, 7),
  daily: [
    { label: "Today", temperatureHigh: 60, temperatureLow: 51, condition: "cloudy" },
    { label: "Wed", temperatureHigh: 58, temperatureLow: 49, condition: "rain" },
    { label: "Thu", temperatureHigh: 61, temperatureLow: 50, condition: "partly-cloudy" },
  ],
};

const portlandRain: Forecast = {
  place: "Portland",
  unit: "C",
  updated: "18 min ago",
  current: { temperature: 11, condition: "rain", summary: "Steady rain", isDay: true },
  hourly: hours([11, 11, 12, 12, 13, 12, 11, 10, 10, 9], ["rain", "rain", "cloudy"], daytimeLabels, 8),
  daily: [
    { label: "Today", temperatureHigh: 13, temperatureLow: 8, condition: "rain" },
    { label: "Wed", temperatureHigh: 12, temperatureLow: 7, condition: "rain" },
    { label: "Thu", temperatureHigh: 14, temperatureLow: 8, condition: "cloudy" },
  ],
};

const montrealSnow: Forecast = {
  place: "Montréal",
  unit: "C",
  updated: "21 min ago",
  current: { temperature: -11.5, condition: "snow", summary: "Light snow", isDay: true },
  hourly: hours([-12, -11, -10, -9, -8, -9, -11, -13], ["snow", "snow", "cloudy"], daytimeLabels, 7),
  daily: [
    { label: "Today", temperatureHigh: -8, temperatureLow: -15, condition: "snow" },
    { label: "Wed", temperatureHigh: -10, temperatureLow: -17, condition: "snow" },
    { label: "Thu", temperatureHigh: -7, temperatureLow: -14, condition: "cloudy" },
  ],
};

const newOrleansStorm: Forecast = {
  place: "New Orleans",
  unit: "F",
  updated: "5 min ago",
  current: { temperature: 76, condition: "thunderstorm", summary: "Thunderstorms", isDay: false },
  hourly: hours([76, 75, 74, 73, 73, 72, 72, 71, 71], ["thunderstorm", "rain"], nightLabels, 0),
  daily: [
    { label: "Today", temperatureHigh: 82, temperatureLow: 70, condition: "thunderstorm" },
    { label: "Wed", temperatureHigh: 80, temperatureLow: 69, condition: "rain" },
    { label: "Thu", temperatureHigh: 83, temperatureLow: 71, condition: "cloudy" },
    { label: "Fri", temperatureHigh: 86, temperatureLow: 72, condition: "partly-cloudy" },
    { label: "Sat", temperatureHigh: 87, temperatureLow: 73, condition: "clear" },
    { label: "Sun", temperatureHigh: 85, temperatureLow: 72, condition: "rain" },
    { label: "Mon", temperatureHigh: 84, temperatureLow: 71, condition: "cloudy" },
  ],
};

const foggy: Forecast = {
  place: "Point Reyes",
  unit: "F",
  updated: "14 min ago",
  current: { temperature: 54, condition: "fog", summary: "Dense fog", isDay: true },
  hourly: hours([54, 55, 56, 58, 60, 61, 59, 57], ["fog", "fog", "partly-cloudy"], daytimeLabels, 7),
  daily: [
    { label: "Today", temperatureHigh: 61, temperatureLow: 50, condition: "fog" },
    { label: "Wed", temperatureHigh: 63, temperatureLow: 51, condition: "fog" },
    { label: "Thu", temperatureHigh: 66, temperatureLow: 52, condition: "partly-cloudy" },
  ],
};

const london: Forecast = {
  place: "London",
  unit: "C",
  updated: "9 min ago",
  current: { temperature: 16, condition: "partly-cloudy", summary: "Sun and clouds", isDay: true },
  hourly: hours([15, 17, 18, 18, 17, 16, 15, 14, 13, 12, 12, 11], ["rain", "clear", "cloudy", "rain"], daytimeLabels, 8),
  daily: [
    { label: "Today", temperatureHigh: 18, temperatureLow: 10, condition: "partly-cloudy" },
    { label: "Wed", temperatureHigh: 16, temperatureLow: 9, condition: "rain" },
    { label: "Thu", temperatureHigh: 14, temperatureLow: 7, condition: "rain" },
    { label: "Fri", temperatureHigh: 15, temperatureLow: 6, condition: "fog" },
    { label: "Sat", temperatureHigh: 17, temperatureLow: 8, condition: "clear" },
    { label: "Sun", temperatureHigh: 13, temperatureLow: 4, condition: "rain" },
    { label: "Mon", temperatureHigh: 15, temperatureLow: 6, condition: "thunderstorm" },
  ],
};

const deathValley: Forecast = {
  place: "Death Valley",
  unit: "F",
  updated: "7 min ago",
  current: { temperature: 104, condition: "clear", summary: "Hot and clear", isDay: true },
  hourly: hours([104, 106, 108, 107, 105, 101], ["clear"], daytimeLabels, 6),
  daily: [
    { label: "Today", temperatureHigh: 108, temperatureLow: 81, condition: "clear" },
    { label: "Wed", temperatureHigh: 107, temperatureLow: 80, condition: "clear" },
  ],
};

const londonShort: Forecast = { ...london, daily: london.daily.slice(0, 4) };
const noCurrentDay: Forecast = { ...sanFrancisco, daily: sanFrancisco.daily.slice(1) };
/* eslint-enable @typescript-eslint/no-magic-numbers */

const viewports = {
  minimum: { name: "Minimum weather", styles: { width: "230px", height: "230px" }, type: "mobile" },
  small: { name: "Small weather", styles: { width: "340px", height: "340px" }, type: "mobile" },
  medium: { name: "Medium weather", styles: { width: "700px", height: "540px" }, type: "desktop" },
  largeBoundary: { name: "Large weather boundary", styles: { width: "760px", height: "740px" }, type: "desktop" },
  large: { name: "Large weather", styles: { width: "900px", height: "780px" }, type: "desktop" },
};

const sized = (viewport: keyof typeof viewports) => ({
  globals: { viewport: { value: viewport, isRotated: false } },
  parameters: { docs: { story: { height: viewports[viewport].styles.height } } },
});

export default {
  title: "Spec/Templates/Weather",
  parameters: {
    layout: "fullscreen",
    viewport: { options: viewports },
    docs: { story: { inline: false, height: "340px" } },
  },
  globals: { viewport: { value: "small", isRotated: false } },
  render,
  args: { theme: "light", state: "ready", forecast: sanFrancisco } satisfies Args,
};

export const ClearDay = { name: "Clear day" };
export const ClearNight = { name: "Clear night", args: { forecast: sedonaNight } };
export const PartlyCloudyNight = { name: "Partly cloudy night", args: { forecast: edinburghNight } };
export const Cloudy = { args: { forecast: seattleCloudy } };
export const Rain = { ...sized("medium"), args: { forecast: portlandRain } };
export const Snow = { args: { forecast: montrealSnow } };
export const ThunderstormNight = { name: "Thunderstorm at night", ...sized("medium"), args: { forecast: newOrleansStorm } };
export const ThunderstormNightLarge = { name: "Thunderstorm at night, large", ...sized("large"), args: { forecast: newOrleansStorm } };
export const Fog = { args: { forecast: foggy } };
export const ThreeDigitTemperature = { name: "Three-digit temperature", args: { forecast: deathValley } };
export const MinimumSize = { name: "Minimum size", ...sized("minimum"), args: { forecast: deathValley } };
export const NoCurrentDay = { name: "No current daily forecast", args: { forecast: noCurrentDay } };
export const Medium = { ...sized("medium"), args: { forecast: london } };
export const Large = { ...sized("largeBoundary"), args: { forecast: london } };
export const ShortForecast = { name: "Four-day forecast", ...sized("large"), args: { forecast: londonShort } };
export const Loading = { args: { state: "loading" } };
export const Empty = { args: { state: "empty" } };
export const Unreadable = { args: { state: "unreadable" } };
export const DarkAppearance = { name: "Dark appearance", args: { theme: "dark" } };

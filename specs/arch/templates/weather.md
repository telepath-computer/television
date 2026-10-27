*The bundled Weather artifact template: its display size, store contract, Open-Meteo forecast, packaged page, and adapting-agent guidance.*

# Weather artifact template

Weather is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. The [Weather UI spec](../../ui/templates/weather.mdx) owns the page appearance and interaction.

The bundled manifest declares `display: { "width": 340, "height": 340, "transparent": true }` in reference pixels. `fullScreen` uses the shared default. These values use the [creation display-options contract](../layout/index.md#^ly-creation-display); the [artifact frame](../../ui/app/artifact-frame/index.md) owns the surrounding transparent presentation.

## Store

The template `data.json` seeds the [JSON store belonging to the artifact](../../product/resources/resources.md#^rs-own-store) with `{}`. This is the empty-location state. A person or agent sets the place name, coordinates, and units. The page owns the optional saved forecast. The manifest sets `dataSchema` to the following contract. ^bundled-artifact-template-weather-store

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "oneOf": [
    { "type": "object", "maxProperties": 0 },
    { "$ref": "#/$defs/configured" }
  ],
  "$defs": {
    "condition": {
      "enum": ["clear", "partly-cloudy", "cloudy", "rain", "snow", "thunderstorm", "fog"],
      "description": "The visual weather condition derived from an Open-Meteo WMO weather code."
    },
    "date": {
      "type": "string",
      "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$"
    },
    "dateTime": {
      "type": "string",
      "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?(Z|[+-]([01]\\d|2[0-3]):[0-5]\\d)$"
    },
    "current": {
      "type": "object",
      "required": ["temperature", "condition", "summary", "isDay"],
      "properties": {
        "temperature": { "type": "number", "description": "Current temperature in the configured units." },
        "condition": { "$ref": "#/$defs/condition" },
        "summary": { "type": "string", "minLength": 1, "description": "Short current-condition description derived from the WMO weather code." },
        "isDay": { "type": "boolean", "description": "Open-Meteo's day-or-night flag for the current condition." }
      }
    },
    "hour": {
      "type": "object",
      "required": ["time", "temperature", "condition", "isDay"],
      "properties": {
        "time": { "$ref": "#/$defs/dateTime", "description": "Forecast instant. An explicit Z or numeric UTC offset is required." },
        "temperature": { "type": "number", "description": "Forecast temperature in the configured units." },
        "condition": { "$ref": "#/$defs/condition" },
        "isDay": { "type": "boolean", "description": "Open-Meteo's day-or-night flag for this hour." }
      }
    },
    "day": {
      "type": "object",
      "required": ["date", "condition", "high", "low"],
      "properties": {
        "date": { "$ref": "#/$defs/date", "description": "Calendar date assigned to this daily forecast by Open-Meteo." },
        "condition": { "$ref": "#/$defs/condition" },
        "high": { "type": "number", "description": "Forecast high temperature in the configured units." },
        "low": { "type": "number", "description": "Forecast low temperature in the configured units." }
      }
    },
    "forecast": {
      "type": "object",
      "description": "Page-owned cache of the last successful Open-Meteo forecast. Agents omit this field.",
      "required": ["latitude", "longitude", "units", "timeZone", "updatedAt", "current", "hourly", "daily"],
      "properties": {
        "latitude": { "type": "number", "minimum": -90, "maximum": 90, "description": "Requested WGS84 latitude used for this forecast." },
        "longitude": { "type": "number", "minimum": -180, "maximum": 180, "description": "Requested WGS84 longitude used for this forecast." },
        "units": { "enum": ["celsius", "fahrenheit"], "description": "Temperature units used for every value in this forecast." },
        "timeZone": { "type": "string", "minLength": 1, "description": "IANA time-zone identifier resolved by Open-Meteo for the requested coordinates." },
        "updatedAt": { "$ref": "#/$defs/dateTime", "description": "Required instant when the page received this successful Open-Meteo response. An explicit Z or numeric UTC offset is required." },
        "current": { "$ref": "#/$defs/current" },
        "hourly": {
          "type": "array",
          "items": { "$ref": "#/$defs/hour" },
          "description": "Hourly forecast normalized from Open-Meteo."
        },
        "daily": {
          "type": "array",
          "items": { "$ref": "#/$defs/day" },
          "description": "Daily forecast normalized from Open-Meteo."
        }
      }
    },
    "configured": {
      "type": "object",
      "required": ["place", "latitude", "longitude", "units"],
      "properties": {
        "place": { "type": "string", "minLength": 1, "description": "Place name shown on the page." },
        "latitude": { "type": "number", "minimum": -90, "maximum": 90, "description": "WGS84 latitude sent to Open-Meteo." },
        "longitude": { "type": "number", "minimum": -180, "maximum": 180, "description": "WGS84 longitude sent to Open-Meteo." },
        "units": { "enum": ["celsius", "fahrenheit"], "description": "Temperature units requested from Open-Meteo." },
        "forecast": { "description": "Page-owned cache candidate. The page validates this value against #/$defs/forecast before using it." }
      }
    }
  }
}
```

[Creating an artifact](./index.md#^artifact-template-schema) rejects starting data unless it is the empty object or has a valid place, latitude, longitude, and units. Writes after creation are not checked against the manifest schema. A later missing value or empty object shows the empty-location state. Any other later value must be one configured object. Extra fields are ignored.

The root schema deliberately accepts any value in `forecast` because this is a disposable cache owned by the page, not configuration that an agent must repair. Before using a saved forecast, the page separately validates it against `$defs.forecast`. That schema checks the forms of cached dates and times, not that they are valid calendar dates or valid instants, and cannot enumerate IANA time-zone identifiers. The page additionally requires valid dates and instants, a `timeZone` recognized by the browser, and each daily high to be at least its low. These checks keep the page from displaying dates, local times, or temperature ranges it cannot determine correctly.

A saved forecast is compatible only when it passes those schema and page checks and its `latitude`, `longitude`, and `units` equal the configured values. The page ignores a saved forecast that is invalid or incompatible, fetches one for the current configuration, and replaces the ignored value on its next successful save. An invalid or incompatible forecast does not make otherwise valid configuration unreadable. Changing only `place` reuses the saved values for the same coordinates and units and does not make a provider request.

The page parses every cached timestamp as an instant, regardless of its written offset. The current hour at `timeZone` is the local clock-hour interval containing the current instant. The current date at `timeZone` is the local calendar date containing the current instant. These definitions distinguish repeated clock hours during a daylight-saving fallback.

The hourly display window contains `current` followed by the first 23 saved hourly entries, or every one if fewer remain. To select those saved entries, the page stably sorts `hourly` by instant, keeps the first entry for each duplicate instant, and retains entries whose instants fall after the current hour. ^bundled-artifact-template-weather-hourly-window

To form the daily display window, the page stably sorts `daily` by date, keeps the first entry for each duplicate date, omits entries before the current date, and retains the first seven entries, or every one if fewer remain. ^bundled-artifact-template-weather-daily-window

Having more saved entries than either displayed limit does not make an otherwise valid forecast unreadable; every saved entry must still satisfy the schema and the page checks.

The current high and low, when available, come from the retained daily entry whose date is the current date at `timeZone`; the page never substitutes another date.

## Forecast request and mapping

After reading a configured location, the page makes a GET request to `https://api.open-meteo.com/v1/forecast` with these exact query parameters: ^bundled-artifact-template-weather-request

| Parameter | Value |
|---|---|
| `latitude`, `longitude` | the configured coordinates |
| `current` | `temperature_2m,weather_code,is_day` |
| `hourly` | `temperature_2m,weather_code,is_day` |
| `daily` | `weather_code,temperature_2m_max,temperature_2m_min` |
| `temperature_unit` | the configured `celsius` or `fahrenheit` |
| `timeformat` | `unixtime` |
| `timezone` | `auto` |
| `forecast_days` | `7` |

The page requests when it opens with a configured location unless a compatible saved forecast has an `updatedAt` from fewer than 15 minutes before the current instant. A future `updatedAt` does not qualify. With a fresh saved forecast, the page waits until that forecast is 15 minutes old before the first attempt. It also requests whenever either coordinate or `units` changes, and about every 15 minutes while the document is visible. Changing only `place` changes the displayed name without making a request. The empty object makes no request.

The page pauses the interval while hidden. On becoming visible, it requests at once when at least 15 minutes have passed since the last attempt or since `updatedAt` in the fresh saved forecast; otherwise it waits for the rest of that interval. At most one provider attempt is in progress. An attempt that has not answered within 10 seconds is aborted and counts as failed. A timer or visibility trigger does not start a second attempt while one is in progress. Changed coordinates or units abort an older attempt and start one for the new configuration; the older response is ineligible for display or saving.

The request uses the keyless free endpoint from Open-Meteo. It asks for UNIX timestamps because the fixed-offset ISO timestamps from Open-Meteo do not represent daylight-saving changes within the forecast. Hourly timestamps become ISO instants and are displayed in the returned IANA `timezone`. Open-Meteo resolves `utc_offset_seconds` at request time and keeps it fixed throughout the response, including across a daylight-saving change. For a daily UNIX timestamp, the page applies that returned offset before taking its `YYYY-MM-DD` date, as Open-Meteo directs for daily values. `updatedAt` is the instant on the page clock when it receives and validates the complete response.

The page builds a normalized forecast from every requested current value and from every entry in matching hourly and daily parallel arrays. It uses the requested coordinates and units, the returned `timezone`, the receipt instant as `updatedAt`, and the mapping below. The response succeeds only when it is a successful HTTP JSON response, has an integer `utc_offset_seconds`, and the forecast built from it passes the same `$defs.forecast` validation and page checks as a saved forecast. `current_units.temperature_2m`, `hourly_units.temperature_2m`, `daily_units.temperature_2m_max`, and `daily_units.temperature_2m_min` must all be `°C` for `celsius` or `°F` for `fahrenheit`. A missing or `null` requested value, unmatched array length, value that cannot be mapped, invalid JSON, HTTP error, timeout, or network error therefore makes the attempt fail. A failed attempt does not change the saved forecast.

The page maps Open-Meteo WMO codes to the closed condition vocabulary and current summary as follows. Daily entries use the condition and not the summary. For current and hourly entries, `is_day` `1` becomes `isDay: true` and `0` becomes `isDay: false`; another value cannot be mapped. The page does not infer daylight. ^bundled-artifact-template-weather-wmo

| WMO code | Condition | Current summary |
|---|---|---|
| `0` | `clear` | Clear |
| `1` | `partly-cloudy` | Mainly clear |
| `2` | `partly-cloudy` | Partly cloudy |
| `3` | `cloudy` | Overcast |
| `45` | `fog` | Fog |
| `48` | `fog` | Rime fog |
| `51` | `rain` | Light drizzle |
| `53` | `rain` | Drizzle |
| `55` | `rain` | Dense drizzle |
| `56` | `rain` | Light freezing drizzle |
| `57` | `rain` | Dense freezing drizzle |
| `61` | `rain` | Light rain |
| `63` | `rain` | Rain |
| `65` | `rain` | Heavy rain |
| `66` | `rain` | Light freezing rain |
| `67` | `rain` | Heavy freezing rain |
| `71` | `snow` | Light snow |
| `73` | `snow` | Snow |
| `75` | `snow` | Heavy snow |
| `77` | `snow` | Snow grains |
| `80` | `rain` | Light rain showers |
| `81` | `rain` | Rain showers |
| `82` | `rain` | Heavy rain showers |
| `85` | `snow` | Light snow showers |
| `86` | `snow` | Heavy snow showers |
| `95` | `thunderstorm` | Thunderstorm |
| `96` | `thunderstorm` | Thunderstorm with hail |
| `97` | `thunderstorm` | Heavy thunderstorm |
| `99` | `thunderstorm` | Thunderstorm with hail |

## Saving, failure, and access

The page subscribes to the whole store through the [resource SDK](../resources/sdk.md) and listens to its access level. Before the subscription returns its first result, it shows loading. A configured location with no compatible saved forecast also shows loading while its first request is in progress. A compatible saved forecast appears immediately. If it is at least 15 minutes old, the opening request runs behind it; if it is fresher, the page waits for the remaining interval.

After every successful response, the page keeps the normalized forecast in memory. With `read-write` access it also uses a root transaction to save that forecast without changing the current place or other fields. The transaction commits only while the configured coordinates and units still match the request; it replaces any earlier, invalid, or incompatible `forecast` value. Two open pages of this artifact with write access can therefore fetch independently, and the last transaction to commit supplies the saved forecast without restoring a concurrently changed location. A page opened through a read-only share fetches and displays its own result but makes no store write. A write refused because access changed or the Television connection was lost does not hide the in-memory result and is not queued; a later successful scheduled fetch can save after write access and connection return.

Whenever both saved and in-memory forecasts are valid and compatible, the page shows the one with the later `updatedAt`. When a request fails and the page has either candidate, it keeps showing the later one without an added error message. The unchanged `updatedAt` continues to show when that forecast was fetched. When no compatible forecast exists, failure replaces loading with the unavailable state. The next scheduled attempt, reopening, or a coordinate or unit change tries again, and a successful response restores the forecast.

A normal Television disconnection, or losing access after a store result arrived, keeps the last location and forecast. Provider refreshes can continue in memory while the document remains visible. When the Television connection returns, the page catches up with stored configuration and access changes. If the first store result had not arrived before the connection was lost or access was revoked, it keeps showing loading.

## Packaged page and guidance

The page loads the canonical Television stylesheet and resource SDK, and includes its other page dependencies inside the template folder so copied artifacts work independently. Its stylesheet is `styles.css` in the template folder; [conformance](../../spec-ui.md#conformance) holds the page to the UI spec stories. Weather-condition artwork and the square `icon.svg` are first-party SVG drawings included in the template. The manifest `icons` lists one entry, `icon.svg`; [icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-weather-page

The [Weather UI attribution rules](../../ui/templates/weather.mdx#attribution) own the visible credit, links, placement, and states. The credit is page chrome, not a store field. ^bundled-artifact-template-weather-credit

In a browser, Television gives the copied page an [opaque origin](../artifact-frame/isolation.md#the-sandbox-header), so its cross-origin request sends `Origin: null`. The sandbox policy has no `connect-src` restriction. The page depends on Open-Meteo continuing to allow that origin and requires network access for a fresh forecast. A saved forecast remains useful when the provider cannot be reached. No API key or Open-Meteo library is included in the template.

The bundled `README.md` explains the empty starting object and the four agent-owned fields, including coordinate ranges and both unit values. It gives one whole-root `tv resource json set` example and examples for changing the place, both coordinates together in one write, or the units. It tells an agent not to write or edit `forecast`, which the page owns, and to clear the card by replacing the root with `{}`, not `null`. It explains the conditional opening request and 15-minute requests, saved offline forecast, visible Open-Meteo credit, external-network requirement, and that a read-only page fetches without saving. It identifies `styles.css` and the first-party SVGs as the places to adapt the visual design, and explains that the transparent document background works with the manifest display setting applied at creation. ^bundled-artifact-template-weather-readme

## Testing guidance

Automated tests never contact Open-Meteo. Browser tests intercept every request to `https://api.open-meteo.com/**` and either fulfill a request scripted by that test with a local fixture for the exact contract above or abort it to exercise failure. A provider request for which the test did not script an expected method, URL, query, and response fails the test. Success fixtures are captured from real responses and include the returned `Access-Control-Allow-Origin` header, so the browser exercises the captured cross-origin response path. Real-stack tests otherwise use the copied page, resource SDK, server, access level, and store.

These network-free tests do not prove that Open-Meteo remains available, keeps its response shape, continues accepting `Origin: null`, sends the same CORS header, supplies non-null values, or continues under the recorded terms and rate limits. Those are release assumptions, not automated-test claims. ^bundled-artifact-template-weather-testing

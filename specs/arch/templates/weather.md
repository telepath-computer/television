*The bundled Weather artifact template: its display size, store contract, packaged page, and adapting-agent guidance.*

# Weather artifact template

Weather is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. The [Weather UI spec](../../ui/templates/weather.mdx) owns the page appearance and interaction.

The bundled manifest declares `display: { "width": 340, "height": 340, "transparent": true }` in reference pixels. `fullScreen` uses the shared default. These values use the [creation display-options contract](../layout/index.md#^ly-creation-display); the [artifact frame](../../ui/app/artifact-frame/index.md) owns the surrounding transparent presentation.

## Store

The template `data.json` seeds the [JSON store belonging to the artifact](../../product/resources/resources.md#^rs-own-store) with `{}`. This is the empty forecast state. Agents replace the root with a complete forecast. The manifest sets `dataSchema` to the following contract. ^bundled-artifact-template-weather-store

```json
{
  "oneOf": [
    { "type": "object", "maxProperties": 0 },
    { "$ref": "#/$defs/forecast" }
  ],
  "$defs": {
    "condition": {
      "enum": ["clear", "partly-cloudy", "cloudy", "rain", "snow", "thunderstorm", "fog"],
      "description": "The visual weather condition."
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
        "temperature": { "type": "number", "description": "Current temperature in the selected units." },
        "condition": { "$ref": "#/$defs/condition" },
        "summary": { "type": "string", "minLength": 1, "description": "Short current-condition description." },
        "isDay": { "type": "boolean", "description": "Whether the current condition is during local daylight." }
      }
    },
    "hour": {
      "type": "object",
      "required": ["time", "temperature", "condition", "isDay"],
      "properties": {
        "time": { "$ref": "#/$defs/dateTime", "description": "Forecast instant. An explicit Z or numeric UTC offset is required." },
        "temperature": { "type": "number", "description": "Forecast temperature in the selected units." },
        "condition": { "$ref": "#/$defs/condition" },
        "isDay": { "type": "boolean", "description": "Whether this hour is during local daylight." }
      }
    },
    "day": {
      "type": "object",
      "required": ["date", "condition", "high", "low"],
      "properties": {
        "date": { "$ref": "#/$defs/date", "description": "Local calendar date at timeZone." },
        "condition": { "$ref": "#/$defs/condition" },
        "high": { "type": "number", "description": "Forecast high temperature in the selected units." },
        "low": { "type": "number", "description": "Forecast low temperature in the selected units." }
      }
    },
    "forecast": {
      "type": "object",
      "required": ["place", "timeZone", "units", "updatedAt", "current", "hourly", "daily"],
      "properties": {
        "place": { "type": "string", "minLength": 1, "description": "Place name shown on the page." },
        "timeZone": { "type": "string", "minLength": 1, "description": "IANA time-zone identifier for the place." },
        "units": { "enum": ["celsius", "fahrenheit"], "description": "Temperature units for every value in the forecast." },
        "updatedAt": { "$ref": "#/$defs/dateTime", "description": "Instant when the agent fetched this forecast. An explicit Z or numeric UTC offset is required." },
        "current": { "$ref": "#/$defs/current" },
        "hourly": {
          "type": "array",
          "items": { "$ref": "#/$defs/hour" },
          "description": "Forecast hours."
        },
        "daily": {
          "type": "array",
          "items": { "$ref": "#/$defs/day" },
          "description": "Forecast days."
        }
      }
    }
  }
}
```

The schema checks the forms of dates and times, not that they are valid calendar dates or valid instants, and cannot enumerate IANA time-zone identifiers. The page additionally requires valid dates and instants, a `timeZone` recognized by the browser, and each daily high to be at least its low. These checks keep the page from displaying dates, local times, or temperature ranges it cannot determine correctly. A complete value that breaks one of these rules is shown as the [Weather UI spec](../../ui/templates/weather.mdx#data-the-page-cannot-read) describes. Extra fields are ignored.

The page parses every timestamp as an instant, regardless of its written offset. The current hour at `timeZone` is the local clock-hour interval containing the current instant. The current date at `timeZone` is the local calendar date containing the current instant. These definitions distinguish repeated clock hours during a daylight-saving fallback.

The hourly display window contains `current` followed by at most 23 stored hourly entries. To select those stored entries, the page stably sorts `hourly` by instant, keeps the first entry for each duplicate instant, and retains entries whose instants fall after the current hour. ^bundled-artifact-template-weather-hourly-window

To form the daily display window, the page stably sorts `daily` by date, keeps the first entry for each duplicate date, omits entries before the current date, and retains at most seven entries. ^bundled-artifact-template-weather-daily-window

Having more stored entries than either displayed limit does not make an otherwise valid forecast unreadable; every stored entry must still satisfy the schema and the page checks.

The current high and low, when available, come from the retained daily entry whose date is the current date at `timeZone`; the page never substitutes another date. The README tells agents to include the current date in `daily`.

The page subscribes to the whole store through the [resource SDK](../resources/sdk.md) and makes no store writes. Before the subscription returns its first result, the page shows the loading state. Once it returns, no value or the empty object shows the empty forecast state. Any other value must be one complete forecast. The page derives elapsed time from `updatedAt`, when the agent fetched the forecast; it never fetches weather or changes the stored forecast. Changes from an agent appear live.

## Packaged page and guidance

The page loads the canonical Television stylesheet and resource SDK, and includes its other page dependencies inside the template folder so copied artifacts work independently. Its stylesheet is `styles.css` in the template folder; [conformance](../../spec-ui.md#conformance) holds the page to the UI spec stories. Weather-condition artwork and the square `icon.svg` are first-party SVG drawings included in the template. The manifest `icons` lists `icon.svg`; [icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-weather-page

The bundled `README.md` explains the empty starting object and every forecast field, including the IANA time zone, condition and units vocabularies, timestamp instants, sorting, displayed limits, and daily high-and-low rule. It says that `updatedAt` is the time when the agent fetched the complete forecast and supplies the elapsed age. It says that every timestamp requires `Z` or a numeric UTC offset. `Z` means UTC; a local clock time must carry the numeric offset in force at that instant and must not be marked `Z` unless it is UTC. The page converts each instant to `timeZone` for display.

The README maps common source conditions onto the closed vocabulary: clear or sunny to `clear`; mixed sun and clouds, mostly clear, or partly cloudy to `partly-cloudy`; cloudy, mostly cloudy, or overcast to `cloudy`; drizzle, showers, rain, or freezing rain to `rain`; snow, flurries, sleet, ice pellets, or wintry mix to `snow`; thunder or lightning to `thunderstorm`; and mist, fog, haze, smoke, dust, or sand to `fog`.

The README tells an adapting agent to fetch weather from a source the agent is allowed to use and replace the root in one `tv resource json set` command. It tells the agent to include the current date in `daily`, set `updatedAt` to the fetch time, and refresh the forecast on a schedule, such as hourly. It tells the agent to clear the card by replacing the root with `{}`, not `null`. It says that the page reads the store live without writing to it or making requests to a weather service, that invalid or partial data is not repaired, and that copied artifacts are independent. It identifies `styles.css` and the first-party SVGs as the places to adapt the visual design, and explains that the transparent document background works with the manifest display setting applied at creation. ^bundled-artifact-template-weather-readme

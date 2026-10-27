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
        "time": { "$ref": "#/$defs/dateTime", "description": "Forecast instant. Any explicit UTC offset is accepted." },
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
      "required": ["place", "timeZone", "units", "observedAt", "current", "hourly", "daily"],
      "properties": {
        "place": { "type": "string", "minLength": 1, "description": "Place name shown on the page." },
        "timeZone": { "type": "string", "minLength": 1, "description": "IANA time-zone identifier for the place." },
        "units": { "enum": ["celsius", "fahrenheit"], "description": "Temperature units for every value in the forecast." },
        "observedAt": { "$ref": "#/$defs/dateTime", "description": "Instant when the agent fetched this forecast. Any explicit UTC offset is accepted." },
        "current": { "$ref": "#/$defs/current" },
        "hourly": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/hour" },
          "description": "Forecast hours."
        },
        "daily": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/day" },
          "description": "Forecast days."
        }
      }
    }
  }
}
```

The schema checks the forms of dates and times, not that they exist, and cannot enumerate IANA time-zone identifiers. The page additionally requires real dates and timestamp instants, a `timeZone` recognized by the browser, and each daily high to be at least its low. These checks keep the page from displaying dates, local times, or temperature ranges it cannot determine correctly. A complete value that breaks one of these rules is shown as the [Weather UI spec](../../ui/templates/weather.mdx#data-the-page-cannot-read) describes. Extra fields are ignored.

The page parses every timestamp as an instant, regardless of its written offset. The current hour at `timeZone` is the local clock-hour interval containing the current instant; an hourly entry is current when its instant falls within that interval. The current date at `timeZone` is the local calendar date containing the current instant. These definitions distinguish repeated clock hours during a daylight-saving fallback.

The page stably sorts hourly entries by instant and daily entries by date, then keeps the first entry for each duplicate instant or date. It omits hourly entries before the current hour and shows at most 24 entries from the current hour forward. The first entry within the current hour is labelled “Now”; any further entry in that hour uses its time label. If no entry falls within the current hour, the page starts with the first later instant and does not show “Now”. If no hourly entries remain, the page omits the hourly panel.

The page omits daily entries before the current date, then shows the first seven sorted, distinct entries. The entry for the current date is labelled “Today”. If no daily entries remain, the page omits the daily panel. The page refreshes the hourly and daily windows and the “Now” and “Today” labels while it remains open. Having more than either displayed limit does not make an otherwise valid forecast unreadable; every stored entry must still satisfy the schema and the page checks. ^bundled-artifact-template-weather-windows

The current high and low come from the retained daily entry whose date is the current date at `timeZone`. If no daily entry matches, the page omits the high-and-low line rather than using another day. The README tells agents to include the current date in `daily`.

The page subscribes to the whole store through the [resource SDK](../resources/sdk.md) and makes no store writes. Before the subscription returns its first result, the page shows the loading state. Once it returns, no value or the empty object shows the empty forecast state. Any other value must be one complete forecast. The page derives the “Updated” age shown below the place from the time in `observedAt`, when the agent fetched the forecast; it never fetches weather or changes the stored forecast. Changes from an agent appear live.

## Packaged page and guidance

The page loads the canonical Television stylesheet and resource SDK, and includes its other page dependencies inside the template folder so copied artifacts work independently. Its stylesheet is `styles.css` in the template folder; [conformance](../../spec-ui.md#conformance) holds the page to the UI spec stories. Weather-condition artwork and the square `icon.svg` are first-party SVG drawings included in the template. The manifest `icons` lists `icon.svg`; [icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-weather-page

The bundled `README.md` explains the empty starting object and every forecast field, including the IANA time zone, condition and units vocabularies, timestamp instants, sorting, displayed limits, and daily high-and-low rule. It says that `observedAt` is the time when the agent fetched the complete forecast and supplies the “Updated” age. It says that `Z` means UTC and that any explicit offset is accepted because the page converts each instant to `timeZone` for display.

The README maps common source conditions onto the closed vocabulary: clear or sunny to `clear`; mixed sun and clouds, mostly clear, or partly cloudy to `partly-cloudy`; cloudy, mostly cloudy, or overcast to `cloudy`; drizzle, showers, rain, or freezing rain to `rain`; snow, flurries, sleet, ice pellets, or wintry mix to `snow`; thunder or lightning to `thunderstorm`; and mist, fog, haze, smoke, dust, or sand to `fog`.

The README tells an adapting agent to fetch weather from a source the agent is allowed to use and replace the root in one `tv resource json set` command. It tells the agent to include the current date in `daily`; include one `hourly` entry for each local clock hour, on the hour at `timeZone`; include the current hour; set `observedAt` to the fetch time; and refresh the forecast on a schedule, such as hourly. It says that the page reads the store live without writing to it or making requests to a weather service, that invalid or partial data is not repaired, and that copied artifacts are independent. It identifies `styles.css` and the first-party SVGs as the places to adapt the visual design, and explains that the transparent document background works with the manifest display setting applied at creation. ^bundled-artifact-template-weather-readme

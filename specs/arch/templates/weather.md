*The bundled Weather artifact template: its display size, store contract, packaged page, and adapting-agent guidance.*

# Weather artifact template

Weather is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. The [Weather UI spec](../../ui/templates/weather.mdx) owns the page appearance and interaction.

The bundled manifest declares `display: { "width": 420, "height": 420, "transparent": true }` in reference pixels. `fullScreen` uses the shared default. These values use the [creation display-options contract](../layout/index.md#^ly-creation-display); the [artifact frame](../../ui/app/artifact-frame/index.md) owns the surrounding transparent presentation.

## Store

The template `data.json` seeds the [JSON store belonging to the artifact](../../product/resources/resources.md#^rs-own-store) with `{}`. This is the empty forecast state. Agents replace the root with a complete forecast, so the manifest `dataSchema` is this schema. ^bundled-artifact-template-weather-store

```json
{
  "oneOf": [
    { "type": "object", "maxProperties": 0 },
    { "$ref": "#/$defs/forecast" }
  ],
  "$defs": {
    "condition": {
      "enum": ["clear", "partly-cloudy", "rain", "snow", "thunderstorm", "fog"],
      "description": "The visual weather condition."
    },
    "date": {
      "type": "string",
      "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$"
    },
    "dateTime": {
      "type": "string",
      "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?(Z|[+-]([01]\\d|2[0-3]):[0-5]\\d)$"
    },
    "current": {
      "type": "object",
      "required": ["temperature", "condition", "summary", "high", "low", "isDay"],
      "properties": {
        "temperature": { "type": "number", "description": "Current temperature in the selected units." },
        "condition": { "$ref": "#/$defs/condition" },
        "summary": { "type": "string", "minLength": 1, "description": "Short current-condition description." },
        "high": { "type": "number", "description": "High temperature for today in the selected units." },
        "low": { "type": "number", "description": "Low temperature for today in the selected units." },
        "isDay": { "type": "boolean", "description": "Whether the current condition is during local daylight." }
      }
    },
    "hour": {
      "type": "object",
      "required": ["time", "temperature", "condition", "isDay"],
      "properties": {
        "time": { "$ref": "#/$defs/dateTime", "description": "Forecast time with the UTC offset for the place." },
        "temperature": { "type": "number", "description": "Forecast temperature in the selected units." },
        "condition": { "$ref": "#/$defs/condition" },
        "isDay": { "type": "boolean", "description": "Whether this hour is during local daylight." }
      }
    },
    "day": {
      "type": "object",
      "required": ["date", "condition", "high", "low"],
      "properties": {
        "date": { "$ref": "#/$defs/date" },
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
        "observedAt": { "$ref": "#/$defs/dateTime", "description": "When the current conditions were observed, with the UTC offset for the place." },
        "current": { "$ref": "#/$defs/current" },
        "hourly": {
          "type": "array",
          "minItems": 1,
          "maxItems": 24,
          "items": { "$ref": "#/$defs/hour" },
          "description": "The next forecast hours in chronological order."
        },
        "daily": {
          "type": "array",
          "minItems": 1,
          "maxItems": 7,
          "items": { "$ref": "#/$defs/day" },
          "description": "Up to seven forecast days in chronological order."
        }
      }
    }
  }
}
```

The schema checks the forms of dates and times, not that they exist, and cannot enumerate IANA time-zone identifiers. The page additionally requires real dates and times, a `timeZone` recognized by the browser, hourly and daily entries in strictly ascending order, and each current or daily high to be at least its low. A complete value that breaks any of these rules is shown as the [Weather UI spec](../../ui/templates/weather.mdx#data-the-page-cannot-read) describes. Extra fields are ignored.

The page subscribes to the whole store through the [resource SDK](../resources/sdk.md) and makes no store writes. Before the subscription returns its first result, the page shows the loading state. Once it returns, no value or the empty object shows the empty forecast state. Any other value must be one complete forecast. The page derives the age shown beside the place from `observedAt`; it never fetches or advances the forecast itself. Changes from an agent appear live.

## Packaged page and guidance

The page loads Television canonical stylesheet and resource SDK, and includes its other page dependencies inside the template folder so copied artifacts work independently. Its stylesheet is `styles.css` in the template folder; [conformance](../../spec-ui.md#conformance) holds the page to the UI spec stories. Weather-condition artwork and the square `icon.svg` are first-party SVG drawings included in the template. The manifest `icons` lists `icon.svg`; [icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-weather-page

The bundled `README.md` explains the empty starting object and every forecast field, including the IANA time zone, condition and units vocabularies, timestamp offsets, chronological arrays, high-and-low rule, and item limits. It tells an adapting agent to fetch weather from a source the agent is allowed to use and replace the root in one `tv resource json set` command. It says that the page reads the store live without writing to it or making requests to a weather service, that `observedAt` lets the page show how old the forecast is, that invalid or partial data is not repaired, and that copied artifacts are independent. It identifies `styles.css` and the first-party SVGs as the places to adapt the visual design, and explains that the transparent document background works with the manifest display setting applied at creation. ^bundled-artifact-template-weather-readme

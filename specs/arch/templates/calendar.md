*The bundled Calendar artifact template: its store contract, packaged page, and adapting-agent guidance.*

# Calendar artifact template

Calendar is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. The [Calendar UI spec](../../ui/templates/calendar.mdx) owns the page's appearance and interaction.

The bundled manifest declares no `display`, so the shared defaults apply.

## Store

The template's `data.json` seeds the artifact's [own JSON store](../../product/resources/resources.md#^rs-own-store) with `{"events":{}}`. Agents write the value, so it has a contract: the manifest's `dataSchema`, which is this schema. ^bundled-artifact-template-calendar-store

```json
{
  "type": "object",
  "required": ["events"],
  "properties": {
    "startDate": {
      "$ref": "#/$defs/date",
      "description": "First day shown. When absent, a seven-day calendar starts on the Monday of the current local week, and a shorter one starts today."
    },
    "days": {
      "type": "integer", "minimum": 1, "maximum": 7,
      "description": "Number of days shown, one column each; 7 when absent."
    },
    "visibleHours": {
      "type": "object",
      "description": "The hours that fill the view, such as {\"start\": 9, \"end\": 18} for 9 AM to 6 PM. When absent, hours have their usual height.",
      "required": ["start", "end"],
      "properties": {
        "start": { "type": "integer", "minimum": 0, "maximum": 23, "description": "First hour in view." },
        "end": { "type": "integer", "minimum": 1, "maximum": 24, "description": "Hour the view ends at; later than start." }
      }
    },
    "events": {
      "type": "object",
      "description": "Events in the calendar, keyed by a push ID or a chosen string. The key is never displayed.",
      "additionalProperties": { "$ref": "#/$defs/event" }
    }
  },
  "$defs": {
    "date": { "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$" },
    "dateTime": { "type": "string", "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d$" },
    "event": {
      "type": "object",
      "required": ["title", "start", "end"],
      "properties": {
        "title": { "type": "string", "description": "Event name." },
        "detail": { "type": "string", "description": "One line shown under the title, such as a place or a note." },
        "start": { "description": "Start, as YYYY-MM-DDTHH:MM local time, or YYYY-MM-DD for an all-day event." },
        "end": { "description": "End, in the same form as start. A timed event ends on the day it starts. An all-day event's end date is the day after its last day." },
        "allDay": { "type": "boolean", "description": "True for an all-day event; false when absent." },
        "color": { "enum": ["red", "orange", "yellow", "green", "blue", "purple"], "description": "Event colour; blue when absent." },
        "attendees": { "type": "array", "items": { "type": "string" }, "description": "Names of the people attending, in display order." },
        "highlight": { "type": "boolean", "description": "True to make the event stand out, as for one the agent has just added. An agent clears it by setting it to false or removing it." }
      },
      "if": { "required": ["allDay"], "properties": { "allDay": { "const": true } } },
      "then": { "properties": { "start": { "$ref": "#/$defs/date" }, "end": { "$ref": "#/$defs/date" } } },
      "else": { "properties": { "start": { "$ref": "#/$defs/dateTime" }, "end": { "$ref": "#/$defs/dateTime" } } }
    }
  }
}
```

The schema checks the forms of dates and times, not that a date exists or that an event or the hours in view end after they start. [Creating an artifact](./index.md#^artifact-template-schema) from the template rejects starting data that breaks the schema; writes after creation are not checked against it.

The page subscribes to the whole store through the [resource SDK](../resources/sdk.md) and makes no store writes. Events sort by start time; there is no `order` field. An event outside the days shown, or one that does not fit the schema and its descriptions, is not displayed. A `startDate` that is not a real date, or a `days` or `visibleHours` that does not fit the schema and its descriptions, is treated as absent. The value as a whole follows the contract when it is an object whose `events` is an object. A value that does not, or no value, is shown as the [Calendar UI spec](../../ui/templates/calendar.mdx#data-the-page-cannot-read) describes.

## Packaged page and guidance

The page loads Television's canonical stylesheet and the resource SDK, and includes its other page dependencies inside the template folder so copied artifacts work independently. Its stylesheet is `styles.css` in the template folder; [conformance](../../spec-ui.md#conformance) holds the page to the UI spec's stories. Its manifest's `icons` lists one entry, `icon.svg`, which is a square SVG. [Icon delivery](./index.md#icon-delivery) selects it, and [Toolbox](../../ui/app/toolbox.mdx#icons) draws it as supplied. ^bundled-artifact-template-calendar-page

The bundled `README.md` explains each store field in the schema above, the empty starting `events` object, and that an event breaking those rules or outside the days shown is not displayed. It tells an adapting agent to write an event with `tv resource json set` at `events/<key>`, and to raise and settle an event by setting its `highlight` to true and then false. It says that the page follows changes live without writing to the store, and that its modules and stylesheet started from Television's tv-calendar component. ^bundled-artifact-template-calendar-readme

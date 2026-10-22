*The bundled Calendar artifact template: its store contract, packaged page, and adapting-agent guidance.*

# Calendar artifact template

Calendar is a bundled [artifact template](../../product/templates.md#^artifact-template-bundled). The [inventory](./bundled-templates.md#^bundled-artifact-template-inventory) owns its ID, name, description, and versions. The [Calendar UI spec](../../ui/templates/calendar.mdx) owns the page's interaction, markup, and styling.

The bundled manifest declares no `display`, so the shared defaults apply.

## Store

The template's `data.json` seeds the artifact's [own JSON store](../../product/resources/resources.md#^rs-own-store) with `{"events":{}}`. Agents write the value, so it has this contract. The store root is an object with four fields: `startDate`, `days`, `visibleHours` and `events`. ^bundled-artifact-template-calendar-store

| Path | Type | Meaning |
| --- | --- | --- |
| `startDate` | string, `YYYY-MM-DD` | First day shown. Optional. When it is absent, a seven-day calendar starts on the Monday of the current local week, and a shorter one starts today. |
| `days` | integer, 1 to 7 | Number of days shown, one column each. Optional; 7 when absent. |
| `visibleHours` | object | The hours that fill the view, such as `{"start": 9, "end": 18}` for 9 AM to 6 PM. Optional; when absent, hours have their usual height. |
| `visibleHours/start` | integer, 0 to 23 | First hour in view. |
| `visibleHours/end` | integer, 1 to 24 | Hour the view ends at; later than `start`. |
| `events` | object | Events in the calendar. An empty object shows no events. |
| `events/<key>` | object | One event. The key comes from `push`, or can be a chosen string; it is never displayed. |
| `events/<key>/title` | string | Event name. |
| `events/<key>/detail` | string | One line shown under the title, such as a place or a note. Optional; none when absent. |
| `events/<key>/start` | string | Start, as `YYYY-MM-DDTHH:MM` local time, or `YYYY-MM-DD` for an all-day event. |
| `events/<key>/end` | string | End, in the same form as `start`. A timed event ends on the day it starts. An all-day event's end date is the day after its last day. |
| `events/<key>/allDay` | boolean | True for an all-day event. Optional; false when absent. |
| `events/<key>/color` | `"red"`, `"orange"`, `"yellow"`, `"green"`, `"blue"` or `"purple"` | Event colour. Optional; blue when absent. |
| `events/<key>/attendees` | array of strings | Names of the people attending, in display order. Optional; none when absent. |
| `events/<key>/highlight` | boolean | True to make the event stand out, as for one the agent has just added. Optional; false when absent. An agent clears it by setting it to false or removing it. |

The page subscribes to the whole store through the [resource SDK](../resources/sdk.md) and makes no store writes. Events sort by start time; there is no `order` field. An event outside the days shown, or one whose fields do not fit the table above, is not displayed. A `startDate` that is not a real date in the form above, a `days` that is not an integer from 1 to 7, or a `visibleHours` that does not fit the rows above, is treated as absent. The value as a whole follows the contract when it is an object whose `events` is an object. A value that does not, or no value, is shown as the [Calendar UI spec](../../ui/templates/calendar.mdx#data-the-page-cannot-read) describes.

## Packaged page and guidance

The page loads Television's canonical stylesheet and the resource SDK, and includes its other page dependencies inside the template folder so copied artifacts work independently. Its stylesheet, `styles.css` in the template folder, is a byte-for-byte copy of the Calendar UI spec's stylesheet, under the [stylesheet-copy checks](../ui/conformance.md#mechanisms). Its `thumbnail.png` is a 4:5 portrait screenshot, 400 by 500 pixels, of the page showing one day with a highlighted event. The [Templates popover UI spec](../../ui/app/templates-popover.mdx) owns how the image is displayed. ^bundled-artifact-template-calendar-page

The bundled `README.md` explains each store field in the table above, the empty starting `events` object, and that an event breaking those rules or outside the days shown is not displayed. It tells an adapting agent to write an event with `tv resource json set` at `events/<key>`, and to raise and settle an event by setting its `highlight` to true and then false. It says that the page follows changes live without writing to the store, and that its modules and stylesheet started from Television's tv-calendar component. ^bundled-artifact-template-calendar-readme

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectTemplateIcon, validateTemplatePackage } from "../src/templates.ts";

const sourceRoot = path.resolve(import.meta.dirname, "../assets/templates");
const folder = path.join(sourceRoot, "calendar");

// The store schema, as specs/arch/templates/calendar.md (^bundled-artifact-template-calendar-store) states it.
const dataSchema = {
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
};

describe("bundled Calendar package", () => {
  // proofs/arch/templates/calendar.md#^templates-calendar-t-package
  it("declares Calendar with its manifest and store schema, empty starting store, adapting guidance and stylesheets", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest).toEqual({
      name: "Calendar",
      description: "Show one to seven days of live events, including all-day events and highlighted moments.",
      version: "1.0.0",
      icons: [{ src: "icon.svg", type: "image/svg+xml" }],
      dataSchema,
    });
    expect(JSON.parse(readFileSync(path.join(folder, "data.json"), "utf8"))).toEqual({ events: {} });
    const readme = readFileSync(path.join(folder, "README.md"), "utf8");
    for (const guidance of ["`startDate`", "`days`", "`visibleHours`", "`events/<key>`", "`allDay`", "`attendees`", "`highlight`", "tv resource json set", "tv-calendar"]) {
      expect(readme).toContain(guidance);
    }
    // The page links its own stylesheet after the canonical stylesheet.
    const page = readFileSync(path.join(folder, "index.html"), "utf8");
    const stylesheets = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(([, href]) => href);
    expect(stylesheets).toEqual(["/canonical/v2/styles.css?authoredForAppVersion=1.5.4", "./styles.css"]);
  });

  // proofs/arch/templates/calendar.md#^templates-calendar-t-icon
  it("supplies its SVG icon to the Toolbox", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest.icons).toEqual([{ src: "icon.svg", type: "image/svg+xml" }]);
    const { template } = validateTemplatePackage(folder, "calendar");
    expect(selectTemplateIcon(template!)).toEqual({ path: realpathSync(path.join(folder, "icon.svg")), contentType: "image/svg+xml" });
  });
});

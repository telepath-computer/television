import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(import.meta.dirname, "../assets/templates");
const folder = path.join(sourceRoot, "calendar");

describe("bundled Calendar package", () => {
  // proofs/arch/templates/calendar.md#^templates-calendar-t-package
  it("declares Calendar with its manifest, empty starting store, adapting guidance, and the spec stylesheet", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest).toEqual({
      name: "Calendar",
      description: "Show one to seven days of live events, including all-day events and highlighted moments.",
      version: "1.0.0",
    });
    expect(JSON.parse(readFileSync(path.join(folder, "data.json"), "utf8"))).toEqual({ events: {} });
    const readme = readFileSync(path.join(folder, "README.md"), "utf8");
    for (const guidance of ["`startDate`", "`days`", "`events/<key>`", "`allDay`", "`attendees`", "`highlight`", "tv resource json set", "tv-calendar"]) {
      expect(readme).toContain(guidance);
    }
    // The page carries the spec stylesheet byte for byte, linked from the page
    // after the canonical stylesheet.
    expect(readFileSync(path.join(folder, "styles.css")))
      .toEqual(readFileSync(path.join(sourceRoot, "../../../../storybook/spec/templates/calendar/styles.css")));
    const page = readFileSync(path.join(folder, "index.html"), "utf8");
    const stylesheets = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(([, href]) => href);
    expect(stylesheets).toEqual(["/canonical/v2/styles.css?authoredForAppVersion=1.5.4", "./styles.css"]);
    const thumbnail = readFileSync(path.join(folder, "thumbnail.png"));
    expect(thumbnail.subarray(1, 4).toString()).toBe("PNG");
    expect([thumbnail.readUInt32BE(16), thumbnail.readUInt32BE(20)]).toEqual([400, 500]);
  });
});

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectTemplateIcon, validateTemplatePackage } from "../src/templates.ts";

const sourceRoot = path.resolve(import.meta.dirname, "../assets/templates");
const folder = path.join(sourceRoot, "calendar");

describe("bundled Calendar package", () => {
  // proofs/arch/templates/calendar.md#^templates-calendar-t-package
  it("declares Calendar with its manifest, empty starting store, adapting guidance and stylesheets", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest).toEqual({
      name: "Calendar",
      description: "Show one to seven days of live events, including all-day events and highlighted moments.",
      version: "1.0.0",
      icons: [{ src: "icon.svg", type: "image/svg+xml" }],
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

import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectTemplateIcon, validateTemplatePackage } from "../src/templates.ts";

const folder = path.resolve(import.meta.dirname, "../assets/templates/weather");

describe("bundled Weather package", () => {
  // proofs/arch/templates/weather.md#^templates-weather-t-package
  it("provides the exact store schema, empty seed, artwork and transparent 340 by 340 display", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      name: "Weather",
      description: "A sky-tinted forecast for one place, from current conditions through the week.",
      version: "1.0.0",
      display: { width: 340, height: 340, transparent: true },
    });
    expect(manifest.display).not.toHaveProperty("fullScreen");
    expect(manifest.dataSchema).toEqual({
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "oneOf": [
        { "type": "object", "maxProperties": 0 },
        { "$ref": "#/$defs/configured" },
      ],
      "$defs": {
        "condition": {
          "enum": ["clear", "partly-cloudy", "cloudy", "rain", "snow", "thunderstorm", "fog"],
          "description": "The visual weather condition derived from an Open-Meteo WMO weather code.",
        },
        "date": {
          "type": "string",
          "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$",
        },
        "dateTime": {
          "type": "string",
          "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?(Z|[+-]([01]\\d|2[0-3]):[0-5]\\d)$",
        },
        "current": {
          "type": "object",
          "required": ["temperature", "condition", "summary", "isDay"],
          "properties": {
            "temperature": { "type": "number", "description": "Current temperature in the configured units." },
            "condition": { "$ref": "#/$defs/condition" },
            "summary": { "type": "string", "minLength": 1, "description": "Short current-condition description derived from the WMO weather code." },
            "isDay": { "type": "boolean", "description": "Open-Meteo's day-or-night flag for the current condition." },
          },
        },
        "hour": {
          "type": "object",
          "required": ["time", "temperature", "condition", "isDay"],
          "properties": {
            "time": { "$ref": "#/$defs/dateTime", "description": "Forecast instant. An explicit Z or numeric UTC offset is required." },
            "temperature": { "type": "number", "description": "Forecast temperature in the configured units." },
            "condition": { "$ref": "#/$defs/condition" },
            "isDay": { "type": "boolean", "description": "Open-Meteo's day-or-night flag for this hour." },
          },
        },
        "day": {
          "type": "object",
          "required": ["date", "condition", "high", "low"],
          "properties": {
            "date": { "$ref": "#/$defs/date", "description": "Calendar date assigned to this daily forecast by Open-Meteo." },
            "condition": { "$ref": "#/$defs/condition" },
            "high": { "type": "number", "description": "Forecast high temperature in the configured units." },
            "low": { "type": "number", "description": "Forecast low temperature in the configured units." },
          },
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
              "maxItems": 24,
              "items": { "$ref": "#/$defs/hour" },
              "description": "At most 24 future hourly entries normalized from Open-Meteo.",
            },
            "daily": {
              "type": "array",
              "items": { "$ref": "#/$defs/day" },
              "description": "Daily forecast normalized from Open-Meteo.",
            },
          },
        },
        "configured": {
          "type": "object",
          "required": ["place", "latitude", "longitude", "units"],
          "properties": {
            "place": { "type": "string", "minLength": 1, "description": "Place name shown on the page." },
            "latitude": { "type": "number", "minimum": -90, "maximum": 90, "description": "WGS84 latitude sent to Open-Meteo." },
            "longitude": { "type": "number", "minimum": -180, "maximum": 180, "description": "WGS84 longitude sent to Open-Meteo." },
            "units": { "enum": ["celsius", "fahrenheit"], "description": "Temperature units requested from Open-Meteo." },
            "forecast": { "description": "Page-owned cache candidate. The page validates this value against #/$defs/forecast before using it." },
          },
        },
      },
    });
    expect(JSON.parse(readFileSync(path.join(folder, "data.json"), "utf8"))).toEqual({});
    for (const file of ["index.html", "styles.css", "page.js", "model.js", "provider.js", "icon.svg", "artwork.svg", "README.md", "THIRD-PARTY-NOTICES.txt"]) {
      expect(existsSync(path.join(folder, file)), file).toBe(true);
    }
    expect(readFileSync(path.join(folder, "index.html"), "utf8")).not.toContain("weather-credit");
  });

  // proofs/arch/templates/weather.md#^templates-weather-t-icon
  it("supplies its SVG icon to the Toolbox", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest.icons).toEqual([{ src: "icon.svg", type: "image/svg+xml" }]);
    const { template } = validateTemplatePackage(folder, "weather");
    expect(selectTemplateIcon(template!)).toEqual({ path: realpathSync(path.join(folder, "icon.svg")), contentType: "image/svg+xml" });
  });

  // proofs/arch/templates/weather.md#^templates-weather-t-readme
  it("documents configuration, provider behavior, privacy, offline use and adaptation", () => {
    const readme = readFileSync(path.join(folder, "README.md"), "utf8");
    const prose = readme.replace(/\s+/g, " ");
    expect(readme).toContain("`{}`");
    for (const field of ["place", "latitude", "longitude", "units", "forecast"]) expect(readme).toContain(`\`${field}\``);
    expect(prose).toMatch(/latitude[\s\S]*-90[\s\S]*90/i);
    expect(prose).toMatch(/longitude[\s\S]*-180[\s\S]*180/i);
    expect(prose).toMatch(/celsius[\s\S]*fahrenheit/i);
    expect(prose).toMatch(/town-level[\s\S]*coordinates[\s\S]*IP address/i);
    expect(readme).toContain('tv resource json set --artifact "$ARTIFACT_ID" \'{"place":"San Francisco","latitude":37.7749,"longitude":-122.4194,"units":"celsius"}\'');
    expect(readme).toContain('tv resource json set --artifact "$ARTIFACT_ID" place \'"San Francisco Bay Area"\'');
    expect(readme).toContain('tv resource json update --artifact "$ARTIFACT_ID" \'{"place":"New York","latitude":40.7128,"longitude":-74.006}\'');
    expect(readme).toContain('tv resource json set --artifact "$ARTIFACT_ID" units \'"fahrenheit"\'');
    expect(readme).toContain('tv resource json set --artifact "$ARTIFACT_ID" \'{}\'');
    expect(prose).toMatch(/do not (?:write|edit)[\s\S]*`forecast`/i);
    expect(prose).toMatch(/Open-Meteo[\s\S]*fetch[\s\S]*cache/i);
    expect(prose).toMatch(/offline[\s\S]*saved forecast/i);
    expect(prose).toMatch(/read-only[\s\S]*does not save/i);
    expect(prose).toMatch(/shows forecast data[\s\S]*credits/i);
    expect(prose).toMatch(/external[ -]network[\s\S]*fresh forecast/i);
    expect(readme).toContain("`styles.css`");
    expect(readme).toContain("`artwork.svg`");
    expect(prose).toMatch(/transparent[\s\S]*creation/i);
  });
});

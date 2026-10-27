import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectTemplateIcon, validateTemplatePackage } from "../src/templates.ts";

const folder = path.resolve(import.meta.dirname, "../assets/templates/map");
const repoRoot = path.resolve(import.meta.dirname, "../../..");

function specifiedSchema(): unknown {
  const spec = readFileSync(path.join(repoRoot, "specs/arch/templates/map.md"), "utf8");
  const block = spec.match(/## Store[\s\S]*?```json\n([\s\S]*?)\n```/);
  if (!block?.[1]) throw new Error("Map architecture spec has no store-schema JSON block");
  return JSON.parse(block[1]);
}

describe("bundled Map package", () => {
  // proofs/arch/templates/map.md#^templates-map-t-package
  it("ships the exact Map package contract", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      name: "Map",
      description: "An interactive map with category colours and icons, a floating place list, photos, and detailed place information.",
      version: "2.0.0",
      icons: [{ src: "icon.svg", type: "image/svg+xml" }],
    });
    expect(manifest).not.toHaveProperty("display");
    expect(manifest.dataSchema).toEqual(specifiedSchema());
    expect(JSON.parse(readFileSync(path.join(folder, "data.json"), "utf8"))).toEqual({});

    expect(readdirSync(folder).sort()).toEqual([
      "README.md",
      "THIRD-PARTY-NOTICES.txt",
      "data.json",
      "icon.svg",
      "icons.svg",
      "index.html",
      "manifest.json",
      "map.css",
      "map.js",
      "vendor",
    ].sort());
    expect(existsSync(path.join(folder, "examples"))).toBe(false);
    expect(existsSync(path.join(folder, "photos"))).toBe(false);

    const html = readFileSync(path.join(folder, "index.html"), "utf8");
    expect(html.indexOf('/canonical/v2/styles.css')).toBeGreaterThan(-1);
    expect(html.indexOf("./map.css")).toBeGreaterThan(html.indexOf('/canonical/v2/styles.css'));
    for (const dependency of [
      "/canonical/v2/components.js",
      "./vendor/leaflet.js",
      "./vendor/leaflet.css",
      "./map.js",
    ]) expect(html).toContain(dependency);

    const source = readFileSync(path.join(folder, "map.js"), "utf8");
    expect(source).toContain("/sdk/v1/resources.js");
    expect(source).toContain("server.arcgisonline.com/ArcGIS/rest/services/");
    expect(source).toContain("Tiles © Esri");
    expect(source).toContain("Imagery © Esri, Maxar, Earthstar Geographics, GIS User Community");
    expect(source).toContain("Labels © Esri");

    const readme = readFileSync(path.join(folder, "README.md"), "utf8");
    for (const field of [
      "title", "subtitle", "numbered", "basemap", "sidebar", "categories", "places",
      "name", "icon", "color", "lat", "lng", "order", "category", "description", "photo", "credit", "fields",
    ]) expect(readme).toContain(`\`${field}\``);
    expect(readme).toContain('tv resource json set --artifact "$ARTIFACT_ID" places/place-01');
    expect(readme).toContain('tv resource json remove --artifact "$ARTIFACT_ID" places/place-01');
    expect(readme).not.toMatch(/tv resource json push/);
    expect(readme).toMatch(/Esri.*network/i);
    expect(readme).toMatch(/never writes|does not write/i);
  });

  // proofs/arch/templates/map.md#^templates-map-t-icon
  it("supplies its SVG icon to the Toolbox", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest.icons).toEqual([{ src: "icon.svg", type: "image/svg+xml" }]);
    const { template } = validateTemplatePackage(folder, "map");
    expect(selectTemplateIcon(template!)).toEqual({
      path: realpathSync(path.join(folder, "icon.svg")),
      contentType: "image/svg+xml",
    });
  });
});

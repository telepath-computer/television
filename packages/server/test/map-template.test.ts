import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
      version: "2.1.0",
      icons: [{ src: "icon.svg", type: "image/svg+xml" }],
    });
    expect(manifest).not.toHaveProperty("display");
    expect(manifest.dataSchema).toEqual(specifiedSchema());
    expect(JSON.parse(readFileSync(path.join(folder, "data.json"), "utf8"))).toEqual({});

    for (const file of [
      "README.md",
      "THIRD-PARTY-NOTICES.txt",
      "data.json",
      "icon.svg",
      "icons.svg",
      "index.html",
      "manifest.json",
      "map.css",
      "map.js",
      "map-model.js",
      "vendor/LICENSE",
      "vendor/leaflet.css",
      "vendor/leaflet.js",
      "vendor/lucide/LICENSE",
      "vendor/lucide/README.md",
      "vendor/lucide/icons.js",
    ]) expect(existsSync(path.join(folder, file)), file).toBe(true);

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
    expect(source).toContain("from './vendor/lucide/icons.js'");
    expect(source).toContain("server.arcgisonline.com/ArcGIS/rest/services/");
  });

  // proofs/arch/templates/map.md#^templates-map-t-readme
  it("documents Map data and scoped agent writes", () => {
    const readme = readFileSync(path.join(folder, "README.md"), "utf8");
    for (const field of [
      "title", "subtitle", "numbered", "basemap", "sidebar", "categories", "places",
      "name", "icon", "color", "lat", "lng", "order", "category", "description", "photo", "credit", "fields",
    ]) expect(readme).toContain(`\`${field}\``);
    expect(readme).toContain('tv resource json set --artifact "$ARTIFACT_ID" places/place-01');
    expect(readme).toContain('tv resource json remove --artifact "$ARTIFACT_ID" places/place-01');
    expect(readme).not.toMatch(/tv resource json push/);
    expect(readme).toMatch(/new Map starts with `\{\}`/i);
    expect(readme).toMatch(/JSON store(?:'s)? key order/i);
    expect(readme).toMatch(/push IDs.*do not fit.*schema/i);
    expect(readme).toMatch(/place.*under any.*key/i);
    expect(readme).toMatch(/categor(?:y|ies).*badly keyed|badly keyed categor/i);
    expect(readme).toMatch(/properties the schema does not name are ignored/i);
    expect(readme).toMatch(/does not fit the schema.*absent/i);
    expect(readme).toMatch(/`order` sorts ascending.*omitted values last.*keys breaking ties/i);
    expect(readme).toMatch(/Untitled place/);
    expect(readme).toMatch(/Supported icons/);
    expect(readme).toMatch(/red.*orange.*yellow.*green.*cyan.*blue.*purple.*pink.*neutral/i);
    expect(readme).toMatch(/explicitly coloured categories do not consume an automatic slot/i);
    expect(readme).toMatch(/photo.*HTTPS/i);
    expect(readme).toMatch(/credit.*HTTPS/i);
    expect(readme).toMatch(/viewer-local/i);
    expect(readme).toMatch(/stored `sidebar` or `basemap` value overrides/i);
    expect(readme).toMatch(/Esri.*network/i);
    expect(readme).toMatch(/never writes|does not write/i);
  });

  // proofs/arch/templates/map.md#^templates-map-t-media-values
  it("accepts only safe local photos and HTTPS media links", async () => {
    const model = await import(pathToFileURL(path.join(folder, "map-model.js")).href) as {
      httpsURL(value: unknown): string | null;
      photoURL(value: unknown): string | null;
    };

    expect(model.photoURL("photo.jpg")).toBe("photo.jpg");
    expect(model.photoURL("./photos/My photo.jpg")).toBe("photos/My photo.jpg");
    expect(model.photoURL("https://example.com/My%20photo.jpg?size=2#credit")).toBe("https://example.com/My%20photo.jpg?size=2#credit");
    for (const value of [
      "http://example.com/photo.jpg",
      "/photo.jpg",
      " photo.jpg",
      "photo.jpg ",
      "photos//photo.jpg",
      "./../photo.jpg",
      "photos/./photo.jpg",
      "photos/../photo.jpg",
      "photos\\photo.jpg",
      "photos:photo.jpg",
      "photo%2Ejpg",
      "photo.jpg?size=2",
      "photo.jpg#credit",
      "photo\u0000.jpg",
      42,
    ]) expect(model.photoURL(value), String(value)).toBeNull();

    expect(model.httpsURL("https://example.com/source?photo=1#credit")).toBe("https://example.com/source?photo=1#credit");
    for (const value of [
      "http://example.com/source",
      "https://example.com/source credit",
      "https://example.com/source\u0000",
      "https://",
      null,
    ]) expect(model.httpsURL(value), String(value)).toBeNull();
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

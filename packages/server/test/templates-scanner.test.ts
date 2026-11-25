import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanTemplatesDirectory, selectTemplateIcon } from "../src/templates.ts";

const homes: string[] = [];

function home(): string {
  const created = mkdtempSync(path.join(os.tmpdir(), "tv-templates-scan-"));
  homes.push(created);
  return created;
}

function template(root: string, id: string, manifest: unknown = {
  name: "Sample",
  description: "A sample page",
  version: "1.2.3",
}): string {
  const folder = path.join(root, id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(path.join(folder, "index.html"), "<!doctype html><title>Sample</title>");
  return folder;
}

afterEach(() => {
  for (const folder of homes.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("artifact template scanner", () => {
  // proofs/arch/templates/index.md#^templates-t-package
  it("preserves exact IDs, validates package files, and reports every defect in an invalid folder", () => {
    const root = path.join(home(), "templates");
    const valid = template(root, "Space #One", {
      name: "Sample", description: "A sample page", version: "1.2.3-alpha.1+build.7", ignored: "not returned",
    });
    writeFileSync(path.join(valid, "data.json"), "null");
    template(root, ".backup");
    writeFileSync(path.join(root, "ordinary-file"), "ignored");
    const broken = template(root, "broken", { name: " ", description: "", version: "v1" });
    rmSync(path.join(broken, "index.html"));
    writeFileSync(path.join(broken, "data.json"), "not JSON");

    const result = scanTemplatesDirectory(root);
    expect(result.templates).toEqual([{
      id: "Space #One", name: "Sample", description: "A sample page", version: "1.2.3-alpha.1+build.7",
      path: valid, hasIcon: false,
    }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.folder).toBe("broken");
    expect(result.errors[0]?.error).toMatch(/name/);
    expect(result.errors[0]?.error).toMatch(/description/);
    expect(result.errors[0]?.error).toMatch(/Semantic Version/);
    expect(result.errors[0]?.error).toMatch(/index\.html/);
    expect(result.errors[0]?.error).toMatch(/data\.json/);
  });

  // proofs/arch/templates/index.md#^templates-t-package
  it("validates starting data readability, JSON, store limits and schema without exposing it in records", () => {
    const root = path.join(home(), "templates");
    for (const [id, bytes] of [
      ["oversized", JSON.stringify("x".repeat(1_048_577))], ["invalid-json", "not JSON"],
      ["nonfinite", "1e400"], ["invalid-key", JSON.stringify({ ["x".repeat(769)]: true })],
      ["too-deep", "[".repeat(34) + "null" + "]".repeat(34)],
    ]) writeFileSync(path.join(template(root, id!), "data.json"), bytes!);
    symlinkSync(path.join(root, "missing.json"), path.join(template(root, "unreadable"), "data.json"));
    mkdirSync(path.join(template(root, "directory"), "data.json"));
    const schema = { type: "object", properties: { message: { type: "string" } }, required: ["message"] };
    for (const [id, value] of [["missing-field", {}], ["wrong-field", { message: 42 }], ["valid", { message: "Ready" }]] as const) {
      const folder = template(root, id, { name: id, description: "Page", version: "1.0.0", dataSchema: schema });
      writeFileSync(path.join(folder, "data.json"), JSON.stringify(value));
    }
    writeFileSync(path.join(template(root, "null"), "data.json"), "null");
    const scan = scanTemplatesDirectory(root);
    expect(scan.templates.map(({ id }) => id)).toEqual(["null", "valid"]);
    expect(scan.errors).toHaveLength(9);
    for (const error of scan.errors) expect(error.error).toContain("data.json");
    for (const id of ["missing-field", "wrong-field"]) {
      const error = scan.errors.find((entry) => entry.folder === id)!.error;
      expect(error).toContain("message");
      expect(error).toContain("tv templates show");
    }
    for (const record of scan.templates) {
      expect(record).not.toHaveProperty("data");
      expect(record).not.toHaveProperty("hasData");
    }
  });

  // proofs/arch/templates/index.md#^templates-t-package
  it("uses a trimmed HTTP(S) URL even without a page and rejects other URL forms, starting data or schemas", () => {
    const root = path.join(home(), "templates");
    for (const [id, url, page] of [["https", "  https://example.com/path?q=1  ", false], ["http", "http://example.com", true]] as const) {
      const folder = template(root, id, { name: id, description: "Site", version: "1.0.0", url });
      if (!page) rmSync(path.join(folder, "index.html"));
    }
    for (const [id, url] of [["relative", "/path"], ["scheme", "file:///tmp/page"], ["empty", " "], ["number", 3], ["null", null]]) {
      template(root, String(id), { name: id, description: "Invalid site", version: "1.0.0", url });
    }
    template(root, "url-schema", { name: "Invalid", description: "Site", version: "1.0.0", url: "https://example.com", dataSchema: false });
    for (const id of ["url-data", "url-broken-data"]) {
      const folder = template(root, id, { name: id, description: "Site", version: "1.0.0", url: "https://example.com" });
      if (id === "url-data") writeFileSync(path.join(folder, "data.json"), "null");
      else symlinkSync("missing.json", path.join(folder, "data.json"));
    }
    const scan = scanTemplatesDirectory(root);
    expect(scan.templates.map(({ id, url }) => ({ id, url }))).toEqual([
      { id: "http", url: "http://example.com" }, { id: "https", url: "https://example.com/path?q=1" },
    ]);
    expect(scan.errors).toHaveLength(8);
    for (const error of scan.errors) expect(error.error).toMatch(/url|dataSchema|data\.json/);
  });

  // proofs/arch/templates/index.md#^templates-t-schema
  it.each([
    true, false, { type: "object" },
    { $schema: "https://json-schema.org/draft/2020-12/schema", type: "string" },
    { $defs: { text: { type: "string" } }, properties: { message: { $ref: "#/$defs/text" } } },
    { $defs: { unused: { $ref: "https://example.com/external" } } },
  ])("accepts a self-contained Draft 2020-12 schema: %j", (dataSchema) => {
    const root = path.join(home(), "templates");
    template(root, "schema", { name: "Schema", description: "Page", version: "1.0.0", dataSchema });
    const scan = scanTemplatesDirectory(root);
    expect(scan.errors).toEqual([]);
    expect(scan.templates[0]?.dataSchema).toEqual(dataSchema);
  });

  // proofs/arch/templates/index.md#^templates-t-schema
  it.each([
    [null, "dataSchema"], [[], "dataSchema"], [{ type: "nonsense" }, "type"],
    [{ $id: 42 }, "dataSchema"],
    [{ $schema: "http://json-schema.org/draft-07/schema#" }, "$schema"],
    [{ $async: true }, "$async is not supported in dataSchema"],
    [{ $async: false }, "$async is not supported in dataSchema"],
    [{ $ref: "#/$defs/missing" }, "ref"], [{ $ref: "#/name" }, "ref"],
    [{ $ref: "https://example.com/external" }, "ref"],
  ])("rejects an invalid or escaping schema with an inspection hint: %j", (dataSchema, field) => {
    const root = path.join(home(), "templates");
    template(root, "Space #One", { name: "Schema", description: "Page", version: "1.0.0", dataSchema });
    const scan = scanTemplatesDirectory(root);
    expect(scan.templates).toEqual([]);
    expect(scan.errors).toHaveLength(1);
    expect(scan.errors[0]?.error).toContain(field);
    expect(scan.errors[0]?.error).toContain("tv templates show");
    expect(scan.errors[0]?.error).toContain("Space #One");
  });

  // proofs/arch/templates/index.md#^templates-t-display-scan
  // proofs/arch/templates/index.md#^templates-t-transparent-scan
  it("keeps validated display fields and omits unknown manifest fields", () => {
    const root = path.join(home(), "templates");
    template(root, "without-display");
    template(root, "partial", {
      name: "Partial", description: "A page", version: "1.0.0", ignored: "root",
      display: { width: 360.5, fullScreen: false, futureOption: "ignored" },
    });
    for (const transparent of [true, false]) {
      template(root, `transparent-${transparent}`, {
        name: "Transparency", description: "A page", version: "1.0.0",
        display: { height: 420, fullScreen: true, transparent, futureOption: "ignored" },
      });
    }

    const scan = scanTemplatesDirectory(root);
    expect(scan.errors).toEqual([]);
    expect(scan.templates.find(({ id }) => id === "without-display")).not.toHaveProperty("display");
    expect(scan.templates.find(({ id }) => id === "partial")).toMatchObject({
      display: { width: 360.5, fullScreen: false },
    });
    expect(scan.templates.find(({ id }) => id === "partial")).not.toHaveProperty("ignored");
    expect(scan.templates.find(({ id }) => id === "partial")?.display).toEqual({ width: 360.5, fullScreen: false });
    for (const transparent of [true, false]) {
      expect(scan.templates.find(({ id }) => id === `transparent-${transparent}`)?.display)
        .toEqual({ height: 420, fullScreen: true, transparent });
    }
  });

  // proofs/arch/templates/index.md#^templates-t-display-scan
  // proofs/arch/templates/index.md#^templates-t-transparent-scan
  it.each([
    ["display", '"display":null', "display"],
    ["array display", '"display":[]', "display"],
    ["width", '"display":{"width":0}', "width"],
    ["negative height", '"display":{"height":-4}', "height"],
    ["nonfinite width", '"display":{"width":1e400}', "width"],
    ["nonnumeric height", '"display":{"height":"large"}', "height"],
    ["fullScreen", '"display":{"fullScreen":"yes"}', "fullScreen"],
    ["string transparency", '"display":{"transparent":"true"}', "transparent"],
    ["numeric transparency", '"display":{"transparent":1}', "transparent"],
    ["null transparency", '"display":{"transparent":null}', "transparent"],
  ])("rejects invalid %s in a manifest and names its field", (_case, displaySource, field) => {
    const root = path.join(home(), "templates");
    const folder = template(root, "invalid");
    writeFileSync(path.join(folder, "manifest.json"),
      `{"name":"Invalid","description":"A page","version":"1.0.0",${displaySource}}`);

    const scan = scanTemplatesDirectory(root);
    expect(scan.templates).toEqual([]);
    expect(scan.errors).toHaveLength(1);
    expect(scan.errors[0]).toMatchObject({ folder: "invalid", error: expect.stringContaining(field) });
  });

  // proofs/arch/templates/index.md#^templates-t-scan
  it("rescans current folders, sorts names and IDs in English, and reports a directory read failure", () => {
    const root = path.join(home(), "templates");
    template(root, "z", { name: "Alpha", description: "A", version: "1.0.0" });
    template(root, "a", { name: "Alpha", description: "A", version: "1.0.0" });
    template(root, "b", { name: "Beta", description: "B", version: "1.0.0" });
    const broken = template(root, "c");
    rmSync(path.join(broken, "manifest.json"));
    expect(scanTemplatesDirectory(root).templates.map(({ id }) => id)).toEqual(["a", "z", "b"]);
    for (const id of ["Z-invalid", "a-invalid", "Á-invalid"]) template(root, id, {});
    expect(scanTemplatesDirectory(root).errors.map(({ folder }) => folder))
      .toEqual(["a-invalid", "Á-invalid", "c", "Z-invalid"]);
    template(root, "new", { name: "Aardvark", description: "A", version: "1.0.0" });
    expect(scanTemplatesDirectory(root).templates.map(({ id }) => id)).toEqual(["new", "a", "z", "b"]);
    rmSync(root, { recursive: true });
    writeFileSync(root, "not a directory");
    expect(scanTemplatesDirectory(root)).toEqual({
      templates: [], errors: [{ folder: null, error: expect.stringContaining("templates directory") }], watching: false,
    });
  });

  // proofs/arch/templates/index.md#^templates-t-icons
  it("ignores unusable icons without invalidating the package and preserves usable manifest order", () => {
    const root = home();
    const folder = template(root, "icons");
    writeFileSync(path.join(folder, "image.SVG"), "<svg/>");
    writeFileSync(path.join(folder, "image.png"), "broken bytes still select a local file");
    writeFileSync(path.join(root, "outside.svg"), "<svg/>");
    symlinkSync(path.join(root, "outside.svg"), path.join(folder, "escape.svg"));
    symlinkSync("image.SVG", path.join(folder, "inside.svg"));
    symlinkSync("missing.svg", path.join(folder, "missing.svg"));
    const icons = [
      null, {}, { src: "" }, { src: "https://example.com/icon.svg" }, { src: "/image.svg" },
      { src: "../outside.svg" }, { src: "escape.svg" }, { src: "missing.svg" },
      { src: "image.SVG", type: "image/jpeg" }, { src: "image.SVG", purpose: "maskable monochrome" },
      { src: "image.SVG", type: 4, sizes: "nonsense 0x40 40x-1 40x40", extra: "ignored" },
      { src: "inside.svg", purpose: "maskable any", sizes: "any" },
      { src: "image.png", type: "", purpose: "any", sizes: "invalid" },
    ];
    const writeIcons = (value: unknown) => writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({
      name: "Icons", description: "Page", version: "1.0.0", icons: value,
    }));
    writeIcons(icons);
    const scan = scanTemplatesDirectory(root);
    expect(scan.errors).toEqual([]);
    expect(scan.templates[0]).toMatchObject({ hasIcon: true, icons: [
      { src: "image.SVG", type: "image/svg+xml", sizes: "40x40" },
      { src: "inside.svg", type: "image/svg+xml", purpose: "maskable any", sizes: "any" },
      { src: "image.png", type: "image/png", purpose: "any" },
    ] });
    for (const absent of [null, {}, "image.svg", [], [{ src: "escape.svg" }]]) {
      writeIcons(absent);
      const record = scanTemplatesDirectory(root).templates[0];
      expect(record).toMatchObject({ hasIcon: false });
      expect(record).not.toHaveProperty("icons");
    }
  });

  it.each([
    ["SVG before sized PNG", [{ src: "large.png", sizes: "56x56" }, { src: "vector.svg" }], "vector.svg"],
    ["any and SVG tie in manifest order", [{ src: "large.png", sizes: "any" }, { src: "vector.svg" }], "large.png"],
    ["smallest sufficient shorter dimension", [{ src: "large.png", sizes: "100x60" }, { src: "small.png", sizes: "56x80" }], "small.png"],
    ["both axes meet target", [{ src: "small.png", sizes: "80x20" }, { src: "large.png", sizes: "60x56" }], "large.png"],
    ["largest undersized", [{ src: "small.png", sizes: "20x30" }, { src: "large.png", sizes: "55x100" }], "large.png"],
    ["32px and 48px are undersized for the 28px slot", [{ src: "tiny.png", sizes: "32x32" }, { src: "small.png", sizes: "48x48" }, { src: "large.png", sizes: "192x192" }], "large.png"],
    ["best of multiple declared sizes", [{ src: "large.png", sizes: "16x16 48x48 128x128" }, { src: "small.png", sizes: "64x64" }], "small.png"],
    ["read dimensions when hints are absent", [{ src: "large.png" }, { src: "small.png", sizes: "invalid" }], "large.png"],
    ["unsized after sized", [{ src: "broken.png" }, { src: "small.png", sizes: "16x16" }], "small.png"],
    ["unsized still selects", [{ src: "broken.png" }], "broken.png"],
    ["ties use manifest order", [{ src: "large.png", sizes: "56x56" }, { src: "small.png", sizes: "56x56" }], "large.png"],
    ["supported type hint without extension", [{ src: "untyped", type: "image/svg+xml" }], "untyped"],
  ])("selects icons by %s", (_case, icons, expected) => {
    const root = home();
    const folder = template(root, "icons", { name: "Icons", description: "Page", version: "1.0.0", url: "https://example.com", icons });
    // Only PNG metadata is read here; browser decoding has its own seam.
    for (const [file, size] of [["tiny.png", 32], ["small.png", 48], ["large.png", 96]] as const) {
      const png = Buffer.alloc(24);
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
      png.write("IHDR", 12);
      png.writeUInt32BE(size, 16);
      png.writeUInt32BE(size, 20);
      writeFileSync(path.join(folder, file), png);
    }
    writeFileSync(path.join(folder, "broken.png"), "broken");
    writeFileSync(path.join(folder, "vector.svg"), "<svg/>");
    writeFileSync(path.join(folder, "untyped"), "<svg/>");
    const record = scanTemplatesDirectory(root).templates[0]!;
    expect(record.hasIcon).toBe(true);
    expect(selectTemplateIcon(record)?.path).toBe(path.join(folder, expected as string));
  });

});

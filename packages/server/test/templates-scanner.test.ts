import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanTemplatesDirectory } from "../src/templates.ts";

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
    writeFileSync(path.join(valid, "thumbnail.png"), Buffer.from([137, 80, 78, 71]));
    template(root, ".backup");
    writeFileSync(path.join(root, "ordinary-file"), "ignored");
    const broken = template(root, "broken", { name: " ", description: "", version: "v1" });
    rmSync(path.join(broken, "index.html"));
    writeFileSync(path.join(broken, "data.json"), "not JSON");

    const result = scanTemplatesDirectory(root);
    expect(result.templates).toEqual([{
      id: "Space #One", name: "Sample", description: "A sample page", version: "1.2.3-alpha.1+build.7",
      path: valid, hasData: true, hasThumbnail: true,
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
  it("rejects oversized data and excludes thumbnails that escape the real folder", () => {
    const root = path.join(home(), "templates");
    const oversized = template(root, "oversized");
    writeFileSync(path.join(oversized, "data.json"), JSON.stringify("x".repeat(1_048_577)));
    const linked = template(root, "linked");
    const outside = path.join(path.dirname(root), "outside.png");
    writeFileSync(outside, "outside");
    symlinkSync(outside, path.join(linked, "thumbnail.png"));
    const unreadableData = template(root, "unreadable-data");
    symlinkSync(path.join(root, "missing-data.json"), path.join(unreadableData, "data.json"));

    const result = scanTemplatesDirectory(root);
    expect(result.errors).toEqual([
      { folder: "oversized", error: expect.stringMatching(/1048576|too.large|at most/i) },
      { folder: "unreadable-data", error: expect.stringMatching(/data\.json/) },
    ]);
    expect(result.templates).toMatchObject([{ id: "linked", hasThumbnail: false }]);
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
    expect(scanTemplatesDirectory(root).errors.map(({ folder }) => folder)).toEqual(["c"]);
    template(root, "new", { name: "Aardvark", description: "A", version: "1.0.0" });
    expect(scanTemplatesDirectory(root).templates.map(({ id }) => id)).toEqual(["new", "a", "z", "b"]);
    rmSync(root, { recursive: true });
    writeFileSync(root, "not a directory");
    expect(scanTemplatesDirectory(root)).toEqual({
      templates: [], errors: [{ folder: null, error: expect.stringContaining("templates directory") }],
    });
  });
});

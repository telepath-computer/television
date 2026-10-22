import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_ARTIFACT_TEMPLATE_IDS, BUNDLED_ARTIFACT_TEMPLATES } from "../src/bundled-template-installer.ts";

const sourceRoot = path.resolve(import.meta.dirname, "../assets/templates");
const folder = path.join(sourceRoot, "checklist");
const require = createRequire(import.meta.url);
const { PNG } = require("playwright-core/lib/utilsBundle") as {
  PNG: { sync: { read(bytes: Buffer): { width: number; height: number; data: Buffer } } };
};

describe("bundled Checklist package", () => {
  // proofs/arch/templates/bundled-templates.md#^templates-bundled-t-inventory
  it("ships Checklist and Calendar with their exact inventory identities and minimum versions", () => {
    expect(readdirSync(sourceRoot).sort()).toEqual(["calendar", "checklist"]);
    expect(BUNDLED_ARTIFACT_TEMPLATE_IDS).toEqual(["checklist", "calendar"]);
    expect(BUNDLED_ARTIFACT_TEMPLATES).toEqual([
      { id: "checklist", minimumVersion: "1.0.0" },
      { id: "calendar", minimumVersion: "1.0.0" },
    ]);
    expect(JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"))).toMatchObject({
      name: "Checklist", description: "A list of items to tick off and edit.", version: "1.0.0",
    });
    expect(JSON.parse(readFileSync(path.join(sourceRoot, "calendar/manifest.json"), "utf8"))).toMatchObject({
      name: "Calendar", description: "Show one to seven days of live events, including all-day events and highlighted moments.", version: "1.0.0",
    });
  });

  // proofs/arch/templates/checklist.md#^templates-checklist-t-package
  it("provides the page, exact empty seed, and 640 by 800 display using the shared fullscreen default", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest.display).toEqual({ width: 640, height: 800 });
    expect(manifest.display).not.toHaveProperty("fullScreen");
    expect(existsSync(path.join(folder, "index.html"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(folder, "data.json"), "utf8"))).toEqual({ title: "Checklist", items: {} });
  });

  // proofs/arch/templates/checklist.md#^templates-checklist-t-thumbnail
  it("decodes a complete portrait PNG with a 4 to 5 aspect ratio", () => {
    const image = PNG.sync.read(readFileSync(path.join(folder, "thumbnail.png")));
    expect(image.width).toBeGreaterThan(0);
    expect(image.width * 5).toBe(image.height * 4);
    expect(image.data.length).toBe(image.width * image.height * 4);
  });

  // proofs/arch/templates/checklist.md#^templates-checklist-t-readme
  // Content checks accompany human-readable guidance review; the UI suite runs these commands.
  it("documents the shared store shape, ordering, whole-value errors, and scoped agent commands", () => {
    const readme = readFileSync(path.join(folder, "README.md"), "utf8");
    for (const field of ["title", "items", "order", "text", "done"]) expect(readme).toContain(`\`${field}\``);
    expect(readme).toMatch(/tv resource json set --artifact "\$ARTIFACT_ID" title /);
    expect(readme).toMatch(/tv resource json push --artifact "\$ARTIFACT_ID" items '\{"order":\d+,"text":"[^"]+","done":false\}'/);
    expect(readme).toMatch(/tv resource json set --artifact "\$ARTIFACT_ID" "items\/\$ITEM_KEY" '\{"order":\d+,"text":"[^"]+","done":(?:true|false)\}'/);
    expect(readme).toContain('tv resource json remove --artifact "$ARTIFACT_ID" "items/$ITEM_KEY"');
  });
});

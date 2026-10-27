import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_ARTIFACT_TEMPLATE_IDS, BUNDLED_ARTIFACT_TEMPLATES } from "../src/bundled-template-installer.ts";
import { selectTemplateIcon, validateTemplatePackage } from "../src/templates.ts";

const sourceRoot = path.resolve(import.meta.dirname, "../assets/templates");
const folder = path.join(sourceRoot, "checklist");

describe("bundled Checklist package", () => {
  // proofs/arch/templates/bundled-templates.md#^templates-bundled-t-inventory
  it("ships Checklist, Calendar, Sticky note and Table with their exact inventory identities and minimum versions", () => {
    expect(readdirSync(sourceRoot).sort()).toEqual(["checklist", "calendar", "sticky-note", "table"].sort());
    expect(BUNDLED_ARTIFACT_TEMPLATE_IDS).toEqual(["checklist", "calendar", "sticky-note", "table"]);
    expect(BUNDLED_ARTIFACT_TEMPLATES).toEqual([
      { id: "checklist", minimumVersion: "1.0.0" },
      { id: "calendar", minimumVersion: "1.0.0" },
      { id: "sticky-note", minimumVersion: "1.0.0" },
      { id: "table", minimumVersion: "1.0.0" },
    ]);
    expect(JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"))).toMatchObject({
      name: "Checklist", description: "A list of items to tick off and edit.", version: "1.0.0",
    });
    expect(JSON.parse(readFileSync(path.join(sourceRoot, "calendar/manifest.json"), "utf8"))).toMatchObject({
      name: "Calendar", description: "Show one to seven days of live events, including all-day events and highlighted moments.", version: "1.0.0",
    });
    expect(JSON.parse(readFileSync(path.join(sourceRoot, "sticky-note/manifest.json"), "utf8"))).toMatchObject({
      name: "Sticky note", description: "A yellow note to type into; an agent can write on it too.", version: "1.0.0",
    });
    expect(JSON.parse(readFileSync(path.join(sourceRoot, "table/manifest.json"), "utf8"))).toMatchObject({
      name: "Table", description: "An editable table to fill by hand or with an agent.", version: "1.0.0",
    });
  });

  // proofs/arch/templates/checklist.md#^templates-checklist-t-package
  it("provides the page, store schema, exact empty seed, and 640 by 800 display using the shared fullscreen default", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest.display).toEqual({ width: 640, height: 800 });
    expect(manifest.display).not.toHaveProperty("fullScreen");
    expect(existsSync(path.join(folder, "index.html"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(folder, "data.json"), "utf8"))).toEqual({ title: "Checklist", items: {} });
    // The store schema, as specs/arch/templates/checklist.md (^bundled-artifact-template-checklist-store) states it.
    expect(manifest.dataSchema).toEqual({
      "type": "object",
      "required": ["title", "items"],
      "properties": {
        "title": { "type": "string" },
        "items": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "required": ["order", "text", "done"],
            "properties": {
              "order": { "type": "number" },
              "text": { "type": "string" },
              "done": { "type": "boolean" }
            }
          }
        }
      }
    });
  });

  // proofs/arch/templates/checklist.md#^templates-checklist-t-icon
  it("supplies its SVG icon to the Toolbox", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest.icons).toEqual([{ src: "icon.svg", type: "image/svg+xml" }]);
    const { template } = validateTemplatePackage(folder, "checklist");
    expect(selectTemplateIcon(template!)).toEqual({ path: realpathSync(path.join(folder, "icon.svg")), contentType: "image/svg+xml" });
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

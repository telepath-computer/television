import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectTemplateIcon, validateTemplatePackage } from "../src/templates.ts";

const folder = path.resolve(import.meta.dirname, "../assets/templates/table");

describe("bundled Table package", () => {
  // Contract: proofs/arch/templates/table.md#^templates-table-t-package.
  it("provides the page, exact store schema and exact empty seed using the shared display default", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest).not.toHaveProperty("display");
    expect(existsSync(path.join(folder, "index.html"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(folder, "data.json"), "utf8"))).toEqual({ columns: {}, rows: {} });
    expect(manifest.dataSchema).toEqual({
      type: "object",
      required: ["columns", "rows"],
      properties: {
        headerRow: { type: "boolean" },
        columns: {
          type: "object",
          additionalProperties: {
            type: "object",
            required: ["order"],
            properties: {
              order: { type: "number" },
              width: { type: "number", exclusiveMinimum: 0 },
            },
          },
        },
        rows: {
          type: "object",
          additionalProperties: {
            type: "object",
            required: ["order", "cells"],
            properties: {
              order: { type: "number" },
              height: { type: "number", exclusiveMinimum: 0 },
              cells: {
                type: "object",
                additionalProperties: { type: ["string", "number", "boolean"] },
              },
            },
          },
        },
      },
    });
  });

  // Cheap source check for ^templates-table-t-assets; its browser seam checks the served files.
  it("loads the canonical stylesheet before its own stylesheet, and the canonical components", () => {
    const page = readFileSync(path.join(folder, "index.html"), "utf8");
    expect(page.indexOf('/canonical/v2/styles.css?authoredForAppVersion=1.5.4')).toBeLessThan(page.indexOf("./styles.css"));
    expect(page).toContain('<script type="module" src="/canonical/v2/components.js"></script>');
  });

  // Contract: proofs/arch/templates/table.md#^templates-table-t-icon.
  it("supplies its SVG icon to the Toolbox", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest.icons).toEqual([{ src: "icon.svg", type: "image/svg+xml" }]);
    const { template } = validateTemplatePackage(folder, "table");
    expect(selectTemplateIcon(template!)).toEqual({ path: realpathSync(path.join(folder, "icon.svg")), contentType: "image/svg+xml" });
  });

  // Contract: proofs/arch/templates/table.md#^templates-table-t-readme.
  // Review establishes the meaning; these checks keep the concrete commands and warnings present.
  it("documents the shared editable store, header row, saved sizes, opaque keys and scoped commands", () => {
    const readme = readFileSync(path.join(folder, "README.md"), "utf8");
    const prose = readme.replace(/\s+/g, " ");
    const firstExample = JSON.parse(readme.match(/```json\n([\s\S]*?)\n```/)![1]);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(Object.keys(firstExample.columns).every(key => uuid.test(key))).toBe(true);
    expect(Object.keys(firstExample.rows).every(key => uuid.test(key))).toBe(true);
    for (const field of ["headerRow", "columns", "rows", "order", "width", "height", "cells"]) {
      expect(readme).toContain(`\`${field}\``);
    }
    expect(prose).toMatch(/cells[^.]*object keyed by column key[^.]*never an array/i);
    expect(prose).toMatch(/empty cells[^.]*left out/i);
    expect(prose).toMatch(/cell values[^.]*strings[^.]*numbers[^.]*booleans[^.]*other values[^.]*blank/i);
    expect(prose).toMatch(/drawn positions[^.]*not stored/i);
    expect(prose).toMatch(/B3[^.]*columns A and B[^.]*rows 1 through 3/i);
    expect(prose).toMatch(/never derive[^.]*title[^.]*never reuse/i);
    expect(prose).toMatch(/fresh random key[^.]*UUID[^.]*every row and column/i);
    expect(prose).toMatch(/push[^.]*normal way[^.]*one (?:row|column|entry)/i);
    expect(prose).toMatch(/distinct finite[^.]*order/i);
    expect(prose).toMatch(/adding at the end[^.]*order[^.]*greater than the last displayed entry/i);
    expect(prose).toMatch(/do not repair[^.]*without an order/i);
    expect(prose).toMatch(/number or boolean[\s\S]*writes[^.]*string/i);
    expect(prose).toMatch(/header row[^.]*first displayed row[^.]*ordinary row/i);
    expect(prose).toMatch(/default width[^.]*160/i);
    expect(prose).toMatch(/width[^.]*clamped[^.]*64[^.]*640/i);
    expect(prose).toMatch(/default height[^.]*38/i);
    expect(prose).toMatch(/height[^.]*clamped[^.]*28[^.]*240/i);
    expect(prose).toMatch(/zero[^.]*negative[^.]*non-number[^.]*default/i);
    expect(prose).toMatch(/person[^.]*editing[^.]*path-level/i);
    for (const command of [
      "export ARTIFACT_ID=<id>",
      'tv resource json set --artifact "$ARTIFACT_ID" \'{"headerRow":true,"columns":{"b57c9dd8-00d4-49c2-a382-e5cd6e45d935":{"order":1,"width":200}},"rows":{"514c6a2b-1324-4d21-9810-595750df8493":{"order":1,"height":52,"cells":{"b57c9dd8-00d4-49c2-a382-e5cd6e45d935":"Park"}},"d4999152-5c07-4c4b-9311-397e48033472":{"order":2,"cells":{"b57c9dd8-00d4-49c2-a382-e5cd6e45d935":"Yosemite"}}}}\'',
      'tv resource json push --artifact "$ARTIFACT_ID" columns \'{"order":2}\'',
      'tv resource json set --artifact "$ARTIFACT_ID" "columns/$COLUMN_KEY/order" \'0.5\'',
      'tv resource json set --artifact "$ARTIFACT_ID" "columns/$COLUMN_KEY/width" \'200\'',
      'tv resource json push --artifact "$ARTIFACT_ID" rows \'{"order":3,"cells":{}}\'',
      'tv resource json set --artifact "$ARTIFACT_ID" "rows/$ROW_KEY/order" \'1.5\'',
      'tv resource json set --artifact "$ARTIFACT_ID" "rows/$ROW_KEY/height" \'52\'',
      'tv resource json set --artifact "$ARTIFACT_ID" "rows/$ROW_KEY/cells/$COLUMN_KEY" \'"Yosemite"\'',
      'tv resource json remove --artifact "$ARTIFACT_ID" "rows/$ROW_KEY/cells/$COLUMN_KEY"',
      'tv resource json set --artifact "$ARTIFACT_ID" headerRow \'false\'',
      'tv resource json set --artifact "$ARTIFACT_ID" headerRow \'true\'',
      'tv resource json remove --artifact "$ARTIFACT_ID" "rows/$ROW_KEY"',
      'tv resource json remove --artifact "$ARTIFACT_ID" "columns/$COLUMN_KEY"',
      'tv resource json set --artifact "$ARTIFACT_ID" \'{"columns":{},"rows":{}}\'',
    ]) expect(readme).toContain(command);
    for (const file of ["page.js", "model.js", "selection-model.js", "styles.css"]) expect(readme).toContain(`\`${file}\``);
    expect(prose).toMatch(/copied artifacts[^.]*independent/i);
  });
});

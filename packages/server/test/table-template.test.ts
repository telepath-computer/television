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
        showHeader: { type: "boolean" },
        columns: {
          type: "object",
          additionalProperties: {
            type: "object",
            required: ["order"],
            properties: { order: { type: "number" }, name: { type: "string" } },
          },
        },
        rows: {
          type: "object",
          additionalProperties: {
            type: "object",
            required: ["order", "cells"],
            properties: {
              order: { type: "number" },
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

  // Cheap source check; the browser seam remains in the slice 2 asset test.
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
  it("documents the shared editable store, opaque keys, tolerant reading and scoped commands", () => {
    const readme = readFileSync(path.join(folder, "README.md"), "utf8");
    const prose = readme.replace(/\s+/g, " ");
    const firstExample = JSON.parse(readme.match(/```json\n([\s\S]*?)\n```/)![1]);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(Object.keys(firstExample.columns).every(key => uuid.test(key))).toBe(true);
    expect(Object.keys(firstExample.rows).every(key => uuid.test(key))).toBe(true);
    for (const field of ["showHeader", "columns", "rows", "order", "name", "cells"]) {
      expect(readme).toContain(`\`${field}\``);
    }
    expect(prose).toMatch(/cells[^.]*object keyed by column key[^.]*never an array/i);
    expect(prose).toMatch(/empty cells[^.]*left out/i);
    expect(prose).toMatch(/cell values[^.]*strings[^.]*numbers[^.]*booleans[^.]*other values[^.]*blank/i);
    expect(prose).toMatch(/drawn positions[^.]*not stored/i);
    expect(prose).toMatch(/B3[^.]*columns A and B[^.]*rows 1 through 3/i);
    expect(prose).toMatch(/never derive[^.]*name[^.]*never reuse/i);
    expect(prose).toMatch(/fresh random key[^.]*UUID[^.]*every row and column/i);
    expect(prose).toMatch(/push[^.]*normal way[^.]*one (?:row|column|entry)/i);
    expect(prose).toMatch(/distinct finite[^.]*order/i);
    expect(prose).toMatch(/do not repair[^.]*without an order/i);
    expect(prose).toMatch(/number or boolean[\s\S]*writes[^.]*string/i);
    expect(prose).toMatch(/person[^.]*editing[^.]*path-level/i);
    for (const path of ["columns/$COLUMN_KEY", "columns/$COLUMN_KEY/name", "rows/$ROW_KEY", "rows/$ROW_KEY/cells/$COLUMN_KEY", "showHeader"]) {
      expect(readme).toContain(path);
    }
    expect(readme).toMatch(/tv resource json push --artifact "\$ARTIFACT_ID" (?:columns|rows)/);
    for (const file of ["page.js", "model.js", "selection-model.js", "styles.css"]) expect(readme).toContain(`\`${file}\``);
    expect(prose).toMatch(/copied artifacts[^.]*independent/i);
  });
});

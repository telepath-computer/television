import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectTemplateIcon, validateTemplatePackage } from "../src/templates.ts";

const folder = path.resolve(import.meta.dirname, "../assets/templates/table");

describe("bundled Table package", () => {
  // proofs/arch/templates/table.md#^templates-table-t-package
  it("provides the page, exact store schema and exact empty seed using the shared display default", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest).not.toHaveProperty("display");
    expect(existsSync(path.join(folder, "index.html"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(folder, "data.json"), "utf8"))).toEqual({ rows: {} });
    // The store schema, as specs/arch/templates/table.md (^bundled-artifact-template-table-store) states it.
    expect(manifest.dataSchema).toEqual({
      "type": "object",
      "required": ["rows"],
      "properties": {
        "rows": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "required": ["order"],
            "properties": {
              "order": { "type": "number" }
            }
          }
        }
      }
    });
  });

  // proofs/arch/templates/table.md#^templates-table-t-assets
  it("loads the canonical stylesheet before its own stylesheet, and the canonical components", () => {
    const page = readFileSync(path.join(folder, "index.html"), "utf8");
    expect(page.indexOf('/canonical/v2/styles.css?authoredForAppVersion=1.5.4')).toBeLessThan(page.indexOf("./styles.css"));
    expect(page).toContain('<script type="module" src="/canonical/v2/components.js"></script>');
  });

  // proofs/arch/templates/table.md#^templates-table-t-icon
  it("supplies its SVG icon to the Toolbox", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest.icons).toEqual([{ src: "icon.svg", type: "image/svg+xml" }]);
    const { template } = validateTemplatePackage(folder, "table");
    expect(selectTemplateIcon(template!)).toEqual({ path: realpathSync(path.join(folder, "icon.svg")), contentType: "image/svg+xml" });
  });

  // proofs/arch/templates/table.md#^templates-table-t-readme
  // Review establishes the meaning; these checks keep the concrete commands and adaptation guidance present.
  it("documents rows, ordering, page-only controls, live errors, adaptation and independent copies", () => {
    const readme = readFileSync(path.join(folder, "README.md"), "utf8");
    const prose = readme.replace(/\s+/g, " ");
    for (const field of ["rows", "order"]) expect(readme).toContain(`\`${field}\``);
    expect(readme).toContain('tv resource json push --artifact "$ARTIFACT_ID" rows \'{"order":1,"Park":"Yosemite"}\'');
    expect(readme).toContain('tv resource json set --artifact "$ARTIFACT_ID" "rows/$ROW_KEY/Park" \'"Yosemite Valley"\'');
    expect(readme).toContain('tv resource json remove --artifact "$ARTIFACT_ID" "rows/$ROW_KEY"');
    expect(readme).toContain('tv resource json set --artifact "$ARTIFACT_ID" rows \'{}\'');
    expect(prose).toMatch(/page follows[\s\S]*live[\s\S]*never writes/i);
    expect(prose).toMatch(/search and column sorting[\s\S]*page only/i);
    expect(prose).toMatch(/invalid or missing data[\s\S]*not repair/i);
    expect(readme).toContain("`styles.css`");
    expect(prose).toMatch(/(?:copied artifacts|copies) are independent/i);
  });
});

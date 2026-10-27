import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectTemplateIcon, validateTemplatePackage } from "../src/templates.ts";

const folder = path.resolve(import.meta.dirname, "../assets/templates/markdown");

describe("bundled Markdown package", () => {
  // proofs/arch/templates/markdown.md#^templates-markdown-t-package
  it("provides the page, exact store schema and exact blank seed using the shared display default", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest).not.toHaveProperty("display");
    expect(existsSync(path.join(folder, "index.html"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(folder, "data.json"), "utf8"))).toEqual({ markdown: "" });
    expect(manifest.dataSchema).toEqual({
      type: "object",
      required: ["markdown"],
      properties: { markdown: { type: "string" } },
    });
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-shared-assets
  it("loads canonical and one versioned shared Markdown editor", () => {
    const page = readFileSync(path.join(folder, "index.html"), "utf8");
    const adapter = readFileSync(path.join(folder, "page.js"), "utf8");
    expect(page.indexOf('/canonical/v2/styles.css?authoredForAppVersion=1.5.4'))
      .toBeLessThan(page.indexOf("/views/markdown/v1/editor.css"));
    expect(page).toContain('<script src="/views/markdown/v1/editor.js"></script>');
    expect(page).toContain('<script type="module" src="./page.js"></script>');
    expect(page).toMatch(/<div id="editor"(?:\s|>)/);
    expect(page).not.toMatch(/<iframe\b/i);
    expect(adapter).toContain("parent: mount");
    expect(adapter).toContain("onSave:");
    expect(adapter).toContain("editor.setValue(");
    expect(adapter).not.toContain("ctx:");
    expect(adapter).not.toContain("editor.view");
    expect(adapter).not.toContain("onSaveError");
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-icon
  it("supplies its SVG icon to the Toolbox", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest.icons).toEqual([{ src: "icon.svg", type: "image/svg+xml" }]);
    const { template } = validateTemplatePackage(folder, "markdown");
    expect(selectTemplateIcon(template!)).toEqual({
      path: realpathSync(path.join(folder, "icon.svg")),
      contentType: "image/svg+xml",
    });
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-readme
  it("documents the shared Markdown, replacement rules, errors and shared editor", () => {
    const readme = readFileSync(path.join(folder, "README.md"), "utf8");
    const prose = readme.replace(/\s+/g, " ");
    expect(readme).toContain("`markdown`");
    expect(readme).toContain('{"markdown":""}');
    expect(readme).toContain('tv resource json get --artifact "$ARTIFACT_ID" markdown');
    expect(readme).toContain("jq -Rs . document.md");
    expect(readme).toContain("--file -");
    expect(readme).toContain('tv resource json set --artifact "$ARTIFACT_ID" markdown');
    expect(readme).toContain('tv resource json set --artifact "$ARTIFACT_ID" markdown \'""\'');
    expect(prose).toMatch(/spaces and line breaks[\s\S]*kept/i);
    expect(prose).toMatch(/other root fields[\s\S]*preserved/i);
    expect(prose).toMatch(/last[- ]write[- ]wins/i);
    expect(prose).toMatch(/invalid or missing data[\s\S]*not repair/i);
    expect(prose).toMatch(/unsaved typing[\s\S]*replaced|replaces[\s\S]*unsaved typing/i);
    expect(prose).toMatch(/copied page files[\s\S]*independent/i);
    expect(prose).toMatch(/current compatible v1 editor/i);
  });
});

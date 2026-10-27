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
  // proofs/ui/markdown-editor/index.md#^md-editor-t-template-order
  it("loads canonical and one versioned shared Markdown editor", () => {
    const page = readFileSync(path.join(folder, "index.html"), "utf8");
    const adapter = readFileSync(path.join(folder, "page.js"), "utf8");
    const deliveryOrder = [
      '/canonical/v2/styles.css?authoredForAppVersion=1.5.4',
      "/views/markdown/v1/editor.css",
      'href="./styles.css"',
      '<script src="/views/markdown/v1/editor.js"></script>',
      '<script type="module" src="./page.js"></script>',
    ].map(part => page.indexOf(part));
    expect(deliveryOrder.every(index => index >= 0)).toBe(true);
    expect(deliveryOrder).toEqual([...deliveryOrder].sort((left, right) => left - right));
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
    expect(adapter).not.toContain("@codemirror/");
    expect(adapter).not.toMatch(/\b(?:from|import)\s*["']codemirror(?:\/|["'])/);
    expect(adapter).not.toContain(".cm-");
  });

  // proofs/arch/templates/markdown.md#^templates-markdown-t-icon
  it("supplies its SVG icon to the Toolbox", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    const icon = readFileSync(path.join(folder, "icon.svg"), "utf8");
    const viewBox = icon.match(/\bviewBox="([^"]+)"/)?.[1]?.split(/\s+/).map(Number);
    expect(manifest.icons).toEqual([{ src: "icon.svg", type: "image/svg+xml" }]);
    expect(viewBox).toHaveLength(4);
    expect(viewBox?.every(Number.isFinite)).toBe(true);
    expect(viewBox?.[2]).toBeGreaterThan(0);
    expect(viewBox?.[3]).toBeGreaterThan(0);
    expect(viewBox?.[2]).toBe(viewBox?.[3]);
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
    expect(readme).toContain("jq -j .value > document.md");
    expect(readme).toContain("jq -Rs . document.md");
    expect(readme).toContain("--file -");
    expect(readme).toContain('tv resource json set --artifact "$ARTIFACT_ID" markdown');
    expect(readme).toContain('tv resource json set --artifact "$ARTIFACT_ID" markdown \'""\'');
    expect(prose).toMatch(/spaces and line breaks[\s\S]*kept/i);
    expect(prose).toMatch(/other root fields[\s\S]*preserved/i);
    expect(prose).toMatch(/saves the complete document/i);
    expect(prose).toMatch(/changes appear live/i);
    expect(prose).toMatch(/last[- ]write[- ]wins/i);
    expect(prose).toMatch(/no offline queue[\s\S]*read-only/i);
    expect(prose).toMatch(/invalid or missing data[\s\S]*not repair/i);
    expect(prose).toMatch(/commands[\s\S]*require `jq`/i);
    expect(prose).toMatch(/field is absent[\s\S]*writes `null`/i);
    expect(prose).toMatch(/read[\s\S]*again[\s\S]*immediately before[\s\S]*(?:replacing|writing)/i);
    expect(prose).toMatch(/saved[\s\S]*since[\s\S]*(?:last )?read/i);
    expect(prose).toMatch(/unsaved typing[\s\S]*replaced|replaces[\s\S]*unsaved typing/i);
    expect(readme).toContain("`#editor`");
    expect(prose).toMatch(/copied page files[\s\S]*independent/i);
    expect(prose).toMatch(/compatible v1 editor/i);
  });
});

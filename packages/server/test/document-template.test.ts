import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectTemplateIcon, validateTemplatePackage } from "../src/templates.ts";

const folder = path.resolve(import.meta.dirname, "../assets/templates/document");
const repoRoot = path.resolve(import.meta.dirname, "../../..");

describe("bundled Document package", () => {
  // proofs/arch/templates/document.md#^templates-document-t-package
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

  // proofs/arch/templates/document.md#^templates-document-t-editor-files
  // proofs/ui/markdown-editor/index.md#^md-editor-t-template-order
  it("ships and loads its packaged Markdown editor", () => {
    const page = readFileSync(path.join(folder, "index.html"), "utf8");
    const adapter = readFileSync(path.join(folder, "page.js"), "utf8");
    for (const file of ["editor.js", "editor.css", "THIRD-PARTY-NOTICES.txt"]) {
      expect(existsSync(path.join(folder, file)), file).toBe(true);
    }
    const deliveryOrder = [
      '/canonical/v2/styles.css?authoredForAppVersion=1.5.4',
      'href="./editor.css"',
      'href="./styles.css"',
    ].map(part => page.indexOf(part));
    expect(deliveryOrder.every(index => index >= 0)).toBe(true);
    expect(deliveryOrder).toEqual([...deliveryOrder].sort((left, right) => left - right));
    expect(page).toContain('<script src="./editor.js"></script>');
    expect(page).toContain('<script type="module" src="./page.js"></script>');
    expect(page).toContain('<script type="module" src="/canonical/v2/components.js"></script>');
    expect(page).toMatch(/<div id="editor"(?:\s|>)/);
    expect(page).not.toMatch(/<iframe\b/i);
    const editor = readFileSync(path.join(folder, "editor.js"), "utf8");
    expect(editor).not.toMatch(/^\s*(?:import|export)\b/m);
    expect(adapter).toContain("parent: mount");
    expect(adapter).toContain('/sdk/v1/resources.js');
    expect(adapter).toContain("onSave:");
    expect(adapter).toContain("editor.setValue(");
    expect(adapter).not.toContain("ctx:");
    expect(adapter).not.toContain("editor.view");
    expect(adapter).not.toContain("onSaveError");
    expect(adapter).not.toContain("@codemirror/");
    expect(adapter).not.toMatch(/\b(?:from|import)\s*["']codemirror(?:\/|["'])/);
    expect(adapter).not.toContain(".cm-");
  });

  // proofs/arch/templates/document.md#^templates-document-t-build-boundary
  it("keeps packaged Markdown editor maintenance outside product builds", () => {
    const viewManifest = JSON.parse(readFileSync(
      path.join(repoRoot, "packages/view-markdown/package.json"),
      "utf8",
    )) as { scripts: Record<string, string> };
    expect(viewManifest.scripts.build).toBe("vite build --config vite.config.ts");

    const lifecycleScripts = [
      "package.json",
      "packages/cli/package.json",
      "packages/server/package.json",
    ].flatMap((file) => {
      const manifest = JSON.parse(readFileSync(path.join(repoRoot, file), "utf8")) as {
        scripts?: Record<string, string>;
      };
      return ["prebuild", "build", "prepack", "prepare"]
        .flatMap(name => manifest.scripts?.[name] ?? []);
    });
    const productBuildSources = [
      ...lifecycleScripts,
      readFileSync(path.join(repoRoot, "packages/server/scripts/build.sh"), "utf8"),
      readFileSync(path.join(repoRoot, "packages/cli/build.mjs"), "utf8"),
    ].join("\n");
    expect(productBuildSources).not.toContain("vite.packaged-markdown-editor.config.ts");
    expect(productBuildSources).not.toContain("check-packaged-markdown-editor");
    expect(productBuildSources).not.toContain("refresh:packaged-markdown-editor");
    expect(productBuildSources).not.toContain("refresh-packaged-markdown-editor");
    expect(productBuildSources).not.toMatch(/(?:write|build).{0,80}assets\/templates\/document/is);
    expect(readFileSync(path.join(repoRoot, "packages/server/scripts/build.sh"), "utf8"))
      .toMatch(/cp -R .*assets\/templates\/\." .*templates_dist/s);
  });

  it("marks the committed packaged Markdown editor output as generated, with no line-ending conversion", () => {
    const attributes = readFileSync(path.join(repoRoot, ".gitattributes"), "utf8");
    expect(attributes).toContain(
      "packages/server/assets/templates/document/editor.js -text linguist-generated",
    );
    expect(attributes).toContain(
      "packages/server/assets/templates/document/editor.css -text linguist-generated",
    );
  });

  // proofs/arch/templates/document.md#^templates-document-t-icon
  it("supplies its SVG icon to the Toolbox", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest.icons).toEqual([{ src: "icon.svg", type: "image/svg+xml" }]);
    const { template } = validateTemplatePackage(folder, "document");
    expect(selectTemplateIcon(template!)).toEqual({
      path: realpathSync(path.join(folder, "icon.svg")),
      contentType: "image/svg+xml",
    });
  });

  // proofs/arch/templates/document.md#^templates-document-t-readme
  it("documents the shared Markdown, replacement rules, errors and packaged Markdown editor", () => {
    const readme = readFileSync(path.join(folder, "README.md"), "utf8");
    const prose = readme.replace(/\s+/g, " ");
    expect(prose).toMatch(/document is Markdown text/i);
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
    expect(prose).toMatch(/each cop(?:y|ied artifact)[\s\S]*editor\.js[\s\S]*editor\.css[\s\S]*THIRD-PARTY-NOTICES\.txt/i);
    expect(prose).toMatch(/Television update[\s\S]*does not replace|does not replace[\s\S]*Television update/i);
    expect(prose).toMatch(/later installed template[\s\S]*does not replace|does not replace[\s\S]*later installed template/i);
    expect(prose).toMatch(/page\.js[\s\S]*editor\.js[\s\S]*editor\.css[\s\S]*THIRD-PARTY-NOTICES\.txt[\s\S]*(?:together|deliberately replaces)/i);
    expect(prose).toMatch(/visual adaptations[\s\S]*styles\.css/i);
  });
});

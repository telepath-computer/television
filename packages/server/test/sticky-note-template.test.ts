import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectTemplateIcon, validateTemplatePackage } from "../src/templates.ts";

const folder = path.resolve(import.meta.dirname, "../assets/templates/sticky-note");
const storyFolder = path.resolve(import.meta.dirname, "../../../storybook/spec/templates/sticky-note");

describe("bundled Sticky note package", () => {
  // proofs/arch/templates/sticky-note.md#^templates-sticky-note-t-package
  it("provides the page, exact empty seed and transparent 360 by 360 display", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest.display).toEqual({ width: 360, height: 360, transparent: true });
    expect(manifest.display).not.toHaveProperty("fullScreen");
    expect(existsSync(path.join(folder, "index.html"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(folder, "data.json"), "utf8"))).toEqual({ text: "" });
  });

  // proofs/arch/templates/sticky-note.md#^templates-sticky-note-t-assets
  it("ships the story font unchanged", () => {
    expect(readFileSync(path.join(folder, "Caveat-Medium.woff2"))).toEqual(readFileSync(path.join(storyFolder, "Caveat-Medium.woff2")));
  });

  // proofs/arch/templates/sticky-note.md#^templates-sticky-note-t-icon
  it("supplies its SVG icon to the Toolbox", () => {
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    expect(manifest.icons).toEqual([{ src: "icon.svg", type: "image/svg+xml" }]);
    const { template } = validateTemplatePackage(folder, "sticky-note");
    expect(selectTemplateIcon(template!)).toEqual({ path: realpathSync(path.join(folder, "icon.svg")), contentType: "image/svg+xml" });
  });

  // proofs/arch/templates/sticky-note.md#^templates-sticky-note-t-readme
  // Review establishes the meaning; these checks keep the concrete commands and adaptation files present.
  it("documents shared text, saving, offline limits, adaptation and the retained font licence", () => {
    const readme = readFileSync(path.join(folder, "README.md"), "utf8");
    const prose = readme.replace(/\s+/g, " ");
    expect(readme).toContain('`{"text":""}`');
    expect(prose).toMatch(/root object[\s\S]*`text` string/);
    expect(prose).toMatch(/hint[\s\S]*never saved/i);
    expect(prose).toMatch(/spaces and line breaks/i);
    expect(prose).toMatch(/other root fields[\s\S]*preserved/i);
    expect(prose).toMatch(/JSON store owned by this artifact/);
    expect(prose).toMatch(/appear live/);
    expect(readme).toContain('tv resource json set --artifact "$ARTIFACT_ID" /text \'"Buy milk\\nCall the plumber"\'');
    expect(readme).toContain('tv resource json set --artifact "$ARTIFACT_ID" /text \'""\'');
    expect(readme).toContain("400 ms");
    expect(prose).toMatch(/leav(?:e|ing) the field/);
    expect(prose).toMatch(/last[ -]write[ -]wins/i);
    expect(prose).toMatch(/disconnected[\s\S]*keep the page open/i);
    expect(prose).toMatch(/clos(?:e|ing)[\s\S]*reload/i);
    expect(prose).toMatch(/invalid or missing data[\s\S]*not repair/i);
    expect(readme).toContain("`styles.css`");
    expect(prose).toMatch(/transparent[\s\S]*creation/);
    expect(prose).toMatch(/(?:copied artifacts|copies) are independent/i);
    expect(readme).toContain("Caveat");
    expect(readme).toContain("https://raw.githubusercontent.com/google/fonts/5571d84c0d8c70ec1af4f64072d8c5cf1e4e9643/ofl/caveat/OFL.txt");
    expect(prose).toMatch(/retain[\s\S]*THIRD-PARTY-NOTICES\.txt/i);
  });
});

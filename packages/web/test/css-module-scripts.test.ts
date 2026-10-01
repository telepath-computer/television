// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  rewriteCssModuleImports,
  sheetModuleSource,
} from "../../../config/css-module-scripts.ts";
import badgeSheet from "./fixtures/css-module-scripts/badge.css" with { type: "css" };
import panelSheet from "./fixtures/css-module-scripts/panel.css" with { type: "css" };
import { panelSheet as panelSheetViaA } from "./helpers/css-sheet-importer-a.ts";
import { panelSheet as panelSheetViaB } from "./helpers/css-sheet-importer-b.ts";

function ruleText(sheet: CSSStyleSheet): string {
  return Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
}

// Attribute clauses are assembled at runtime: written literally, the
// plugin's own pre-transform would rewrite them inside this file's source
// before the test runs.
const cssAttr = (quote: string) => `with { type: ${quote}css${quote} }`;

describe("rewriteCssModuleImports", () => {
  it("rewrites an attributed css import to a ?sheet import", () => {
    expect(
      rewriteCssModuleImports(`import sheet from "./panel.css" ${cssAttr(`"`)};`),
    ).toBe(`import sheet from "./panel.css?sheet";`);
  });

  it("rewrites single-quoted attributed imports", () => {
    expect(
      rewriteCssModuleImports(`import sheet from './panel.css' ${cssAttr(`'`)};`),
    ).toBe(`import sheet from './panel.css?sheet';`);
  });

  it("rewrites side-effect attributed imports", () => {
    expect(
      rewriteCssModuleImports(`import "./panel.css" ${cssAttr(`"`)};`),
    ).toBe(`import "./panel.css?sheet";`);
  });

  it("rewrites every attributed import in a module", () => {
    const code = [
      `import a from "./a.css" ${cssAttr(`"`)};`,
      `import { helper } from "./helper.ts";`,
      `import b from "./b.css" ${cssAttr(`"`)};`,
    ].join("\n");
    expect(rewriteCssModuleImports(code)).toBe(
      [
        `import a from "./a.css?sheet";`,
        `import { helper } from "./helper.ts";`,
        `import b from "./b.css?sheet";`,
      ].join("\n"),
    );
  });

  it("leaves plain css imports untouched", () => {
    expect(rewriteCssModuleImports(`import "./global.css";`)).toBeNull();
  });

  it("leaves ?inline css imports untouched", () => {
    expect(rewriteCssModuleImports(`import css from "./index.css?inline";`)).toBeNull();
  });

  it("leaves non-css import attributes untouched", () => {
    expect(
      rewriteCssModuleImports(`import data from "./data.json" with { type: "json" };`),
    ).toBeNull();
  });
});

describe("sheetModuleSource", () => {
  const code = sheetModuleSource(".panel { color: red; }");

  it("embeds the css text and loads it into a constructed sheet", () => {
    expect(code).toContain(JSON.stringify(".panel { color: red; }"));
    expect(code).toContain("new CSSStyleSheet()");
    expect(code).toContain("sheet.replaceSync(css)");
  });

  it("default-exports the sheet", () => {
    expect(code).toContain("export default sheet");
  });

  it("self-accepts hot updates so style edits replaceSync in place", () => {
    expect(code).toContain("import.meta.hot.accept()");
    expect(code).toContain("import.meta.hot.data.sheet = sheet");
  });
});

describe("css module script imports (through the vite pipeline)", () => {
  it("yields a CSSStyleSheet containing the file's rules", () => {
    expect(panelSheet).toBeInstanceOf(CSSStyleSheet);
    expect(ruleText(panelSheet)).toContain(".panel");
    expect(ruleText(panelSheet)).toContain("rebeccapurple");
  });

  it("hands every importer of a file the same sheet instance", () => {
    expect(panelSheetViaA).toBe(panelSheet);
    expect(panelSheetViaB).toBe(panelSheet);
  });

  it("yields a distinct sheet per file", () => {
    expect(badgeSheet).toBeInstanceOf(CSSStyleSheet);
    expect(badgeSheet).not.toBe(panelSheet);
    expect(ruleText(badgeSheet)).toContain("goldenrod");
  });
});

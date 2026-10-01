import { describe, expect, test } from "vitest";
import { styleSourceText } from "./lib/ui-style-source.ts";

describe("authoritative stylesheet sources", () => {
  test("preserves CSS bytes and extracts only a frame's decoded style block", () => {
    const css = "/* authority */\n.panel { color: red; }\n";
    expect(styleSourceText("surface.css", css)).toBe(css);
    expect(styleSourceText("surface.frame", "---\ntitle: Panel\nstyle: |\n  /* authority */\n  .panel { color: red; }\n---\n<div class=\"panel\">Content</div>\n")).toBe(css);
  });

  test("respects YAML chomping and excludes frames without their own styling", () => {
    expect(styleSourceText("surface.frame", "---\nstyle: |-\n  .panel {}\n---\n<div></div>")).toBe(".panel {}");
    expect(styleSourceText("surface.frame", "---\ntitle: Panel\nimports:\n  - ./surface.css\n---\n<div></div>")).toBeUndefined();
    expect(styleSourceText("surface.frame", "<div></div>")).toBeUndefined();
  });

  test("rejects malformed frame styles instead of silently excluding them", () => {
    expect(() => styleSourceText("surface.frame", "---\nstyle: []\n---\n")).toThrow("style must be a string");
    expect(() => styleSourceText("surface.frame", "---\nstyle: |\n  .panel {}\n")).toThrow("front matter is not closed");
  });
});

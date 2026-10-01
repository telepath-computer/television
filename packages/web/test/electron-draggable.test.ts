// @vitest-environment jsdom

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.join(__dirname, "..", "..", "..");
const cssPath = path.join(repoRoot, "packages/web/src/global.css");

// Extract a CSS rule that sets `-webkit-app-region: <value>` and return its
// selector text. We feed the selector to `Element.matches()` so the assertion
// is about behavior (does this element opt in/out of dragging?) rather than
// the literal shape of the source CSS.
function selectorFor(css: string, value: "drag" | "no-drag"): string {
  // `[;}]` after the value prevents `drag` from matching `no-drag` and
  // vice-versa.
  const declaration = new RegExp(
    `-webkit-app-region:\\s*${value}\\s*[;}]`,
  ).exec(css);
  if (!declaration) throw new Error(`No rule found for -webkit-app-region: ${value}`);
  const openingBrace = css.lastIndexOf("{", declaration.index);
  if (openingBrace === -1) throw new Error(`Rule has no opening brace: ${value}`);
  const selectorStart = Math.max(
    css.lastIndexOf("}", openingBrace),
    css.lastIndexOf(";", openingBrace),
  );
  return css.slice(selectorStart + 1, openingBrace).trim();
}

describe("[electron-draggable] convention", () => {
  let css: string;
  let dragSelector: string;
  let noDragSelector: string;
  let band: HTMLDivElement;

  beforeAll(() => {
    css = readFileSync(cssPath, "utf8");
    dragSelector = selectorFor(css, "drag");
    noDragSelector = selectorFor(css, "no-drag");

    band = document.createElement("div");
    band.setAttribute("electron-draggable", "");
    document.body.appendChild(band);
  });

  afterAll(() => {
    band.remove();
  });

  it("the band itself is draggable", () => {
    expect(band.matches(dragSelector)).toBe(true);
  });

  it("a button inside the band opts out so clicks aren't eaten by drag", () => {
    const button = document.createElement("button");
    band.appendChild(button);
    expect(button.matches(noDragSelector)).toBe(true);
    button.remove();
  });

  it("an input inside the band opts out so text selection works", () => {
    const input = document.createElement("input");
    band.appendChild(input);
    expect(input.matches(noDragSelector)).toBe(true);
    input.remove();
  });

  it("an <a> inside the band opts out so links remain clickable", () => {
    const a = document.createElement("a");
    a.href = "#";
    band.appendChild(a);
    expect(a.matches(noDragSelector)).toBe(true);
    a.remove();
  });

  it("a role='button' element inside the band opts out", () => {
    const div = document.createElement("div");
    div.setAttribute("role", "button");
    band.appendChild(div);
    expect(div.matches(noDragSelector)).toBe(true);
    div.remove();
  });

  it("a plain <span> inside the band stays draggable so the band is still grabbable", () => {
    const span = document.createElement("span");
    band.appendChild(span);
    expect(span.matches(noDragSelector)).toBe(false);
    span.remove();
  });
});

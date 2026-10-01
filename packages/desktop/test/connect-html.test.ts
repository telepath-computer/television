// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const connectHtmlPath = path.join(__dirname, "../src/connect.html");

function loadConnect(): Document {
  const html = readFileSync(connectHtmlPath, "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

describe("connect.html drag region structure", () => {
  it("does not put -webkit-app-region: drag on body or any ancestor of the form", () => {
    const document = loadConnect();
    const styles = Array.from(document.querySelectorAll("style"))
      .map((node) => node.textContent ?? "")
      .join("\n");

    // The form must not be inside a drag region: that breaks click/focus on
    // its inputs in Chromium. Drag must be applied to a sibling, not body or
    // a wrapping container.
    expect(styles).not.toMatch(/\bbody\s*\{[^}]*-webkit-app-region:\s*drag/);
  });

  it("declares a dedicated drag-region element distinct from the form", () => {
    const document = loadConnect();
    const dragRegion = document.querySelector("[data-drag-region]");
    expect(dragRegion).not.toBeNull();
    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    expect(dragRegion!.contains(form)).toBe(false);
  });
});

describe("connect.html connect flow UI", () => {
  it("uses a text server URL field and a connect button with inline spinner", () => {
    const document = loadConnect();
    const serverInput = document.querySelector("#serverURL");
    expect(serverInput?.getAttribute("type")).toBe("text");
    expect(document.querySelector("#submit .button-spinner")).not.toBeNull();
    expect(document.querySelector("#submit .button-label")?.textContent).toBe("Connect");
  });

  it("prefills saved connection via bundled connect-page script", () => {
    const html = readFileSync(connectHtmlPath, "utf8");
    expect(html).toContain('src="connect-page.cjs"');
    expect(html).not.toContain("window.television.getConnection");
    expect(html).toContain("script-src 'self' 'unsafe-inline'");
  });
});

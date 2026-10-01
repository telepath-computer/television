// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { renderTarget } from "./main.ts";

function mountFixture(): void {
  document.body.innerHTML = `
    <section id="target-block" hidden>
      <p id="address-label"></p>
      <a id="target-link" target="_blank" rel="noopener noreferrer"></a>
      <p id="plain-address" hidden></p>
    </section>
    <section id="desktop-app" hidden></section>
  `;
}

function targetLink(): HTMLAnchorElement {
  const link = document.getElementById("target-link");
  if (!(link instanceof HTMLAnchorElement)) throw new Error("Expected target link");
  return link;
}

describe("url-unsupported renderTarget", () => {
  beforeEach(() => {
    mountFixture();
  });

  it("renders http(s) targets as safe new-tab anchors without modifier-click instruction", () => {
    renderTarget("https://example.com/path?q=1#section");

    const block = document.getElementById("target-block")!;
    const label = document.getElementById("address-label")!;
    const link = targetLink();
    const plainAddress = document.getElementById("plain-address")!;
    const desktopApp = document.getElementById("desktop-app")!;

    expect(block.hidden).toBe(false);
    expect(label.textContent).toBe("This is the URL you're trying to visit:");
    expect(block.textContent).not.toMatch(/click|Ctrl|Command|new tab/i);
    expect(link.hidden).toBe(false);
    expect(link.textContent).toBe("https://example.com/path?q=1#section");
    expect(link.href).toBe("https://example.com/path?q=1#section");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(plainAddress.hidden).toBe(true);
    expect(desktopApp.hidden).toBe(false);
  });

  it("keeps the address block hidden and shows the desktop app when the host has no target", () => {
    renderTarget(null);

    expect(document.getElementById("target-block")!.hidden).toBe(true);
    expect(document.getElementById("desktop-app")!.hidden).toBe(false);
  });

  it("renders non-web and invalid targets as labeled plain text without click guidance", () => {
    for (const target of ["javascript:alert(1)", "data:text/html,<h1>unsafe</h1>", "not a url"]) {
      mountFixture();
      renderTarget(target);

      const block = document.getElementById("target-block")!;
      const label = document.getElementById("address-label")!;
      const link = targetLink();
      const plainAddress = document.getElementById("plain-address")!;
      const desktopApp = document.getElementById("desktop-app")!;

      expect(block.hidden).toBe(false);
      expect(label.textContent).toBe("This is the URL you're trying to visit:");
      expect(link.hidden).toBe(true);
      expect(link.hasAttribute("href")).toBe(false);
      expect(link.textContent).toBe("");
      expect(plainAddress.hidden).toBe(false);
      expect(plainAddress.textContent).toBe(target);
      expect(block.textContent).not.toMatch(/click|Ctrl|Command|new tab/i);
      expect(desktopApp.hidden).toBe(false);
    }
  });
});

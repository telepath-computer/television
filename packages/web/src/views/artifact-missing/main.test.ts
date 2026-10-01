// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { missingArtifactDescription, missingArtifactRecoveryHint, missingArtifactTitle } from "@telepath-computer/television-artifact/missing-artifact-page";
import { renderMissingArtifact } from "./main.ts";

function mountFixture(): void {
  document.body.innerHTML = `
    <h1 id="missing-title"></h1>
    <p id="missing-description"></p>
    <section id="path-block" hidden>
      <code id="missing-path"></code>
    </section>
    <p id="missing-recovery"></p>
  `;
}

describe("artifact-missing renderMissingArtifact", () => {
  beforeEach(() => {
    mountFixture();
  });

  it("renders generic copy without a path until the host provides artifact metadata", () => {
    renderMissingArtifact(null);

    expect(document.getElementById("missing-title")!.textContent).toBe(missingArtifactTitle());
    expect(document.getElementById("missing-description")!.textContent).toBe(missingArtifactDescription());
    expect(document.getElementById("missing-recovery")!.textContent).toBe(missingArtifactRecoveryHint());
    expect(document.getElementById("path-block")!.hidden).toBe(true);
    expect(document.getElementById("missing-path")!.textContent).toBe("");
  });

  it("renders host-provided paths as text, not HTML", () => {
    const hostilePath = "/tmp/<img src=x onerror=alert(1)>.html";

    renderMissingArtifact({ title: "Hostile <title>", path: hostilePath });

    expect(document.title).toBe("Hostile <title>");
    expect(document.getElementById("path-block")!.hidden).toBe(false);
    expect(document.getElementById("missing-path")!.textContent).toBe(hostilePath);
    expect(document.querySelector("img")).toBeNull();
  });
});

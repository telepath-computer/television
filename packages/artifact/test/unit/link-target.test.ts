import { describe, expect, it } from "vitest";
import { classifyLinkTarget, isWebNavigationURL } from "../../src/link-target.ts";

const baseURL = "https://television.test/artifact/note/index.html";

describe("link target classification", () => {
  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-link-classifier
  it("classifies absolute, relative, and fragment HTTP(S) targets as web navigation", () => {
    for (const value of [
      "https://example.com/page",
      "http://example.com/page",
      "./next.html",
      "/artifact/note/next.html",
      "#section",
    ]) {
      expect(classifyLinkTarget(value, baseURL)).toMatchObject({ kind: "web" });
      expect(isWebNavigationURL(value, baseURL)).toBe(true);
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-link-classifier
  it("classifies unknown explicit schemes as application links", () => {
    for (const value of [
      "example-app://open/item",
      "obsidian://open?vault=pages&file=note",
      "mailto:user@example.com",
      "tel:+15551234567",
    ]) {
      expect(classifyLinkTarget(value, baseURL)).toMatchObject({ kind: "application" });
      expect(isWebNavigationURL(value, baseURL)).toBe(false);
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-link-classifier
  it("keeps browser-executable and local-resource schemes out of application handoff", () => {
    for (const value of [
      "javascript:document.body.textContent='owned'",
      "data:text/html,hello",
      "blob:https://television.test/id",
      "file:///tmp/note.html",
      "filesystem:https://television.test/temporary/note.html",
      "view-source:https://television.test/",
      "chrome://settings/",
      "about:blank",
    ]) {
      expect(classifyLinkTarget(value, baseURL)).toMatchObject({ kind: "browser-local" });
      expect(isWebNavigationURL(value, baseURL)).toBe(false);
    }
  });

  // spec: proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-link-classifier
  it("classifies malformed values as inert", () => {
    expect(classifyLinkTarget("http://[", baseURL)).toEqual({ kind: "invalid" });
    expect(classifyLinkTarget("https://example.com", "not a base")).toEqual({ kind: "invalid" });
    expect(isWebNavigationURL("http://[", baseURL)).toBe(false);
  });
});

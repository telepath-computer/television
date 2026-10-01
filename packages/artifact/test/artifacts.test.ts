import { describe, expect, it } from "vitest";
import { createArtifact, type Artifact } from "@telepath-computer/television-artifact";

describe("createArtifact", () => {
  it("generates an id when omitted", () => {
    const artifact = createArtifact({ kind: "path", title: "T", path: "/tmp/a.html" });
    expect(artifact.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i);
    expect(artifact).toMatchObject({ kind: "path", title: "T", path: "/tmp/a.html" });
  });

  it("returns a value assignable to Artifact", () => {
    const artifact: Artifact = createArtifact({ kind: "url", title: "U", url: "https://example.com" });
    expect(artifact.kind).toBe("url");
  });

  it("creates path artifacts", () => {
    expect(createArtifact({ id: "a", kind: "path", title: "A", path: "/tmp/a.html" })).toEqual({
      id: "a",
      kind: "path",
      title: "A",
      path: "/tmp/a.html",
    });
  });

  it("creates URL artifacts", () => {
    expect(createArtifact({ id: "u", kind: "url", title: "U", url: "https://example.com" })).toEqual({
      id: "u",
      kind: "url",
      title: "U",
      url: "https://example.com",
    });
  });
});

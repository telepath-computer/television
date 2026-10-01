import { describe, expect, it } from "vitest";
import {
  ArtifactSchema,
  artifactBasename,
  createArtifact,
  hasTrailingSeparator,
  isAllowedArtifactFilePath,
  isExternalArtifactURL,
  isHtmlPath,
  isMarkdownPath,
  isTvArtifact,
  stripTrailingSeparators,
} from "@telepath-computer/television-artifact";

describe("artifact pointer model", () => {
  it("accepts path artifacts", () => {
    const result = ArtifactSchema.safeParse({ id: "a", kind: "path", title: "A", path: "/tmp/a.html" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: "a", kind: "path", title: "A", path: "/tmp/a.html" });
    }
  });

  it("accepts http(s) URL artifacts", () => {
    const result = ArtifactSchema.safeParse({ id: "a", kind: "url", title: "A", url: "https://example.com" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: "a", kind: "url", title: "A", url: "https://example.com" });
    }
    expect(ArtifactSchema.safeParse({ id: "a", kind: "url", title: "A", url: "http://example.com" }).success).toBe(true);
  });

  it("rejects old artifact shapes and unsafe URL schemes", () => {
    expect(ArtifactSchema.safeParse({ id: "a", kind: "markdown", title: "A", externalFilePath: "/tmp/a.md", status: "committed" }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ id: "a", kind: "web-bundle", title: "A", status: "pending" }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ id: "a", kind: "path", title: "A", path: "/tmp/a.md", url: "https://example.com" }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ id: "a", kind: "url", title: "A", externalURL: "https://example.com" }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ id: "a", type: "path", title: "A", path: "/tmp/a.md" }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ id: "a", kind: "url", title: "A", url: "javascript:alert(1)" }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ id: "a", kind: "url", title: "A", url: "file:///tmp/a.html" }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ id: "a", kind: "url", title: "A", url: "not a url" }).success).toBe(false);
  });

  it("constructs path and URL artifacts", () => {
    expect(createArtifact({ id: "p", kind: "path", title: "P", path: "/tmp/a.html" })).toEqual({ id: "p", kind: "path", title: "P", path: "/tmp/a.html" });
    expect(createArtifact({ id: "u", kind: "url", title: "U", url: "https://example.com" })).toEqual({ id: "u", kind: "url", title: "U", url: "https://example.com" });
  });
});

describe("path classification helpers", () => {
  it("detects POSIX and Windows trailing separators", () => {
    expect(hasTrailingSeparator("/tmp/site/")).toBe(true);
    expect(hasTrailingSeparator("C:/site/")).toBe(true);
    expect(hasTrailingSeparator("C:\\site\\")).toBe(true);
    expect(hasTrailingSeparator("/tmp/site")).toBe(false);
    expect(hasTrailingSeparator("")).toBe(false);
  });

  it("strips trailing separators while preserving root paths", () => {
    expect(stripTrailingSeparators("/tmp/site/")).toBe("/tmp/site");
    expect(stripTrailingSeparators("/tmp/site//")).toBe("/tmp/site");
    expect(stripTrailingSeparators("C:\\site\\")).toBe("C:\\site");
    expect(stripTrailingSeparators("/tmp/site")).toBe("/tmp/site");
    expect(stripTrailingSeparators("/")).toBe("/");
    expect(stripTrailingSeparators("")).toBe("");
  });

  it("preserves Windows drive roots", () => {
    expect(stripTrailingSeparators("C:\\")).toBe("C:\\");
    expect(stripTrailingSeparators("C:/")).toBe("C:/");
    expect(stripTrailingSeparators("C://")).toBe("C:/");
    expect(stripTrailingSeparators("c:\\\\")).toBe("c:\\");
    expect(stripTrailingSeparators("C:")).toBe("C:");
  });

  it("extracts basenames with POSIX or Windows separators without normalizing paths", () => {
    expect(artifactBasename("/tmp/file.html")).toBe("file.html");
    expect(artifactBasename("C:\\notes\\today.markdown")).toBe("today.markdown");
    expect(artifactBasename("relative/name.md")).toBe("name.md");
  });

  it("classifies markdown and HTML basename extensions", () => {
    expect(isMarkdownPath("/tmp/note.md")).toBe(true);
    expect(isMarkdownPath("/tmp/note.markdown")).toBe(true);
    expect(isHtmlPath("/tmp/index.htm")).toBe(true);
    expect(isHtmlPath("/tmp/index.html")).toBe(true);
    expect(isAllowedArtifactFilePath("/tmp/note.md")).toBe(true);
    expect(isAllowedArtifactFilePath("/tmp/note.markdown")).toBe(true);
    expect(isAllowedArtifactFilePath("/tmp/index.htm")).toBe(true);
    expect(isAllowedArtifactFilePath("/tmp/index.html")).toBe(true);
  });

  it("rejects lookalike extensions and directory paths", () => {
    for (const ext of [".pdf", ".txt", ".json", ".xhtml", ".shtml"]) {
      expect(isAllowedArtifactFilePath(`/tmp/file${ext}`)).toBe(false);
    }
    expect(isAllowedArtifactFilePath("/tmp/index.html/")).toBe(false);
  });

  it("validates only absolute http(s) URLs", () => {
    expect(isExternalArtifactURL("https://example.com/a?b=1")).toBe(true);
    expect(isExternalArtifactURL("http://example.com")).toBe(true);
    expect(isExternalArtifactURL("/relative")).toBe(false);
    expect(isExternalArtifactURL("ftp://example.com")).toBe(false);
  });

  it("detects Television artifact proxy URLs by shape", () => {
    expect(isTvArtifact("http://producer.test/artifact/01J00000000000000000000000/index.html")).toBe(true);
    expect(isTvArtifact("https://producer.test/artifact/01J00000000000000000000000")).toBe(true);
    expect(isTvArtifact("http://producer.test/prefix/artifact/01J00000000000000000000000/index.html")).toBe(false);
    expect(isTvArtifact("http://producer.test/artifact/short/index.html")).toBe(false);
    expect(isTvArtifact("not a url")).toBe(false);
  });
});

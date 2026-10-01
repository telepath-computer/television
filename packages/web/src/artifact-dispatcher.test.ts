import { describe, expect, it } from "vitest";
import { hasTrailingSeparator, isMarkdownPath, type Artifact } from "@telepath-computer/television-artifact";
import { artifactRenderRoute } from "./artifact-dispatcher.ts";
import { artifactDocumentRoute, type ArtifactDocumentSource } from "./views/artifact-document-host.ts";

describe("artifactRenderRoute", () => {
  it("routes non-markdown directory path artifacts to the proxy root", () => {
    const artifact = { id: "01ABC", kind: "path" as const, title: "Bundle", path: "/tmp/site/" };
    expect(hasTrailingSeparator(artifact.path)).toBe(true);
    expect(artifactRenderRoute(artifact)).toEqual({
      renderer: "proxy-iframe",
      viewURL: "/artifact/01ABC/",
      contentURL: null,
    });
  });

  it("routes non-markdown file path artifacts to their encoded proxy basename", () => {
    expect(artifactRenderRoute({
      id: "id with space",
      kind: "path",
      title: "HTML",
      path: "/tmp/file (1)#?.%.é.html",
    })).toEqual({
      renderer: "proxy-iframe",
      viewURL: "/artifact/id%20with%20space/file%20(1)%23%3F.%25.%C3%A9.html",
      contentURL: null,
    });
  });

  it("routes markdown path artifacts to the markdown view and markdown endpoint", () => {
    const artifact = { id: "md/id", kind: "path" as const, title: "Note", path: "C:\\notes\\today.markdown" };
    expect(isMarkdownPath(artifact.path)).toBe(true);
    expect(artifactRenderRoute(artifact)).toEqual({
      renderer: "markdown",
      viewURL: "/views/markdown/",
      contentURL: "/markdown/md%2Fid",
    });
  });

  it("routes all Electron artifact kinds to webview-capable routes", () => {
    expect(artifactRenderRoute({
      id: "file id",
      kind: "path",
      title: "HTML",
      path: "/tmp/file.html",
    }, { electron: true })).toEqual({
      renderer: "url-webview",
      viewURL: "/artifact/file%20id/file.html",
      contentURL: null,
    });

    expect(artifactRenderRoute({
      id: "dir",
      kind: "path",
      title: "Directory",
      path: "/tmp/site/",
    }, { electron: true })).toEqual({
      renderer: "url-webview",
      viewURL: "/artifact/dir/",
      contentURL: null,
    });

    expect(artifactRenderRoute({
      id: "md/id",
      kind: "path",
      title: "Note",
      path: "/tmp/today.markdown",
    }, { electron: true })).toEqual({
      renderer: "url-webview",
      viewURL: "/views/markdown/",
      contentURL: "/markdown/md%2Fid",
    });
  });

  it("routes URL artifacts to unsupported browser iframe or Electron webview", () => {
    const artifact = { id: "url", kind: "url" as const, title: "External", url: "https://example.com/path?q=1" };
    expect(artifactRenderRoute(artifact, { electron: false })).toEqual({
      renderer: "url-unsupported",
      viewURL: "/views/url-unsupported/",
      contentURL: null,
    });
    expect(artifactRenderRoute(artifact, { electron: true })).toEqual({
      renderer: "url-webview",
      viewURL: "https://example.com/path?q=1",
      contentURL: null,
    });
  });
});

// spec: proofs/product/artifacts.md#^af-ac-demo-scope
describe("browser demo mode routing", () => {
  const ULID = "01J0000000000000000000ABCD";
  const url = (value: string) => ({ id: "u", kind: "url" as const, title: "Page", url: value });
  const demo = { electron: false, browserDemo: true };
  const direct = (value: string) => ({ renderer: "url-direct", viewURL: value, contentURL: null });

  it("routes http and https external page artifacts to a direct iframe at their own URL", () => {
    for (const value of [
      "https://news.ycombinator.com/",
      "http://example.test:8080/page?q=1#top",
      "http://127.0.0.1:4000/not-an-artifact",
    ]) {
      expect(artifactRenderRoute(url(value), demo)).toEqual(direct(value));
      expect(artifactDocumentRoute(source(url(value), demo, null))).toEqual(direct(value));
    }
  });

  it("keeps Television artifact addresses on the shared route on any host", () => {
    for (const value of [`https://other.example/artifact/${ULID}/`, `http://127.0.0.1:4000/artifact/${ULID}/index.html`]) {
      expect(artifactRenderRoute(url(value), demo)).toEqual({ renderer: "proxy-iframe", viewURL: value, contentURL: null });
    }
  });

  it("keeps non-web URLs on the unsupported page", () => {
    for (const value of ["obsidian://open?vault=x", "file:///tmp/a.html", "not a url"]) {
      expect(artifactRenderRoute(url(value), demo)).toEqual({
        renderer: "url-unsupported",
        viewURL: "/views/url-unsupported/",
        contentURL: null,
      });
    }
  });

  it("routes every other artifact identically with demo mode on and off", () => {
    const artifacts = [
      { id: "p", kind: "path" as const, title: "HTML", path: "/tmp/site/index.html" },
      { id: "d", kind: "path" as const, title: "Dir", path: "/tmp/site/" },
      { id: "m", kind: "path" as const, title: "Note", path: "/tmp/note.md" },
      url(`https://other.example/artifact/${ULID}/`),
      url("obsidian://open"),
    ];
    for (const artifact of artifacts) {
      expect(artifactRenderRoute(artifact, demo)).toEqual(artifactRenderRoute(artifact, { electron: false }));
    }
    for (const artifact of [...artifacts, url("https://news.ycombinator.com/")]) {
      expect(artifactRenderRoute(artifact, { electron: true, browserDemo: true }))
        .toEqual(artifactRenderRoute(artifact, { electron: true }));
    }
    const served = artifacts[0]!;
    for (const currentURL of ["https://news.ycombinator.com/item?id=1", "http://localhost:9/artifact/p/other.html"]) {
      expect(artifactDocumentRoute(source(served, demo, currentURL)))
        .toEqual(artifactDocumentRoute(source(served, { electron: false }, currentURL)));
    }
  });
});

function source(
  artifact: Artifact,
  options: { electron: boolean; browserDemo?: boolean },
  currentURL: string | null,
): ArtifactDocumentSource {
  return {
    artifact,
    application: null,
    electron: options.electron,
    browserDemo: options.browserDemo ?? false,
    viewURL: null,
    contentURL: null,
    currentURL,
  };
}

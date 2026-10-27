import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appearanceResolverScriptSource,
  bridgeScriptSource,
} from "@telepath-computer/television-artifact/browser";
import { Server } from "../src/server.ts";
import { ServerStore } from "../src/server-store.ts";
import { injectedETag } from "../src/artifact-proxy.ts";
import { MARKDOWN_DOC_CSS } from "../src/markdown-doc-style.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

function tempDir(prefix = "television-proxy-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

interface Harness {
  server: Server;
  store: ServerStore;
  storagePath: string;
  token: string;
}

async function createHarness(options: { staticDir?: string; bundledViewsPath?: string } = {}): Promise<Harness> {
  const storagePath = tempDir();
  const store = createServingStore(storagePath, { ...(options.bundledViewsPath ? { bundledViewsPath: options.bundledViewsPath } : {}) });
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true, staticDir: options.staticDir });
  await server.start();
  return { server, store, storagePath, token: store.authToken };
}

function bearer(h: Harness): Record<string, string> {
  return { Authorization: `Bearer ${h.token}` };
}

describe("artifact proxy", () => {
  const harnesses: Harness[] = [];
  const paths: string[] = [];

  afterEach(async () => {
    for (const h of harnesses.splice(0)) {
      await h.server.dispose();
      rmSync(h.storagePath, { recursive: true, force: true });
    }
    for (const p of paths.splice(0)) rmSync(p, { recursive: true, force: true });
  });

  async function setup(options: { staticDir?: string; bundledViewsPath?: string } = {}): Promise<Harness> {
    const h = await createHarness(options);
    harnesses.push(h);
    return h;
  }

  function trackedDir(prefix?: string): string {
    const dir = tempDir(prefix);
    paths.push(dir);
    return dir;
  }

  function createArtifactMissingView(body = "<!doctype html><title>Artifact file not found</title><main>static missing view</main>"): string {
    const viewsRoot = trackedDir("television-views-");
    const viewDir = path.join(viewsRoot, "artifact-missing");
    mkdirSync(viewDir, { recursive: true });
    writeFileSync(path.join(viewDir, "index.html"), body, "utf8");
    return viewsRoot;
  }

  function createStaticRootWithArtifactMissingView(body: string): string {
    const staticRoot = trackedDir("television-static-");
    mkdirSync(path.join(staticRoot, "views", "artifact-missing", "assets"), { recursive: true });
    writeFileSync(path.join(staticRoot, "views", "artifact-missing", "assets", "artifactMissing.js"), "window.__artifactMissingLoaded = true;\n", "utf8");
    writeFileSync(path.join(staticRoot, "views", "artifact-missing", "index.html"), body, "utf8");
    return staticRoot;
  }

  it("serves directory artifacts with index resolution and subresources without auth", async () => {
    const h = await setup();
    const bundle = trackedDir("television-bundle-");
    mkdirSync(path.join(bundle, "nested"));
    writeFileSync(path.join(bundle, "index.html"), "<!doctype html><h1>Root</h1>");
    writeFileSync(path.join(bundle, "nested", "index.htm"), "<!doctype html><h1>Nested</h1>");
    writeFileSync(path.join(bundle, "style.css"), "body { color: red; }");
    writeFileSync(path.join(bundle, "data.json"), JSON.stringify({ ok: true }));
    const artifact = h.store.createArtifact({ channelID: h.store.listChannels()[0]!.id, kind: "path", title: "Bundle", path: `${bundle}${path.sep}` });

    await request(h.server.httpServer)
      .get(`/artifact/${artifact.id}`)
      .expect(301)
      .expect("Location", `/artifact/${artifact.id}/`)
      .expect("X-Content-Type-Options", "nosniff")
      .expect("Referrer-Policy", "no-referrer");

    await request(h.server.httpServer)
      .get(`/artifact/${artifact.id}/`)
      .expect(200)
      .expect("X-Content-Type-Options", "nosniff")
      .expect("Referrer-Policy", "no-referrer")
      .expect("Cache-Control", "no-cache, must-revalidate")
      .expect(({ text, headers }) => {
        expect(headers["content-type"]).toContain("text/html");
        expect(text).toContain("<h1>Root</h1>");
        expect(text).toContain(bridgeScriptSource());
      });

    await request(h.server.httpServer)
      .get(`/artifact/${artifact.id}/nested/`)
      .expect(200)
      .expect(({ text }) => expect(text).toContain("<h1>Nested</h1>"));

    await request(h.server.httpServer)
      .get(`/artifact/${artifact.id}/style.css`)
      .expect(200)
      .expect(({ text, headers }) => {
        expect(headers["content-type"]).toContain("text/css");
        expect(text).toContain("color: red");
        expect(text).not.toContain(appearanceResolverScriptSource('\"system\"'));
        expect(text).not.toContain(bridgeScriptSource());
      });

    await request(h.server.httpServer)
      .get(`/artifact/${artifact.id}/data.json`)
      .expect(200)
      .expect(({ text, headers }) => {
        expect(headers["content-type"]).toContain("application/json");
        expect(text).toContain("ok");
        expect(text).not.toContain(appearanceResolverScriptSource('\"system\"'));
        expect(text).not.toContain(bridgeScriptSource());
      });
  });

  it("injects appearance after CSP metadata and before styles, with the bridge at document end", async () => {
    const h = await setup();
    const dir = trackedDir("television-injection-order-");
    const appearance = appearanceResolverScriptSource('\"system\"');
    const bridge = bridgeScriptSource();
    const fixtures = [
      `<html><HEAD><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'self'"><style>body{color:red}</style></HEAD><body>explicit head</body></html>`,
      `\n<!-- authored -->\n<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="script-src 'self'"><style>body{color:blue}</style><body>implicit head</body>`,
    ];

    for (const [index, source] of fixtures.entries()) {
      const file = path.join(dir, `fixture-${index}.html`);
      writeFileSync(file, source);
      const artifact = h.store.createArtifact({
        channelID: h.store.listChannels()[0]!.id,
        kind: "path",
        title: `Fixture ${index}`,
        path: file,
      });
      const response = await request(h.server.httpServer)
        .get(`/artifact/${artifact.id}/${path.basename(file)}`)
        .expect(200);
      const cspAt = response.text.indexOf("Content-Security-Policy");
      const appearanceAt = response.text.indexOf(appearance);
      const styleAt = response.text.indexOf("<style>");
      const bodyEndAt = response.text.indexOf("</body>");
      const bridgeAt = response.text.indexOf(bridge);

      expect(cspAt).toBeGreaterThanOrEqual(0);
      expect(appearanceAt).toBeGreaterThan(cspAt);
      expect(styleAt).toBeGreaterThan(appearanceAt);
      expect(bridgeAt).toBeGreaterThan(bodyEndAt);
      expect(response.text.endsWith(`<script>\n${bridge}\n</script>\n`)).toBe(true);
    }
  });

  it("serves exactly one encoded URL for file artifacts", async () => {
    const h = await setup();
    const dir = trackedDir("television-file-");
    const basename = "file (1)#?.%.é.html";
    const filePath = path.join(dir, basename);
    writeFileSync(filePath, "<!doctype html><p>single</p>");
    writeFileSync(path.join(dir, "sibling.css"), "body{}");
    const artifact = h.store.createArtifact({ channelID: h.store.listChannels()[0]!.id, kind: "path", title: "File", path: filePath });
    const encoded = encodeURIComponent(basename);

    for (const route of [`/artifact/${artifact.id}`, `/artifact/${artifact.id}/`]) {
      await request(h.server.httpServer)
        .get(route)
        .expect(301)
        .expect("Location", `/artifact/${artifact.id}/${encoded}`)
        .expect("X-Content-Type-Options", "nosniff")
        .expect("Referrer-Policy", "no-referrer");
    }

    await request(h.server.httpServer)
      .get(`/artifact/${artifact.id}/${encoded}`)
      .expect(200)
      .expect(({ text }) => {
        expect(text).toContain("single");
        expect(text).toContain(bridgeScriptSource());
      });

    await request(h.server.httpServer)
      .get(`/artifact/${artifact.id}/${encodeURIComponent("sibling.css")}`)
      .expect(404)
      .expect("X-Content-Type-Options", "nosniff")
      .expect("Referrer-Policy", "no-referrer");
  });

  it("returns the static missing-artifact view for missing canonical artifact entries and plain 404s for non-entry requests", async () => {
    const missingViewHTML = "<!doctype html><title>Artifact file not found</title><main id=static>static missing view</main>";
    const h = await setup({ bundledViewsPath: createArtifactMissingView(missingViewHTML) });
    const dir = trackedDir("television-proxy-404-");
    const md = path.join(dir, "note.md");
    const html = path.join(dir, "page.html");
    const bundle = path.join(dir, "bundle");
    const empty = path.join(dir, "empty");
    mkdirSync(bundle);
    mkdirSync(empty);
    writeFileSync(path.join(bundle, "index.html"), "<!doctype html>");
    writeFileSync(path.join(empty, "index.html"), "<!doctype html>");
    writeFileSync(md, "# note");
    writeFileSync(html, "<!doctype html>");
    const markdown = h.store.createArtifact({ channelID: h.store.listChannels()[0]!.id, kind: "path", title: "Markdown", path: md });
    const url = h.store.createArtifact({ channelID: h.store.listChannels()[0]!.id, kind: "url", title: "URL", url: "https://example.com" });
    const missing = h.store.createArtifact({ channelID: h.store.listChannels()[0]!.id, kind: "path", title: "Missing", path: html });
    const directoryArtifact = h.store.createArtifact({ channelID: h.store.listChannels()[0]!.id, kind: "path", title: "Dir", path: `${empty}${path.sep}` });
    const fileArtifact = h.store.createArtifact({ channelID: h.store.listChannels()[0]!.id, kind: "path", title: "File", path: html });
    rmSync(path.join(empty, "index.html"));
    rmSync(html);
    mkdirSync(html);

    for (const route of [
      `/artifact/${url.id}/`,
      "/artifact/does-not-exist/",
    ]) {
      await request(h.server.httpServer)
        .get(route)
        .expect(404)
        .expect("X-Content-Type-Options", "nosniff")
        .expect("Referrer-Policy", "no-referrer")
        .expect(({ text }) => expect(text).not.toContain("Artifact file not found"));
    }

    await request(h.server.httpServer)
      .get(`/artifact/${markdown.id}/${encodeURIComponent(path.basename(md))}`)
      .expect(200)
      .expect("Content-Type", /text\/html/)
      .expect(({ text }) => expect(text).toContain("note"));

    for (const [route, targetPath] of [
      [`/artifact/${missing.id}/${encodeURIComponent(path.basename(html))}`, html],
      [`/artifact/${directoryArtifact.id}/`, `${empty}${path.sep}`],
      [`/artifact/${fileArtifact.id}/${encodeURIComponent(path.basename(html))}`, html],
    ] as const) {
      await request(h.server.httpServer)
        .get(route)
        .expect(404)
        .expect("X-Content-Type-Options", "nosniff")
        .expect("Referrer-Policy", "no-referrer")
        .expect("Content-Type", /text\/html/)
        .expect(({ text }) => {
          expect(text).toBe(missingViewHTML);
          expect(text).not.toContain(targetPath);
        });
    }

    await request(h.server.httpServer)
      .get(`/artifact/${directoryArtifact.id}/missing.css`)
      .expect(404)
      .expect(({ text }) => expect(text).not.toContain("Artifact file not found"));
  });

  it("serves the artifact-missing view's script from beside the view, at an address that resolves from both canonical entry shapes and allows any origin", async () => {
    const missingViewHTML = "<!doctype html><script type=module src=\"../../views/artifact-missing/assets/artifactMissing.js\"></script>";
    const staticRoot = createStaticRootWithArtifactMissingView(missingViewHTML);
    const h = await setup({ staticDir: staticRoot, bundledViewsPath: path.join(staticRoot, "views") });
    const dir = trackedDir("television-proxy-missing-assets-");
    const filePath = path.join(dir, "page.html");
    const bundlePath = path.join(dir, "bundle");
    mkdirSync(bundlePath);
    writeFileSync(filePath, "<!doctype html>");
    writeFileSync(path.join(bundlePath, "index.html"), "<!doctype html>");
    const fileArtifact = h.store.createArtifact({ channelID: h.store.listChannels()[0]!.id, kind: "path", title: "File", path: filePath });
    const directoryArtifact = h.store.createArtifact({ channelID: h.store.listChannels()[0]!.id, kind: "path", title: "Dir", path: `${bundlePath}${path.sep}` });
    rmSync(filePath);
    rmSync(path.join(bundlePath, "index.html"));

    for (const route of [
      `/artifact/${fileArtifact.id}/${encodeURIComponent(path.basename(filePath))}`,
      `/artifact/${directoryArtifact.id}/`,
    ]) {
      const response = await request(h.server.httpServer)
        .get(route)
        .expect(404)
        .expect(({ text }) => expect(text).toBe(missingViewHTML));
      const scriptPath = /src="([^"]+)"/.exec(response.text)?.[1];
      const resolvedPath = new URL(scriptPath!, `http://television.test${route}`).pathname;
      expect(resolvedPath).toBe("/views/artifact-missing/assets/artifactMissing.js");
      await request(h.server.httpServer)
        .get(resolvedPath)
        .set("Origin", "null")
        .expect(200)
        .expect("Access-Control-Allow-Origin", "*")
        .expect(({ text }) => expect(text).toContain("__artifactMissingLoaded"));
    }
  });

  it("leaves redirects and unsuccessful responses without cache directives (^apx-t-nonresource-cache)", async () => {
    const missingViewHTML =
      "<!doctype html><title>Artifact file not found</title><main>static missing view</main>";
    const h = await setup({
      bundledViewsPath: createArtifactMissingView(missingViewHTML),
    });
    const dir = trackedDir("television-proxy-nonresource-cache-");
    const bundle = path.join(dir, "bundle");
    const missingPath = path.join(dir, "missing.html");
    mkdirSync(bundle);
    writeFileSync(path.join(bundle, "index.html"), "<!doctype html>");
    writeFileSync(missingPath, "<!doctype html>");
    const channelID = h.store.listChannels()[0]!.id;
    const directoryArtifact = h.store.createArtifact({
      channelID,
      kind: "path",
      title: "Directory",
      path: `${bundle}${path.sep}`,
    });
    const missingArtifact = h.store.createArtifact({
      channelID,
      kind: "path",
      title: "Missing",
      path: missingPath,
    });
    rmSync(missingPath);

    const responses = [
      await request(h.server.httpServer)
        .get(`/artifact/${directoryArtifact.id}`)
        .expect(301),
      await request(h.server.httpServer)
        .get("/artifact/does-not-exist/")
        .expect(404),
      await request(h.server.httpServer)
        .get(
          `/artifact/${missingArtifact.id}/${encodeURIComponent(path.basename(missingPath))}`,
        )
        .expect(404)
        .expect(({ text }) => expect(text).toBe(missingViewHTML)),
      await request(h.server.httpServer)
        .post(`/artifact/${directoryArtifact.id}`)
        .expect(405),
    ];

    for (const response of responses) {
      expect(response.headers["cache-control"]).toBeUndefined();
    }
  });

  it("supports HEAD, method rejection, and injected-HTML validators", async () => {
    const h = await setup();
    const dir = trackedDir("television-head-");
    const file = path.join(dir, "index.html");
    writeFileSync(file, "<!doctype html><p>head</p>");
    const artifact = h.store.createArtifact({ channelID: h.store.listChannels()[0]!.id, kind: "path", title: "HTML", path: file });
    const route = `/artifact/${artifact.id}/${encodeURIComponent(path.basename(file))}`;

    const head = await request(h.server.httpServer)
      .head(route)
      .expect(200)
      .expect("X-Content-Type-Options", "nosniff")
      .expect("Referrer-Policy", "no-referrer")
      .expect("Cache-Control", "no-cache, must-revalidate");
    expect(head.text).toBeUndefined();
    expect(head.headers.etag).toBeDefined();

    await request(h.server.httpServer)
      .get(route)
      .set("If-None-Match", head.headers.etag)
      .expect(304)
      .expect("X-Content-Type-Options", "nosniff")
      .expect("Referrer-Policy", "no-referrer");

    await request(h.server.httpServer)
      .get(route)
      .set("If-None-Match", '"old-etag"')
      .expect(200)
      .expect(({ text }) => expect(text).toContain(bridgeScriptSource()));

    await request(h.server.httpServer)
      .post(route)
      .expect(405)
      .expect("Allow", "GET, HEAD")
      .expect("X-Content-Type-Options", "nosniff")
      .expect("Referrer-Policy", "no-referrer");
  });

  it("revalidates proxied HTML after source edits (^apx-t-document-cache)", async () => {
    const h = await setup();
    const dir = trackedDir("television-html-revalidation-");
    const file = path.join(dir, "document.html");
    writeFileSync(file, "<!doctype html><p>First document</p>");
    const artifact = h.store.createArtifact({
      channelID: h.store.listChannels()[0]!.id,
      kind: "path",
      title: "Revalidating HTML",
      path: file,
    });
    const route = `/artifact/${artifact.id}/${encodeURIComponent(path.basename(file))}`;

    const first = await request(h.server.httpServer)
      .get(route)
      .expect(200)
      .expect("Cache-Control", "no-cache, must-revalidate")
      .expect(({ text }) => expect(text).toContain("First document"));
    expect(first.headers.etag).toBeDefined();

    await request(h.server.httpServer)
      .get(route)
      .set("If-None-Match", first.headers.etag as string)
      .expect(304);

    writeFileSync(file, "<!doctype html><p>Changed document body</p>");
    const changed = await request(h.server.httpServer)
      .get(route)
      .set("If-None-Match", first.headers.etag as string)
      .expect(200)
      .expect("Cache-Control", "no-cache, must-revalidate")
      .expect(({ text }) => expect(text).toContain("Changed document body"));
    expect(changed.headers.etag).not.toBe(first.headers.etag);
  });

  it("revalidates artifact-local stylesheets before reuse (^apx-t-asset-cache)", async () => {
    const h = await setup();
    const dir = trackedDir("television-asset-revalidation-");
    const file = path.join(dir, "artifact-style.css");
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><p>Fixture</p>");
    writeFileSync(file, "body { color: red; }\n");
    const artifact = h.store.createArtifact({
      channelID: h.store.listChannels()[0]!.id,
      kind: "path",
      title: "Revalidating stylesheet",
      path: `${dir}${path.sep}`,
    });
    const route = `/artifact/${artifact.id}/${encodeURIComponent(path.basename(file))}`;

    const first = await request(h.server.httpServer)
      .get(route)
      .expect(200)
      .expect("Cache-Control", "no-cache")
      .expect(({ text }) => expect(text).toBe("body { color: red; }\n"));
    expect(first.headers.etag).toBeDefined();

    await request(h.server.httpServer)
      .get(route)
      .set("If-None-Match", first.headers.etag as string)
      .expect(304)
      .expect("Cache-Control", "no-cache");

    writeFileSync(file, "body { color: rebeccapurple; }\n");
    const changed = await request(h.server.httpServer)
      .get(route)
      .set("If-None-Match", first.headers.etag as string)
      .expect(200)
      .expect("Cache-Control", "no-cache")
      .expect(({ text }) =>
        expect(text).toBe("body { color: rebeccapurple; }\n")
      );
    expect(changed.headers.etag).not.toBe(first.headers.etag);
  });

  it("renders markdown artifacts through the proxy as injected HTML with validators", async () => {
    const h = await setup();
    const dir = trackedDir("television-markdown-proxy-");
    const file = path.join(dir, "note.md");
    writeFileSync(file, "# Hello\n\n<script>window.markdownScript = true;</script>");
    const artifact = h.store.createArtifact({ channelID: h.store.listChannels()[0]!.id, kind: "path", title: "Markdown", path: file });
    const route = `/artifact/${artifact.id}/${encodeURIComponent(path.basename(file))}`;

    await request(h.server.httpServer)
      .get(`/artifact/${artifact.id}`)
      .expect(301)
      .expect("Location", route);

    const head = await request(h.server.httpServer)
      .head(route)
      .expect(200)
      .expect("Content-Type", /text\/html/)
      .expect("X-Content-Type-Options", "nosniff")
      .expect("Referrer-Policy", "no-referrer")
      .expect("Cache-Control", "no-cache, must-revalidate");
    expect(head.headers.etag).toBeDefined();
    expect(head.text).toBeUndefined();

    const first = await request(h.server.httpServer)
      .get(route)
      .expect(200)
      .expect("Content-Type", /text\/html/)
      .expect(({ text }) => {
        expect(text).toContain("<h1>Hello</h1>");
        expect(text).toContain("<script>window.markdownScript = true;</script>");
        expect(text).toContain("/canonical/v2/styles.css");
        // The markdown-doc stylesheet is inlined verbatim, after the canonical
        // <link> so it can override the base and read the canonical tokens.
        expect(text).toContain(MARKDOWN_DOC_CSS);
        const linkAt = text.indexOf("/canonical/v2/styles.css");
        const cssAt = text.indexOf(MARKDOWN_DOC_CSS);
        expect(linkAt).toBeGreaterThanOrEqual(0);
        expect(cssAt).toBeGreaterThan(linkAt);
        // A couple of signature rules from the editor-parity sheet.
        expect(text).toContain("padding: 1.5rem 1rem");
        expect(text).toContain("font-weight: 600");
        expect(text).toContain(bridgeScriptSource());
      });
    expect(first.headers.etag).toBe(head.headers.etag);

    // The document wrapper (incl. its <style>) is folded into the ETag, so it
    // differs from an ETag over the markdown source alone. This is what makes a
    // change to the rendering template invalidate caches on a normal reload
    // instead of silently 304-ing a stale page.
    const sourceOnlyETag = injectedETag(statSync(file), readFileSync(file), bridgeScriptSource());
    expect(first.headers.etag).not.toBe(sourceOnlyETag);

    await request(h.server.httpServer)
      .get(route)
      .set("If-None-Match", first.headers.etag)
      .expect(304)
      .expect("X-Content-Type-Options", "nosniff")
      .expect("Referrer-Policy", "no-referrer");

    writeFileSync(file, "# Changed\n");
    const changed = await request(h.server.httpServer).get(route).expect(200);
    expect(changed.headers.etag).not.toBe(first.headers.etag);
    expect(changed.text).toContain("<h1>Changed</h1>");
  });

  it("keeps proxy reads unauthenticated while registry reads remain authenticated", async () => {
    const h = await setup();
    const dir = trackedDir("television-cap-");
    const file = path.join(dir, "cap.html");
    writeFileSync(file, "<!doctype html><p>capability</p>");
    const artifact = h.store.createArtifact({ channelID: h.store.listChannels()[0]!.id, kind: "path", title: "Cap", path: file });

    await request(h.server.httpServer)
      .get(`/artifact/${artifact.id}/${encodeURIComponent(path.basename(file))}`)
      .expect(200)
      .expect(({ text }) => expect(text).toContain("capability"));
    await request(h.server.httpServer).get("/artifacts").expect(401);
    await request(h.server.httpServer).get(`/artifacts/${artifact.id}`).expect(401);
    await request(h.server.httpServer).get(`/artifacts/${artifact.id}`).set(bearer(h)).expect(200);
  });

  it("serves symlink-to-file artifacts and keeps declared file shape at serve time", async () => {
    const h = await setup();
    const dir = trackedDir("television-symlink-proxy-");
    const target = path.join(dir, "target.html");
    const link = path.join(dir, "link.html");
    writeFileSync(target, "<!doctype html><p>linked</p>");
    symlinkSync(target, link);
    const artifact = h.store.createArtifact({ channelID: h.store.listChannels()[0]!.id, kind: "path", title: "Link", path: link });

    await request(h.server.httpServer)
      .get(`/artifact/${artifact.id}/${encodeURIComponent(path.basename(link))}`)
      .expect(200)
      .expect(({ text }) => expect(text).toContain("linked"));

    rmSync(target);
    mkdirSync(target);
    await request(h.server.httpServer)
      .get(`/artifact/${artifact.id}/${encodeURIComponent(path.basename(link))}`)
      .expect(404);
  });

  it("adds Referrer-Policy to main UI HTML responses", async () => {
    const staticDir = trackedDir("television-static-");
    writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>TV</title>");
    const h = await setup({ staticDir });
    await request(h.server.httpServer).get("/index.html").expect(200).expect("Referrer-Policy", "no-referrer");
  });

  it("mixes both generated script sources into injected HTML validators", () => {
    const dir = trackedDir("television-etag-bridge-");
    const file = path.join(dir, "index.html");
    writeFileSync(file, "<!doctype html><p>etag</p>");
    const stat = statSync(file);
    const body = Buffer.from("<!doctype html><p>etag</p>");

    expect(injectedETag(stat, body, "bridge A", "appearance A"))
      .not.toBe(injectedETag(stat, body, "bridge B", "appearance A"));
    expect(injectedETag(stat, body, "bridge A", "appearance A"))
      .not.toBe(injectedETag(stat, body, "bridge A", "appearance B"));
  });

  it("keeps the static library as resolver and server-injected bridge source centralized", () => {
    const source = readFileSync(new URL("../src/artifact-proxy.ts", import.meta.url), "utf8");
    expect(source).toContain("send(req, subpath");
    expect(source).not.toMatch(/decodeURI(Component)?/);
    expect(source).not.toContain('".."');
    expect(source).not.toContain("'..'");

    const bridgeModule = readFileSync(new URL("../../artifact/src/browser/artifact-bridge.ts", import.meta.url), "utf8");
    const serverProxy = readFileSync(new URL("../src/artifact-proxy.ts", import.meta.url), "utf8");
    const markdownMain = readFileSync(new URL("../../view-markdown/src/main.ts", import.meta.url), "utf8");
    expect(bridgeModule).toContain("function bridgeScriptSource");
    expect(serverProxy).toContain("@telepath-computer/television-artifact/browser");
    expect(markdownMain).toContain("@telepath-computer/television-artifact/browser");
    expect(markdownMain).toContain("installBridge(window)");
    expect(bridgeScriptSource()).toContain("installBridge");
    expect(bridgeScriptSource()).toContain("installAppearanceResolver");
    expect(appearanceResolverScriptSource('\"system\"')).toContain("installAppearanceResolver");
    expect(statSync(new URL("../../artifact/src/browser/artifact-bridge.ts", import.meta.url)).isFile()).toBe(true);
  });
});

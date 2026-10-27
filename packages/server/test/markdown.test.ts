import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "../src/server.ts";
import { ServerStore } from "../src/server-store.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

interface Harness {
  server: Server;
  store: ServerStore;
  storagePath: string;
  token: string;
}

function tempDir(prefix = "television-markdown-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function auth(h: Harness): Record<string, string> {
  return { Authorization: `Bearer ${h.token}` };
}

function defaultChannelID(h: Harness): string {
  return h.store.listChannels()[0]!.id;
}

async function createHarness(options: { bundledViewsPath?: string } = {}): Promise<Harness> {
  const storagePath = tempDir();
  const store = createServingStore(storagePath, { ...(options.bundledViewsPath ? { bundledViewsPath: options.bundledViewsPath } : {}) });
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
  await server.start();
  return { server, store, storagePath, token: store.authToken };
}

describe("markdown carve-out endpoint", () => {
  const harnesses: Harness[] = [];
  const tempPaths: string[] = [];

  afterEach(async () => {
    for (const h of harnesses.splice(0)) {
      await h.server.dispose();
      rmSync(h.storagePath, { recursive: true, force: true });
    }
    for (const dir of tempPaths.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function setup(options: { bundledViewsPath?: string } = {}): Promise<Harness> {
    const h = await createHarness(options);
    harnesses.push(h);
    return h;
  }

  function writeTarget(name: string, content = "# note"): string {
    const dir = tempDir("television-markdown-target-");
    tempPaths.push(dir);
    const filePath = path.join(dir, name);
    writeFileSync(filePath, content);
    return filePath;
  }

  it("GET reads raw markdown bytes and PUT writes through to the pointed-to file", async () => {
    const h = await setup();
    const target = writeTarget("note.md", "# before\n");
    const artifact = h.store.createArtifact({ kind: "path", title: "Note", channelID: defaultChannelID(h), path: target });

    await request(h.server.httpServer)
      .get(`/markdown/${encodeURIComponent(artifact.id)}`)
      .set(auth(h))
      .expect(200)
      .expect("Content-Type", /text\/markdown/)
      .expect("# before\n");

    await request(h.server.httpServer)
      .put(`/markdown/${encodeURIComponent(artifact.id)}`)
      .set(auth(h))
      .set("Content-Type", "text/markdown")
      .send("# after\n")
      .expect(204);

    expect(readFileSync(target, "utf8")).toBe("# after\n");
  });

  it("returns JSON 404s for out-of-scope markdown ids", async () => {
    const h = await setup();
    const md = h.store.createArtifact({ kind: "path", title: "MD", channelID: defaultChannelID(h), path: writeTarget("gone.markdown") });
    if (md.kind !== "path") throw new Error("Expected path artifact");
    rmSync(md.path);
    const html = h.store.createArtifact({ kind: "path", title: "HTML", channelID: defaultChannelID(h), path: writeTarget("index.html", "<!doctype html>") });
    const dir = tempDir("television-markdown-dir-");
    tempPaths.push(dir);
    writeFileSync(path.join(dir, "index.html"), "<!doctype html>");
    const bundle = h.store.createArtifact({ kind: "path", title: "Bundle", channelID: defaultChannelID(h), path: `${dir}${path.sep}` });
    const url = h.store.createArtifact({ kind: "url", title: "URL", channelID: defaultChannelID(h), url: "https://example.com" });

    for (const id of ["missing", url.id, bundle.id, html.id, md.id]) {
      await request(h.server.httpServer)
        .get(`/markdown/${encodeURIComponent(id)}`)
        .set(auth(h))
        .expect(404)
        .expect("Content-Type", /json/)
        .expect(({ body }) => expect(body).toEqual({ message: expect.any(String) }));
      await request(h.server.httpServer)
        .put(`/markdown/${encodeURIComponent(id)}`)
        .set(auth(h))
        .set("Content-Type", "text/markdown")
        .send("x")
        .expect(404)
        .expect("Content-Type", /json/)
        .expect(({ body }) => expect(body).toEqual({ message: expect.any(String) }));
    }
  });

  it("answers an unreadable markdown file as missing and a write it cannot make with a JSON 500", async () => {
    if (process.platform === "win32") return;
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const h = await setup();
    const readTarget = writeTarget("read-denied.md", "# before");
    const writeTargetPath = writeTarget("write-denied.md", "# before");
    const readArtifact = h.store.createArtifact({ kind: "path", title: "Read denied", channelID: defaultChannelID(h), path: readTarget });
    const writeArtifact = h.store.createArtifact({ kind: "path", title: "Write denied", channelID: defaultChannelID(h), path: writeTargetPath });
    chmodSync(readTarget, 0o000);
    chmodSync(writeTargetPath, 0o400);

    try {
      // A file that cannot be read is not one an artifact can be created
      // from, so it is missing (specs/product/artifacts.md#^af-real-location).
      await request(h.server.httpServer)
        .get(`/markdown/${encodeURIComponent(readArtifact.id)}`)
        .set(auth(h))
        .expect(404)
        .expect("Content-Type", /json/)
        .expect(({ body }) => expect(body).toEqual({ message: expect.any(String) }));

      await request(h.server.httpServer)
        .put(`/markdown/${encodeURIComponent(writeArtifact.id)}`)
        .set(auth(h))
        .set("Content-Type", "text/markdown")
        .send("x")
        .expect(500)
        .expect("Content-Type", /json/)
        .expect(({ body }) => expect(body).toEqual({ message: expect.any(String) }));
    } finally {
      chmodSync(readTarget, 0o600);
      chmodSync(writeTargetPath, 0o600);
    }
  });

  it("requires bearer auth and rejects query-token-only access", async () => {
    const h = await setup();
    const artifact = h.store.createArtifact({ kind: "path", title: "Note", channelID: defaultChannelID(h), path: writeTarget("note.md") });
    const target = `/markdown/${encodeURIComponent(artifact.id)}`;

    await request(h.server.httpServer).get(target).expect(401);
    await request(h.server.httpServer).get(`${target}?token=${encodeURIComponent(h.token)}`).expect(401);
    await request(h.server.httpServer).get(target).set(auth(h)).expect(200);
  });

  it("serves fixed markdown view assets without authentication", async () => {
    const viewsRoot = tempDir("television-views-");
    tempPaths.push(viewsRoot);
    const markdownDir = path.join(viewsRoot, "markdown");
    mkdirSync(markdownDir, { recursive: true });
    writeFileSync(path.join(markdownDir, "index.html"), "<!doctype html><title>Markdown</title>");
    writeFileSync(path.join(markdownDir, "asset.js"), "window.markdownAsset = true;");
    const h = await setup({ bundledViewsPath: viewsRoot });

    expect(h.store.getViewPath("markdown")).toBe(markdownDir);
    await request(h.server.httpServer).get("/views/markdown/").expect(200).expect(/Markdown/);
    await request(h.server.httpServer).get("/views/markdown/asset.js").expect(200).expect(/markdownAsset/);
  });
});

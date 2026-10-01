import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

function tempDir(prefix = "television-routes-views-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("fixed markdown view routes", () => {
  const dirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.dispose();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("serves /views/markdown/ and subresources without authentication", async () => {
    const storagePath = tempDir("television-view-storage-");
    const viewsRoot = tempDir("television-view-dist-");
    dirs.push(storagePath, viewsRoot);
    const markdownDir = path.join(viewsRoot, "markdown");
    mkdirSync(markdownDir, { recursive: true });
    writeFileSync(path.join(viewsRoot, "secret.txt"), "no peeking");
    writeFileSync(path.join(markdownDir, "index.html"), "<!doctype html><title>Markdown</title>");
    writeFileSync(path.join(markdownDir, "manifest.json"), JSON.stringify({ name: "Markdown", description: "Edits markdown." }));
    writeFileSync(path.join(markdownDir, "editor.js"), "export {};\n");
    writeFileSync(path.join(markdownDir, "style.css"), "body { color: red; }\n");
    const store = createServingStore(storagePath, { bundledViewsPath: viewsRoot });
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
    servers.push(server);
    await server.start();

    await request(server.httpServer).get("/views/markdown/").expect(200).expect(/Markdown/);
    const jsRes = await request(server.httpServer).get("/views/markdown/editor.js").expect(200).expect(/export/);
    expect(jsRes.headers["content-type"]).toMatch(/javascript/);
    const cssRes = await request(server.httpServer).get("/views/markdown/style.css").expect(200).expect(/color: red/);
    expect(cssRes.headers["content-type"]).toContain("text/css");
    const manifestRes = await request(server.httpServer).get("/views/markdown/manifest.json").expect(200);
    expect(manifestRes.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(manifestRes.text)).toMatchObject({ name: "Markdown", description: "Edits markdown." });

    await request(server.httpServer).get("/views/markdown/../secret.txt").expect(404);
    for (const traversal of ["/views/markdown/%2e%2e/secret.txt", "/views/markdown/..%2Fsecret.txt"]) {
      const res = await request(server.httpServer).get(traversal);
      expect([403, 404]).toContain(res.status);
      expect(res.text).not.toContain("no peeking");
    }

    await request(server.httpServer).get("/views/unknown").expect(404);
    await request(server.httpServer).get("/views/unknown/").expect(404);
    await request(server.httpServer).get("/views/unknown/anything.js").expect(404);
  });

  it("returns 404 when the markdown view index.html is missing", async () => {
    const storagePath = tempDir("television-view-storage-");
    const viewsRoot = tempDir("television-view-dist-");
    dirs.push(storagePath, viewsRoot);
    mkdirSync(path.join(viewsRoot, "markdown"), { recursive: true });
    writeFileSync(path.join(viewsRoot, "markdown", "editor.js"), "export {};\n");
    const store = createServingStore(storagePath, { bundledViewsPath: viewsRoot });
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
    servers.push(server);
    await server.start();

    await request(server.httpServer).get("/views/markdown").expect(404);
  });
});

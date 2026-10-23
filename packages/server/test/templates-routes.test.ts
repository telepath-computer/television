import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { TelevisionClient } from "@telepath-computer/television-shared";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

const homes: string[] = [];
const servers: Server[] = [];

function home(): string {
  const created = mkdtempSync(path.join(os.tmpdir(), "tv-templates-routes-"));
  homes.push(created);
  return created;
}

function template(homePath: string, id: string, name = id): string {
  const folder = path.join(homePath, "templates", id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name, description: "Ready to use", version: "1.0.0" }));
  writeFileSync(path.join(folder, "index.html"), "<!doctype html><title>Ready</title>");
  return folder;
}

async function start(homePath: string): Promise<{ server: Server; token: string; channelID: string }> {
  const store = createServingStore(homePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
  servers.push(server);
  await server.start();
  return { server, token: store.authToken, channelID: store.listChannels()[0]!.id };
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.dispose();
  for (const folder of homes.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("artifact template routes", () => {
  // proofs/arch/templates/index.md#^templates-t-routes
  it("authenticates list, returns a fresh full scan, and sends no CORS headers", async () => {
    const root = home();
    const { server, token } = await start(root);
    await request(server.httpServer).get("/templates").expect(401);
    const first = await request(server.httpServer).get("/templates").set(auth(token)).set("Origin", "https://outside.example").expect(200);
    expect(first.body).toEqual({ templates: [], errors: [], watching: false });
    expect(first.headers["access-control-allow-origin"]).toBeUndefined();
    template(root, "first", "First");
    const client = new TelevisionClient(server.getBaseURL(), { token });
    const second = await client.templates.list();
    expect(second.templates).toMatchObject([{ id: "first", name: "First" }]);
    expect(second.errors).toEqual([]);
  });

  // proofs/arch/templates/index.md#^templates-t-create-route
  it("refuses missing, invalid, outside, and scan-wide-failed IDs from a fresh scan", async () => {
    const root = home();
    const { server, token, channelID } = await start(root);
    template(root, "valid");
    const invalid = template(root, "invalid");
    rmSync(path.join(invalid, "index.html"));
    const outside = path.join(root, "outside-template");
    mkdirSync(outside);
    writeFileSync(path.join(outside, "manifest.json"), JSON.stringify({ name: "Outside", description: "Outside", version: "1.0.0" }));
    writeFileSync(path.join(outside, "index.html"), "outside");
    const create = (templateID: string) => request(server.httpServer).post("/templates/artifacts")
      .set(auth(token)).send({ templateID, channelID, source: "cli" });

    await request(server.httpServer).post("/templates/artifacts").send({ templateID: "valid", channelID, source: "cli" }).expect(401);
    expect((await create("missing").expect(404)).body.error).toMatch(/missing/);
    expect((await create("invalid").expect(400)).body.error).toMatch(/index\.html/);
    expect((await create("../outside-template").expect(404)).body.error).toMatch(/outside-template/);
    expect(readdirSync(path.join(root, "artifacts"))).toEqual([]);
    const records = await request(server.httpServer).get("/artifacts").set(auth(token)).expect(200);
    expect(records.body.artifacts).toEqual([]);
    rmSync(path.join(root, "templates"), { recursive: true });
    writeFileSync(path.join(root, "templates"), "obstructed");
    expect((await create("valid").expect(500)).body.error).toMatch(/templates directory/);
  });

  // proofs/arch/templates/index.md#^templates-t-create-route
  it("creates from an immediately edited manifest through a fresh exact-ID lookup", async () => {
    const root = home();
    const folder = template(root, "Space #One");
    const { server, token, channelID } = await start(root);
    const client = new TelevisionClient(server.getBaseURL(), { token });
    await client.templates.list();
    writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({
      name: "Edited name", description: "Site", version: "1.0.0", url: "https://example.com/edited",
    }));
    const result = await client.templates.create({ templateID: "Space #One", channelID, source: "cli" });
    expect(result).toEqual({ artifactID: expect.any(String), url: "https://example.com/edited" });
    expect((await client.artifacts.get({ artifactID: result.artifactID })).artifact).toMatchObject({ title: "Edited name" });
  });

  // proofs/arch/templates/index.md#^templates-t-thumbnail-route
  it("serves exact thumbnail bytes through the authenticated client and refuses missing or escaping files", async () => {
    const root = home();
    const special = template(root, "Space #One");
    const bytes = Buffer.from([137, 80, 78, 71, 0, 12, 255]);
    writeFileSync(path.join(special, "thumbnail.png"), bytes);
    template(root, "no-image");
    const invalid = template(root, "invalid");
    rmSync(path.join(invalid, "index.html"));
    writeFileSync(path.join(invalid, "thumbnail.png"), bytes);
    const outside = path.join(root, "outside.png");
    writeFileSync(outside, bytes);
    const outsideTemplate = path.join(root, "outside-template");
    mkdirSync(outsideTemplate);
    writeFileSync(path.join(outsideTemplate, "manifest.json"), JSON.stringify({
      name: "Outside", description: "Outside sibling", version: "1.0.0",
    }));
    writeFileSync(path.join(outsideTemplate, "index.html"), "<!doctype html><title>Outside</title>");
    writeFileSync(path.join(outsideTemplate, "thumbnail.png"), Buffer.from("outside sibling thumbnail"));
    const linked = template(root, "linked");
    symlinkSync(outside, path.join(linked, "thumbnail.png"));
    const unreadable = template(root, "unreadable");
    symlinkSync(path.join(root, "missing.png"), path.join(unreadable, "thumbnail.png"));
    const { server, token } = await start(root);
    const encoded = encodeURIComponent("Space #One");
    await request(server.httpServer).get(`/templates/${encoded}/thumbnail.png`).expect(401);
    const response = await request(server.httpServer).get(`/templates/${encoded}/thumbnail.png`)
      .set(auth(token)).set("Origin", "https://outside.example").expect(200);
    expect(response.headers["content-type"]).toMatch(/^image\/png/);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.body).toEqual(bytes);
    const client = new TelevisionClient(server.getBaseURL(), { token });
    expect(Buffer.from(await client.templates.thumbnail("Space #One"))).toEqual(bytes);
    for (const id of ["no-image", "invalid", "linked", "unreadable", "../outside-template"]) {
      await request(server.httpServer).get(`/templates/${encodeURIComponent(id)}/thumbnail.png`).set(auth(token)).expect(404);
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { TelevisionClient } from "@telepath-computer/television-shared";
import WebSocket from "ws";
import { Server } from "../src/server.ts";
import { createServingStore, type ServingStoreOverrides } from "../../../test/helpers/serving-store.ts";

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

async function start(homePath: string, overrides: ServingStoreOverrides = {}): Promise<{ server: Server; store: ReturnType<typeof createServingStore>; token: string; channelID: string }> {
  const store = createServingStore(homePath, overrides);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
  servers.push(server);
  await server.start();
  return { server, store, token: store.authToken, channelID: store.listChannels()[0]!.id };
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.dispose();
  vi.restoreAllMocks();
  for (const folder of homes.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("artifact template routes", () => {
  // proofs/arch/templates/index.md#^templates-t-routes
  it("authenticates cached lists and publishes immediate fresh shared-client scans", async () => {
    const root = home();
    const folder = template(root, "first", "First");
    const { server, token } = await start(root);
    await request(server.httpServer).get("/templates").expect(401);
    const first = await request(server.httpServer).get("/templates").set(auth(token)).set("Origin", "https://outside.example").expect(200);
    expect(first.body).toMatchObject({ templates: [{ id: "first", name: "First" }], errors: [], watching: true });
    expect(first.headers["access-control-allow-origin"]).toBeUndefined();
    const client = new TelevisionClient(server.getBaseURL(), { token });
    const socket = new WebSocket(`${server.getBaseURL().replace("http:", "ws:")}/events?token=${token}`);
    const events: any[] = [];
    socket.on("message", (data) => events.push(JSON.parse(data.toString())));
    try {
      await vi.waitFor(() => expect(events[0]?.type).toBe("server-status"));
      // Synchronous route calls can prove the cached read before native watch delivery.
      writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name: "Edited", description: "Ready", version: "1.0.0" }));
      const second = await client.templates.list({ fresh: true });
      expect(second.templates[0]?.name).toBe("Edited");
      expect(await client.templates.list()).toEqual(second);
      await vi.waitFor(() => expect(events.some((event) => event.type === "templates-changed" && event.scan.templates[0]?.name === "Edited")).toBe(true));
    } finally { socket.terminate(); }
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

  // proofs/arch/templates/index.md#^templates-t-icon-route
  it("serves authenticated exact-ID icons with media type and no-store and rechecks symlink containment", async () => {
    const root = home();
    const special = template(root, "Space #One");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>';
    writeFileSync(path.join(special, "image.svg"), svg);
    const manifest = { name: "Icon", description: "Page", version: "1.0.0", icons: [{ src: "image.svg" }] };
    writeFileSync(path.join(special, "manifest.json"), JSON.stringify(manifest));
    const png = template(root, "png");
    const bytes = Buffer.from([137, 80, 78, 71, 0, 12, 255]);
    writeFileSync(path.join(png, "image.png"), bytes);
    writeFileSync(path.join(png, "manifest.json"), JSON.stringify({ ...manifest, icons: [{ src: "image.png" }] }));
    template(root, "no-image");
    const linked = template(root, "linked");
    writeFileSync(path.join(linked, "local.svg"), svg);
    symlinkSync("local.svg", path.join(linked, "image.svg"));
    writeFileSync(path.join(linked, "manifest.json"), JSON.stringify(manifest));
    const { server, token } = await start(root);
    const encoded = encodeURIComponent("Space #One");
    await request(server.httpServer).get(`/templates/${encoded}/icon`).expect(401);
    const response = await request(server.httpServer).get(`/templates/${encoded}/icon`)
      .set(auth(token)).set("Origin", "https://outside.example").expect(200);
    expect(response.headers["content-type"]).toMatch(/^image\/svg\+xml/);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    const client = new TelevisionClient(server.getBaseURL(), { token });
    expect(await client.templates.icon("Space #One")).toEqual({ bytes: new Uint8Array(Buffer.from(svg)), contentType: "image/svg+xml" });
    expect(await client.templates.icon("png")).toEqual({ bytes: new Uint8Array(bytes), contentType: "image/png" });
    expect(await client.templates.icon("linked")).toMatchObject({ contentType: "image/svg+xml" });
    writeFileSync(path.join(root, "outside.svg"), "outside");
    rmSync(path.join(linked, "image.svg"));
    symlinkSync(path.join(root, "outside.svg"), path.join(linked, "image.svg"));
    for (const id of ["missing", "no-image", "linked", "../outside"]) {
      await request(server.httpServer).get(`/templates/${encodeURIComponent(id)}/icon`).set(auth(token)).expect(404);
    }
  });

  it("fallback list scans publish but icon-only validation changes neither cache nor events", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = home();
    const folder = template(root, "one");
    const { server, store, token } = await start(root, { watchContentFile: () => { throw new Error("watch unavailable"); } });
    const client = new TelevisionClient(server.getBaseURL(), { token });
    expect((await client.templates.list()).watching).toBe(false);
    const before = store.templateCache!.getSnapshot();
    const events = vi.fn();
    store.addEventListener("templates-changed", events);
    const manifest = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    writeFileSync(path.join(folder, "icon.svg"), "<svg/>");
    writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ ...manifest, name: "Edited", icons: [{ src: "icon.svg" }] }));
    expect(await client.templates.icon("one")).toMatchObject({ contentType: "image/svg+xml" });
    expect(store.templateCache!.getSnapshot()).toBe(before);
    expect(events).not.toHaveBeenCalled();
    expect((await client.templates.list()).templates[0]).toMatchObject({ name: "Edited", hasIcon: true });
    expect(events).toHaveBeenCalledTimes(1);
    rmSync(path.join(folder, "index.html"));
    await expect(client.templates.icon("one")).rejects.toMatchObject({ status: 404 });
    expect(events).toHaveBeenCalledTimes(1);
  });

  // proofs/arch/templates/index.md#^templates-t-cache-events
  it("publishes native nested edits and folder additions renames removals without replay and keeps linked-content events", async () => {
    const root = home();
    const folder = template(root, "one");
    mkdirSync(path.join(folder, "nested"));
    writeFileSync(path.join(folder, "nested", "style.css"), "first");
    const { server, token, channelID } = await start(root);
    const client = new TelevisionClient(server.getBaseURL(), { token });
    const artifact = await client.templates.create({ templateID: "one", channelID, source: "cli" });
    const socket = new WebSocket(`${server.getBaseURL().replace("http:", "ws:")}/events?token=${token}`);
    const events: any[] = [];
    socket.on("message", (data) => events.push(JSON.parse(data.toString())));
    try {
      await vi.waitFor(() => expect(events[0]?.type).toBe("server-status"));
      await new Promise<void>((resolve) => { socket.once("pong", () => resolve()); socket.ping(); });
      expect(events).toHaveLength(1);
      const edits = () => events.filter((event) => event.type === "templates-changed");
      writeFileSync(path.join(folder, "nested", "style.css"), "second");
      await vi.waitFor(() => expect(edits().at(-1)).toMatchObject({ scan: { templates: [{ id: "one" }], watching: true }, invalidatedIDs: ["one"] }));
      await vi.waitFor(() => expect(events.some((event) => event.type === "artifact-content-changed" && event.artifactID === artifact.artifactID)).toBe(true));
      template(root, "two");
      await vi.waitFor(() => expect(edits().at(-1)?.scan.templates.map((entry: { id: string }) => entry.id)).toEqual(["one", "two"]));
      renameSync(path.join(root, "templates", "two"), path.join(root, "templates", "renamed"));
      await vi.waitFor(() => expect(edits().at(-1)?.scan.templates.map((entry: { id: string }) => entry.id)).toEqual(["one", "renamed"]));
      expect(edits().at(-1)?.invalidatedIDs).toEqual(expect.arrayContaining(["two", "renamed"]));
      rmSync(path.join(root, "templates", "renamed"), { recursive: true });
      await vi.waitFor(() => expect(edits().at(-1)?.scan.templates.map((entry: { id: string }) => entry.id)).toEqual(["one"]));
      expect(edits().at(-1)?.invalidatedIDs).toContain("renamed");
    } finally { socket.terminate(); }
  });

});

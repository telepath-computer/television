import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import WebSocket from "ws";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";
import { seedThemePackage } from "../../../test/helpers/theme-package.ts";

function tempDir(): string { return mkdtempSync(path.join(os.tmpdir(), "television-events-")); }

describe("artifact registry events", () => {
  const servers: Server[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.dispose();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("emits create, update, and remove events for pointer artifacts", async () => {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const target = path.join(storagePath, "event.html");
    writeFileSync(target, "<!doctype html>");
    const store = createServingStore(storagePath);
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
    servers.push(server);
    await server.start();
    const listener = vi.fn();
    store.addEventListener("artifact-created", listener);
    store.addEventListener("artifact-updated", listener);
    store.addEventListener("artifact-removed", listener);
    const channel = store.listChannels()[0]!;
    const auth = { Authorization: `Bearer ${store.authToken}` };

    const created = await request(server.httpServer)
      .post("/artifacts")
      .set(auth)
      .send({ kind: "path", title: "Before", path: target, channelID: channel.id })
      .expect(201);
    await request(server.httpServer).patch(`/artifacts/${created.body.artifact.id}`).set(auth).send({ title: "After" }).expect(200);
    await request(server.httpServer).delete(`/artifacts/${created.body.artifact.id}`).set(auth).expect(200);

    expect(listener.mock.calls.map(([event]) => event.type)).toEqual([
      "artifact-created",
      "artifact-updated",
      "artifact-removed",
    ]);
  });
});


// `events` is the DOMAIN stream: the connect-time `server-status` message
// (specs/arch/updates/version-advertisement.md ^events-version) is collected
// separately in `statusMessages` — its contract is owned by
// version-advertisement.test.ts; these tests assert domain-event delivery.
async function openEvents(server: Server, token: string): Promise<{ ws: WebSocket; events: any[]; statusMessages: any[] }> {
  const ws = new WebSocket(`${server.getBaseURL().replace(/^http/, "ws")}/events?token=${encodeURIComponent(token)}`);
  const events: any[] = [];
  const statusMessages: any[] = [];
  ws.on("message", (data) => {
    const message = JSON.parse(String(data));
    if (message.type === "server-status") statusMessages.push(message);
    else events.push(message);
  });
  await new Promise<void>((resolve) => ws.on("open", () => resolve()));
  return { ws, events, statusMessages };
}

describe("/events websocket stream", () => {
  const servers: Server[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.dispose();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function harness(options: { auth?: boolean } = {}) {
    const storagePath = tempDir();
    dirs.push(storagePath);
    const target = path.join(storagePath, "event.html");
    writeFileSync(target, "<!doctype html>");
    const store = createServingStore(storagePath);
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: options.auth ?? true });
    servers.push(server);
    await server.start();
    return { storagePath, target, store, server, auth: { Authorization: `Bearer ${store.authToken}` } };
  }



  it("rejects websocket clients with an invalid token string", async () => {
    const h = await harness();
    const ws = new WebSocket(`${h.server.getBaseURL().replace(/^http/, "ws")}/events?token=wrong-token`);
    const code = await new Promise<number>((resolve) => ws.on("close", (closeCode) => resolve(closeCode)));
    expect(code).toBe(4401);
  });

  it("ignores client-to-server websocket messages", async () => {
    const h = await harness();
    const { ws, events } = await openEvents(h.server, h.store.authToken);
    ws.send(JSON.stringify({ type: "channel-created", channel: { id: "fake", name: "Fake", layout: [] } }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.close();
    expect(events).toEqual([]);
    expect(h.store.getChannel("fake")).toBeUndefined();
  });

  it("broadcasts artifact-content-changed events from watched file changes", async () => {
    const h = await harness();
    const artifact = h.store.createArtifact({ kind: "path", title: "Watched", channelID: h.store.listChannels()[0]!.id, path: h.target });
    const { ws, events } = await openEvents(h.server, h.store.authToken);
    await new Promise((resolve) => setTimeout(resolve, 75));
    writeFileSync(h.target, "<!doctype html><h1>changed</h1>");
    await new Promise((resolve) => setTimeout(resolve, 350));
    ws.close();
    expect(events).toContainEqual({ type: "artifact-content-changed", artifactID: artifact.id });
  });

  it("keeps websocket channel payloads byte-identical to HTTP channel reads", async () => {
    const h = await harness();
    const { ws, events } = await openEvents(h.server, h.store.authToken);
    const created = await request(h.server.httpServer).post("/channels").set(h.auth).send({ name: "HTTP parity" }).expect(201);
    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.close();
    expect(events).toContainEqual({ type: "channel-created", channel: created.body.channel });
  });

  it("rejects websocket clients without a valid token using 4401", async () => {
    const h = await harness();
    const ws = new WebSocket(`${h.server.getBaseURL().replace(/^http/, "ws")}/events`);
    const code = await new Promise<number>((resolve) => ws.on("close", (closeCode) => resolve(closeCode)));
    expect(code).toBe(4401);
  });

  it("sends exactly one server-status message on connect and replays no domain events", async () => {
    const h = await harness();
    const { ws, events, statusMessages } = await openEvents(h.server, h.store.authToken);
    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.close();
    expect(events).toEqual([]);
    expect(statusMessages).toHaveLength(1);
    expect(statusMessages[0]).toMatchObject({ type: "server-status" });
  });

  // spec: proofs/arch/resources/index.md#^rs-arch-t-events-token
  it("sends server-status first to a client without a token on a tokenless server", async () => {
    const h = await harness({ auth: false });
    const ws = new WebSocket(`${h.server.getBaseURL().replace(/^http/, "ws")}/events`);
    const first = await new Promise<unknown>((resolve, reject) => {
      ws.once("message", (data) => resolve(JSON.parse(String(data))));
      ws.once("close", (code) => reject(new Error(`closed with ${code}`)));
    });
    ws.close();
    expect(first).toMatchObject({ type: "server-status" });
  });

  it("broadcasts full artifact payloads to multiple clients in create/update/remove order", async () => {
    const h = await harness();
    const first = await openEvents(h.server, h.store.authToken);
    const second = await openEvents(h.server, h.store.authToken);
    const channel = h.store.listChannels()[0]!;

    const created = await request(h.server.httpServer)
      .post("/artifacts")
      .set(h.auth)
      .send({ kind: "path", title: "Before", path: h.target, channelID: channel.id })
      .expect(201);
    const updated = await request(h.server.httpServer).patch(`/artifacts/${created.body.artifact.id}`).set(h.auth).send({ title: "After" }).expect(200);
    await request(h.server.httpServer).delete(`/artifacts/${created.body.artifact.id}`).set(h.auth).expect(200);
    const renamed = await request(h.server.httpServer).patch(`/channels/${channel.id}`).set(h.auth).send({ name: "Renamed" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    first.ws.close(); second.ws.close();

    for (const events of [first.events, second.events]) {
      expect(events.map((event) => event.type)).toEqual(["artifact-created", "artifact-updated", "artifact-removed", "channel-updated"]);
      expect(events[0]).toEqual({ type: "artifact-created", channelID: channel.id, artifact: created.body.artifact });
      expect(events[1]).toEqual({ type: "artifact-updated", artifact: updated.body.artifact });
      expect(events[2]).toEqual({ type: "artifact-removed", artifactID: created.body.artifact.id, channelID: channel.id });
      expect(events[3]).toEqual({ type: "channel-updated", channel: renamed.body.channel });
      expect("artifacts" in events[3]).toBe(false);
    }
  });

  it("emits only the pinned event-family names across delivery mutations", async () => {
    const h = await harness();
    const { ws, events } = await openEvents(h.server, h.store.authToken);

    const createdChannel = await request(h.server.httpServer).post("/channels").set(h.auth).send({ name: "Family" }).expect(201);
    const channelID = createdChannel.body.channel.id;
    const created = await request(h.server.httpServer)
      .post("/artifacts")
      .set(h.auth)
      .send({ kind: "path", title: "Family Artifact", path: h.target, channelID })
      .expect(201);
    await request(h.server.httpServer).patch(`/artifacts/${created.body.artifact.id}`).set(h.auth).send({ title: "Renamed" }).expect(200);
    await request(h.server.httpServer).patch(`/channels/${channelID}`).set(h.auth).send({ name: "Family Updated" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 75));
    writeFileSync(h.target, "<!doctype html><h1>family</h1>");
    await new Promise((resolve) => setTimeout(resolve, 350));
    await request(h.server.httpServer).delete(`/artifacts/${created.body.artifact.id}`).set(h.auth).expect(200);
    await request(h.server.httpServer).delete(`/channels/${channelID}`).set(h.auth).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.close();

    expect(new Set(events.map((event) => event.type))).toEqual(new Set([
      "artifact-created",
      "artifact-updated",
      "artifact-content-changed",
      "artifact-removed",
      "channel-created",
      "channel-updated",
      "channel-removed",
    ]));
    expect(events).toHaveLength(7);
  });

  it("orders artifact removals, channel removal, pin pruning, and successor focus", async () => {
    const h = await harness();
    const successor = h.store.listChannels()[0]!;
    const channel = h.store.createChannel({ name: "Delete" });
    const artifact = h.store.createArtifact({ kind: "path", title: "A", path: h.target, channelID: channel.id });
    await request(h.server.httpServer).patch("/display").set(h.auth).send({
      focusedChannelId: channel.id,
      pinnedChannelIds: [channel.id, successor.id],
    }).expect(204);
    const { ws, events } = await openEvents(h.server, h.store.authToken);

    await request(h.server.httpServer).delete(`/channels/${channel.id}`).set(h.auth).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.close();

    expect(events).toEqual([
      { type: "artifact-removed", artifactID: artifact.id, channelID: channel.id },
      { type: "channel-removed", channelID: channel.id },
      { type: "pinned-channels-changed", pinnedChannelIds: [successor.id] },
      { type: "channel-changed", channelID: successor.id },
    ]);
    expect(h.store.getDisplayState()).toEqual({
      focusedChannelId: successor.id,
      pinnedChannelIds: [successor.id],
      activeThemeName: null,
      activeThemeColorScheme: null,
      appearanceMode: "system",
      themeJavaScriptConsentIds: [],
    });
    await request(h.server.httpServer).get("/display").set(h.auth).expect(200).expect(({ body }) => {
      expect(body).toMatchObject({
        focusedChannelId: successor.id,
        pinnedChannelIds: [successor.id],
        activeThemeName: null,
        activeThemeColorScheme: null,
        appearanceMode: "system",
        acpEnabled: false,
      });
    });
  });

  it("broadcasts refresh fallback and does not reselect a repaired theme after restart", async () => {
    const h = await harness();
    const themeDir = seedThemePackage(h.storagePath, "paperlike");
    await request(h.server.httpServer).post("/themes/refresh").set(h.auth).expect(200);
    await request(h.server.httpServer)
      .patch("/display")
      .set(h.auth)
      .send({ activeThemeName: "paperlike" })
      .expect(204);
    const { ws, events } = await openEvents(h.server, h.store.authToken);

    writeFileSync(
      path.join(themeDir, "manifest.json"),
      `${JSON.stringify({ name: "Paperlike", version: "invalid" })}\n`,
      "utf8",
    );
    await request(h.server.httpServer).post("/themes/refresh").set(h.auth).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.close();

    expect(events).toContainEqual({
      type: "theme-changed",
      themeName: null,
      activeThemeColorScheme: null,
      themeJavaScriptConsentIds: [],
    });
    expect(JSON.parse(readFileSync(path.join(h.storagePath, "state", "display.json"), "utf8"))).toMatchObject({
      activeThemeName: null,
    });

    seedThemePackage(h.storagePath, "paperlike");
    await h.server.dispose();
    servers.splice(servers.indexOf(h.server), 1);
    const restartedStore = createServingStore(h.storagePath);
    const restarted = new Server({ store: restartedStore, host: "127.0.0.1", port: 0, auth: true });
    servers.push(restarted);
    await restarted.start();

    expect(restartedStore.getThemeRegistry().themes.map((theme) => theme.id)).toContain("paperlike");
    expect(restartedStore.getActiveThemeName()).toBeNull();
    await request(restarted.httpServer)
      .get("/display")
      .set({ Authorization: `Bearer ${restartedStore.authToken}` })
      .expect(200)
      .expect(({ body }) => expect(body.activeThemeName).toBeNull());
  });

  it("does not replay old events to clients that connect after a restart", async () => {
    const h = await harness();
    h.store.createChannel({ name: "Before" });
    const artifact = h.store.createArtifact({ kind: "path", title: "Watched", channelID: h.store.listChannels()[0]!.id, path: h.target });
    await h.server.dispose();
    servers.splice(servers.indexOf(h.server), 1);

    const restartedStore = createServingStore(h.storagePath);
    const restarted = new Server({ store: restartedStore, host: "127.0.0.1", port: 0, auth: true });
    servers.push(restarted);
    await restarted.start();
    const { ws, events } = await openEvents(restarted, restartedStore.authToken);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events).toEqual([]);
    writeFileSync(h.target, "<!doctype html><h1>after restart</h1>");
    await new Promise((resolve) => setTimeout(resolve, 350));
    ws.close();

    expect(events).toEqual([{ type: "artifact-content-changed", artifactID: artifact.id }]);
  });
});

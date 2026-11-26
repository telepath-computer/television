import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import WebSocket from "ws";
import { Server } from "../src/server.ts";
import { telemetryVersion, type BuiltTelemetryEvent } from "../src/telemetry/index.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

const homes: string[] = [];
const servers: Server[] = [];
const sockets: WebSocket[] = [];

function home(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "tv-channel-invariant-"));
  homes.push(root);
  return root;
}

async function start(root: string) {
  const store = createServingStore(root);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
  servers.push(server);
  await server.start();
  return { store, server, auth: { Authorization: `Bearer ${store.authToken}` } };
}

async function events(server: Server, token: string): Promise<{ ws: WebSocket; received: unknown[] }> {
  const ws = new WebSocket(`${server.getBaseURL().replace(/^http/, "ws")}/events?token=${encodeURIComponent(token)}`);
  sockets.push(ws);
  const received: unknown[] = [];
  ws.on("message", (message) => {
    const event = JSON.parse(String(message)) as { type: string };
    if (event.type !== "server-status") received.push(event);
  });
  await new Promise<void>((resolve) => ws.once("open", resolve));
  return { ws, received };
}

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  for (const server of servers.splice(0)) await server.dispose();
  for (const root of homes.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("serving channel invariant", () => {
  // proofs/arch/channel-state/index.md#^cs-ac-first-focus
  it.each([null, "missing-channel"])("repairs %s focus on serving boot before HTTP clients connect", async (focus) => {
    const root = home();
    mkdirSync(path.join(root, "state", "channels"), { recursive: true });
    writeFileSync(path.join(root, "state", "channels", "first.json"), JSON.stringify({ id: "first", name: "First", layoutVersion: 2, layout: [] }));
    writeFileSync(path.join(root, "state", "display.json"), JSON.stringify({
      focusedChannelId: focus, pinnedChannelIds: [], activeThemeName: null, appearanceMode: "system",
    }));
    const { server, auth } = await start(root);
    const display = await request(server.httpServer).get("/display").set(auth).expect(200);
    expect(display.body.focusedChannelId).toBe("first");
    expect(JSON.parse(readFileSync(path.join(root, "state", "display.json"), "utf8")).focusedChannelId).toBe("first");
  });

  // proofs/arch/channel-state/index.md#^cs-ac-focus-validate
  it("rejects unknown and null focus without changing exposed or persisted state", async () => {
    const root = home();
    const { server, store, auth } = await start(root);
    const file = path.join(root, "state", "display.json");
    const before = readFileSync(file, "utf8");
    for (const [focusedChannelId, status] of [["missing-channel", 404], [null, 400]] as const) {
      await request(server.httpServer).patch("/display").set(auth).send({ focusedChannelId }).expect(status);
      expect(readFileSync(file, "utf8")).toBe(before);
      expect(store.getFocusedChannelId()).toBe(store.listChannels()[0]!.id);
    }
  });

  // proofs/arch/channel-state/index.md#^cs-ac-focus-successor
  it("selects the first pinned successor, then newest unpinned, and replaces the final channel", async () => {
    const root = home();
    const { server, store, auth } = await start(root);
    const original = store.listChannels()[0]!;
    const newer = store.createChannel({ name: "Newer" });
    const pinned = store.createChannel({ name: "Pinned" });
    await request(server.httpServer).patch("/display").set(auth)
      .send({ focusedChannelId: original.id, pinnedChannelIds: [pinned.id] }).expect(204);
    await request(server.httpServer).delete(`/channels/${original.id}`).set(auth).expect(200);
    expect((await request(server.httpServer).get("/display").set(auth).expect(200)).body.focusedChannelId).toBe(pinned.id);
    await request(server.httpServer).patch("/display").set(auth).send({ pinnedChannelIds: [], focusedChannelId: pinned.id }).expect(204);
    await request(server.httpServer).delete(`/channels/${pinned.id}`).set(auth).expect(200);
    expect((await request(server.httpServer).get("/display").set(auth).expect(200)).body.focusedChannelId).toBe(newer.id);
    await request(server.httpServer).delete(`/channels/${newer.id}`).set(auth).expect(200);
    const remaining = (await request(server.httpServer).get("/channels").set(auth).expect(200)).body.channels;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ name: "New channel", layout: [] });
    expect(remaining[0].id).not.toBe(newer.id);
    const display = (await request(server.httpServer).get("/display").set(auth).expect(200)).body;
    expect(display).toMatchObject({ focusedChannelId: remaining[0].id, pinnedChannelIds: [] });
  });

  // proofs/arch/channel-state/index.md#^cs-ac-pin-prune
  it("announces artifact removal, replacement, pin pruning, focus, and old-channel removal in order", async () => {
    const root = home();
    const { server, store, auth } = await start(root);
    const old = store.listChannels()[0]!;
    const artifact = store.createArtifact({ kind: "url", title: "Page", channelID: old.id, url: "https://example.com" });
    await request(server.httpServer).patch("/display").set(auth).send({ pinnedChannelIds: [old.id] }).expect(204);
    const stream = await events(server, store.authToken);
    await request(server.httpServer).delete(`/channels/${old.id}`).set(auth).expect(200);
    await expect.poll(() => stream.received.length).toBe(5);
    expect(stream.received).toMatchObject([
      { type: "artifact-removed", artifactID: artifact.id, channelID: old.id },
      { type: "channel-created", channel: { name: "New channel" } },
      { type: "pinned-channels-changed", pinnedChannelIds: [] },
      { type: "channel-changed" },
      { type: "channel-removed", channelID: old.id },
    ]);
    const replacementID = (stream.received[1] as { channel: { id: string } }).channel.id;
    expect((stream.received[3] as { channelID: string }).channelID).toBe(replacementID);
    expect((await request(server.httpServer).get("/display").set(auth).expect(200)).body.focusedChannelId).toBe(replacementID);
  });

  // proofs/arch/telemetry/emitters.md#^t-channel-replacement-emit
  // proofs/product/telemetry.md#^ac-channel
  it("emits deletion telemetry without a user-create event for the automatic replacement", async () => {
    const root = home();
    const store = createServingStore(root);
    const emitted: BuiltTelemetryEvent[] = [];
    const server = new Server({
      store, host: "127.0.0.1", port: 0, auth: true,
      telemetry: {
        env: { TV_TELEMETRY_TEST: "1" }, version: telemetryVersion("0.1.170"),
        sink: { enqueue: (event) => { emitted.push(event); } },
      },
    });
    servers.push(server);
    await server.start();
    const original = store.listChannels()[0]!;
    await request(server.httpServer).delete(`/channels/${original.id}`)
      .set({ Authorization: `Bearer ${store.authToken}` }).expect(200);
    expect(emitted.filter(({ name }) => name === "screen_deleted")).toHaveLength(1);
    expect(emitted.filter(({ name }) => name === "screen_created")).toEqual([]);
  });
});

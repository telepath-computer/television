import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import WebSocket from "ws";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "../src/server.ts";
import { ServerStore } from "../src/server-store.ts";
import { getChannelsDir } from "../src/artifact-paths.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-marker-transport-"));
}

function bundle(name: string): string {
  return path.join(here, "fixtures", "onboarding-bundles", name);
}

// Producer side of the marker seam (specs/arch/onboarding/installer.md, Marker contracts):
// a really-running server store and routes driven by real HTTP and websocket
// clients; no browser attached.
describe("Onboarding marker transport", () => {
  const servers: Server[] = [];
  const stores: ServerStore[] = [];
  const dirs: string[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    for (const server of servers.splice(0)) await server.dispose();
    for (const store of stores.splice(0)) store.dispose();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function storage(): string {
    const storagePath = tempDir();
    dirs.push(storagePath);
    return storagePath;
  }

  async function startServer(storagePath: string, bundleName?: string): Promise<{ server: Server; store: ServerStore; auth: { Authorization: string } }> {
    const store = new ServerStore({
      storagePath,
      installOnboardingChannels: true,
      ...(bundleName ? { onboardingContentPath: bundle(bundleName) } : {}),
    });
    stores.push(store);
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
    servers.push(server);
    await server.start();
    return { server, store, auth: { Authorization: `Bearer ${store.authToken}` } };
  }

  // proofs/arch/onboarding/installer.md#^t-marker-roundtrip
  describe("Marker in HTTP responses", () => {
    it("returns installer-created markers from channel list and get; ordinary channels carry none", async () => {
      const storagePath = storage();
      const { server, auth } = await startServer(storagePath, "two-channels");

      const created = await request(server.httpServer)
        .post("/channels").set(auth).send({ name: "Ordinary" }).expect(201);
      expect(created.body.channel.onboarding).toBeUndefined();

      const list = await request(server.httpServer).get("/channels").set(auth).expect(200);
      const channels: Array<{ id: string; name: string; onboarding?: { slug: string } }> = list.body.channels;
      expect(channels).toHaveLength(3);
      const first = channels.find((channel) => channel.name === "First Screen")!;
      expect(first.onboarding).toEqual({ slug: "first" });
      const second = channels.find((channel) => channel.name === "Second Screen")!;
      expect(second.onboarding).toEqual({ slug: "second" });
      expect(channels.find((channel) => channel.name === "Ordinary")!.onboarding).toBeUndefined();

      const got = await request(server.httpServer).get(`/channels/${first.id}`).set(auth).expect(200);
      expect(got.body.channel.onboarding).toEqual({ slug: "first" });
    });
  });

  // proofs/arch/onboarding/installer.md#^t-marker-events
  describe("Marker on channel events", () => {
    it("channel-updated for a marked channel carries the marker over the real websocket", async () => {
      const storagePath = storage();
      const { server, auth } = await startServer(storagePath, "two-channels");
      const token = readFileSync(path.join(storagePath, "state", "token"), "utf8").trim();

      const ws = new WebSocket(`${server.getBaseURL().replace(/^http/, "ws")}/events?token=${encodeURIComponent(token)}`);
      sockets.push(ws);
      const events: Array<{ type: string; channel?: { name: string; onboarding?: unknown } }> = [];
      ws.on("message", (data) => events.push(JSON.parse(String(data))));
      await new Promise<void>((resolve) => ws.on("open", () => resolve()));

      const list = await request(server.httpServer).get("/channels").set(auth).expect(200);
      const first = list.body.channels.find((channel: { name: string }) => channel.name === "First Screen");
      const ordinary = await request(server.httpServer)
        .post("/channels").set(auth).send({ name: "Ordinary" }).expect(201);

      await request(server.httpServer)
        .patch(`/channels/${first.id}`).set(auth).send({ name: "Guide renamed" }).expect(200);
      await request(server.httpServer)
        .patch(`/channels/${ordinary.body.channel.id}`).set(auth).send({ name: "Ordinary renamed" }).expect(200);

      await expect.poll(() => events.filter((event) => event.type === "channel-updated")).toHaveLength(2);
      const updates = events.filter((event) => event.type === "channel-updated");
      const markedUpdate = updates.find((event) => event.channel!.name === "Guide renamed")!;
      expect(markedUpdate.channel!.onboarding).toEqual({ slug: "first" });
      const ordinaryUpdate = updates.find((event) => event.channel!.name === "Ordinary renamed")!;
      expect(ordinaryUpdate.channel!.onboarding).toBeUndefined();
    });
  });

  // proofs/arch/onboarding/installer.md#^t-marker-api-ro
  describe("Marker is ignored on create", () => {
    it("a create request carrying onboarding succeeds and creates an unmarked channel", async () => {
      const storagePath = storage();
      const { server, auth } = await startServer(storagePath);

      const created = await request(server.httpServer)
        .post("/channels")
        .set(auth)
        .send({ name: "Sneaky", onboarding: { slug: "fake" } })
        .expect(201);
      expect(created.body.channel.onboarding).toBeUndefined();

      const got = await request(server.httpServer)
        .get(`/channels/${created.body.channel.id}`).set(auth).expect(200);
      expect(got.body.channel.onboarding).toBeUndefined();
    });
  });

  // proofs/arch/onboarding/installer.md#^t-marker-api-ro-update
  describe("Marker is ignored on update", () => {
    it("updates carrying onboarding succeed and leave marker state exactly as installed", async () => {
      const storagePath = storage();
      const { server, auth } = await startServer(storagePath, "two-channels");
      const list = await request(server.httpServer).get("/channels").set(auth).expect(200);
      const marked = list.body.channels.find((channel: { name: string }) => channel.name === "First Screen");
      const unmarkedCreate = await request(server.httpServer)
        .post("/channels").set(auth).send({ name: "Plain" }).expect(201);

      // Attempt to alter a marker.
      const altered = await request(server.httpServer)
        .patch(`/channels/${marked.id}`)
        .set(auth)
        .send({ name: "Renamed fine", onboarding: { slug: "hijack" } })
        .expect(200);
      expect(altered.body.channel.name).toBe("Renamed fine");
      expect(altered.body.channel.onboarding).toEqual({ slug: "first" });

      // Attempt to remove a marker.
      const removed = await request(server.httpServer)
        .patch(`/channels/${marked.id}`)
        .set(auth)
        .send({ name: "Renamed again", onboarding: null })
        .expect(200);
      expect(removed.body.channel.onboarding).toEqual({ slug: "first" });

      // Attempt to add a marker to an unmarked channel.
      const stamped = await request(server.httpServer)
        .patch(`/channels/${unmarkedCreate.body.channel.id}`)
        .set(auth)
        .send({ name: "Still plain", onboarding: { slug: "fake" } })
        .expect(200);
      expect(stamped.body.channel.onboarding).toBeUndefined();
    });
  });

  describe("Marker persistence", () => {
    it("survives raw channel JSON and a store restart", () => {
      const storagePath = storage();
      const store = new ServerStore({
        storagePath,
        installOnboardingChannels: true,
        onboardingContentPath: bundle("two-channels"),
      });
      const first = store.listChannels().find((channel) => channel.onboarding?.slug === "first")!;
      store.dispose();

      const raw = JSON.parse(readFileSync(path.join(getChannelsDir(storagePath), `${first.id}.json`), "utf8"));
      expect(raw.onboarding).toEqual({ slug: "first" });

      // The current load() rebuilds channels field-by-field; restart must not
      // drop the marker (plan risk: marker-loss trap).
      const restarted = new ServerStore({
        storagePath,
        installOnboardingChannels: true,
        onboardingContentPath: bundle("two-channels"),
      });
      stores.push(restarted);
      const reloaded = restarted.listChannels().find((channel) => channel.id === first.id)!;
      expect(reloaded.onboarding).toEqual({ slug: "first" });

      // A user rename through the store keeps the marker in the rewritten JSON.
      restarted.updateChannel({ channelID: first.id, fields: { name: "Renamed" } });
      const rewritten = JSON.parse(readFileSync(path.join(getChannelsDir(storagePath), `${first.id}.json`), "utf8"));
      expect(rewritten.onboarding).toEqual({ slug: "first" });
    });
  });
});

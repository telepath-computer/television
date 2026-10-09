import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import WebSocket from "ws";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  type ServerEvent,
  TelevisionClient,
  type TabPage,
} from "@telepath-computer/television-shared";
import { Server } from "../src/server.ts";
import { moveRecordPath, writeMoveRecord } from "../src/move-record.ts";
import { nodeResourceStorageOperations } from "../src/resources/storage.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

// Proves the move contract in specs/arch/layout/index.md#^ly-move
// (proofs/arch/layout/index.md, "Moving an artifact between channels").

const LAYOUT_VERSION = 2;

function page(
  artifactIds: string[],
  fullScreen = false,
  size: { width: number; height: number } = DEFAULT_PAGE_SIZE,
): TabPage {
  return {
    artifactIds,
    geometry: fullScreen ? { kind: "single", full_screen: true } : { ...DEFAULT_PAGE_GEOMETRY },
    size: { ...size },
  };
}

const MOVED_SIZE = { width: 512.5, height: 640 };

interface Fixture {
  storagePath: string;
  source: string;
  target: string;
  third: string;
  /** A path artifact with a generated ID, so it has a store and can be shared. */
  thirdA: string;
  authored: string;
}

/**
 * Three ordinary channels, each with pages created through the production
 * store, and an authored version-2 channel whose first page holds two
 * artifacts (a state stage 1 cannot create through its UI).
 * Source: [moved (full-screen, MOVED_SIZE), source-other]. Target: [target-a].
 * Third: [thirdA]. Authored: [[authored-a, authored-b], [authored-c]].
 */
function createFixture(): Fixture {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-artifact-move-"));
  const store = createServingStore(storagePath);
  const source = store.createChannel({ id: "source-channel", name: "Source" });
  const target = store.createChannel({ id: "target-channel", name: "Target" });
  const third = store.createChannel({ id: "third-channel", name: "Third" });
  const authored = store.createChannel({ id: "authored-channel", name: "Authored" });
  const url = (name: string) => `https://example.com/${name}`;
  for (const [id, channelID] of [
    ["moved", source.id],
    ["source-other", source.id],
    ["target-a", target.id],
    ["authored-a", authored.id],
    ["authored-b", authored.id],
    ["authored-c", authored.id],
  ] as const) {
    store.createArtifact({ id, kind: "url", title: id, channelID, url: url(id) });
  }
  // A path artifact with a generated ID, so it can have a store and a share link.
  const thirdFile = path.join(storagePath, "third-a.html");
  writeFileSync(thirdFile, "<!doctype html><title>third</title>");
  const thirdA = store.createArtifact({ kind: "path", title: "third-a", channelID: third.id, path: thirdFile });
  store.updateChannel({
    channelID: source.id,
    fields: { layout: [page(["moved"], true, MOVED_SIZE), page(["source-other"])] },
  });
  store.dispose();

  writeFileSync(
    channelPath(storagePath, authored.id),
    JSON.stringify({
      id: authored.id,
      name: authored.name,
      layoutVersion: LAYOUT_VERSION,
      layout: [page(["authored-a", "authored-b"], false, MOVED_SIZE), page(["authored-c"])],
    }, null, 2),
  );

  return { storagePath, source: source.id, target: target.id, third: third.id, thirdA: thirdA.id, authored: authored.id };
}

function channelPath(storagePath: string, channelID: string): string {
  return path.join(storagePath, "state", "channels", `${channelID}.json`);
}

function storedLayout(storagePath: string, channelID: string): TabPage[] {
  return JSON.parse(readFileSync(channelPath(storagePath, channelID), "utf8")).layout;
}

/**
 * Makes a stored file unwritable by replacing it with a directory of the same
 * name: every user, root included, fails to write it as a file. Returns a
 * function that restores the original bytes.
 */
function blockFile(filePath: string): () => void {
  const original = existsSync(filePath) ? readFileSync(filePath) : null;
  rmSync(filePath, { force: true });
  mkdirSync(filePath);
  return () => {
    rmSync(filePath, { recursive: true, force: true });
    if (original !== null) writeFileSync(filePath, original);
  };
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function openEvents(server: Server, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`${server.getBaseURL().replace(/^http/, "ws")}/events?token=${encodeURIComponent(token)}`);
  await new Promise<void>((resolve) => ws.on("open", resolve));
  return ws;
}

function nextChannelUpdate(ws: WebSocket, channelID: string): Promise<Extract<ServerEvent, { type: "channel-updated" }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`Timed out waiting for channel update: ${channelID}`));
    }, 2_000);
    const onMessage = (data: WebSocket.RawData): void => {
      const event = JSON.parse(String(data)) as ServerEvent;
      if (event.type !== "channel-updated" || event.channel.id !== channelID) return;
      clearTimeout(timeout);
      ws.off("message", onMessage);
      resolve(event);
    };
    ws.on("message", onMessage);
  });
}

describe("moving an artifact between channels", () => {
  const dirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.dispose();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function fixture(): Fixture {
    const created = createFixture();
    dirs.push(created.storagePath);
    return created;
  }

  async function start(fx: Fixture): Promise<{ server: Server; token: string }> {
    const store = createServingStore(fx.storagePath);
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
    servers.push(server);
    await server.start();
    return { server, token: store.authToken };
  }

  async function stop(server: Server): Promise<void> {
    await server.dispose();
    servers.splice(servers.indexOf(server), 1);
  }

  async function layoutOf(server: Server, token: string, channelID: string): Promise<TabPage[]> {
    const response = await request(server.httpServer).get(`/channels/${channelID}`).set(auth(token)).expect(200);
    return response.body.channel.layout;
  }

  function move(server: Server, token: string, artifactID: string, channelID: string) {
    return request(server.httpServer).post(`/artifacts/${artifactID}/move`).set(auth(token)).send({ channelID });
  }

  // proofs/arch/layout/index.md#^ly-ac-move
  it("moves a page's artifact to the end of another channel with its size and full-screen state, through HTTP, websocket, and restart", async () => {
    const fx = fixture();
    const first = await start(fx);
    const ws = await openEvents(first.server, first.token);
    const sourceEvent = nextChannelUpdate(ws, fx.source);
    const targetEvent = nextChannelUpdate(ws, fx.target);
    const before = (await request(first.server.httpServer).get("/artifacts/moved").set(auth(first.token)).expect(200)).body.artifact;

    await move(first.server, first.token, "moved", fx.target)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ outcome: "moved", artifactID: "moved", channelID: fx.target }));

    const expectedSource = [page(["source-other"])];
    const expectedTarget = [page(["target-a"]), page(["moved"], true, MOVED_SIZE)];
    expect((await sourceEvent).channel.layout).toEqual(expectedSource);
    expect((await targetEvent).channel.layout).toEqual(expectedTarget);
    ws.close();
    expect(await layoutOf(first.server, first.token, fx.source)).toEqual(expectedSource);
    expect(await layoutOf(first.server, first.token, fx.target)).toEqual(expectedTarget);
    await request(first.server.httpServer).get("/artifacts/moved").set(auth(first.token)).expect(200)
      .expect(({ body }) => expect(body.artifact).toEqual(before));

    await stop(first.server);
    const restarted = await start(fx);
    expect(await layoutOf(restarted.server, restarted.token, fx.source)).toEqual(expectedSource);
    expect(await layoutOf(restarted.server, restarted.token, fx.target)).toEqual(expectedTarget);
    expect(existsSync(moveRecordPath(fx.storagePath))).toBe(false);
  });

  // proofs/arch/layout/index.md#^ly-ac-move-multi
  it("moves one artifact out of a multi-artifact page, leaving the rest of the page in place", async () => {
    const fx = fixture();
    const { server, token } = await start(fx);

    await move(server, token, "authored-a", fx.target).expect(200);

    expect(await layoutOf(server, token, fx.authored)).toEqual([
      page(["authored-b"], false, MOVED_SIZE),
      page(["authored-c"]),
    ]);
    expect(await layoutOf(server, token, fx.target)).toEqual([
      page(["target-a"]),
      page(["authored-a"], false, MOVED_SIZE),
    ]);
  });

  // proofs/arch/layout/index.md#^ly-ac-move-same
  it("reports that nothing changed when the artifact is already on the channel", async () => {
    const fx = fixture();
    const { server, token } = await start(fx);
    const storedBefore = readFileSync(channelPath(fx.storagePath, fx.source));
    const layoutBefore = await layoutOf(server, token, fx.source);

    await move(server, token, "moved", fx.source)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ outcome: "unchanged", artifactID: "moved", channelID: fx.source }));

    expect(await layoutOf(server, token, fx.source)).toEqual(layoutBefore);
    expect(readFileSync(channelPath(fx.storagePath, fx.source))).toEqual(storedBefore);
  });

  // proofs/arch/layout/index.md#^ly-ac-move-unknown
  it.each([
    ["an unknown artifact", "no-such-artifact", "target-channel", "Artifact not found: no-such-artifact"],
    ["an unknown target channel", "moved", "no-such-channel", "Channel not found: no-such-channel"],
  ])("rejects a move naming %s without changing any layout", async (_case, artifactID, channelID, message) => {
    const fx = fixture();
    const { server, token } = await start(fx);
    const storedBefore = [fx.source, fx.target].map((id) => readFileSync(channelPath(fx.storagePath, id)));

    await move(server, token, artifactID, channelID)
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe(message));

    expect(await layoutOf(server, token, fx.source)).toEqual([page(["moved"], true, MOVED_SIZE), page(["source-other"])]);
    expect(await layoutOf(server, token, fx.target)).toEqual([page(["target-a"])]);
    expect([fx.source, fx.target].map((id) => readFileSync(channelPath(fx.storagePath, id)))).toEqual(storedBefore);
  });

  // proofs/arch/layout/index.md#^ly-ac-move-record-fails
  it("rejects a move whose record cannot be saved and changes nothing", async () => {
    const fx = fixture();
    const first = await start(fx);
    const storedBefore = [fx.source, fx.target].map((id) => readFileSync(channelPath(fx.storagePath, id)));
    const unblock = blockFile(moveRecordPath(fx.storagePath));

    const response = await move(first.server, first.token, "moved", fx.target);
    expect(response.status).toBeGreaterThanOrEqual(500);

    expect(await layoutOf(first.server, first.token, fx.source)).toEqual([page(["moved"], true, MOVED_SIZE), page(["source-other"])]);
    expect(await layoutOf(first.server, first.token, fx.target)).toEqual([page(["target-a"])]);
    expect([fx.source, fx.target].map((id) => readFileSync(channelPath(fx.storagePath, id)))).toEqual(storedBefore);
    unblock();

    await stop(first.server);
    const restarted = await start(fx);
    expect(await layoutOf(restarted.server, restarted.token, fx.source)).toEqual([page(["moved"], true, MOVED_SIZE), page(["source-other"])]);
    expect(await layoutOf(restarted.server, restarted.token, fx.target)).toEqual([page(["target-a"])]);
  });

  // proofs/arch/layout/index.md#^ly-ac-move-save-fails
  it("keeps a committed move whose channel save fails, reports an unknown outcome, and completes it at restart", async () => {
    const fx = fixture();
    const first = await start(fx);
    const unblock = blockFile(channelPath(fx.storagePath, fx.target));

    await move(first.server, first.token, "moved", fx.target)
      .expect(503)
      .expect(({ body }) => expect(body.error).toMatch(/outcome is unknown/));

    expect(await layoutOf(first.server, first.token, fx.source)).toEqual([page(["source-other"])]);
    expect(await layoutOf(first.server, first.token, fx.target)).toEqual([page(["target-a"]), page(["moved"], true, MOVED_SIZE)]);
    expect(existsSync(moveRecordPath(fx.storagePath))).toBe(true);

    await stop(first.server);
    unblock();
    const restarted = await start(fx);
    expect(await layoutOf(restarted.server, restarted.token, fx.source)).toEqual([page(["source-other"])]);
    expect(await layoutOf(restarted.server, restarted.token, fx.target)).toEqual([page(["target-a"]), page(["moved"], true, MOVED_SIZE)]);
    expect(storedLayout(fx.storagePath, fx.target)).toEqual([page(["target-a"]), page(["moved"], true, MOVED_SIZE)]);
    expect(storedLayout(fx.storagePath, fx.source)).toEqual([page(["source-other"])]);
    expect(existsSync(moveRecordPath(fx.storagePath))).toBe(false);
  });

  // proofs/arch/layout/index.md#^ly-ac-move-pending-blocks
  it("fails later changes while a committed move cannot be completed, then completes it before the next change", async () => {
    const fx = fixture();
    const first = await start(fx);
    const unblock = blockFile(channelPath(fx.storagePath, fx.target));
    await move(first.server, first.token, "moved", fx.target).expect(503);

    await move(first.server, first.token, "moved", fx.third)
      .expect(503)
      .expect(({ body }) => expect(body.error).toMatch(/outcome is unknown/));
    expect(await layoutOf(first.server, first.token, fx.third)).toEqual([page([fx.thirdA])]);
    expect(await layoutOf(first.server, first.token, fx.target)).toEqual([page(["target-a"]), page(["moved"], true, MOVED_SIZE)]);

    unblock();
    await move(first.server, first.token, "moved", fx.third).expect(200);
    expect(existsSync(moveRecordPath(fx.storagePath))).toBe(false);

    await stop(first.server);
    const restarted = await start(fx);
    expect(await layoutOf(restarted.server, restarted.token, fx.source)).toEqual([page(["source-other"])]);
    expect(await layoutOf(restarted.server, restarted.token, fx.target)).toEqual([page(["target-a"])]);
    expect(await layoutOf(restarted.server, restarted.token, fx.third)).toEqual([page([fx.thirdA]), page(["moved"], true, MOVED_SIZE)]);
  });

  // proofs/arch/layout/index.md#^ly-ac-move-recovery
  it.each([
    ["the target already holds the artifact and the source still does", true],
    ["neither channel was saved", false],
  ])("completes an interrupted move at startup when %s", async (_case, targetSaved) => {
    const fx = fixture();
    writeMoveRecord(nodeResourceStorageOperations, fx.storagePath, {
      artifactID: "moved",
      sourceChannelID: fx.source,
      targetChannelID: fx.target,
      geometry: { kind: "single", full_screen: true },
      size: MOVED_SIZE,
    });
    if (targetSaved) {
      const stored = JSON.parse(readFileSync(channelPath(fx.storagePath, fx.target), "utf8"));
      stored.layout = [page(["target-a"]), page(["moved"], true, MOVED_SIZE)];
      writeFileSync(channelPath(fx.storagePath, fx.target), JSON.stringify(stored, null, 2));
    }

    const { server, token } = await start(fx);

    expect(await layoutOf(server, token, fx.source)).toEqual([page(["source-other"])]);
    expect(await layoutOf(server, token, fx.target)).toEqual([page(["target-a"]), page(["moved"], true, MOVED_SIZE)]);
    expect(storedLayout(fx.storagePath, fx.source)).toEqual([page(["source-other"])]);
    expect(storedLayout(fx.storagePath, fx.target)).toEqual([page(["target-a"]), page(["moved"], true, MOVED_SIZE)]);
    expect(existsSync(moveRecordPath(fx.storagePath))).toBe(false);
  });

  // proofs/arch/layout/index.md#^ly-t-move-pending-handoff
  describe("every channel and artifact change completes a pending move first", () => {
    const changes: Array<[string, (client: TelevisionClient, fx: Fixture) => Promise<unknown>]> = [
      ["creating an artifact", (client, fx) => client.artifacts.create({ kind: "url", title: "New", url: "https://example.com/new", channelID: fx.third })],
      ["updating an artifact", (client, fx) => client.artifacts.update({ artifactID: fx.thirdA, title: "Renamed" })],
      ["deleting an artifact", (client, fx) => client.artifacts.delete({ artifactID: fx.thirdA })],
      ["creating a channel", (client) => client.channels.create({ name: "Fresh" })],
      ["renaming a channel", (client, fx) => client.channels.update({ channelID: fx.third, name: "Renamed" })],
      ["updating a channel's layout", (client, fx) => client.channels.update({ channelID: fx.authored, layout: [page(["authored-c"]), page(["authored-a", "authored-b"], false, MOVED_SIZE)] })],
      ["removing a channel", (client, fx) => client.channels.remove({ channelID: fx.third })],
      ["saving an artifact's share link", (client, fx) => client.resources.share({ artifactID: fx.thirdA })],
      ["saving an artifact's store pointer on its first store write", (client, fx) => client.resources.json.set({ store: { artifactID: fx.thirdA }, path: "", value: 1 })],
    ];

    it.each(changes)("%s", async (_name, change) => {
      const fx = fixture();
      const { server, token } = await start(fx);
      const client = new TelevisionClient(server.getBaseURL(), { token });
      const unblock = blockFile(channelPath(fx.storagePath, fx.target));
      await expect(client.artifacts.move({ artifactID: "moved", channelID: fx.target })).rejects.toThrow(/outcome is unknown/);
      expect(existsSync(moveRecordPath(fx.storagePath))).toBe(true);
      unblock();

      await change(client, fx);

      expect(existsSync(moveRecordPath(fx.storagePath))).toBe(false);
      expect(storedLayout(fx.storagePath, fx.target)).toEqual([page(["target-a"]), page(["moved"], true, MOVED_SIZE)]);
      expect(storedLayout(fx.storagePath, fx.source)).toEqual([page(["source-other"])]);
    });
  });
});

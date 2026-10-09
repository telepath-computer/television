import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import WebSocket from "ws";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  TelevisionClient,
  type ServerEvent,
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

// The moved page sits between other pages, and each channel keeps several
// pages, so a move that reorders the pages it leaves behind is caught.
const SOURCE_BEFORE = [page(["source-before"]), page(["moved"], true, MOVED_SIZE), page(["source-other"]), page(["source-last"])];
const SOURCE_AFTER = [page(["source-before"]), page(["source-other"]), page(["source-last"])];
const TARGET_BEFORE = [page(["target-a"]), page(["target-b"])];
const TARGET_AFTER = [...TARGET_BEFORE, page(["moved"], true, MOVED_SIZE)];

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
 * Channels and pages created through the production store, plus an authored
 * version-2 channel whose first page holds three artifacts (a state stage 1
 * cannot create through its UI). Third: [thirdA].
 * Authored: [[authored-a, authored-b, authored-d], [authored-c]].
 */
function createFixture(): Fixture {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-artifact-move-"));
  const store = createServingStore(storagePath);
  const source = store.createChannel({ id: "source-channel", name: "Source" });
  const target = store.createChannel({ id: "target-channel", name: "Target" });
  const third = store.createChannel({ id: "third-channel", name: "Third" });
  const authored = store.createChannel({ id: "authored-channel", name: "Authored" });
  for (const [id, channelID] of [
    ["source-before", source.id],
    ["moved", source.id],
    ["source-other", source.id],
    ["source-last", source.id],
    ["target-a", target.id],
    ["target-b", target.id],
    ["authored-a", authored.id],
    ["authored-b", authored.id],
    ["authored-d", authored.id],
    ["authored-c", authored.id],
  ] as const) {
    store.createArtifact({ id, kind: "url", title: id, channelID, url: `https://example.com/${id}` });
  }
  const thirdFile = path.join(storagePath, "third-a.html");
  writeFileSync(thirdFile, "<!doctype html><title>third</title>");
  const thirdA = store.createArtifact({ kind: "path", title: "third-a", channelID: third.id, path: thirdFile });
  store.updateChannel({ channelID: source.id, fields: { layout: SOURCE_BEFORE } });
  store.dispose();

  writeFileSync(
    channelPath(storagePath, authored.id),
    JSON.stringify({
      id: authored.id,
      name: authored.name,
      layoutVersion: LAYOUT_VERSION,
      layout: [page(["authored-a", "authored-b", "authored-d"], false, MOVED_SIZE), page(["authored-c"])],
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

    expect((await sourceEvent).channel.layout).toEqual(SOURCE_AFTER);
    expect((await targetEvent).channel.layout).toEqual(TARGET_AFTER);
    ws.close();
    expect(await layoutOf(first.server, first.token, fx.source)).toEqual(SOURCE_AFTER);
    expect(await layoutOf(first.server, first.token, fx.target)).toEqual(TARGET_AFTER);
    await request(first.server.httpServer).get("/artifacts/moved").set(auth(first.token)).expect(200)
      .expect(({ body }) => expect(body.artifact).toEqual(before));

    await stop(first.server);
    const restarted = await start(fx);
    expect(await layoutOf(restarted.server, restarted.token, fx.source)).toEqual(SOURCE_AFTER);
    expect(await layoutOf(restarted.server, restarted.token, fx.target)).toEqual(TARGET_AFTER);
    expect(existsSync(moveRecordPath(fx.storagePath))).toBe(false);
  });

  // proofs/arch/layout/index.md#^ly-ac-move-multi
  it("moves one artifact out of a multi-artifact page, leaving the rest of the page in place", async () => {
    const fx = fixture();
    const { server, token } = await start(fx);

    await move(server, token, "authored-b", fx.target).expect(200);

    expect(await layoutOf(server, token, fx.authored)).toEqual([
      page(["authored-a", "authored-d"], false, MOVED_SIZE),
      page(["authored-c"]),
    ]);
    expect(await layoutOf(server, token, fx.target)).toEqual([...TARGET_BEFORE, page(["authored-b"], false, MOVED_SIZE)]);
  });

  // proofs/arch/layout/index.md#^ly-ac-move-same
  it("reports that nothing changed when the artifact is already on the channel", async () => {
    const fx = fixture();
    const { server, token } = await start(fx);
    const storedBefore = readFileSync(channelPath(fx.storagePath, fx.source));

    await move(server, token, "moved", fx.source)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ outcome: "unchanged", artifactID: "moved", channelID: fx.source }));

    expect(await layoutOf(server, token, fx.source)).toEqual(SOURCE_BEFORE);
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

    expect(await layoutOf(server, token, fx.source)).toEqual(SOURCE_BEFORE);
    expect(await layoutOf(server, token, fx.target)).toEqual(TARGET_BEFORE);
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

    expect(await layoutOf(first.server, first.token, fx.source)).toEqual(SOURCE_BEFORE);
    expect(await layoutOf(first.server, first.token, fx.target)).toEqual(TARGET_BEFORE);
    expect([fx.source, fx.target].map((id) => readFileSync(channelPath(fx.storagePath, id)))).toEqual(storedBefore);
    unblock();

    await stop(first.server);
    const restarted = await start(fx);
    expect(await layoutOf(restarted.server, restarted.token, fx.source)).toEqual(SOURCE_BEFORE);
    expect(await layoutOf(restarted.server, restarted.token, fx.target)).toEqual(TARGET_BEFORE);
  });

  // proofs/arch/layout/index.md#^ly-ac-move-save-fails
  it("keeps a committed move whose channel save fails, reports an unknown outcome, and completes it at restart", async () => {
    const fx = fixture();
    const first = await start(fx);
    const unblock = blockFile(channelPath(fx.storagePath, fx.target));

    await move(first.server, first.token, "moved", fx.target)
      .expect(503)
      .expect(({ body }) => expect(body.error).toMatch(/outcome is unknown/));

    expect(await layoutOf(first.server, first.token, fx.source)).toEqual(SOURCE_AFTER);
    expect(await layoutOf(first.server, first.token, fx.target)).toEqual(TARGET_AFTER);
    expect(existsSync(moveRecordPath(fx.storagePath))).toBe(true);

    await stop(first.server);
    unblock();
    const restarted = await start(fx);
    expect(await layoutOf(restarted.server, restarted.token, fx.source)).toEqual(SOURCE_AFTER);
    expect(await layoutOf(restarted.server, restarted.token, fx.target)).toEqual(TARGET_AFTER);
    expect(storedLayout(fx.storagePath, fx.target)).toEqual(TARGET_AFTER);
    expect(storedLayout(fx.storagePath, fx.source)).toEqual(SOURCE_AFTER);
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
    expect(await layoutOf(first.server, first.token, fx.target)).toEqual(TARGET_AFTER);

    unblock();
    await move(first.server, first.token, "moved", fx.third).expect(200);
    expect(existsSync(moveRecordPath(fx.storagePath))).toBe(false);

    await stop(first.server);
    const restarted = await start(fx);
    expect(await layoutOf(restarted.server, restarted.token, fx.source)).toEqual(SOURCE_AFTER);
    expect(await layoutOf(restarted.server, restarted.token, fx.target)).toEqual(TARGET_BEFORE);
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
      stored.layout = TARGET_AFTER;
      writeFileSync(channelPath(fx.storagePath, fx.target), JSON.stringify(stored, null, 2));
    }

    const { server, token } = await start(fx);

    expect(await layoutOf(server, token, fx.source)).toEqual(SOURCE_AFTER);
    expect(await layoutOf(server, token, fx.target)).toEqual(TARGET_AFTER);
    expect(storedLayout(fx.storagePath, fx.source)).toEqual(SOURCE_AFTER);
    expect(storedLayout(fx.storagePath, fx.target)).toEqual(TARGET_AFTER);
    expect(existsSync(moveRecordPath(fx.storagePath))).toBe(false);
  });

  // proofs/arch/layout/index.md#^ly-ac-move-recovery-blocked
  it("serves the moved layouts and keeps a startup recovery pending when its record cannot be removed", async () => {
    const fx = fixture();
    writeMoveRecord(nodeResourceStorageOperations, fx.storagePath, {
      artifactID: "moved",
      sourceChannelID: fx.source,
      targetChannelID: fx.target,
      geometry: { kind: "single", full_screen: true },
      size: MOVED_SIZE,
    });
    // The store's declared storage-operations hook, failing only the removal
    // of the move record until the test allows it.
    let blockRecordRemoval = true;
    const storage = {
      ...nodeResourceStorageOperations,
      deleteFile(filePath: string) {
        if (blockRecordRemoval && filePath === moveRecordPath(fx.storagePath)) throw new Error("record removal blocked");
        nodeResourceStorageOperations.deleteFile(filePath);
      },
    };
    const store = createServingStore(fx.storagePath, { resourceStorageOperations: storage });
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
    servers.push(server);
    await server.start();
    const token = store.authToken;

    expect(await layoutOf(server, token, fx.source)).toEqual(SOURCE_AFTER);
    expect(await layoutOf(server, token, fx.target)).toEqual(TARGET_AFTER);
    expect(existsSync(moveRecordPath(fx.storagePath))).toBe(true);
    await request(server.httpServer).patch(`/channels/${fx.third}`).set(auth(token)).send({ name: "Renamed" })
      .expect(503)
      .expect(({ body }) => expect(body.error).toMatch(/outcome is unknown/));

    blockRecordRemoval = false;
    await request(server.httpServer).patch(`/channels/${fx.third}`).set(auth(token)).send({ name: "Renamed" }).expect(200);
    expect(existsSync(moveRecordPath(fx.storagePath))).toBe(false);
    expect(storedLayout(fx.storagePath, fx.source)).toEqual(SOURCE_AFTER);
    expect(storedLayout(fx.storagePath, fx.target)).toEqual(TARGET_AFTER);
  });

  // proofs/arch/layout/index.md#^ly-t-move-pending-handoff
  describe("every channel and artifact change completes a pending move first", () => {
    interface Change {
      /** Makes the requested change through the real shared client. */
      apply: (client: TelevisionClient, fx: Fixture) => Promise<unknown>;
      /** Whether the requested change is visible through the server. */
      applied: (client: TelevisionClient, fx: Fixture) => Promise<boolean>;
    }
    const channelNames = async (client: TelevisionClient) => (await client.channels.list()).channels.map(({ name }) => name);
    const artifactExists = (client: TelevisionClient, artifactID: string) =>
      client.artifacts.get({ artifactID }).then(() => true, () => false);
    const changes: Array<[string, Change]> = [
      ["creating an artifact", {
        apply: (client, fx) => client.artifacts.create({ kind: "url", title: "New", url: "https://example.com/new", channelID: fx.third }),
        applied: async (client, fx) => (await client.artifacts.list({ channelID: fx.third })).artifacts.some(({ title }) => title === "New"),
      }],
      ["updating an artifact", {
        apply: (client, fx) => client.artifacts.update({ artifactID: fx.thirdA, title: "Renamed" }),
        applied: async (client, fx) => (await client.artifacts.get({ artifactID: fx.thirdA })).artifact.title === "Renamed",
      }],
      ["deleting an artifact", {
        apply: (client, fx) => client.artifacts.delete({ artifactID: fx.thirdA }),
        applied: async (client, fx) => !(await artifactExists(client, fx.thirdA)),
      }],
      ["creating a channel", {
        apply: (client) => client.channels.create({ name: "Fresh" }),
        applied: async (client) => (await channelNames(client)).includes("Fresh"),
      }],
      ["renaming a channel", {
        apply: (client, fx) => client.channels.update({ channelID: fx.third, name: "Renamed" }),
        applied: async (client, fx) => (await client.channels.get({ channelID: fx.third })).channel.name === "Renamed",
      }],
      ["updating a channel's layout", {
        apply: (client, fx) => client.channels.update({ channelID: fx.authored, layout: [page(["authored-c"]), page(["authored-a", "authored-b", "authored-d"], false, MOVED_SIZE)] }),
        applied: async (client, fx) => (await client.channels.get({ channelID: fx.authored })).channel.layout[0]!.artifactIds[0] === "authored-c",
      }],
      ["removing a channel", {
        apply: (client, fx) => client.channels.remove({ channelID: fx.third }),
        applied: async (client) => !(await channelNames(client)).includes("Third"),
      }],
      ["saving an artifact's share link", {
        apply: (client, fx) => client.resources.share({ artifactID: fx.thirdA }),
        applied: async (client, fx) => (await client.artifacts.get({ artifactID: fx.thirdA })).artifact.share !== undefined,
      }],
      ["saving an artifact's store pointer on its first store write", {
        apply: (client, fx) => client.resources.json.set({ store: { artifactID: fx.thirdA }, path: "", value: 1 }),
        applied: async (client, fx) => (await client.artifacts.get({ artifactID: fx.thirdA })).artifact.store !== undefined,
      }],
    ];

    it.each(changes)("%s", async (_name, change) => {
      const fx = fixture();
      const { server, token } = await start(fx);
      const client = new TelevisionClient(server.getBaseURL(), { token });
      const unblock = blockFile(channelPath(fx.storagePath, fx.target));
      await expect(client.artifacts.move({ artifactID: "moved", channelID: fx.target })).rejects.toThrow(/outcome is unknown/);
      expect(existsSync(moveRecordPath(fx.storagePath))).toBe(true);

      // While the pending move still cannot complete, the change is refused
      // and does not happen.
      await expect(change.apply(client, fx)).rejects.toThrow(/outcome is unknown/);
      expect(await change.applied(client, fx)).toBe(false);
      expect(existsSync(moveRecordPath(fx.storagePath))).toBe(true);

      // Once the move can complete, the change completes it first, then
      // happens itself.
      unblock();
      await change.apply(client, fx);
      expect(await change.applied(client, fx)).toBe(true);
      expect(existsSync(moveRecordPath(fx.storagePath))).toBe(false);
      expect(storedLayout(fx.storagePath, fx.target)).toEqual(TARGET_AFTER);
      expect(storedLayout(fx.storagePath, fx.source)).toEqual(SOURCE_AFTER);
    });
  });
});

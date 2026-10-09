import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import WebSocket from "ws";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  type ServerEvent,
  type TabPage,
} from "@telepath-computer/television-shared";
import { Server } from "../src/server.ts";
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
  authored: string;
}

/**
 * Channels and pages created through the production store, plus an authored
 * version-2 channel whose first page holds three artifacts (a state stage 1
 * cannot create through its UI).
 * Authored: [[authored-a, authored-b, authored-d], [authored-c]].
 */
function createFixture(): Fixture {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-artifact-move-"));
  const store = createServingStore(storagePath);
  const source = store.createChannel({ id: "source-channel", name: "Source" });
  const target = store.createChannel({ id: "target-channel", name: "Target" });
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

  return { storagePath, source: source.id, target: target.id, authored: authored.id };
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
  it("moves a page's artifact to the end of another channel with its size and full-screen state, replacing each channel's record, through HTTP, websocket, and restart", async () => {
    const fx = fixture();
    const first = await start(fx);
    const ws = await openEvents(first.server, first.token);
    const sourceEvent = nextChannelUpdate(ws, fx.source);
    const targetEvent = nextChannelUpdate(ws, fx.target);
    const before = (await request(first.server.httpServer).get("/artifacts/moved").set(auth(first.token)).expect(200)).body.artifact;
    const inodes = () => [fx.source, fx.target].map((id) => statSync(channelPath(fx.storagePath, id)).ino);
    const inodesBefore = inodes();

    await move(first.server, first.token, "moved", fx.target)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ outcome: "moved", artifactID: "moved", channelID: fx.target }));

    expect((await sourceEvent).channel.layout).toEqual(SOURCE_AFTER);
    expect((await targetEvent).channel.layout).toEqual(TARGET_AFTER);
    ws.close();
    // Each channel's record was replaced by a new file rather than rewritten
    // in place, so a stop mid-save leaves the old record or the new one.
    const inodesAfter = inodes();
    expect(inodesAfter[0]).not.toBe(inodesBefore[0]);
    expect(inodesAfter[1]).not.toBe(inodesBefore[1]);
    expect(await layoutOf(first.server, first.token, fx.source)).toEqual(SOURCE_AFTER);
    expect(await layoutOf(first.server, first.token, fx.target)).toEqual(TARGET_AFTER);
    await request(first.server.httpServer).get("/artifacts/moved").set(auth(first.token)).expect(200)
      .expect(({ body }) => expect(body.artifact).toEqual(before));

    await stop(first.server);
    const restarted = await start(fx);
    expect(await layoutOf(restarted.server, restarted.token, fx.source)).toEqual(SOURCE_AFTER);
    expect(await layoutOf(restarted.server, restarted.token, fx.target)).toEqual(TARGET_AFTER);
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

  // proofs/arch/layout/index.md#^ly-ac-move-source-fails
  it("rejects a move whose source channel cannot be saved and changes nothing", async () => {
    const fx = fixture();
    const first = await start(fx);
    const targetBefore = readFileSync(channelPath(fx.storagePath, fx.target));
    const unblock = blockFile(channelPath(fx.storagePath, fx.source));

    const response = await move(first.server, first.token, "moved", fx.target);
    expect(response.status).toBeGreaterThanOrEqual(500);

    expect(await layoutOf(first.server, first.token, fx.source)).toEqual(SOURCE_BEFORE);
    expect(await layoutOf(first.server, first.token, fx.target)).toEqual(TARGET_BEFORE);
    expect(readFileSync(channelPath(fx.storagePath, fx.target))).toEqual(targetBefore);
    unblock();

    await stop(first.server);
    const restarted = await start(fx);
    expect(await layoutOf(restarted.server, restarted.token, fx.source)).toEqual(SOURCE_BEFORE);
    expect(await layoutOf(restarted.server, restarted.token, fx.target)).toEqual(TARGET_BEFORE);
  });

  // proofs/arch/layout/index.md#^ly-ac-move-target-fails
  it("leaves the artifact on no channel, with its record kept, when the target channel cannot be saved", async () => {
    const fx = fixture();
    const first = await start(fx);
    const before = (await request(first.server.httpServer).get("/artifacts/moved").set(auth(first.token)).expect(200)).body.artifact;
    const unblock = blockFile(channelPath(fx.storagePath, fx.target));

    const response = await move(first.server, first.token, "moved", fx.target);
    expect(response.status).toBeGreaterThanOrEqual(500);

    expect(await layoutOf(first.server, first.token, fx.source)).toEqual(SOURCE_AFTER);
    expect(await layoutOf(first.server, first.token, fx.target)).toEqual(TARGET_BEFORE);
    expect(storedLayout(fx.storagePath, fx.source)).toEqual(SOURCE_AFTER);
    unblock();

    await stop(first.server);
    const restarted = await start(fx);
    expect(await layoutOf(restarted.server, restarted.token, fx.source)).toEqual(SOURCE_AFTER);
    expect(await layoutOf(restarted.server, restarted.token, fx.target)).toEqual(TARGET_BEFORE);
    await request(restarted.server.httpServer).get("/artifacts/moved").set(auth(restarted.token)).expect(200)
      .expect(({ body }) => expect(body.artifact).toEqual(before));
    // An artifact on no channel cannot be moved, and is reported as no
    // channel holding it.
    await move(restarted.server, restarted.token, "moved", fx.target)
      .expect(404)
      .expect(({ body }) => expect(body.error).toBe("Artifact not found: moved"));
  });
});

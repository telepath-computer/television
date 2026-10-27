import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import WebSocket from "ws";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  type ServerEvent,
  type ServerStatusMessage,
  type TabPage,
} from "@telepath-computer/television-shared";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

// Artifact IDs are generated (specs/product/artifacts.md#^af-artifact-id), so
// these tests name artifacts and map each name to the ID its fixture created.
let ids: Record<string, string> = {};
const id = (name: string): string => ids[name] ?? name;
const named = (layout: TabPage[]): TabPage[] => layout.map((p) => ({ ...p, artifactIds: p.artifactIds.map(id) }));
const namedPlacement = (placement: Record<string, string>) =>
  Object.fromEntries(Object.entries(placement).map(([key, name]) => [key, id(name)]));

// Proves the placement contract in specs/arch/layout/index.md#^ly-placement
// (proofs/arch/layout/index.md, "Placing a page before or after an artifact").

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

// The receiving channel holds three pages, so a placement at either end and
// between two pages is each visible.
const TARGET_BEFORE = [page(["target-a"]), page(["target-b"]), page(["target-c"])];
const SOURCE_BEFORE = [page(["moved"], true, MOVED_SIZE), page(["source-other"])];

interface Fixture {
  storagePath: string;
  source: string;
  target: string;
}

function createFixture(): Fixture {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-artifact-placement-"));
  const store = createServingStore(storagePath);
  const source = store.createChannel({ id: "source-channel", name: "Source" });
  const target = store.createChannel({ id: "target-channel", name: "Target" });
  ids = {};
  for (const [name, channelID] of [
    ["moved", source.id],
    ["source-other", source.id],
    ["target-a", target.id],
    ["target-b", target.id],
    ["target-c", target.id],
  ] as const) {
    ids[name] = store.createArtifact({ kind: "url", title: name, channelID, url: `https://example.com/${name}` }).id;
  }
  store.updateChannel({ channelID: source.id, fields: { layout: named(SOURCE_BEFORE) } });
  store.dispose();
  return { storagePath, source: source.id, target: target.id };
}

function channelPath(storagePath: string, channelID: string): string {
  return path.join(storagePath, "state", "channels", `${channelID}.json`);
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function openEvents(server: Server, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`${server.getBaseURL().replace(/^http/, "ws")}/events?token=${encodeURIComponent(token)}`);
  await new Promise<void>((resolve) => ws.on("open", resolve));
  return ws;
}

/** Collects events until a `channel-updated` for `channelID` arrives. */
function eventsUntilChannelUpdate(ws: WebSocket, channelID: string): Promise<ServerEvent[]> {
  return new Promise((resolve, reject) => {
    const events: ServerEvent[] = [];
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`Timed out waiting for channel update: ${channelID}`));
    }, 2_000);
    const onMessage = (data: WebSocket.RawData): void => {
      const event = JSON.parse(String(data)) as ServerEvent | ServerStatusMessage;
      // Every connection's first message; it can arrive after the listener is attached.
      if (event.type === "server-status") return;
      events.push(event);
      if (event.type !== "channel-updated" || event.channel.id !== channelID) return;
      clearTimeout(timeout);
      ws.off("message", onMessage);
      resolve(events);
    };
    ws.on("message", onMessage);
  });
}

describe("placing a page before or after an artifact", () => {
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

  function create(server: Server, token: string, channelID: string, placement: Record<string, string>) {
    return request(server.httpServer)
      .post("/artifacts")
      .set(auth(token))
      .send({ kind: "url", title: "Placed", url: "https://example.com/placed", channelID, ...namedPlacement(placement) });
  }

  function move(server: Server, token: string, artifactID: string, channelID: string, placement: Record<string, string>) {
    return request(server.httpServer).post(`/artifacts/${id(artifactID)}/move`).set(auth(token)).send({ channelID, ...namedPlacement(placement) });
  }

  // proofs/arch/layout/index.md#^ly-ac-placement-create
  it.each([
    ["before the first", { before: "target-a" }, 0],
    ["before the last", { before: "target-c" }, 2],
    ["after the first", { after: "target-a" }, 1],
    ["after the last", { after: "target-c" }, 3],
  ])("creates an artifact %s artifact through HTTP, websocket, and restart", async (_case, placement, index) => {
    const fx = fixture();
    const first = await start(fx);
    const ws = await openEvents(first.server, first.token);
    const events = eventsUntilChannelUpdate(ws, fx.target);

    const created = await create(first.server, first.token, fx.target, placement).expect(201);
    const createdID = created.body.artifact.id as string;
    const expected = named(TARGET_BEFORE);
    expected.splice(index, 0, page([createdID]));

    const received = await events;
    ws.close();
    expect(received.map((event) => event.type)).toEqual(["artifact-created", "channel-updated"]);
    expect((received[1] as Extract<ServerEvent, { type: "channel-updated" }>).channel.layout).toEqual(expected);
    expect(await layoutOf(first.server, first.token, fx.target)).toEqual(expected);

    await stop(first.server);
    const restarted = await start(fx);
    expect(await layoutOf(restarted.server, restarted.token, fx.target)).toEqual(expected);
  });

  // proofs/arch/layout/index.md#^ly-ac-placement-move
  it.each([
    ["after the first", { after: "target-a" }, 1],
    ["before the first", { before: "target-a" }, 0],
  ])("moves an artifact %s artifact through HTTP, websocket, and restart", async (_case, placement, index) => {
    const fx = fixture();
    const first = await start(fx);
    const ws = await openEvents(first.server, first.token);
    const events = eventsUntilChannelUpdate(ws, fx.target);
    const expected = named(TARGET_BEFORE);
    expected.splice(index, 0, page([id("moved")], true, MOVED_SIZE));

    await move(first.server, first.token, "moved", fx.target, placement)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ outcome: "moved", artifactID: id("moved"), channelID: fx.target }));

    const received = await events;
    ws.close();
    expect((received.at(-1) as Extract<ServerEvent, { type: "channel-updated" }>).channel.layout).toEqual(expected);
    expect(await layoutOf(first.server, first.token, fx.target)).toEqual(expected);
    expect(await layoutOf(first.server, first.token, fx.source)).toEqual(named([page(["source-other"])]));

    await stop(first.server);
    const restarted = await start(fx);
    expect(await layoutOf(restarted.server, restarted.token, fx.target)).toEqual(expected);
  });

  // proofs/arch/layout/index.md#^ly-ac-placement-rejected
  it.each([
    ["creation", "an artifact on another channel", { before: "source-other" }, "source-other"],
    ["creation", "an unknown artifact", { after: "no-such-artifact" }, "no-such-artifact"],
    ["creation", "both before and after", { before: "target-a", after: "target-b" }, null],
    ["move", "an artifact on another channel", { before: "source-other" }, "source-other"],
    ["move", "an unknown artifact", { after: "no-such-artifact" }, "no-such-artifact"],
    ["move", "both before and after", { before: "target-a", after: "target-b" }, null],
  ])("rejects a %s naming %s without changing anything", async (kind, _case, placement, namedArtifact) => {
    const fx = fixture();
    const { server, token } = await start(fx);
    const storedBefore = [fx.source, fx.target].map((id) => readFileSync(channelPath(fx.storagePath, id)));
    const artifactsBefore = (await request(server.httpServer).get("/artifacts").set(auth(token)).expect(200)).body.artifacts;
    const recordsDir = path.join(fx.storagePath, "state", "artifacts");
    const recordsBefore = existsSync(recordsDir) ? readdirSync(recordsDir).sort() : [];

    const response = kind === "creation"
      ? await create(server, token, fx.target, placement)
      : await move(server, token, "moved", fx.target, placement);

    expect(response.status).toBe(400);
    if (namedArtifact !== null) expect(response.body.error).toBe(`Artifact ${id(namedArtifact)} is not on channel ${fx.target}.`);
    expect(await layoutOf(server, token, fx.source)).toEqual(named(SOURCE_BEFORE));
    expect(await layoutOf(server, token, fx.target)).toEqual(named(TARGET_BEFORE));
    expect([fx.source, fx.target].map((id) => readFileSync(channelPath(fx.storagePath, id)))).toEqual(storedBefore);
    expect((await request(server.httpServer).get("/artifacts").set(auth(token)).expect(200)).body.artifacts).toEqual(artifactsBefore);
    expect(existsSync(recordsDir) ? readdirSync(recordsDir).sort() : []).toEqual(recordsBefore);
  });

  // proofs/arch/layout/index.md#^ly-ac-placement-move-same
  it.each([
    ["target", "target-c", { before: "target-a" }, () => named([page(["target-c"]), page(["target-a"]), page(["target-b"])])],
    ["source", "moved", { after: "source-other" }, () => named([page(["source-other"]), page(["moved"], true, MOVED_SIZE)])],
  ] as const)(
    "repositions an artifact on the channel already holding it (%s channel)",
    async (channel, artifact, placement, expectedLayout) => {
      const fx = fixture();
      const channelID = channel === "target" ? fx.target : fx.source;
      const first = await start(fx);
      const ws = await openEvents(first.server, first.token);
      const events = eventsUntilChannelUpdate(ws, channelID);
      const expected = expectedLayout();

      await move(first.server, first.token, artifact, channelID, placement)
        .expect(200)
        .expect(({ body }) => expect(body).toEqual({ outcome: "repositioned", artifactID: id(artifact), channelID }));

      const received = await events;
      ws.close();
      expect(received.map((event) => event.type)).toEqual(["channel-updated"]);
      expect((received[0] as Extract<ServerEvent, { type: "channel-updated" }>).channel.layout).toEqual(expected);
      expect(await layoutOf(first.server, first.token, channelID)).toEqual(expected);

      await stop(first.server);
      const restarted = await start(fx);
      expect(await layoutOf(restarted.server, restarted.token, channelID)).toEqual(expected);
    },
  );

  // proofs/arch/layout/index.md#^ly-ac-placement-move-same-unchanged
  it("reports unchanged when a same-channel placement keeps the order", async () => {
    const fx = fixture();
    const { server, token } = await start(fx);
    const storedBefore = readFileSync(channelPath(fx.storagePath, fx.target));

    await move(server, token, "target-b", fx.target, { after: "target-a" })
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ outcome: "unchanged", artifactID: id("target-b"), channelID: fx.target }));

    expect(await layoutOf(server, token, fx.target)).toEqual(named(TARGET_BEFORE));
    expect(readFileSync(channelPath(fx.storagePath, fx.target))).toEqual(storedBefore);
  });

  // proofs/arch/layout/index.md#^ly-ac-placement-move-same-unchanged
  it.each([
    ["the moved artifact itself", { before: "target-c" }, null],
    ["an artifact on another channel", { before: "source-other" }, "source-other"],
  ])("rejects a same-channel placement naming %s", async (_case, placement, namedArtifact) => {
    const fx = fixture();
    const { server, token } = await start(fx);
    const storedBefore = readFileSync(channelPath(fx.storagePath, fx.target));

    const response = await move(server, token, "target-c", fx.target, placement);

    expect(response.status).toBe(400);
    if (namedArtifact !== null) expect(response.body.error).toBe(`Artifact ${id(namedArtifact)} is not on channel ${fx.target}.`);
    expect(await layoutOf(server, token, fx.target)).toEqual(named(TARGET_BEFORE));
    expect(readFileSync(channelPath(fx.storagePath, fx.target))).toEqual(storedBefore);
  });
});

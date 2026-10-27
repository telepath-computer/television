import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const LAYOUT_VERSION = 2;

function page(
  artifactIds: string[],
  fullScreen = false,
  size: { width: number; height: number } = DEFAULT_PAGE_SIZE,
): TabPage {
  return {
    artifactIds,
    geometry: fullScreen
      ? { kind: "single", full_screen: true }
      : { ...DEFAULT_PAGE_GEOMETRY },
    size: { ...size },
  };
}

interface Fixture {
  storagePath: string;
  ordinary: { id: string; artifactIds: string[] };
  authored: { id: string; artifactIds: string[] };
}

function createFixture(): Fixture {
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-page-layout-"));
  const store = createServingStore(storagePath);
  const ordinary = store.createChannel({ id: "ordinary-channel", name: "Ordinary" });
  const ordinaryArtifacts = [
    store.createArtifact({ kind: "url", title: "A", channelID: ordinary.id, url: "https://example.com/a" }),
    store.createArtifact({ kind: "url", title: "B", channelID: ordinary.id, url: "https://example.com/b" }),
  ];
  const authored = store.createChannel({ id: "authored-channel", name: "Authored" });
  const authoredArtifacts = [
    store.createArtifact({ kind: "url", title: "A", channelID: authored.id, url: "https://example.com/a" }),
    store.createArtifact({ kind: "url", title: "B", channelID: authored.id, url: "https://example.com/b" }),
    store.createArtifact({ kind: "url", title: "C", channelID: authored.id, url: "https://example.com/c" }),
  ];
  store.dispose();

  writeFileSync(
    channelPath(storagePath, authored.id),
    JSON.stringify({
      id: authored.id,
      name: authored.name,
      layoutVersion: LAYOUT_VERSION,
      layout: [
        page([authoredArtifacts[0]!.id, authoredArtifacts[1]!.id]),
        page([authoredArtifacts[2]!.id]),
      ],
    }, null, 2),
  );

  return {
    storagePath,
    ordinary: { id: ordinary.id, artifactIds: ordinaryArtifacts.map(({ id }) => id) },
    authored: { id: authored.id, artifactIds: authoredArtifacts.map(({ id }) => id) },
  };
}

function channelPath(storagePath: string, channelID: string): string {
  return path.join(storagePath, "state", "channels", `${channelID}.json`);
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function openEvents(server: Server, token: string): Promise<WebSocket> {
  const ws = new WebSocket(
    `${server.getBaseURL().replace(/^http/, "ws")}/events?token=${encodeURIComponent(token)}`,
  );
  await new Promise<void>((resolve) => ws.on("open", resolve));
  return ws;
}

function nextChannelUpdate(ws: WebSocket, channelID: string): Promise<Extract<ServerEvent, { type: "channel-updated" }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`Timed out waiting for channel update: ${channelID}`));
    }, 1_000);
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

describe("target page layout server boundary", () => {
  const dirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.dispose();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function start(fixture: Fixture): Promise<{ server: Server; token: string }> {
    const store = createServingStore(fixture.storagePath);
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
    servers.push(server);
    await server.start();
    return { server, token: store.authToken };
  }

  it("persists page reorder and full-screen state without narrowing multi-artifact membership", async () => {
    const fixture = createFixture();
    dirs.push(fixture.storagePath);
    const first = await start(fixture);
    const ws = await openEvents(first.server, first.token);

    const ordinaryLayout = [
      page([fixture.ordinary.artifactIds[1]!]),
      page([fixture.ordinary.artifactIds[0]!]),
    ];
    const ordinaryEvent = nextChannelUpdate(ws, fixture.ordinary.id);
    await request(first.server.httpServer)
      .patch(`/channels/${fixture.ordinary.id}`)
      .set(auth(first.token))
      .send({ layout: ordinaryLayout })
      .expect(200)
      .expect(({ body }) => expect(body.channel.layout).toEqual(ordinaryLayout));
    expect((await ordinaryEvent).channel.layout).toEqual(ordinaryLayout);

    const authoredLayout = [
      page([fixture.authored.artifactIds[2]!]),
      page([fixture.authored.artifactIds[0]!, fixture.authored.artifactIds[1]!], true),
    ];
    const authoredEvent = nextChannelUpdate(ws, fixture.authored.id);
    await request(first.server.httpServer)
      .patch(`/channels/${fixture.authored.id}`)
      .set(auth(first.token))
      .send({ layout: authoredLayout })
      .expect(200)
      .expect(({ body }) => expect(body.channel.layout).toEqual(authoredLayout));
    expect((await authoredEvent).channel.layout).toEqual(authoredLayout);
    ws.close();

    for (const [channelID, expectedLayout] of [
      [fixture.ordinary.id, ordinaryLayout],
      [fixture.authored.id, authoredLayout],
    ] as const) {
      const stored = JSON.parse(readFileSync(channelPath(fixture.storagePath, channelID), "utf8"));
      expect(stored).toMatchObject({ layoutVersion: LAYOUT_VERSION, layout: expectedLayout });
    }

    await first.server.dispose();
    servers.splice(servers.indexOf(first.server), 1);
    const restarted = await start(fixture);
    for (const [channelID, expectedLayout] of [
      [fixture.ordinary.id, ordinaryLayout],
      [fixture.authored.id, authoredLayout],
    ] as const) {
      await request(restarted.server.httpServer)
        .get(`/channels/${channelID}`)
        .set(auth(restarted.token))
        .expect(200)
        .expect(({ body }) => {
          expect(body.channel.layout).toEqual(expectedLayout);
          expect(body.channel).not.toHaveProperty("layoutVersion");
        });
    }
  });

  // proofs/arch/layout/index.md#^ly-ac-size-persists
  it("persists a fractional page size through HTTP, two websocket clients, and restart", async () => {
    const fixture = createFixture();
    dirs.push(fixture.storagePath);
    const first = await start(fixture);
    const firstClient = await openEvents(first.server, first.token);
    const secondClient = await openEvents(first.server, first.token);
    const expectedLayout = [
      page([fixture.authored.artifactIds[0]!, fixture.authored.artifactIds[1]!], false, {
        width: 612.5,
        height: 701.25,
      }),
      page([fixture.authored.artifactIds[2]!]),
    ];
    const firstEvent = nextChannelUpdate(firstClient, fixture.authored.id);
    const secondEvent = nextChannelUpdate(secondClient, fixture.authored.id);

    await request(first.server.httpServer)
      .patch(`/channels/${fixture.authored.id}`)
      .set(auth(first.token))
      .send({ layout: expectedLayout })
      .expect(200)
      .expect(({ body }) => expect(body.channel.layout).toEqual(expectedLayout));
    expect((await firstEvent).channel.layout).toEqual(expectedLayout);
    expect((await secondEvent).channel.layout).toEqual(expectedLayout);
    firstClient.close();
    secondClient.close();

    expect(JSON.parse(readFileSync(
      channelPath(fixture.storagePath, fixture.authored.id),
      "utf8",
    ))).toMatchObject({ layoutVersion: LAYOUT_VERSION, layout: expectedLayout });

    await first.server.dispose();
    servers.splice(servers.indexOf(first.server), 1);
    const restarted = await start(fixture);
    await request(restarted.server.httpServer)
      .get(`/channels/${fixture.authored.id}`)
      .set(auth(restarted.token))
      .expect(200)
      .expect(({ body }) => expect(body.channel.layout).toEqual(expectedLayout));
  });

  it("rejects a combined rename and invalid regrouping atomically", async () => {
    const fixture = createFixture();
    dirs.push(fixture.storagePath);
    const running = await start(fixture);
    const recordPath = channelPath(fixture.storagePath, fixture.authored.id);
    const beforeBytes = readFileSync(recordPath, "utf8");

    await request(running.server.httpServer)
      .patch(`/channels/${fixture.authored.id}`)
      .set(auth(running.token))
      .send({
        name: "Changed during rejected update",
        layout: [page(fixture.authored.artifactIds)],
      })
      .expect(409);

    await request(running.server.httpServer)
      .get(`/channels/${fixture.authored.id}`)
      .set(auth(running.token))
      .expect(200)
      .expect(({ body }) => expect(body.channel.name).toBe("Authored"));
    expect(readFileSync(recordPath, "utf8")).toBe(beforeBytes);
  });

  it.each([
    ["duplicates an artifact", (ids: string[]) => [page(ids.slice(0, 2)), page([ids.at(-1)!, ids.at(-1)!])], 409],
    ["drops an artifact", (ids: string[]) => [page(ids.slice(0, 2))], 409],
    ["names an unknown artifact", (ids: string[]) => [page(ids.slice(0, 2)), page(["unknown-artifact"])], 409],
    ["splits a page", (ids: string[]) => ids.map((id) => page([id])), 409],
    ["merges pages", (ids: string[]) => [page(ids)], 409],
    ["reorders membership inside a page", (ids: string[]) => [page(ids.slice(0, 2).reverse()), page(ids.slice(2))], 409],
    ["contains empty membership", (ids: string[]) => [page(ids.slice(0, 2)), page([])], 400],
    ["contains an unknown geometry kind", (ids: string[]) => [page(ids.slice(0, 2)), { artifactIds: ids.slice(2), geometry: { kind: "split", full_screen: false }, size: DEFAULT_PAGE_SIZE }], 400],
    ["contains malformed membership", (ids: string[]) => [page(ids.slice(0, 2)), { artifactIds: [""], geometry: DEFAULT_PAGE_GEOMETRY, size: DEFAULT_PAGE_SIZE }], 400],
    ["contains fields from another layout model", (ids: string[]) => [page(ids.slice(0, 2)), { artifactIds: ids.slice(2), geometry: { ...DEFAULT_PAGE_GEOMETRY, width: 4 }, size: DEFAULT_PAGE_SIZE }], 400],
    ["lacks size", (ids: string[]) => [page(ids.slice(0, 2)), { artifactIds: ids.slice(2), geometry: DEFAULT_PAGE_GEOMETRY }], 400],
    ["contains half-shaped size", (ids: string[]) => [page(ids.slice(0, 2)), { ...page(ids.slice(2)), size: { width: DEFAULT_PAGE_SIZE.width } }], 400],
    ["contains non-numeric size", (ids: string[]) => [page(ids.slice(0, 2)), { ...page(ids.slice(2)), size: { ...DEFAULT_PAGE_SIZE, width: "560" } }], 400],
    ["contains zero size", (ids: string[]) => [page(ids.slice(0, 2)), { ...page(ids.slice(2)), size: { ...DEFAULT_PAGE_SIZE, width: 0 } }], 400],
    ["contains negative size", (ids: string[]) => [page(ids.slice(0, 2)), { ...page(ids.slice(2)), size: { ...DEFAULT_PAGE_SIZE, height: -1 } }], 400],
    ["contains an extra size field", (ids: string[]) => [page(ids.slice(0, 2)), { ...page(ids.slice(2)), size: { ...DEFAULT_PAGE_SIZE, unit: "px" } }], 400],
  ] as const)("rejects an update that %s without changing exposed or stored state", async (_label, proposed, status) => {
    const fixture = createFixture();
    dirs.push(fixture.storagePath);
    const running = await start(fixture);
    const recordPath = channelPath(fixture.storagePath, fixture.authored.id);
    const beforeBytes = readFileSync(recordPath, "utf8");
    const before = await request(running.server.httpServer)
      .get(`/channels/${fixture.authored.id}`)
      .set(auth(running.token))
      .expect(200);

    await request(running.server.httpServer)
      .patch(`/channels/${fixture.authored.id}`)
      .set(auth(running.token))
      .send({ layout: proposed([...fixture.authored.artifactIds]) })
      .expect(status);

    await request(running.server.httpServer)
      .get(`/channels/${fixture.authored.id}`)
      .set(auth(running.token))
      .expect(200)
      .expect(({ body }) => expect(body).toEqual(before.body));
    expect(readFileSync(recordPath, "utf8")).toBe(beforeBytes);
  });

  it("rejects a non-finite JSON size without changing exposed or stored state", async () => {
    const fixture = createFixture();
    dirs.push(fixture.storagePath);
    const running = await start(fixture);
    const recordPath = channelPath(fixture.storagePath, fixture.authored.id);
    const beforeBytes = readFileSync(recordPath, "utf8");
    const before = await request(running.server.httpServer)
      .get(`/channels/${fixture.authored.id}`)
      .set(auth(running.token))
      .expect(200);
    const body = JSON.stringify({
      layout: [
        page(fixture.authored.artifactIds.slice(0, 2)),
        {
          ...page(fixture.authored.artifactIds.slice(2)),
          size: { width: "__NON_FINITE__", height: DEFAULT_PAGE_SIZE.height },
        },
      ],
    }).replace('"__NON_FINITE__"', "1e400");

    await request(running.server.httpServer)
      .patch(`/channels/${fixture.authored.id}`)
      .set(auth(running.token))
      .type("application/json")
      .send(body)
      .expect(400);

    await request(running.server.httpServer)
      .get(`/channels/${fixture.authored.id}`)
      .set(auth(running.token))
      .expect(200)
      .expect(({ body: exposed }) => expect(exposed).toEqual(before.body));
    expect(readFileSync(recordPath, "utf8")).toBe(beforeBytes);
  });
});

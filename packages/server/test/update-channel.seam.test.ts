import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { Server } from "../src/server.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";
import { startUpdateChannelFixture, type UpdateChannelFixtureServer } from "../../../test/helpers/update-channel-fixture.ts";

// Seam tests for the update channel (specs/arch/updates/update-channel.md),
// crossed against a really-listening Server polling a really-served fixture
// update-channel.json over HTTP (reached via TV_UPDATE_CHANNEL_URL,
// ^hook-channel-url; the fast interval rides ^hook-poll-interval):
//   ^t-poll-fetch      — the poll request carries the cache-busting query
//                        param and Cache-Control: no-cache header, and the
//                        fetched document becomes the update state.
//   ^t-relay-on-connect — a newly connecting client receives the current
//                        update state (the same crossing as
//                        version-advertisement.md ^t-server-status-on-connect).
//   ^t-relay-broadcast — a poll that changes state delivers a fresh
//                        server-status to an ALREADY-OPEN client.
//   disposal           — server dispose stops the poll timer (no further
//                        fixture requests once disposed).
// Failure-permutation breadth is owned by ^t-poll-failures
// (src/updates/update-channel.test.ts); the server version is staged with
// TV_TEST_VERSION (version-advertisement.md ^hook-server-version).

const DOCUMENT_V2 = {
  schemaVersion: 1,
  version: "2.0.0",
  toast: { markdown: "Release 2.0.0 is out!", prompt: "please upgrade", promptButtonLabel: "Copy it" },
  desktop: { upgradeMarkdown: "upgrade the desktop app" },
};

const ENV_KEYS = ["TV_TEST_VERSION", "TV_UPDATE_CHANNEL_URL", "TV_UPDATE_CHANNEL_POLL_INTERVAL_MS"] as const;
const FAST_INTERVAL_MS = 25;

interface StatusMessage {
  type: string;
  version?: string;
  update?: { toast: { version: string } | null; desktop: { upgradeMarkdown: string } | null } | null;
}

const servers: Server[] = [];
const fixtures: UpdateChannelFixtureServer[] = [];
const dirs: string[] = [];
const sockets: WebSocket[] = [];
const savedEnv = new Map<string, string | undefined>();

function setEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.dispose();
  for (const fixture of fixtures.splice(0)) await fixture.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
});

async function startFixture(document: unknown): Promise<UpdateChannelFixtureServer> {
  const fixture = await startUpdateChannelFixture(document);
  fixtures.push(fixture);
  return fixture;
}

async function startServer(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): Promise<Server> {
  setEnv(env);
  const storagePath = mkdtempSync(path.join(os.tmpdir(), "television-update-channel-seam-"));
  dirs.push(storagePath);
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: false });
  servers.push(server);
  await server.start();
  return server;
}

function openEvents(server: Server): { ws: WebSocket; messages: StatusMessage[] } {
  const ws = new WebSocket(`${server.getBaseURL().replace(/^http/, "ws")}/events`);
  sockets.push(ws);
  const messages: StatusMessage[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(String(data)) as StatusMessage));
  return { ws, messages };
}

describe("update channel over real HTTP (^t-poll-fetch, ^t-relay-on-connect)", () => {
  it("boot-polls with cache-busting, adopts the document, and delivers it to a connecting client", async () => {
    const fixture = await startFixture(DOCUMENT_V2);
    const server = await startServer({ TV_TEST_VERSION: "1.0.0", TV_UPDATE_CHANNEL_URL: fixture.url });

    // ^t-poll-fetch: the boot poll reached the fixture with the freshness
    // contract (^poll-cache-bust) on the wire.
    await expect.poll(() => fixture.requests.length).toBeGreaterThan(0);
    const request = fixture.requests[0]!;
    expect(new URL(request.url, fixture.url).searchParams.get("t")).toMatch(/^\d+$/);
    expect(request.headers["cache-control"]).toBe("no-cache");

    // ^t-relay-on-connect: a fresh connection's first message carries the
    // adopted state. Adoption is asynchronous relative to start(), so poll
    // with fresh connections until the state is visible.
    await expect
      .poll(async () => {
        const { ws, messages } = openEvents(server);
        await new Promise<void>((resolve) => {
          ws.once("message", () => resolve());
          ws.once("error", () => resolve());
        });
        ws.close();
        return messages[0]?.update ?? null;
      })
      .toEqual({
        toast: { version: "2.0.0", markdown: DOCUMENT_V2.toast.markdown, prompt: DOCUMENT_V2.toast.prompt, promptButtonLabel: DOCUMENT_V2.toast.promptButtonLabel },
        desktop: { upgradeMarkdown: DOCUMENT_V2.desktop.upgradeMarkdown },
      });
  });

  it("relays no toast when the channel is not newer than the server", async () => {
    const fixture = await startFixture(DOCUMENT_V2);
    const server = await startServer({ TV_TEST_VERSION: "2.0.0", TV_UPDATE_CHANNEL_URL: fixture.url });
    await expect.poll(() => fixture.requests.length).toBeGreaterThan(0);

    await expect
      .poll(async () => {
        const { ws, messages } = openEvents(server);
        await new Promise<void>((resolve) => {
          ws.once("message", () => resolve());
          ws.once("error", () => resolve());
        });
        ws.close();
        return messages[0]?.update ?? null;
      })
      .toEqual({ toast: null, desktop: { upgradeMarkdown: DOCUMENT_V2.desktop.upgradeMarkdown } });
  });
});

describe("relay broadcast on state change (^t-relay-broadcast)", () => {
  it("a poll yielding a different document delivers a fresh server-status to an already-open client", async () => {
    const fixture = await startFixture(DOCUMENT_V2);
    const server = await startServer({
      TV_TEST_VERSION: "1.0.0",
      TV_UPDATE_CHANNEL_URL: fixture.url,
      TV_UPDATE_CHANNEL_POLL_INTERVAL_MS: String(FAST_INTERVAL_MS),
    });

    const { messages } = openEvents(server);
    await expect.poll(() => messages.length).toBeGreaterThan(0);

    fixture.setResponse({ ...DOCUMENT_V2, version: "3.0.0" });

    // The open socket receives a re-broadcast server-status carrying the new
    // state — no reconnect involved.
    await expect
      .poll(
        () => messages.some((message) => message.type === "server-status" && message.update?.toast?.version === "3.0.0"),
        { timeout: 10_000 },
      )
      .toBe(true);
  });
});

describe("poller lifecycle (disposal)", () => {
  it("dispose stops the poll timer: no further fixture requests arrive", async () => {
    const fixture = await startFixture(DOCUMENT_V2);
    const server = await startServer({
      TV_TEST_VERSION: "1.0.0",
      TV_UPDATE_CHANNEL_URL: fixture.url,
      TV_UPDATE_CHANNEL_POLL_INTERVAL_MS: String(FAST_INTERVAL_MS),
    });

    // Polling is demonstrably live…
    await expect.poll(() => fixture.requests.length).toBeGreaterThan(1);
    await server.dispose();
    servers.length = 0;

    // …and demonstrably stops. Bounded observation window behind a negative
    // assertion: several intervals' worth of silence after disposal.
    const countAfterDispose = fixture.requests.length;
    await new Promise((resolve) => setTimeout(resolve, FAST_INTERVAL_MS * 8));
    expect(fixture.requests.length).toBe(countAfterDispose);
  });
});

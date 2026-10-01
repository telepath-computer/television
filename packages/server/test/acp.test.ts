import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveACPAgentProfile } from "../src/config.ts";
import { Server } from "../src/server.ts";
import { ServerStore } from "../src/server-store.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

// The ACP bridge puts its agent working directory under the operating-system
// home, which it reads when its module loads. vi.hoisted runs this before the
// imports above, so the bridge sees a temporary HOME and these tests never
// write the running user's default Television home (specs/product/cli.md,
// Testing).
const operatingSystemHome = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const original = process.env.HOME;
  const temporary = mkdtempSync(join(tmpdir(), "television-acp-os-home-"));
  process.env.HOME = temporary;
  return { original, temporary };
});

afterAll(() => {
  if (operatingSystemHome.original === undefined) delete process.env.HOME;
  else process.env.HOME = operatingSystemHome.original;
  rmSync(operatingSystemHome.temporary, { recursive: true, force: true });
});

const AUTH_FAILED_CLOSE_CODE = 4401;
const OPENCLAW_PROFILE = resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "openclaw" });

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-acp-"));
}

interface Harness {
  server: Server;
  store: ServerStore;
  storagePath: string;
  baseURL: string;
  token: string;
}

async function createHarness(): Promise<Harness> {
  const storagePath = tempDir();
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true, acpProfile: OPENCLAW_PROFILE });
  await server.start();
  return {
    server,
    store,
    storagePath,
    baseURL: server.getBaseURL(),
    token: store.authToken,
  };
}

function acpURL(baseURL: string, token?: string): string {
  const parsed = new URL(baseURL);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/acp";
  if (token !== undefined) {
    parsed.searchParams.set("token", token);
  }
  return parsed.toString();
}

function eventsURL(baseURL: string, token: string): string {
  const parsed = new URL(baseURL);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/events";
  parsed.searchParams.set("token", token);
  return parsed.toString();
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function closeCode(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once("close", (code) => resolve(code));
  });
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.once("error", reject);
  });
}

describe("/acp WebSocket", () => {
  const harnesses: Harness[] = [];

  afterEach(async () => {
    for (const h of harnesses.splice(0)) {
      await h.server.dispose();
      rmSync(h.storagePath, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<Harness> {
    const h = await createHarness();
    harnesses.push(h);
    return h;
  }

  it("is not exposed when the server starts without an acpProfile", async () => {
    const storagePath = tempDir();
    const store = createServingStore(storagePath);
    const server = new Server({ store, host: "127.0.0.1", port: 0, auth: true });
    await server.start();
    harnesses.push({ server, store, storagePath, baseURL: server.getBaseURL(), token: store.authToken });

    const socket = new WebSocket(acpURL(server.getBaseURL(), store.authToken));
    const outcome = await Promise.race([
      opened(socket).then(() => "open" as const),
      new Promise<"closed">((resolve) => socket.once("close", () => resolve("closed"))),
      new Promise<"error">((resolve) => socket.once("error", () => resolve("error"))),
    ]);

    expect(outcome).not.toBe("open");
  });

  it("rejects /acp connections without a token (close 4401)", async () => {
    const h = await setup();
    const socket = new WebSocket(acpURL(h.baseURL));
    const code = await closeCode(socket);
    expect(code).toBe(AUTH_FAILED_CLOSE_CODE);
  });

  it("rejects /acp connections with a bad token (close 4401)", async () => {
    const h = await setup();
    const socket = new WebSocket(acpURL(h.baseURL, "bad-token"));
    const code = await closeCode(socket);
    expect(code).toBe(AUTH_FAILED_CLOSE_CODE);
  });

  it("accepts /acp with a valid token and responds to acp-bridge-connect with status", async () => {
    const h = await setup();
    const socket = new WebSocket(acpURL(h.baseURL, h.token));
    await opened(socket);

    const statusPromise = nextMessage(socket);
    socket.send(JSON.stringify({ type: "acp-bridge-connect" }));
    const status = (await statusPromise) as { type: string; status: string };
    expect(status.type).toBe("acp-bridge-status");
    expect(["launching", "error", "ready", "exited"]).toContain(status.status);

    socket.close();
  });

  it("does not mix ACP traffic into the /events channel", async () => {
    const h = await setup();
    const eventsSocket = new WebSocket(eventsURL(h.baseURL, h.token));
    await opened(eventsSocket);

    // ACP connect on /events is silently ignored (pub-sub only).
    eventsSocket.send(JSON.stringify({ type: "acp-bridge-connect" }));

    const race = Promise.race([
      nextMessage(eventsSocket),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
    ]);
    await expect(race).resolves.toBeNull();
    eventsSocket.close();
  });
});

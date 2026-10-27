import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import WebSocket from "ws";
import { Server } from "../src/server.ts";
import { resolveACPAgentProfile } from "../src/config.ts";
import {
  SECONDARY_LOOPBACK_ADDRESS,
  canBindSecondaryLoopback,
  secondaryLoopbackTestName,
} from "./secondary-loopback.ts";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-listeners-"));
}

function readLogRecords(storagePath: string): Array<Record<string, unknown>> {
  return readFileSync(path.join(storagePath, "logs", "tv.log"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function connect(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

function listen(server: http.Server, host: string, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (typeof address !== "object" || !address) {
        reject(new Error("server did not report an address"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

interface PrivilegedBindProbe {
  port: number;
  code: "EACCES" | "EPERM";
}

async function probePrivilegedBindFailure(): Promise<PrivilegedBindProbe | null> {
  for (const port of [1, 7, 9, 11, 13, 17, 19]) {
    const probe = http.createServer();
    try {
      await listen(probe, "127.0.0.1", port);
      await close(probe);
      return null;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") return { port, code };
      if (code !== "EADDRINUSE") throw error;
    }
  }

  return null;
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function websocketURL(baseURL: string, pathname: "/events" | "/acp"): string {
  const parsed = new URL(baseURL);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = pathname;
  return parsed.toString();
}

const SECONDARY_LOOPBACK_AVAILABLE = await canBindSecondaryLoopback();
const PRIVILEGED_BIND_PROBE = await probePrivilegedBindFailure();
const secondaryLoopbackTitle = (name: string): string =>
  secondaryLoopbackTestName(name, SECONDARY_LOOPBACK_AVAILABLE);
const privilegedBindTitle = PRIVILEGED_BIND_PROBE
  ? "rejects startup when the process lacks permission to bind a privileged port"
  : "rejects startup when the process lacks permission to bind a privileged port (skipped: no privileged-port EACCES/EPERM can be staged on this host)";

describe("server listeners", () => {
  const servers: Server[] = [];
  const storageDirs: string[] = [];
  const storagePaths = new WeakMap<Server, string>();

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await server.dispose();
    }
    for (const dir of storageDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  function createServer(options: { listen?: string[]; port?: number; auth?: boolean; acp?: boolean } = {}): Server {
    const storagePath = tempDir();
    storageDirs.push(storagePath);
    const store = createServingStore(storagePath);
    const acpProfile = options.acp ? resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "openclaw" }) : null;
    const server = new Server({
      store,
      listen: options.listen,
      port: options.port,
      auth: options.auth,
      ...(acpProfile ? { acpProfile } : {}),
    });
    servers.push(server);
    storagePaths.set(server, storagePath);
    return server;
  }

  function storagePathFor(server: Server): string {
    const storagePath = storagePaths.get(server);
    if (!storagePath) throw new Error("server has no test storage path");
    return storagePath;
  }

  it("defaults to localhost with no auth", async () => {
    const server = createServer({ port: 0 });
    await server.start();

    await request(server.httpServer).get("/channels").expect(200);
  });

  it("enforces auth globally when configured", async () => {
    const server = createServer({ port: 0, auth: true });
    await server.start();

    await request(server.httpServer).get("/channels").expect(401);
  });

  it("does not enforce auth on REST, /events, or /acp when no-auth is configured", async () => {
    const server = createServer({ port: 0, auth: false, acp: true });
    await server.start();

    await request(server.httpServer).get("/channels").expect(200);

    const eventsSocket = new WebSocket(websocketURL(server.getBaseURL(), "/events"));
    const acpSocket = new WebSocket(websocketURL(server.getBaseURL(), "/acp"));
    await Promise.all([opened(eventsSocket), opened(acpSocket)]);
    eventsSocket.close();
    acpSocket.close();
  });

  it.skipIf(!SECONDARY_LOOPBACK_AVAILABLE)(
    secondaryLoopbackTitle("serves REST and /events from multiple healthy listeners sharing one app"),
    async () => {
      const server = createServer({ listen: [SECONDARY_LOOPBACK_ADDRESS], port: 0 });
      await server.start();

      const urls = server.getBaseURLs();
      expect(urls.map((url) => new URL(url).hostname)).toEqual(["127.0.0.1", SECONDARY_LOOPBACK_ADDRESS]);

      for (const url of urls) {
        const channelsResponse = await fetch(new URL("/channels", url));
        expect(channelsResponse.status).toBe(200);
        await expect(channelsResponse.json()).resolves.toEqual({ channels: [expect.objectContaining({ name: "Default" })] });

        const eventsSocket = new WebSocket(websocketURL(url, "/events"));
        await opened(eventsSocket);
        eventsSocket.close();
      }
    },
  );

  it("reports raw bind addresses and the listening port from /health", async () => {
    const server = createServer({ listen: ["0.0.0.0"], port: 0 });
    await server.start();

    const port = Number(new URL(server.getBaseURL()).port);
    const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);

    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toEqual({
      status: "ok",
      version: "0.0.0",
      bindAddresses: ["0.0.0.0"],
      origins: expect.any(Array),
      port,
    });
  });

  // [[arch/cli/index.md#^cli-server-origins-contract]]
  it("reports its origins, one for each interface address under a wildcard listener, each of which answers", async () => {
    const loopback = createServer({ port: 0 });
    await loopback.start();
    const loopbackOrigin = `http://127.0.0.1:${loopback.getListeningPort()}`;
    expect(loopback.getOrigins()).toEqual([loopbackOrigin]);
    expect((await (await fetch(`${loopbackOrigin}/health`)).json()).origins).toEqual([loopbackOrigin]);

    const wildcard = createServer({ listen: ["0.0.0.0"], port: 0 });
    await wildcard.start();
    const port = wildcard.getListeningPort();
    const interfaceAddresses = Object.values(os.networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => entry.family === "IPv4")
      .map((entry) => entry.address);
    const expected = [...new Set(interfaceAddresses)].map((address) => `http://${address}:${port}`);
    expect(expected).toContain(`http://127.0.0.1:${port}`);
    expect(expected.filter((origin) => origin.startsWith("http://0.0.0.0"))).toEqual([]);
    expect(wildcard.getOrigins()).toEqual(expected);
    expect(await (await fetch(`http://127.0.0.1:${port}/health`)).json()).toMatchObject({ bindAddresses: ["0.0.0.0"], origins: expected, port });
    for (const origin of expected) expect((await fetch(`${origin}/health`)).status, origin).toBe(200);
  });

  // ^t-all-or-nothing ^t-port-zero
  it("rejects startup and closes bound listeners when any required address fails", async () => {
    const server = createServer({ listen: ["192.0.2.1"], port: 0 });
    const storagePath = storagePathFor(server);

    await expect(server.start()).rejects.toMatchObject({ exitStatus: 69 });

    // ^t-record-before-exit: once rejection is observable, the synchronous tv.log record is immediately readable.
    const fatalRecords = readLogRecords(storagePath).filter((record) => record.msg === "server startup failed");
    expect(fatalRecords).toHaveLength(1);
    const outcomes = fatalRecords[0]?.outcomes as Array<Record<string, unknown>> | undefined;
    expect(outcomes).toEqual([
      expect.objectContaining({ address: "127.0.0.1", port: expect.any(Number), outcome: "bound" }),
      expect.objectContaining({ address: "192.0.2.1", port: expect.any(Number), outcome: "failed" }),
    ]);

    const boundOutcome = outcomes?.[0];
    if (typeof boundOutcome?.port !== "number") throw new Error("fatal record did not include the bound listener port");
    await expect(connect("127.0.0.1", boundOutcome.port)).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  // ^t-attempt-all
  it("attempts every required address before rejecting startup", async () => {
    const server = createServer({ listen: ["192.0.2.1", "198.51.100.1"], port: 0 });
    const storagePath = storagePathFor(server);

    await expect(server.start()).rejects.toMatchObject({ exitStatus: 69 });

    const fatalRecords = readLogRecords(storagePath).filter((record) => record.msg === "server startup failed");
    expect(fatalRecords).toHaveLength(1);
    const outcomes = fatalRecords[0]?.outcomes as Array<Record<string, unknown>> | undefined;
    expect(outcomes?.filter((outcome) => outcome.outcome === "failed")).toEqual([
      expect.objectContaining({
        address: "192.0.2.1",
        outcome: "failed",
        code: "EADDRNOTAVAIL",
      }),
      expect.objectContaining({
        address: "198.51.100.1",
        outcome: "failed",
        code: "EADDRNOTAVAIL",
      }),
    ]);
  });

  it("rejects startup with status 69 when a listener port is in use", async () => {
    const blocker = http.createServer((_req, res) => res.end("blocked"));
    const blockedPort = await listen(blocker, "127.0.0.1");

    try {
      const server = createServer({ port: blockedPort });
      const storagePath = storagePathFor(server);

      await expect(server.start()).rejects.toMatchObject({ exitStatus: 69 });

      const fatalRecord = readLogRecords(storagePath).find((record) => record.msg === "server startup failed");
      expect(fatalRecord?.outcomes).toEqual([
        expect.objectContaining({
          address: "127.0.0.1",
          port: blockedPort,
          outcome: "failed",
          code: "EADDRINUSE",
        }),
      ]);
    } finally {
      await close(blocker);
    }
  });

  // ^t-error-classes
  it.skipIf(!PRIVILEGED_BIND_PROBE)(privilegedBindTitle, async () => {
    if (!PRIVILEGED_BIND_PROBE) throw new Error("privileged bind test ran without a permission-denied probe");
    const server = createServer({ port: PRIVILEGED_BIND_PROBE.port });
    const storagePath = storagePathFor(server);

    await expect(server.start()).rejects.toMatchObject({ exitStatus: 69 });

    const fatalRecord = readLogRecords(storagePath).find((record) => record.msg === "server startup failed");
    expect(fatalRecord?.outcomes).toEqual([
      expect.objectContaining({
        address: "127.0.0.1",
        port: PRIVILEGED_BIND_PROBE.port,
        outcome: "failed",
        code: PRIVILEGED_BIND_PROBE.code,
      }),
    ]);
  });
});

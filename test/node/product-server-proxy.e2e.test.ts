import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import net, { type Socket } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { disposeAllProductServers, launchProductServer, startDevelopmentProxy, type DevelopmentProxy } from "../helpers/product-server.ts";
import { ownedProcessCount } from "../helpers/owned-process.ts";

const TIMEOUT_MS = 5_000;

const disposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposals.splice(0).reverse()) await dispose();
});

describe("product server lifecycle", () => {
  test("disposes a child process while product-server startup is still in flight", async () => {
    const startup = launchProductServer();

    await disposeAllProductServers();

    await expect(startup).rejects.toThrow("tv serve exited before startup");
    expect(ownedProcessCount()).toBe(0);
  });
});

describe("development proxy reset containment", () => {
  test("closes both upgraded peers when the accepted browser socket resets", async () => {
    const upstreamSockets = new Set<Socket>();
    const upstream = createServer();
    upstream.on("upgrade", (_request, socket) => {
      const upstreamSocket = socket as Socket;
      upstreamSockets.add(upstreamSocket);
      upstreamSocket.on("error", () => upstreamSocket.destroy());
      upstreamSocket.once("close", () => upstreamSockets.delete(upstreamSocket));
      upstreamSocket.resume();
      upstreamSocket.write([
        "HTTP/1.1 101 Switching Protocols",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "",
        "",
      ].join("\r\n"));
    });
    const upstreamURL = await listen(upstream);
    disposals.push(async () => closeServer(upstream, upstreamSockets));

    const proxy = await startDevelopmentProxy({ productServerURL: upstreamURL, viteBaseURL: upstreamURL });
    disposals.push(() => proxy.dispose());

    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on("uncaughtException", onUncaught);
    try {
      const client = await connect(proxy.url);
      client.on("error", () => {});
      client.write([
        "GET /events HTTP/1.1",
        `Host: ${new URL(proxy.url).host}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "",
        "",
      ].join("\r\n"));
      await waitForData(client, "101 Switching Protocols");
      expect(upstreamSockets.size).toBe(1);

      client.resetAndDestroy();
      await waitFor(
        () => proxy.trackedSocketCount() === 0 && upstreamSockets.size === 0,
        () => `proxy sockets=${proxy.trackedSocketCount()}, upstream sockets=${upstreamSockets.size}`,
      );
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(uncaught).toEqual([]);
      expect(proxy.trackedSocketCount()).toBe(0);
      expect(upstreamSockets.size).toBe(0);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });

  test("preserves a clean FIN when the upgraded upstream ends gracefully", async () => {
    const upstreamSockets = new Set<Socket>();
    const upstream = createServer();
    upstream.on("upgrade", (_request, socket) => {
      const upstreamSocket = socket as Socket;
      upstreamSockets.add(upstreamSocket);
      upstreamSocket.on("error", () => upstreamSocket.destroy());
      upstreamSocket.once("close", () => upstreamSockets.delete(upstreamSocket));
      upstreamSocket.end([
        "HTTP/1.1 101 Switching Protocols",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "",
        "",
      ].join("\r\n"));
    });
    const upstreamURL = await listen(upstream);
    disposals.push(async () => closeServer(upstream, upstreamSockets));

    const proxy = await startDevelopmentProxy({ productServerURL: upstreamURL, viteBaseURL: upstreamURL });
    disposals.push(() => proxy.dispose());

    const client = await connect(proxy.url);
    const closure = observeSocketClosure(client);
    client.write([
      "GET /events HTTP/1.1",
      `Host: ${new URL(proxy.url).host}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "",
      "",
    ].join("\r\n"));

    const observed = await closure;
    expect(observed.data).toContain("101 Switching Protocols");
    expect(observed).toMatchObject({ ended: true, hadError: false, errors: [] });
    await waitFor(
      () => proxy.trackedSocketCount() === 0 && upstreamSockets.size === 0,
      () => `proxy sockets=${proxy.trackedSocketCount()}, upstream sockets=${upstreamSockets.size}`,
    );
  });

  test("closes both HTTP peers when the accepted browser socket resets", async () => {
    const upstreamSockets = new Set<Socket>();
    const upstreamRequests = new Set<IncomingMessage>();
    const upstream = createServer((request: IncomingMessage, response: ServerResponse) => {
      upstreamRequests.add(request);
      request.on("error", () => request.destroy());
      request.once("close", () => upstreamRequests.delete(request));
      response.on("error", () => response.destroy());
    });
    upstream.on("connection", (socket) => {
      upstreamSockets.add(socket);
      socket.on("error", () => socket.destroy());
      socket.once("close", () => upstreamSockets.delete(socket));
    });
    const upstreamURL = await listen(upstream);
    disposals.push(async () => closeServer(upstream, upstreamSockets));

    const proxy = await startDevelopmentProxy({ productServerURL: upstreamURL, viteBaseURL: upstreamURL });
    disposals.push(() => proxy.dispose());

    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on("uncaughtException", onUncaught);
    try {
      const client = await connect(proxy.url);
      client.on("error", () => {});
      client.write([
        "POST /channels HTTP/1.1",
        `Host: ${new URL(proxy.url).host}`,
        "Content-Type: application/json",
        "Content-Length: 1000",
        "",
        "{",
      ].join("\r\n"));
      await waitFor(() => upstreamRequests.size === 1);

      client.resetAndDestroy();
      await waitFor(
        () => proxy.trackedSocketCount() === 0 && upstreamSockets.size === 0 && upstreamRequests.size === 0,
        () => `proxy sockets=${proxy.trackedSocketCount()}, upstream sockets=${upstreamSockets.size}, upstream requests=${upstreamRequests.size}`,
      );
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(uncaught).toEqual([]);
      expect(proxy.trackedSocketCount()).toBe(0);
      expect(upstreamSockets.size).toBe(0);
      expect(upstreamRequests.size).toBe(0);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });
});

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("upstream did not bind a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

async function connect(url: string): Promise<Socket> {
  const parsed = new URL(url);
  const socket = net.connect(Number(parsed.port), parsed.hostname);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return socket;
}

function observeSocketClosure(socket: Socket): Promise<{ data: string; ended: boolean; hadError: boolean; errors: string[] }> {
  let data = "";
  let ended = false;
  const errors: string[] = [];
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for socket closure; received ${JSON.stringify(data)}`)), TIMEOUT_MS);
    socket.on("data", (chunk: Buffer) => { data += chunk.toString("utf8"); });
    socket.on("end", () => { ended = true; });
    socket.on("error", (error: NodeJS.ErrnoException) => { errors.push(error.code ?? error.message); });
    socket.once("close", (hadError) => {
      clearTimeout(timeout);
      resolve({ data, ended, hadError, errors });
    });
  });
}

async function waitForData(socket: Socket, expected: string): Promise<void> {
  let data = "";
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${JSON.stringify(expected)}; received ${JSON.stringify(data)}`)), TIMEOUT_MS);
    const onData = (chunk: Buffer) => {
      data += chunk.toString("utf8");
      if (!data.includes(expected)) return;
      clearTimeout(timeout);
      socket.off("data", onData);
      resolve();
    };
    socket.on("data", onData);
  });
}

async function waitFor(predicate: () => boolean, describeState: () => string = () => "state unavailable"): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for proxy peers to close: ${describeState()}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function closeServer(server: ReturnType<typeof createServer>, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

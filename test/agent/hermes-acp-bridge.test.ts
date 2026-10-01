import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, type RawData } from "ws";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type AnyMessage,
  type RequestPermissionRequest,
  type SessionNotification,
  type Stream,
} from "@agentclientprotocol/sdk";
import { resolveACPAgentProfile, Server } from "@telepath-computer/television-server";
import type { ACPBridgeReadyMetadata } from "@telepath-computer/television-shared";
import { ACPClient, type ACPClientStatus, type ACPMappedSessionStore } from "../../packages/web/src/services/acp-client.ts";
import { createServingStore } from "../helpers/serving-store.ts";

// The ACP bridge puts its agent working directory under the operating-system
// home, which it reads when its module loads. vi.hoisted runs this before the
// imports above, so the bridge sees a temporary HOME and this test never
// writes the running user's default Television home (specs/product/cli.md,
// Testing). The real HOME returns once the imports have loaded, because the
// agent the bridge launches inherits it and reads its own configuration there.
const operatingSystemHome = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const original = process.env.HOME;
  const temporary = mkdtempSync(join(tmpdir(), "television-acp-os-home-"));
  process.env.HOME = temporary;
  return { original, temporary };
});
if (operatingSystemHome.original === undefined) delete process.env.HOME;
else process.env.HOME = operatingSystemHome.original;

afterAll(() => {
  rmSync(operatingSystemHome.temporary, { recursive: true, force: true });
});

const CLIENT_INFO = { name: "television-hermes-acp-test", version: "0.0.0" };
const HERMES_PROFILE = resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "hermes" });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BridgeStatus = {
  type: "acp-bridge-status";
  status: "launching" | "ready" | "error" | "exited";
  error?: string;
} & Partial<ACPBridgeReadyMetadata>;

type BridgeMessage = BridgeStatus | { type: "acp-bridge-message"; message: AnyMessage };

type Harness = {
  server: Server;
  storagePath: string;
  serverURL: string;
  token: string;
};

type Listener = (event: unknown) => void;

class RecordingMappedSessionStore implements ACPMappedSessionStore {
  readonly entries = new Map<string, string>();
  readonly getCalls: string[] = [];
  readonly setCalls: Array<{ logicalSessionKey: string; actualSessionId: string }> = [];

  getActualSessionId(logicalSessionKey: string): string | null {
    this.getCalls.push(logicalSessionKey);
    return this.entries.get(logicalSessionKey) ?? null;
  }

  setActualSessionId(logicalSessionKey: string, actualSessionId: string): void {
    this.setCalls.push({ logicalSessionKey, actualSessionId });
    this.entries.set(logicalSessionKey, actualSessionId);
  }

  clearActualSessionId(logicalSessionKey: string): void {
    this.entries.delete(logicalSessionKey);
  }
}

type JSONRPCRequest = {
  method?: string;
  params?: unknown;
};

class NodeWebSocketAdapter {
  readonly socket: WebSocket;
  readonly #listeners = new Map<string, Map<Listener, (...args: unknown[]) => void>>();
  readonly #onSend?: (data: string) => void;

  constructor(url: string, options: { onSend?: (data: string) => void } = {}) {
    this.socket = new WebSocket(url);
    this.#onSend = options.onSend;
  }

  get readyState(): number {
    return this.socket.readyState;
  }

  addEventListener(type: string, listener: Listener): void {
    const wrapped = (...args: unknown[]) => {
      if (type === "message") {
        const [data] = args as [RawData];
        listener({ data: data.toString() });
        return;
      }
      listener(args[0] ?? {});
    };
    let listenersForType = this.#listeners.get(type);
    if (!listenersForType) {
      listenersForType = new Map();
      this.#listeners.set(type, listenersForType);
    }
    listenersForType.set(listener, wrapped);
    this.socket.on(type, wrapped as never);
  }

  removeEventListener(type: string, listener: Listener): void {
    const listenersForType = this.#listeners.get(type);
    const wrapped = listenersForType?.get(listener);
    if (!wrapped) {
      return;
    }
    this.socket.off(type, wrapped as never);
    listenersForType?.delete(listener);
  }

  send(data: string): void {
    this.#onSend?.(data);
    this.socket.send(data);
  }

  close(): void {
    this.socket.close();
  }
}

function hasHermesBinary(): boolean {
  const result = spawnSync("hermes", ["--version"], { encoding: "utf8" });
  return result.status === 0;
}

function isPIDRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function hasModelCredentials(): boolean {
  return process.env.HERMES_E2E_ENABLE_MODEL === "1"
    || Boolean(
      process.env.OPENAI_API_KEY
        || process.env.ANTHROPIC_API_KEY
        || process.env.GOOGLE_API_KEY
        || process.env.GEMINI_API_KEY
        || process.env.OPENROUTER_API_KEY,
    );
}

function createDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-hermes-acp-"));
}

async function createHermesHarness(): Promise<Harness> {
  const storagePath = createDataDir();
  const store = createServingStore(storagePath);
  const server = new Server({ store, host: "127.0.0.1", port: 0, acpProfile: HERMES_PROFILE });
  await server.start();
  return {
    server,
    storagePath,
    serverURL: server.getBaseURL(),
    token: server.getAuthToken(),
  };
}

function acpURL(harness: Harness): string {
  const parsed = new URL(harness.serverURL);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/acp";
  parsed.searchParams.set("token", harness.token);
  return parsed.toString();
}

function createBridgeStream(wsURL: string): Promise<{
  stream: Stream;
  socket: WebSocket;
  statuses: BridgeStatus[];
  ready: ACPBridgeReadyMetadata;
}> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsURL);
    const statuses: BridgeStatus[] = [];

    let readyResolved = false;
    let resolveReady!: (metadata: ACPBridgeReadyMetadata) => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<ACPBridgeReadyMetadata>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });

    const readable = new ReadableStream<AnyMessage>({
      start(controller) {
        socket.on("open", () => {
          socket.send(JSON.stringify({ type: "acp-bridge-connect" }));
        });

        socket.on("message", (data: RawData) => {
          let message: BridgeMessage;
          try {
            message = JSON.parse(data.toString()) as BridgeMessage;
          } catch (error) {
            const wrapped = error instanceof Error ? error : new Error(String(error));
            rejectReady(wrapped);
            controller.error(wrapped);
            return;
          }

          if (message.type === "acp-bridge-status") {
            statuses.push(message);
            if (message.status === "ready") {
              if (!message.agent || !message.sessionIdStrategy || !message.sessionCwd || !message.tvArgs) {
                const error = new Error("Hermes bridge ready status did not include metadata");
                rejectReady(error);
                controller.error(error);
                return;
              }
              if (!readyResolved) {
                readyResolved = true;
                resolveReady({
                  agent: message.agent,
                  sessionIdStrategy: message.sessionIdStrategy,
                  sessionCwd: message.sessionCwd,
                  tvArgs: message.tvArgs,
                });
              }
              return;
            }
            if (message.status === "launching") {
              return;
            }
            if (message.status === "error" || message.status === "exited") {
              const error = new Error(message.error ?? `ACP bridge ${message.status}`);
              if (!readyResolved) {
                rejectReady(error);
              }
              controller.error(error);
            }
            return;
          }

          controller.enqueue(message.message);
        });

        socket.on("close", () => {
          if (!readyResolved) {
            rejectReady(new Error("WebSocket closed before bridge ready"));
          }
          controller.close();
        });

        socket.on("error", (error) => {
          if (!readyResolved) {
            rejectReady(error);
          }
          controller.error(error);
        });
      },
    });

    const writable = new WritableStream<AnyMessage>({
      async write(message) {
        await ready;
        socket.send(JSON.stringify({ type: "acp-bridge-message", message }));
      },
      close() {
        socket.close();
      },
      abort() {
        socket.close();
      },
    });

    ready
      .then((metadata) => resolve({ stream: { readable, writable }, socket, statuses, ready: metadata }))
      .catch(reject);
  });
}

function createConnection(stream: Stream): {
  connection: ClientSideConnection;
  updates: SessionNotification[];
} {
  const updates: SessionNotification[] = [];
  const connection = new ClientSideConnection(
    () => ({
      sessionUpdate: async (params: SessionNotification) => {
        updates.push(params);
      },
      requestPermission: async (_params: RequestPermissionRequest) => {
        return { outcome: { outcome: "cancelled" } };
      },
    }),
    stream,
  );
  return { connection, updates };
}

async function waitFor<T>(label: string, timeoutMs: number, fn: () => T | null): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = fn();
    if (value !== null) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function initialize(connection: ClientSideConnection): Promise<void> {
  await connection.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
    clientInfo: CLIENT_INFO,
  });
}

function recordBridgeRequest(requests: JSONRPCRequest[], data: string): void {
  let bridgeMessage: unknown;
  try {
    bridgeMessage = JSON.parse(data) as unknown;
  } catch {
    return;
  }
  if (typeof bridgeMessage !== "object" || bridgeMessage === null) {
    return;
  }
  const outer = bridgeMessage as { type?: unknown; message?: unknown };
  if (outer.type !== "acp-bridge-message" || typeof outer.message !== "object" || outer.message === null) {
    return;
  }
  const request = outer.message as JSONRPCRequest;
  if (typeof request.method === "string") {
    requests.push(request);
  }
}

function requestsByMethod(requests: JSONRPCRequest[], method: string): JSONRPCRequest[] {
  return requests.filter((request) => request.method === method);
}

function requestSessionId(request: JSONRPCRequest): string | null {
  const params = request.params;
  if (typeof params !== "object" || params === null || !("sessionId" in params)) {
    return null;
  }
  const { sessionId } = params as { sessionId?: unknown };
  return typeof sessionId === "string" ? sessionId : null;
}

function collectAgentText(updates: SessionNotification[]): string {
  return updates
    .flatMap((notification) => {
      const { update } = notification;
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        return [update.content.text];
      }
      return [];
    })
    .join("");
}

const describeHermes = process.env.SKIP_ACP_TESTS || !hasHermesBinary() ? describe.skip : describe;
const itModel = hasModelCredentials() ? it : it.skip;

describeHermes("Hermes ACP bridge (agent e2e)", () => {
  const harnesses: Harness[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
    for (const harness of harnesses.splice(0)) {
      await harness.server.dispose();
      rmSync(harness.storagePath, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<Harness> {
    const harness = await createHermesHarness();
    harnesses.push(harness);
    return harness;
  }

  it("creates a Hermes session, loads it, and returns /version", async () => {
    const harness = await setup();
    const bridge = await createBridgeStream(acpURL(harness));
    sockets.push(bridge.socket);

    expect(bridge.statuses.some((status) => status.status === "launching")).toBe(true);
    expect(bridge.ready).toMatchObject({
      agent: "hermes",
      sessionIdStrategy: "mapped",
    });
    expect(path.isAbsolute(bridge.ready.sessionCwd)).toBe(true);

    const { connection, updates } = createConnection(bridge.stream);
    await initialize(connection);

    const session = await connection.newSession({
      cwd: "/",
      mcpServers: [],
      _meta: { sessionKey: "television-hermes-e2e" },
    });
    expect(session.sessionId).toMatch(UUID_RE);

    await connection.loadSession({
      sessionId: session.sessionId,
      cwd: "/",
      mcpServers: [],
    });

    const response = await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "/version" }],
    });
    expect(response.stopReason).toBe("end_turn");
    expect(collectAgentText(updates)).toMatch(/Hermes Agent v/i);
  }, 180_000);

  it("uses one Hermes subprocess per websocket client and cleans them up independently", async () => {
    const harness = await setup();
    const wsURL = acpURL(harness);

    const bridgeA = await createBridgeStream(wsURL);
    sockets.push(bridgeA.socket);
    await vi.waitFor(() => {
      expect(harness.server.getACPBridgePIDs()).toHaveLength(1);
    }, { timeout: 30_000 });
    const [pidA] = harness.server.getACPBridgePIDs();
    if (!pidA) throw new Error("Expected first Hermes bridge PID");

    const bridgeB = await createBridgeStream(wsURL);
    sockets.push(bridgeB.socket);
    await vi.waitFor(() => {
      expect(harness.server.getACPBridgePIDs()).toHaveLength(2);
    }, { timeout: 30_000 });
    const pidB = harness.server.getACPBridgePIDs().find((pid) => pid !== pidA);
    if (!pidB) throw new Error("Expected second Hermes bridge PID");

    expect(isPIDRunning(pidA)).toBe(true);
    expect(isPIDRunning(pidB)).toBe(true);

    bridgeA.socket.close();
    await new Promise<void>((resolve) => bridgeA.socket.once("close", resolve));
    await vi.waitFor(() => {
      expect(isPIDRunning(pidA)).toBe(false);
    }, { timeout: 30_000 });
    expect(isPIDRunning(pidB)).toBe(true);

    bridgeB.socket.close();
    await new Promise<void>((resolve) => bridgeB.socket.once("close", resolve));
    await vi.waitFor(() => {
      expect(isPIDRunning(pidB)).toBe(false);
    }, { timeout: 30_000 });
  }, 180_000);

  it("loads a persisted mapped Hermes UUID, reports the model, reconnects, and disposes cleanly", async () => {
    const harness = await setup();
    const store = new RecordingMappedSessionStore();
    const adapters: NodeWebSocketAdapter[] = [];
    const observedStatuses: ACPClientStatus[] = [];
    let messagesChanged = 0;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const createSocket = (url: string) => {
      const adapter = new NodeWebSocketAdapter(url);
      adapters.push(adapter);
      return adapter;
    };

    const first = new ACPClient({
      serverURL: harness.serverURL,
      token: harness.token,
      enabled: true,
      createSocket,
      mappedSessionStore: store,
    });
    const recordStatus = () => observedStatuses.push(first.status);
    const recordMessages = () => {
      messagesChanged += 1;
    };
    first.addEventListener("status-changed", recordStatus);
    first.addEventListener("messages-changed", recordMessages);

    expect(first.status).toBe("disconnected");
    expect(first.messages).toEqual([]);
    await first.connect();
    expect(first.status).toBe("ready");
    expect(observedStatuses).toEqual(["ready"]);
    expect(messagesChanged).toBe(0);
    expect(info).toHaveBeenCalledWith(
      "[ACPClient] Current model:",
      expect.any(String),
      expect.stringMatching(/^\(.+\)$/),
    );

    await first.sendMessage({ text: "/version" });
    expect(first.status).toBe("ready");
    expect(observedStatuses).toContain("running");
    expect(messagesChanged).toBeGreaterThan(0);
    expect(first.messages.some((message) => message.kind === "assistant" && /Hermes Agent v/i.test(message.text))).toBe(true);

    const actualSessionId = store.getActualSessionId("agent:main:television-default-client");
    expect(actualSessionId).toMatch(UUID_RE);
    expect(store.setCalls).toHaveLength(1);
    first.dispose();
    expect(first.status).toBe("disposed");
    expect(observedStatuses.at(-1)).toBe("disposed");
    await expect(first.connect()).rejects.toThrow("ACPClient has been disposed");
    first.removeEventListener("status-changed", recordStatus);
    first.removeEventListener("messages-changed", recordMessages);

    const second = new ACPClient({
      serverURL: harness.serverURL,
      token: harness.token,
      enabled: true,
      createSocket,
      mappedSessionStore: store,
    });
    await second.connect();
    await second.sendMessage({ text: "/version" });

    expect(store.getCalls).toContain("agent:main:television-default-client");
    expect(store.setCalls).toHaveLength(1);
    expect(store.getActualSessionId("agent:main:television-default-client")).toBe(actualSessionId);
    expect(second.messages.some((message) => message.kind === "assistant" && /Hermes Agent v/i.test(message.text))).toBe(true);
    second.dispose();
    info.mockRestore();
  }, 180_000);

  itModel("reconnects mapped ACPClient sessions by loading the same Hermes UUID and preserves underlying context", async () => {
    const harness = await setup();
    const store = new RecordingMappedSessionStore();
    const requests: JSONRPCRequest[] = [];
    const adapters: NodeWebSocketAdapter[] = [];
    const client = new ACPClient({
      serverURL: harness.serverURL,
      token: harness.token,
      enabled: true,
      mappedSessionStore: store,
      createSocket: (url) => {
        const adapter = new NodeWebSocketAdapter(url, {
          onSend: (data) => recordBridgeRequest(requests, data),
        });
        adapters.push(adapter);
        return adapter;
      },
    });

    await client.connect();
    const logicalKey = "agent:main:television-default-client";
    const actualSessionId = store.getActualSessionId(logicalKey);
    expect(actualSessionId).toMatch(UUID_RE);
    expect(requestsByMethod(requests, "session/new")).toHaveLength(1);
    expect(requestsByMethod(requests, "session/load")).toHaveLength(0);

    const token = `tv-continuity-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await client.sendMessage({
      text: `Please remember this exact token for the next turn: ${token}. Reply with exactly OK.`,
    });
    expect(client.status).toBe("ready");

    adapters.at(-1)?.close();
    await waitFor("mapped session client disconnected", 10_000, () => client.status === "disconnected" ? true : null);

    const requestCountBeforeReconnect = requests.length;
    await client.connect();
    const reconnectRequests = requests.slice(requestCountBeforeReconnect);
    expect(requestsByMethod(reconnectRequests, "session/new")).toHaveLength(0);
    const loadRequests = requestsByMethod(reconnectRequests, "session/load");
    expect(loadRequests).toHaveLength(1);
    expect(requestSessionId(loadRequests[0]!)).toBe(actualSessionId);

    await client.sendMessage({
      text: "What exact token did I ask you to remember in the previous turn? Reply with only that token.",
    });
    expect(client.status).toBe("ready");
    const transcript = client.messages.map((message) => message.text).join("\n");
    expect(transcript).toContain(token);

    client.dispose();
  }, 300_000);

  // TODO(TV-184): pre-existing flake — agent runs commands in the wrong cwd / misses sentinel file.
  itModel.skip("opens real Hermes sessions in the bridge-reported session cwd", async () => {
    // realpathSync resolves the macOS /var → /private/var symlink so the
    // assertion against the bridge-reported cwd (which the server resolves
    // canonically) holds. No-op on Linux.
    const workspaceDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "television-hermes-cwd-")));
    const sentinelName = `sentinel-${Date.now()}.txt`;
    const sentinelText = `cwd-sentinel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    writeFileSync(path.join(workspaceDir, sentinelName), sentinelText, "utf8");

    const harness = await setup();
    const adapters: NodeWebSocketAdapter[] = [];
    const client = new ACPClient({
      serverURL: harness.serverURL,
      token: harness.token,
      enabled: true,
      createSocket: (url) => {
        const adapter = new NodeWebSocketAdapter(url);
        adapters.push(adapter);
        return adapter;
      },
    });

    const previousCwd = process.cwd();
    try {
      process.chdir(workspaceDir);
      await client.connect();
    } finally {
      process.chdir(previousCwd);
    }

    try {
      await client.sendMessage({
        text: [
          "Use the terminal tool to run exactly this command in the current working directory:",
          "",
          `    pwd && cat ./${sentinelName}`,
          "",
          "Report the exact stdout. Do not answer from memory.",
        ].join("\n"),
      });

      expect(client.status).toBe("ready");
      const transcript = client.messages.map((message) => message.text).join("\n");
      expect(transcript).toContain(workspaceDir);
      expect(transcript).toContain(sentinelText);
    } finally {
      client.dispose();
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }, 300_000);

  // TV-288: Hermes currently completes the prompt without surfacing the terminal tool call in ACPClient messages.
  itModel.skip("renders real Hermes terminal tool calls as completed ACPClient tool_call messages", async () => {
    const harness = await setup();
    const client = new ACPClient({
      serverURL: harness.serverURL,
      token: harness.token,
      enabled: true,
      createSocket: (url) => new NodeWebSocketAdapter(url),
    });
    await client.connect();

    const observedToolStatuses = new Map<string, Set<string>>();
    const recordToolStatuses = () => {
      for (const message of client.messages) {
        if (message.kind === "tool_call") {
          let statuses = observedToolStatuses.get(message.toolCallId);
          if (!statuses) {
            statuses = new Set();
            observedToolStatuses.set(message.toolCallId, statuses);
          }
          statuses.add(message.status);
        }
      }
    };
    client.addEventListener("messages-changed", recordToolStatuses);

    const startedMs = Date.now();
    try {
      await client.sendMessage({
        text: [
          "Use the terminal tool to run exactly this command and report the exact stdout:",
          "",
          "    date +%s%N",
          "",
          "Do not answer from memory; the nanosecond timestamp must come from the command output.",
        ].join("\n"),
      });
    } finally {
      client.removeEventListener("messages-changed", recordToolStatuses);
    }
    const finishedMs = Date.now();

    expect(client.status).toBe("ready");
    const completedTool = client.messages.find(
      (message) => message.kind === "tool_call" && message.status === "completed",
    );
    expect(completedTool).toBeDefined();
    if (!completedTool || completedTool.kind !== "tool_call") {
      throw new Error("Expected completed Hermes tool_call message");
    }
    expect(observedToolStatuses.get(completedTool.toolCallId)?.has("in_progress")).toBe(true);
    expect(observedToolStatuses.get(completedTool.toolCallId)?.has("completed")).toBe(true);

    const transcript = client.messages.map((message) => message.text).join("\n");
    const lowerBound = BigInt(startedMs - 60_000) * 1_000_000n;
    const upperBound = BigInt(finishedMs + 60_000) * 1_000_000n;
    const plausibleTimestamp = [...transcript.matchAll(/\b\d{19}\b/g)]
      .map((match) => BigInt(match[0]))
      .find((value) => value >= lowerBound && value <= upperBound);
    expect(plausibleTimestamp).toBeDefined();

    client.dispose();
  }, 300_000);

});

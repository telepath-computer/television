import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, type RawData } from "ws";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type SessionNotification,
  type RequestPermissionRequest,
  type Stream,
} from "@agentclientprotocol/sdk";
import { resolveACPAgentProfile, Server } from "@telepath-computer/television-server";
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

const OPENCLAW_PROFILE = resolveACPAgentProfile({ TELEVISION_ACP_AGENT: "openclaw" });

const ACP_TEST_FILE = path.resolve(import.meta.dirname, "fixtures/acp-read-input.md");
const CLIENT_INFO = { name: "television-acp-test", version: "0.0.0" };

type SessionUpdate = SessionNotification;
type BridgeMessage = {
  type: string;
  status?: string;
  error?: string;
  message?: unknown;
  [key: string]: unknown;
};

function createDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "television-acp-agent-e2e-"));
}

function logPhase(label: string): void {
  console.log(`[acp-agent-e2e][${new Date().toISOString()}] ${label}`);
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve test port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function isPIDRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create an ACP SDK Stream over the Television bridge WebSocket protocol.
 *
 * Connects via `ws`, sends `acp-bridge-connect`, filters for `acp-bridge-*`
 * messages (skipping `channel-list` and other non-bridge messages), waits
 * through `launching` → `ready`, then bridges `acp-bridge-message` into
 * ReadableStream/WritableStream.
 */
function createBridgeStream(wsURL: string): Promise<{ stream: Stream; socket: WebSocket }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsURL);

    let readyResolved = false;
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });

    const readable = new ReadableStream({
      start(controller) {
        let controllerClosed = false;
        const closeController = () => {
          if (controllerClosed) return;
          controllerClosed = true;
          controller.close();
        };
        const errorController = (error: Error) => {
          if (controllerClosed) return;
          controllerClosed = true;
          controller.error(error);
        };

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
            errorController(wrapped);
            return;
          }

          // Skip non-bridge messages (e.g. channel-list)
          if (!message.type.startsWith("acp-bridge-")) {
            return;
          }

          if (message.type === "acp-bridge-status") {
            if (message.status === "ready") {
              if (!readyResolved) {
                readyResolved = true;
                resolveReady();
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
              errorController(error);
            }
            return;
          }

          if (message.type === "acp-bridge-message") {
            controller.enqueue(message.message);
          }
        });

        socket.on("close", () => {
          if (!readyResolved) {
            rejectReady(new Error("WebSocket closed before bridge ready"));
          }
          closeController();
        });

        socket.on("error", (error) => {
          if (!readyResolved) {
            rejectReady(error);
          }
          errorController(error);
        });
      },
    });

    const writable = new WritableStream({
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

    ready.then(() => resolve({ stream: { readable, writable }, socket })).catch(reject);
  });
}

function createConnection(stream: Stream): {
  connection: ClientSideConnection;
  updates: SessionUpdate[];
} {
  const updates: SessionUpdate[] = [];
  const connection = new ClientSideConnection(
    () => ({
      sessionUpdate: async (params: SessionUpdate) => {
        updates.push(params);
      },
      requestPermission: async (_params: RequestPermissionRequest) => {
        return { outcome: "allow" as const };
      },
    }),
    stream,
  );
  return { connection, updates };
}

async function initConnection(connection: ClientSideConnection): Promise<void> {
  await connection.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
    clientInfo: CLIENT_INFO,
  });
}

function getSessionKey(mode: "single_session" | "per_channel_session", channelID: string): string {
  const clientGUID = "acp-test";
  if (mode === "single_session") {
    return `agent:main:television-${clientGUID}`;
  }
  return `agent:main:television-${clientGUID}-${channelID.toLowerCase()}`;
}

function collectTextFromUpdates(updates: SessionUpdate[]): string {
  const texts: string[] = [];
  for (const notification of updates) {
    const { update } = notification;
    if (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "user_message_chunk") {
      if (update.content.type === "text" && "text" in update.content) {
        texts.push((update.content as { text: string }).text);
      }
    }
  }
  return texts.join("");
}

const describeAgent = process.env.SKIP_ACP_TESTS || process.env.OPENCLAW_ACP_E2E !== "1" ? describe.skip : describe;

describeAgent("ACP bridge (agent e2e)", () => {
  const tempDirs: string[] = [];
  const openSockets: WebSocket[] = [];
  const runningServers: Server[] = [];

  afterEach(async () => {
    for (const socket of openSockets.splice(0)) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
    for (const server of runningServers.splice(0)) {
      await server.dispose();
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const sessionMode of ["per_channel_session", "single_session"] as const) {
    it(`loads history after reconnect in ${sessionMode}`, async () => {
      const storagePath = createDataDir();
      tempDirs.push(storagePath);
      const store = createServingStore(storagePath);
      const server = new Server({ store, port: 0, acpProfile: OPENCLAW_PROFILE });
      runningServers.push(server);

      logPhase(`starting server for ${sessionMode}`);
      await server.start();
      const serverURL = server.getBaseURL();
      const token = server.getAuthToken();
      const channel = store.listChannels()[0];
      if (!channel) throw new Error("Expected default channel");

      const wsURL = `${serverURL.replace(/^http/, "ws")}/acp?token=${encodeURIComponent(token)}`;

      // First connection: create session and send prompt
      logPhase(`connecting (first) for ${sessionMode}`);
      const { stream, socket } = await createBridgeStream(wsURL);
      openSockets.push(socket);
      const { connection } = createConnection(stream);
      await initConnection(connection);

      const sessionKey = getSessionKey(sessionMode, channel.id);

      let sessionId: string;
      try {
        await connection.loadSession({ sessionId: sessionKey, cwd: "/", mcpServers: [] });
        sessionId = sessionKey;
      } catch {
        const session = await connection.newSession({ cwd: "/", mcpServers: [] });
        sessionId = session.sessionId;
      }

      const runToken = `acp-agent-${sessionMode}-${Date.now()}`;
      const prompt = `Use a tool to read the file ${ACP_TEST_FILE}. Do not answer from memory. Tell me the first line of the file and include this exact token in your answer: ${runToken}`;

      logPhase(`sending prompt for ${sessionMode}`);
      const promptResponse = await connection.prompt({
        sessionId,
        prompt: [{ type: "text", text: prompt }],
      });
      expect(promptResponse.stopReason).toBe("end_turn");

      // Disconnect
      logPhase(`disconnecting for ${sessionMode}`);
      socket.close();
      await new Promise<void>((resolve) => socket.once("close", resolve));

      // Reconnect and load session
      logPhase(`reconnecting for ${sessionMode}`);
      const { stream: stream2, socket: socket2 } = await createBridgeStream(wsURL);
      openSockets.push(socket2);
      const { connection: connection2, updates: updates2 } = createConnection(stream2);
      await initConnection(connection2);

      await connection2.loadSession({ sessionId: sessionKey, cwd: "/", mcpServers: [] });

      // Wait for history replay
      await new Promise((resolve) => setTimeout(resolve, 2_000));

      const replayedText = collectTextFromUpdates(updates2);
      expect(replayedText).toContain(runToken);

      logPhase(`test passed for ${sessionMode}`);
      socket2.close();
    }, 240_000);
  }

  it("reconnects after server restart and replays history", async () => {
    const storagePath = createDataDir();
    tempDirs.push(storagePath);
    const store = createServingStore(storagePath);
    const port = await getAvailablePort();
    let server = new Server({ store, port, acpProfile: OPENCLAW_PROFILE });
    runningServers.push(server);

    logPhase("starting server for restart test");
    await server.start();
    const token = server.getAuthToken();
    const channel = store.listChannels()[0];
    if (!channel) throw new Error("Expected default channel");

    const wsURL = `ws://127.0.0.1:${port}/acp?token=${encodeURIComponent(token)}`;

    // First connection: send prompt
    const { stream, socket } = await createBridgeStream(wsURL);
    openSockets.push(socket);
    const { connection } = createConnection(stream);
    await initConnection(connection);

    const sessionKey = getSessionKey("per_channel_session", channel.id);
    let sessionId: string;
    try {
      await connection.loadSession({ sessionId: sessionKey, cwd: "/", mcpServers: [] });
      sessionId = sessionKey;
    } catch {
      const session = await connection.newSession({ cwd: "/", mcpServers: [] });
      sessionId = session.sessionId;
    }

    const runToken = `acp-restart-${Date.now()}`;
    const prompt = `Use a tool to read the file ${ACP_TEST_FILE}. Do not answer from memory. Tell me the first line of the file and include this exact token in your answer: ${runToken}`;

    logPhase("sending first prompt");
    const response = await connection.prompt({
      sessionId,
      prompt: [{ type: "text", text: prompt }],
    });
    expect(response.stopReason).toBe("end_turn");

    // Stop server
    logPhase("stopping server");
    runningServers.splice(runningServers.indexOf(server), 1);
    await server.dispose();

    // Restart server on same port with same store
    logPhase("restarting server");
    server = new Server({ store, port, acpProfile: OPENCLAW_PROFILE });
    runningServers.push(server);
    await server.start();

    // Reconnect and verify history
    const { stream: stream2, socket: socket2 } = await createBridgeStream(wsURL);
    openSockets.push(socket2);
    const { connection: connection2, updates: updates2 } = createConnection(stream2);
    await initConnection(connection2);

    await connection2.loadSession({ sessionId: sessionKey, cwd: "/", mcpServers: [] });
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    const replayedText = collectTextFromUpdates(updates2);
    expect(replayedText).toContain(runToken);

    // Send second prompt
    const secondRunToken = `acp-restart-second-${Date.now()}`;
    const secondPrompt = `Use a tool to read the file ${ACP_TEST_FILE} again. Include this exact token in your answer: ${secondRunToken}`;

    logPhase("sending second prompt after restart");
    const secondResponse = await connection2.prompt({
      sessionId: sessionKey,
      prompt: [{ type: "text", text: secondPrompt }],
    });
    expect(secondResponse.stopReason).toBe("end_turn");

    logPhase("restart test passed");
    socket2.close();
  }, 300_000);

  it("uses one subprocess per websocket client and cleans them up independently", async () => {
    const storagePath = createDataDir();
    tempDirs.push(storagePath);
    const store = createServingStore(storagePath);
    const server = new Server({ store, port: 0, acpProfile: OPENCLAW_PROFILE });
    runningServers.push(server);

    await server.start();
    const serverURL = server.getBaseURL();
    const token = server.getAuthToken();
    const channel = store.listChannels()[0];
    if (!channel) throw new Error("Expected default channel");

    const wsURL = `${serverURL.replace(/^http/, "ws")}/acp?token=${encodeURIComponent(token)}`;

    // Connect client A
    const { stream: streamA, socket: socketA } = await createBridgeStream(wsURL);
    openSockets.push(socketA);
    createConnection(streamA);

    // Wait for subprocess to spawn
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const pidsAfterA = server.getACPBridgePIDs();
    expect(pidsAfterA).toHaveLength(1);
    const [pidA] = pidsAfterA;
    if (!pidA) throw new Error("Expected PID for client A");

    // Connect client B
    const { stream: streamB, socket: socketB } = await createBridgeStream(wsURL);
    openSockets.push(socketB);
    createConnection(streamB);

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const pidsAfterB = server.getACPBridgePIDs();
    expect(pidsAfterB).toHaveLength(2);

    const pidB = pidsAfterB.find((pid) => pid !== pidA)!;
    expect(pidA).not.toBe(pidB);
    expect(isPIDRunning(pidA)).toBe(true);
    expect(isPIDRunning(pidB)).toBe(true);

    // Close client A
    socketA.close();
    await new Promise<void>((resolve) => socketA.once("close", resolve));

    // Wait for PID A to exit
    await vi.waitFor(() => {
      expect(isPIDRunning(pidA)).toBe(false);
    }, { timeout: 30_000 });
    expect(isPIDRunning(pidB)).toBe(true);

    // Close client B
    socketB.close();
    await new Promise<void>((resolve) => socketB.once("close", resolve));

    await vi.waitFor(() => {
      expect(isPIDRunning(pidB)).toBe(false);
    }, { timeout: 30_000 });
  }, 180_000);

});

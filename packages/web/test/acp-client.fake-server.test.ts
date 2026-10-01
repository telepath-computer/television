import { describe, expect, it, vi } from "vitest";
import { ACPClient, type ACPClientStatus, type ACPMappedSessionStore } from "../src/services/acp-client.ts";
import { createFakeACPBridge } from "./fakes/fake-acp-bridge.ts";

async function waitFor<T>(label: string, timeoutMs: number, fn: () => T | null): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = fn();
    if (result !== null) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function createMemoryMappedSessionStore(initialEntries: Record<string, string> = {}): ACPMappedSessionStore & { entries: Map<string, string> } {
  const entries = new Map(Object.entries(initialEntries));
  return {
    entries,
    getActualSessionId(logicalSessionKey: string) {
      return entries.get(logicalSessionKey) ?? null;
    },
    setActualSessionId(logicalSessionKey: string, actualSessionId: string) {
      entries.set(logicalSessionKey, actualSessionId);
    },
    clearActualSessionId(logicalSessionKey: string) {
      entries.delete(logicalSessionKey);
    },
  };
}

function transcriptText(client: Pick<ACPClient, "messages">): string {
  return client.messages.map((message) => message.text).join("\n");
}

describe("ACPClient fake ACP server", () => {
  it("publishes the direct status/messages surface and surgical events", async () => {
    const bridge = createFakeACPBridge({
      bridgeMetadata: {
        agent: "hermes",
        sessionIdStrategy: "mapped",
        sessionCwd: "/tmp/fake-project",
        tvArgs: ["--home", "/tmp/fake-television-home"],
      },
      promptSequence: [{ type: "assistant", text: "Hello from fake ACP." }],
    });

    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
    });
    service.setChannelContext({ channelID: "01METADATA", channelName: "Metadata" });

    const observedStatuses: ACPClientStatus[] = [];
    let messagesChanged = 0;
    let legacyChangeEvents = 0;
    const recordStatus = () => observedStatuses.push(service.status);
    const recordMessages = () => {
      messagesChanged += 1;
    };
    const legacyListenerTarget = service as unknown as {
      addEventListener(type: string, listener: () => void): void;
    };
    service.addEventListener("status-changed", recordStatus);
    service.addEventListener("messages-changed", recordMessages);
    legacyListenerTarget.addEventListener("change", () => {
      legacyChangeEvents += 1;
    });

    expect(service.status).toBe("disconnected");
    expect(service.messages).toEqual([]);

    await service.connect();

    expect(service.status).toBe("ready");
    expect(observedStatuses).toEqual(["ready"]);
    expect(messagesChanged).toBe(0);
    expect(legacyChangeEvents).toBe(0);

    await service.sendMessage({ text: "/version" });

    expect(service.status).toBe("ready");
    expect(service.messages).toHaveLength(2);
    expect(observedStatuses).toEqual(["ready", "running", "ready"]);
    expect(messagesChanged).toBeGreaterThan(0);
    expect(legacyChangeEvents).toBe(0);

    await service.dispose();

    expect(service.status).toBe("disposed");
    expect(observedStatuses).toEqual(["ready", "running", "ready", "disposed"]);
    expect(legacyChangeEvents).toBe(0);
  });

  it("logs the Hermes current model reported by ACP session setup", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const bridge = createFakeACPBridge({
      bridgeMetadata: {
        agent: "hermes",
        sessionIdStrategy: "mapped",
        sessionCwd: "/tmp/fake-project",
        tvArgs: ["--home", "/tmp/fake-television-home"],
      },
      models: {
        currentModelId: "openai-codex:gpt-5.3-codex-spark",
        availableModels: [
          {
            modelId: "openai-codex:gpt-5.3-codex-spark",
            name: "gpt-5.3-codex-spark",
            description: "Provider: OpenAI Codex • current",
          },
        ],
      },
    });

    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
    });
    service.setChannelContext({ channelID: "01MODEL", channelName: "Model" });

    try {
      await service.connect();

      expect(info).toHaveBeenCalledWith(
        "[ACPClient] Current model:",
        "gpt-5.3-codex-spark",
        "(openai-codex:gpt-5.3-codex-spark)",
      );
    } finally {
      info.mockRestore();
    }
  });

  it("creates and stores a Hermes mapped session directly on first run", async () => {
    const mappedSessionStore = createMemoryMappedSessionStore();
    const bridge = createFakeACPBridge({
      bridgeMetadata: {
        agent: "hermes",
        sessionIdStrategy: "mapped",
        sessionCwd: "/tmp/fake-project",
        tvArgs: ["--home", "/tmp/fake-television-home"],
      },
      loadMissingBehavior: "empty",
      newSessionIds: ["hermes-uuid-1"],
      promptSequence: [{ type: "assistant", text: "Hermes version" }],
    });

    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
      mappedSessionStore,
    });
    service.setChannelContext({ channelID: "01HERMES", channelName: "Hermes" });

    await service.connect();
    await service.sendMessage({ text: "/version" });

    expect(bridge.requests.loadSession).toHaveLength(0);
    expect(bridge.requests.newSession).toHaveLength(1);
    expect(bridge.requests.newSession[0]?._meta).toMatchObject({
      sessionKey: "agent:main:television-default-client",
    });
    expect(bridge.requests.newSession[0]?.cwd).toBe("/tmp/fake-project");
    expect(mappedSessionStore.getActualSessionId("agent:main:television-default-client")).toBe("hermes-uuid-1");
    expect(bridge.requests.prompt[0]?.sessionId).toBe("hermes-uuid-1");
  });

  it("loads a persisted Hermes mapped session from a new client instance", async () => {
    const mappedSessionStore = createMemoryMappedSessionStore();
    const bridge = createFakeACPBridge({
      bridgeMetadata: {
        agent: "hermes",
        sessionIdStrategy: "mapped",
        sessionCwd: "/tmp/fake-project",
        tvArgs: ["--home", "/tmp/fake-television-home"],
      },
      newSessionIds: ["hermes-uuid-1"],
      promptSequence: [{ type: "assistant", text: "Hermes version" }],
    });

    const first = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
      mappedSessionStore,
    });
    first.setChannelContext({ channelID: "01HERMES", channelName: "Hermes" });
    await first.connect();
    first.dispose();

    const second = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
      mappedSessionStore,
    });
    second.setChannelContext({ channelID: "01HERMES", channelName: "Hermes" });
    await second.connect();
    await second.sendMessage({ text: "/version" });

    expect(bridge.requests.newSession).toHaveLength(1);
    expect(bridge.requests.loadSession.at(-1)?.sessionId).toBe("hermes-uuid-1");
    expect(bridge.requests.loadSession.at(-1)?.cwd).toBe("/tmp/fake-project");
    expect(bridge.requests.prompt.at(-1)?.sessionId).toBe("hermes-uuid-1");
    expect(second.messages).toHaveLength(2);
  });

  it("replaces a stale Hermes mapped session when load throws", async () => {
    const mappedSessionStore = createMemoryMappedSessionStore({
      "agent:main:television-default-client": "stale-hermes-uuid",
    });
    const bridge = createFakeACPBridge({
      bridgeMetadata: {
        agent: "hermes",
        sessionIdStrategy: "mapped",
        sessionCwd: "/tmp/fake-project",
        tvArgs: ["--home", "/tmp/fake-television-home"],
      },
      newSessionIds: ["replacement-hermes-uuid"],
    });

    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
      mappedSessionStore,
    });
    service.setChannelContext({ channelID: "01STALE", channelName: "Stale" });

    await service.connect();
    await service.sendMessage({ text: "/version" });

    expect(bridge.requests.loadSession[0]?.sessionId).toBe("stale-hermes-uuid");
    expect(bridge.requests.loadSession[0]?.cwd).toBe("/tmp/fake-project");
    expect(bridge.requests.newSession[0]?.cwd).toBe("/tmp/fake-project");
    expect(mappedSessionStore.getActualSessionId("agent:main:television-default-client")).toBe("replacement-hermes-uuid");
    expect(bridge.requests.prompt[0]?.sessionId).toBe("replacement-hermes-uuid");
  });

  it("replaces a stale Hermes mapped session when load returns an empty Hermes response", async () => {
    const mappedSessionStore = createMemoryMappedSessionStore({
      "agent:main:television-default-client": "missing-hermes-uuid",
    });
    const bridge = createFakeACPBridge({
      bridgeMetadata: {
        agent: "hermes",
        sessionIdStrategy: "mapped",
        sessionCwd: "/tmp/fake-project",
        tvArgs: ["--home", "/tmp/fake-television-home"],
      },
      loadMissingBehavior: "empty",
      newSessionIds: ["replacement-hermes-uuid"],
    });

    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
      mappedSessionStore,
    });
    service.setChannelContext({ channelID: "01EMPTY", channelName: "Empty" });

    await service.connect();
    await service.sendMessage({ text: "/version" });

    expect(bridge.requests.loadSession[0]?.sessionId).toBe("missing-hermes-uuid");
    expect(bridge.requests.loadSession[0]?.cwd).toBe("/tmp/fake-project");
    expect(bridge.requests.newSession[0]?.cwd).toBe("/tmp/fake-project");
    expect(mappedSessionStore.getActualSessionId("agent:main:television-default-client")).toBe("replacement-hermes-uuid");
    expect(bridge.requests.prompt[0]?.sessionId).toBe("replacement-hermes-uuid");
  });

  it("tracks tool calls and splits assistant messages around them", async () => {
    const bridge = createFakeACPBridge({
      promptSequence: [
        { type: "assistant", text: "I will inspect the file. " },
        {
          type: "tool_start",
          toolCallId: "tool-1",
          title: "Read file: fixtures/acp-read-input.md",
          toolKind: "read",
          text: "Preparing to read /fixtures/acp-read-input.md...",
          locations: [{ path: "/fixtures/acp-read-input.md", line: 1 }],
        },
        {
          type: "tool_update",
          toolCallId: "tool-1",
          status: "in_progress",
          text: "Reading /fixtures/acp-read-input.md...",
        },
        {
          type: "tool_update",
          toolCallId: "tool-1",
          status: "completed",
          text: "Found # ACP read fixture",
          locations: [{ path: "/fixtures/acp-read-input.md", line: 1 }],
        },
        { type: "assistant", text: "The first line is # ACP Client." },
      ],
    });

    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
    });

    service.setChannelContext({
      channelID: "01FAKESCREEN",
      channelName: "Fake",
    });

    await service.connect();
    await service.sendMessage({ text: "What is in the file?" });

    expect(service.status).toBe("ready");
    expect(service.messages).toHaveLength(4);

    const [user, firstAssistant, toolCall, secondAssistant] = service.messages;

    expect(user).toMatchObject({ kind: "user", text: "What is in the file?", status: "final" });
    expect(firstAssistant).toMatchObject({
      kind: "assistant",
      text: "I will inspect the file. ",
      status: "final",
    });
    expect(toolCall).toMatchObject({
      kind: "tool_call",
      toolCallId: "tool-1",
      title: "Read file: fixtures/acp-read-input.md",
      toolKind: "read",
      status: "completed",
      text: "Preparing to read /fixtures/acp-read-input.md...Reading /fixtures/acp-read-input.md...Found # ACP read fixture",
      locations: [{ path: "/fixtures/acp-read-input.md", line: 1 }],
    });
    expect(secondAssistant).toMatchObject({
      kind: "assistant",
      text: "The first line is # ACP Client.",
      status: "final",
    });
  });

  it.skip("moves to disconnected when the bridge drops during a running prompt", async () => {
    // TODO(TV-186): Fake bridge can still emit prompt chunks after the ACPClient stream controller closes,
    // causing a post-test unhandled rejection in Vitest (`Controller is already closed`).
    const bridge = createFakeACPBridge({
      promptSequence: [{ type: "pause", ms: 250 }, { type: "assistant", text: "Still working..." }],
    });

    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
    });
    service.setChannelContext({ channelID: "01DISCONNECT", channelName: "Disconnect" });

    await service.connect();
    const sendPromise = service.sendMessage({ text: "Keep going" });

    await waitFor("run to start", 5_000, () => service.status === "running" ? true : null);
    bridge.disconnectAll();
    await expect(sendPromise).rejects.toThrow();

    await waitFor("disconnected lifecycle", 5_000, () => service.status === "disconnected" ? true : null);
  });

  it("sendMessage while running cancels the in-flight prompt and then sends", async () => {
    const bridge = createFakeACPBridge({
      promptSequence: [{ type: "pause", ms: 250 }, { type: "assistant", text: "Still working..." }],
    });

    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
    });
    service.setChannelContext({ channelID: "01QUEUE", channelName: "Queue" });

    const observedStatuses: ACPClientStatus[] = [];
    service.addEventListener("status-changed", () => {
      observedStatuses.push(service.status);
    });

    await service.connect();

    const firstSend = service.sendMessage({ text: "Keep going" });
    await waitFor("run to start", 5_000, () => service.status === "running" ? true : null);

    await expect(service.sendMessage({ text: "New text" })).resolves.toBeUndefined();
    await firstSend;

    expect(bridge.requests.cancel).toHaveLength(1);
    expect(observedStatuses).toEqual([
      "ready",
      "running",
      "cancelling",
      "ready",
      "running",
      "ready",
    ]);
    expect(
      service.messages.some((message) => message.kind === "user" && message.text === "New text"),
    ).toBe(true);
  });

  it("can reconnect from disconnected and replay history", async () => {
    const bridge = createFakeACPBridge({
      promptSequence: [{ type: "assistant", text: "Recovered response." }],
    });

    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
    });
    service.setChannelContext({ channelID: "01RECONNECT", channelName: "Reconnect" });

    await service.connect();
    await service.sendMessage({ text: "Hello" });
    bridge.disconnectAll();

    await waitFor("service disconnected", 5_000, () => service.status === "disconnected" ? true : null);
    await service.connect();

    await waitFor("service ready again", 5_000, () => service.status === "ready" ? true : null);

    const transcript = transcriptText(service);
    expect(transcript).toContain("Hello");
    expect(transcript).toContain("Recovered response.");
  });

  it("strips Television channel context from replayed user history split across chunks", async () => {
    const sessionKey = "agent:main:television-default-client";
    const bridge = createFakeACPBridge({
      sessionHistoryByKey: {
        [sessionKey]: [
          {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "[Television channel context]\nThis chat session is coming from a Television client in the channel below.\n" },
          },
          {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "channel_id: 01FAKESCREEN\nchannel_name: Fake\n" },
          },
          {
            sessionUpdate: "user_message_chunk",
            content: {
              type: "text",
              text: "When the user asks to inspect or change Television state with the tv CLI, use this channel ID with the --channel argument.\n[/Television channel context]\n",
            },
          },
          {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "Actual user text" },
          },
        ],
      },
    });

    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
      sessionMode: "single_session",
    });
    service.setChannelContext({ channelID: "01FAKESCREEN", channelName: "Fake" });

    await service.connect();

    const transcript = transcriptText(service);

    expect(transcript).not.toContain("[Television channel context]");
    expect(transcript).toContain("Actual user text");
  });

  it("returns to disconnected when reconnect fails", async () => {
    const bridge = createFakeACPBridge({});

    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
    });
    service.setChannelContext({ channelID: "01FAIL", channelName: "Fail" });

    await service.connect();
    bridge.disconnectAll();
    await waitFor("service disconnected", 5_000, () => service.status === "disconnected" ? true : null);

    bridge.setAcceptConnections(false);
    await expect(service.connect()).rejects.toThrow();
    expect(service.status).toBe("disconnected");
  });

  it("does not inject the Television skill note on a generic first prompt when channel context is null", async () => {
    const bridge = createFakeACPBridge({});
    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
    });
    // No setChannelContext call — equivalent to home / null context.

    await service.connect();
    await service.sendMessage({ text: "hello from home" });

    const prompt = bridge.requests.prompt[0];
    const text = prompt?.prompt?.map((block) => (block as { text?: string }).text ?? "").join("");
    expect(text).toBe("hello from home");
  });

  it("injects the Television skill note on the first Television-related prompt when channel context is null", async () => {
    const bridge = createFakeACPBridge({});
    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
    });
    // No setChannelContext call — equivalent to home / null context.

    await service.connect();
    await service.sendMessage({ text: "tv status for the active artifact layout" });

    const prompt = bridge.requests.prompt[0];
    const text = prompt?.prompt?.map((block) => (block as { text?: string }).text ?? "").join("");
    expect(text).toContain("tv status for the active artifact layout");
    expect(text).toContain("[Television channel context]");
    expect(text).toContain("Using Television requires the knowledge in the `television` skill.");
    expect(text).toContain("Re-read it only if it is not already in context or you know it changed.");
    expect(text).toContain("tv skills install <your agent skills path>");
    expect(text).toContain("There is currently no active Television channel.");
    expect(text).not.toContain("channel_id:");
  });

  // proofs/arch/cli/index.md#^cli-acp-home-context-client
  it("puts the tv arguments from the bridge's ready metadata in every Television context block", async () => {
    const connectClient = async (tvArgs: string[], channel: { channelID: string; channelName: string } | null) => {
      const bridge = createFakeACPBridge({
        bridgeMetadata: { agent: "openclaw", sessionIdStrategy: "deterministic", sessionCwd: "/", tvArgs },
      });
      const service = new ACPClient({
        serverURL: "http://fake.local",
        token: "fake-token",
        enabled: true,
        createSocket: bridge.createSocket,
      });
      if (channel) service.setChannelContext(channel);
      await service.connect();
      return { bridge, service };
    };
    const firstContextBlock = (bridge: ReturnType<typeof createFakeACPBridge>): string => {
      const text = bridge.requests.prompt[0]?.prompt?.map((block) => (block as { text?: string }).text ?? "").join("") ?? "";
      const end = text.indexOf("[/Television channel context]");
      expect(text.startsWith("[Television channel context]") && end > 0, text).toBe(true);
      return text.slice(0, end);
    };

    const attached = await connectClient(["--home", "/srv/tv-home", "--port", "41234"], { channelID: "01HOMECONTEXT", channelName: "Home context" });
    await attached.service.sendMessage({ text: "first message" });
    const attachedBlock = firstContextBlock(attached.bridge);
    expect(attachedBlock).toContain("channel_id: 01HOMECONTEXT");
    expect(attachedBlock).toContain("--home /srv/tv-home --port 41234");
    await attached.service.dispose();

    const unattached = await connectClient(["--home", "/srv/tv-home", "--port", "41234"], null);
    await unattached.service.sendMessage({ text: "tv status for the active artifact layout" });
    const unattachedBlock = firstContextBlock(unattached.bridge);
    expect(unattachedBlock).toContain("There is currently no active Television channel.");
    expect(unattachedBlock).toContain("--home /srv/tv-home --port 41234");
    await unattached.service.dispose();

    const portless = await connectClient(["--home", "/srv/Television Home"], { channelID: "01PORTLESS", channelName: "Portless" });
    await portless.service.sendMessage({ text: "first message" });
    const portlessBlock = firstContextBlock(portless.bridge);
    expect(portlessBlock).toContain("--home '/srv/Television Home'");
    expect(portlessBlock).not.toContain("--port");
    await portless.service.dispose();
  });

  it("clears channel-specific injection state when channel context is set to null after a prior channel", async () => {
    const bridge = createFakeACPBridge({});
    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
    });
    service.setChannelContext({ channelID: "01PRIOR", channelName: "Prior" });
    await service.connect();
    await service.sendMessage({ text: "first message" });

    service.setChannelContext(null);
    await service.sendMessage({ text: "from home" });

    const second = bridge.requests.prompt[1];
    const text = second?.prompt?.map((block) => (block as { text?: string }).text ?? "").join("");
    expect(text).toContain("from home");
    expect(text).not.toContain("[Television channel context]");
  });

  it("injects the Television skill note again on the first prompt after a session load", async () => {
    const bridge = createFakeACPBridge({});
    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
    });
    service.setChannelContext({ channelID: "01RELOAD", channelName: "Reload" });

    await service.connect();
    await service.sendMessage({ text: "before reconnect" });
    bridge.disconnectAll();
    await waitFor("service disconnected", 5_000, () => service.status === "disconnected" ? true : null);

    await service.connect();
    await service.sendMessage({ text: "after reconnect" });

    const second = bridge.requests.prompt[1];
    const text = second?.prompt?.map((block) => (block as { text?: string }).text ?? "").join("");
    expect(text).toContain("after reconnect");
    expect(text).toContain("Using Television requires the knowledge in the `television` skill.");
    expect(text).toContain("Re-read it only if it is not already in context or you know it changed.");
    expect(text).toContain("tv skills install <your agent skills path>");
    expect(text).toContain("channel_id: 01RELOAD");
  });

  it("supports explicit dispose", async () => {
    const bridge = createFakeACPBridge({});

    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
    });
    service.setChannelContext({ channelID: "01DISPOSE", channelName: "Dispose" });

    await service.connect();
    await service.dispose();

    expect(service.status).toBe("disposed");
    await expect(service.connect()).rejects.toThrow();
  });

  it("preserves enabled and setEnabled without auto-reconnecting on re-enable", async () => {
    const bridge = createFakeACPBridge({});
    const socketURLs: string[] = [];
    const observedStatuses: ACPClientStatus[] = [];
    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: (url) => {
        socketURLs.push(url);
        return bridge.createSocket();
      },
    });
    service.setChannelContext({ channelID: "01ENABLED", channelName: "Enabled" });
    service.addEventListener("status-changed", () => {
      observedStatuses.push(service.status);
    });

    await service.connect();
    expect(service.enabled).toBe(true);
    expect(service.status).toBe("ready");
    expect(socketURLs).toHaveLength(1);

    service.setEnabled(false);
    expect(service.enabled).toBe(false);
    expect(service.status).toBe("disconnected");
    expect(socketURLs).toHaveLength(1);

    service.setEnabled(true);
    expect(service.enabled).toBe(true);
    expect(service.status).toBe("disconnected");
    expect(socketURLs).toHaveLength(1);

    await service.connect();
    expect(service.status).toBe("ready");
    expect(socketURLs).toHaveLength(2);
    expect(observedStatuses).toEqual(["ready", "disconnected", "ready"]);
  });

  it("treats cancel() as a no-op when no run is active", async () => {
    const bridge = createFakeACPBridge({});
    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
    });
    service.setChannelContext({ channelID: "01CANCEL", channelName: "Cancel" });

    await service.connect();
    expect(service.status).toBe("ready");

    await expect(service.cancel()).resolves.toBeUndefined();
    expect(service.status).toBe("ready");
    expect(service.messages).toEqual([]);
  });

  it("creates a fresh deterministic session key and clears transcript state on startNewSession()", async () => {
    const bridge = createFakeACPBridge({
      bridgeMetadata: {
        agent: "openclaw",
        sessionIdStrategy: "deterministic",
        sessionCwd: "/tmp/fake-project",
        tvArgs: ["--home", "/tmp/fake-television-home"],
      },
      promptSequence: [{ type: "assistant", text: "Deterministic hello." }],
    });
    const service = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      createSocket: bridge.createSocket,
    });
    service.setChannelContext({ channelID: "01DETERMINISTIC", channelName: "Deterministic" });

    await service.connect();
    await service.sendMessage({ text: "first deterministic turn" });

    expect(service.status).toBe("ready");
    expect(transcriptText(service)).toContain("first deterministic turn");
    expect(bridge.requests.newSession[0]?._meta).toMatchObject({
      sessionKey: "agent:main:television-default-client",
    });
    expect(bridge.requests.prompt[0]?.sessionId).toBe("agent:main:television-default-client");

    await expect(service.startNewSession()).resolves.toBeUndefined();

    expect(service.status).toBe("ready");
    expect(service.messages).toEqual([]);

    await service.sendMessage({ text: "/version" });

    expect(bridge.requests.newSession[1]?._meta).toMatchObject({
      sessionKey: "agent:main:television-default-client:epoch-1",
    });
    expect(bridge.requests.prompt[1]?.sessionId).toBe("agent:main:television-default-client:epoch-1");
    expect(transcriptText(service)).not.toContain("first deterministic turn");
    expect(transcriptText(service)).toContain("/version");
  });
});

describe("ACPClient mapped session persistence", () => {
  it("persists mapped Hermes sessions in single-session mode keyed by client GUID", async () => {
    const store = createMemoryMappedSessionStore();
    const bridge = createFakeACPBridge({
      bridgeMetadata: {
        agent: "hermes",
        sessionIdStrategy: "mapped",
        sessionCwd: "/tmp/fake-project",
        tvArgs: ["--home", "/tmp/fake-television-home"],
      },
      newSessionIds: ["single-hermes-uuid"],
    });
    const client = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      sessionMode: "single_session",
      createSocket: bridge.createSocket,
      clientGUID: "CLIENT-GUID",
      mappedSessionStore: store,
    });
    client.setChannelContext({ channelID: "01A", channelName: "A" });

    await client.connect();

    expect(bridge.requests.newSession[0]?._meta).toMatchObject({
      sessionKey: "agent:main:television-client-guid",
    });
    expect(store.entries.get("agent:main:television-client-guid")).toBe("single-hermes-uuid");
  });

  it("persists mapped Hermes sessions in per-channel mode keyed by lowercased channel", async () => {
    const store = createMemoryMappedSessionStore();
    const bridge = createFakeACPBridge({
      bridgeMetadata: {
        agent: "hermes",
        sessionIdStrategy: "mapped",
        sessionCwd: "/tmp/fake-project",
        tvArgs: ["--home", "/tmp/fake-television-home"],
      },
      newSessionIds: ["screen-hermes-uuid"],
    });
    const client = new ACPClient({
      serverURL: "http://fake.local",
      token: "fake-token",
      enabled: true,
      sessionMode: "per_channel_session",
      createSocket: bridge.createSocket,
      clientGUID: "CLIENT-GUID",
      mappedSessionStore: store,
    });
    client.setChannelContext({ channelID: "01ABCDEF", channelName: "A" });

    await client.connect();

    expect(bridge.requests.newSession[0]?._meta).toMatchObject({
      sessionKey: "agent:main:television-client-guid-01abcdef",
    });
    expect(store.entries.get("agent:main:television-client-guid-01abcdef"))
      .toBe("screen-hermes-uuid");
  });
});

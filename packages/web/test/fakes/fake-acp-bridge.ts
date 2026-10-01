import type { ACPBridgeReadyMetadata } from "@telepath-computer/television-shared";
import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  type Agent,
  type AuthenticateRequest,
  type AuthenticateResponse,
  type AnyMessage,
  type CancelNotification,
  type InitializeRequest,
  type InitializeResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type SessionNotification,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  ndJsonStream,
} from "@agentclientprotocol/sdk";

type Listener = (event: unknown) => void;

type FakeSocketEventMap = {
  open: Set<Listener>;
  message: Set<Listener>;
  close: Set<Listener>;
  error: Set<Listener>;
};

type FakeSocketSide = {
  readyState: number;
  listeners: FakeSocketEventMap;
  peer: FakeSocketSide | null;
};

export type FakeACPScenario = {
  bridgeMetadata?: ACPBridgeReadyMetadata;
  loadMissingBehavior?: "throw" | "empty" | "null";
  newSessionIds?: string[];
  models?: NonNullable<NewSessionResponse["models"]>;
  promptSequence?: PromptStep[];
  sessionHistoryByKey?: Record<string, SessionNotification["update"][]>;
};

export type PromptStep =
  | { type: "assistant"; text: string }
  | { type: "user_history_chunk"; text: string }
  | { type: "pause"; ms: number }
  | {
      type: "tool_start";
      toolCallId: string;
      title: string;
      toolKind: "read" | "edit" | "delete" | "move" | "search" | "execute" | "fetch" | "other";
      text?: string;
      locations?: Array<{ path: string; line?: number }>;
    }
  | {
      type: "tool_update";
      toolCallId: string;
      status: "in_progress" | "completed" | "failed";
      text?: string;
      locations?: Array<{ path: string; line?: number }>;
    };

type SessionRecord = {
  sessionId: string;
  config: Record<string, string>;
  history: SessionNotification["update"][];
};

export function createFakeACPBridge(scenario: FakeACPScenario) {
  const bridgeMetadata = scenario.bridgeMetadata ?? {
    agent: "openclaw",
    sessionIdStrategy: "deterministic",
    sessionCwd: "/",
    tvArgs: ["--home", "/television-home"],
  } satisfies ACPBridgeReadyMetadata;
  const requests = {
    loadSession: [] as LoadSessionRequest[],
    newSession: [] as NewSessionRequest[],
    setSessionConfigOption: [] as SetSessionConfigOptionRequest[],
    prompt: [] as PromptRequest[],
    cancel: [] as CancelNotification[],
  };
  let nextNewSessionIdIndex = 0;
  const sockets = new Set<FakeSocketSide>();
  const sessions = new Map<string, SessionRecord>(
    Object.entries(scenario.sessionHistoryByKey ?? {}).map(([sessionId, history]) => [
      sessionId,
      { sessionId, config: {}, history: [...history] },
    ]),
  );
  let acceptConnections = true;

  class FakeAgent implements Agent {
    private readonly conn: AgentSideConnection;
    private readonly sessions: Map<string, SessionRecord>;

    constructor(conn: AgentSideConnection, sessionsRef: Map<string, SessionRecord>) {
      this.conn = conn;
      this.sessions = sessionsRef;
    }

    async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: true,
        },
        agentInfo: {
          name: "fake-openclaw-acp",
          version: "0.0.0",
        },
        authMethods: [],
      };
    }

    async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
      return {};
    }

    async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
      requests.newSession.push(params);
      const sessionKey = getSessionKey(params);
      const generatedSessionId = scenario.newSessionIds?.[nextNewSessionIdIndex++];
      const sessionId = generatedSessionId
        ?? (bridgeMetadata.sessionIdStrategy === "mapped" ? `fake-session-${crypto.randomUUID()}` : sessionKey);
      this.sessions.set(sessionId, {
        sessionId,
        config: {},
        history: [],
      });
      return {
        sessionId,
        ...(scenario.models ? { models: scenario.models } : {}),
      };
    }

    async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
      requests.loadSession.push(params);
      if (!this.sessions.has(params.sessionId)) {
        if (scenario.loadMissingBehavior === "empty") {
          return {};
        }
        if (scenario.loadMissingBehavior === "null") {
          return null as unknown as LoadSessionResponse;
        }
        throw new Error(`Unknown session: ${params.sessionId}`);
      }
      const session = this.sessions.get(params.sessionId)!;
      for (const update of session.history) {
        await this.conn.sessionUpdate({
          sessionId: params.sessionId,
          update,
        });
      }
      return {
        configOptions: [],
        ...(scenario.models ? { models: scenario.models } : {}),
      };
    }

    async setSessionConfigOption(
      params: SetSessionConfigOptionRequest,
    ): Promise<SetSessionConfigOptionResponse> {
      requests.setSessionConfigOption.push(params);
      const session = this.sessions.get(params.sessionId);
      if (!session) {
        throw new Error(`Unknown session: ${params.sessionId}`);
      }
      session.config[params.configId] = String(params.value);
      return { configOptions: [] };
    }

    async prompt(params: PromptRequest): Promise<PromptResponse> {
      requests.prompt.push(params);
      const session = sessions.get(params.sessionId);
      if (!session) {
        throw new Error(`Unknown session: ${params.sessionId}`);
      }

      const userText = params.prompt
        .flatMap((content) => content.type === "text" ? [content.text] : [])
        .join("");
      if (userText) {
        const update: SessionNotification["update"] = {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: userText },
        };
        session.history.push(update);
      }

      const steps = scenario.promptSequence ?? [
        { type: "assistant", text: "Hello from fake ACP." },
      ];

      for (const step of steps) {
        switch (step.type) {
          case "user_history_chunk":
            {
              const update: SessionNotification["update"] = {
                sessionUpdate: "user_message_chunk",
                content: { type: "text", text: step.text },
              };
              session.history.push(update);
              await this.conn.sessionUpdate({
                sessionId: params.sessionId,
                update,
              });
            }
            break;
          case "pause":
            await new Promise((resolve) => setTimeout(resolve, step.ms));
            break;
          case "assistant":
            {
              const update: SessionNotification["update"] = {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: step.text },
              };
              session.history.push(update);
              await this.conn.sessionUpdate({
                sessionId: params.sessionId,
                update,
              });
            }
            break;
          case "tool_start":
            {
              const update: SessionNotification["update"] = {
                sessionUpdate: "tool_call",
                toolCallId: step.toolCallId,
                title: step.title,
                status: "in_progress",
                kind: step.toolKind,
                ...(step.text
                  ? {
                      content: [
                        {
                          type: "content",
                          content: {
                            type: "text",
                            text: step.text,
                          },
                        },
                      ],
                    }
                  : {}),
                ...(step.locations ? { locations: step.locations } : {}),
              };
              session.history.push(update);
              await this.conn.sessionUpdate({ sessionId: params.sessionId, update });
            }
            break;
          case "tool_update":
            {
              const update: SessionNotification["update"] = {
                sessionUpdate: "tool_call_update",
                toolCallId: step.toolCallId,
                status: step.status,
                ...(step.text
                  ? {
                      content: [
                        {
                          type: "content",
                          content: {
                            type: "text",
                            text: step.text,
                          },
                        },
                      ],
                    }
                  : {}),
                ...(step.locations ? { locations: step.locations } : {}),
              };
              session.history.push(update);
              await this.conn.sessionUpdate({ sessionId: params.sessionId, update });
            }
            break;
        }
      }

      return { stopReason: "end_turn" };
    }

    async cancel(params: CancelNotification): Promise<void> {
      requests.cancel.push(params);
      return;
    }
  }

  return {
    requests,
    setAcceptConnections(value: boolean) {
      acceptConnections = value;
    },
    disconnectAll() {
      for (const socket of sockets) {
        socket.readyState = 3;
        emit(socket, "close", {});
        if (socket.peer) {
          socket.peer.readyState = 3;
          emit(socket.peer, "close", {});
        }
      }
      sockets.clear();
    },
    createSocket() {
      const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
      const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
      const socket = createLinkedSocketPair();
      const bridgeSide = socket.peer!;
      sockets.add(socket);
      sockets.add(bridgeSide);

      new AgentSideConnection(
        (conn) => new FakeAgent(conn, sessions),
        ndJsonStream(agentToClient.writable, clientToAgent.readable),
      );

      const clientWriter = clientToAgent.writable.getWriter();

      void (async () => {
        const reader = agentToClient.readable.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          const message = decodeJson(value);
          emit(socket, "message", { data: JSON.stringify({ type: "acp-bridge-message", message }) });
        }
      })();

      bridgeSide.listeners.message.add(async (event) => {
        const data = getSocketEventData(event);
        if (!data) {
          return;
        }
        const message = JSON.parse(data) as { type: string; channelID?: string; message?: AnyMessage };
        switch (message.type) {
          case "acp-bridge-connect":
            emit(socket, "message", {
              data: JSON.stringify({
                type: "acp-bridge-status",
                status: "ready",
                ...bridgeMetadata,
              }),
            });
            break;
          case "acp-bridge-message":
            await clientWriter.write(encodeJson(message.message));
            break;
        }
      });

      queueMicrotask(() => {
        if (!acceptConnections) {
          socket.readyState = 3;
          emit(socket, "error", {});
          emit(socket, "close", {});
          return;
        }

        socket.readyState = 1;
        bridgeSide.readyState = 1;
        emit(socket, "open", {});
      });
      return toWebSocketLike(socket);
    },
  };
}

function getSessionKey(params: NewSessionRequest): string {
  const sessionKey = params._meta?.sessionKey;
  return typeof sessionKey === "string" ? sessionKey : `fake-session-${crypto.randomUUID()}`;
}

function createLinkedSocketPair(): FakeSocketSide {
  const a = createSocketSide();
  const b = createSocketSide();
  a.peer = b;
  b.peer = a;
  return a;
}

function createSocketSide(): FakeSocketSide {
  return {
    readyState: 0,
    peer: null,
    listeners: {
      open: new Set(),
      message: new Set(),
      close: new Set(),
      error: new Set(),
    },
  };
}

function toWebSocketLike(socket: FakeSocketSide) {
  return {
    get readyState() {
      return socket.readyState;
    },
    addEventListener(type: string, listener: Listener) {
      socket.listeners[type as keyof FakeSocketEventMap]?.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      socket.listeners[type as keyof FakeSocketEventMap]?.delete(listener);
    },
    send(data: string) {
      emit(socket.peer!, "message", { data });
    },
    close() {
      socket.readyState = 3;
      emit(socket.peer!, "close", {});
    },
  };
}

function emit(socket: FakeSocketSide, type: keyof FakeSocketEventMap, event: unknown) {
  for (const listener of socket.listeners[type]) {
    listener(event);
  }
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

function decodeJson(value: Uint8Array): AnyMessage {
  return JSON.parse(new TextDecoder().decode(value).trim()) as AnyMessage;
}

function getSocketEventData(event: unknown): string | null {
  if (typeof event === "object" && event !== null && "data" in event) {
    const data = (event as { data?: unknown }).data;
    return typeof data === "string" ? data : null;
  }
  return null;
}

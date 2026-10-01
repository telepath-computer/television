import { EventTarget } from "@rupertsworld/event-target";
import {
  type AnyMessage,
  ClientSideConnection,
  PROTOCOL_VERSION,
  type LoadSessionResponse,
  type NewSessionResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type Stream,
  type ToolCallContent,
} from "@agentclientprotocol/sdk";
import { withDisposable } from "@telepath-computer/utils/disposable";
import {
  type ACPBridgeReadyMetadata,
  type ACPClientMessage,
  type AssistantMessage,
  type MessageId,
  type ToolCallMessage,
  type UserMessage,
} from "@telepath-computer/television-shared";
import {
  ACPClientMessagesChangedEvent,
  ACPClientStatusChangedEvent,
} from "../events.ts";

const SENDER_BLOCK_RE =
  /^Sender \(untrusted metadata\):\n```json\n[\s\S]*?\n```\n\n?/;
const WORKING_DIRECTORY_RE = /^\[[^\n]*Working directory:[^\n]*\]\n\n?/;
const CHANNEL_CONTEXT_RE = /\[Television channel context\][\s\S]*?\[\/Television channel context\]\n*/;
const TELEVISION_RELATED_PROMPT_RE = /\b(tv|television|channel|artifact|artifacts|viewer|filmstrip|layout|focus)\b/i;
const SHELL_SAFE_ARGUMENT_RE = /^[A-Za-z0-9_@%+=:,./-]+$/;
const DIRECTIVE_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+|audio_as_voice)\s*\]\]\s*/gi;

type WebSocketLike = {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  send(data: string): void;
  close(): void;
};

export type ACPClientStatus =
  | "disconnected"
  | "ready"
  | "running"
  | "cancelling"
  | "disposed";

export interface UserMessageInput {
  text: string;
}

export interface ACPMappedSessionStore {
  getActualSessionId(logicalSessionKey: string): string | null;
  setActualSessionId(logicalSessionKey: string, actualSessionId: string): void;
  clearActualSessionId(logicalSessionKey: string): void;
}

export interface ACPClientOptions {
  serverURL: string;
  token: string;
  enabled?: boolean;
  clientGUID?: string;
  sessionMode?: ACPSessionMode;
  mappedSessionStore?: ACPMappedSessionStore;
  createSocket?: (url: string) => WebSocketLike;
}

export type ACPSessionMode = "single_session" | "per_channel_session";

export const DEFAULT_ACP_SESSION_MODE: ACPSessionMode = "single_session";

type ChannelContext = {
  channelID: string;
  channelName: string | null;
};

type BridgeStatusMessage = {
  type: "acp-bridge-status";
  status: "launching" | "ready" | "error" | "exited";
  error?: string;
  agent?: unknown;
  sessionIdStrategy?: unknown;
  sessionCwd?: unknown;
  tvArgs?: unknown;
};

type BridgePayloadMessage = {
  type: "acp-bridge-message";
  message: AnyMessage;
};

type BridgeMessage = BridgeStatusMessage | BridgePayloadMessage;

const CLIENT_INFO = { name: "television-acp-client", version: "0.0.0" };
const DEFAULT_SESSION_KEY = "agent:main:television";

type ACPClientEvent = ACPClientStatusChangedEvent | ACPClientMessagesChangedEvent;

const DisposableACPEventTarget = withDisposable(
  EventTarget as abstract new () => EventTarget<ACPClientEvent>,
);

export class ACPClient extends DisposableACPEventTarget {
  #status: ACPClientStatus = "disconnected";
  #disconnectError: string | null = null;
  readonly #messagesById = new Map<MessageId, ACPClientMessage>();
  #connection: ClientSideConnection | null = null;
  #bootstrapPromise: Promise<void> | null = null;
  #sessionReadyPromise: Promise<void> | null = null;
  #sessionReadyKey: string | null = null;
  #sessionId: string | null = null;
  #bridgeMetadata: ACPBridgeReadyMetadata | null = null;
  readonly #mappedSessionStore: ACPMappedSessionStore;
  #activeSessionKey: string | null = null;
  #sessionEpoch = 0;
  #nextMessageId = 1;
  #openAssistantMessageId: MessageId | null = null;
  #channelContext: ChannelContext | null = null;
  #needsChannelContextInjection = false;
  #needsTelevisionSkillReminderInjection = false;
  #replayingHistory = false;
  #replayOpenUserMessageId: MessageId | null = null;
  readonly #injectedChannelContextSessionKeys = new Set<string>();
  readonly #createSocket: (url: string) => WebSocketLike;
  readonly #options: ACPClientOptions;
  readonly #sessionMode: ACPSessionMode;
  readonly #handleBridgeDisconnectBound = (error: Error) => {
    this.#handleBridgeDisconnect(error);
  };
  #socket: WebSocketLike | null = null;

  constructor(options: ACPClientOptions) {
    super();
    this.#options = options;
    this.#sessionMode = options.sessionMode ?? DEFAULT_ACP_SESSION_MODE;
    this.#mappedSessionStore = options.mappedSessionStore ?? createMemoryMappedSessionStore();
    this.#createSocket = options.createSocket ?? ((url) => new WebSocket(url));
  }

  get status(): ACPClientStatus {
    return this.#status;
  }

  get messages(): readonly ACPClientMessage[] {
    return [...this.#messagesById.values()];
  }

  get enabled(): boolean {
    return this.#options.enabled ?? false;
  }

  setToken(token: string | null): void {
    this.#options.token = token ?? "";
  }

  setEnabled(enabled: boolean): void {
    // Note: re-enabling from a previously-disabled state does NOT trigger a
    // reconnect. ACP availability is determined at server start (see
    // /display.acpEnabled) and does not flip dynamically; supporting that
    // would require connection-lifecycle dynamism we don't have today.
    this.#options.enabled = enabled;
    if (!enabled) {
      this.#cleanupConnection();
      this.#disconnectError = null;
      this.#setStatus("disconnected");
    }
  }

  async connect(): Promise<void> {
    if (this.disposed) {
      throw new Error("ACPClient has been disposed");
    }

    if (!this.enabled) {
      return;
    }

    if (this.status !== "disconnected") {
      return;
    }

    if (this.#bootstrapPromise === null) {
      this.#disconnectError = null;
      this.#bootstrapPromise = this.#bootstrapConnection();
    }
    try {
      await this.#bootstrapPromise;
      await this.#ensureSessionReady();
    } catch (error) {
      this.#handleDisconnect(toErrorMessage(error));
      throw error;
    }
  }

  dispose(): void {
    this.#cleanupConnection();
    this.#disconnectError = null;
    this.#setStatus("disposed");
  }

  async sendMessage(input: UserMessageInput): Promise<void> {
    await this.connect();

    if (this.status === "running" || this.status === "cancelling") {
      await this.cancel();
      await this.#waitForStatus("ready");
    }

    if (this.#sessionId === null || this.#activeSessionKey !== this.#requireDesiredSessionKey()) {
      await this.#ensureSessionReady();
    }

    if (this.status !== "ready") {
      throw new Error("ACPClient is not ready to send a new message");
    }

    const text = input.text.trim();
    if (!text) {
      throw new Error("Cannot send an empty message");
    }

    this.#appendMessage({
      id: this.#mintMessageId("user"),
      kind: "user",
      text,
      status: "final",
    });

    this.#setStatus("running");

    try {
      const response = await this.#requireConnection().prompt({
        sessionId: this.#requireSessionId(),
        prompt: [{ type: "text", text: this.#buildPromptText(text) }],
      });
      this.#closeOpenAssistant(response.stopReason === "cancelled" ? "cancelled" : "final");
      this.#setStatus("ready");
    } catch (error) {
      if (this.#isDisconnected()) {
        throw error;
      }
      this.#closeOpenAssistant("error");
      this.#setStatus("ready");
      throw error;
    }
  }

  async startNewSession(): Promise<void> {
    await this.connect();

    if (this.status === "running" || this.status === "cancelling") {
      await this.cancel();
      await this.#waitForStatus("ready");
    }

    const sessionKey = this.#requireDesiredSessionKey();
    if (this.#bridgeMetadata?.sessionIdStrategy === "mapped") {
      this.#mappedSessionStore.clearActualSessionId(sessionKey);
    } else {
      this.#sessionEpoch += 1;
    }

    this.#sessionReadyPromise = null;
    this.#sessionReadyKey = null;
    this.#sessionId = null;
    this.#activeSessionKey = null;
    this.#resetTranscript();
  }

  async cancel(): Promise<void> {
    if (this.status !== "running") {
      return;
    }

    this.#setStatus("cancelling");

    await this.#requireConnection().cancel({ sessionId: this.#requireSessionId() });
  }

  async #waitForStatus(target: ACPClientStatus): Promise<void> {
    if (this.status === target) {
      return;
    }
    if (this.status === "disposed") {
      throw new Error("ACPClient has been disposed");
    }
    if (this.status === "disconnected") {
      throw new Error(this.#disconnectError ?? "ACPClient is disconnected");
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.removeEventListener("status-changed", handleStatusChanged);
      };
      const handleStatusChanged = () => {
        if (this.status === target) {
          cleanup();
          resolve();
          return;
        }
        if (this.status === "disposed") {
          cleanup();
          reject(new Error("ACPClient has been disposed"));
          return;
        }
        if (this.status === "disconnected") {
          cleanup();
          reject(new Error(this.#disconnectError ?? "ACPClient is disconnected"));
        }
      };

      this.addEventListener("status-changed", handleStatusChanged);
    });
  }

  setChannelContext(input: { channelID: string; channelName: string | null } | null): void {
    if (input === null) {
      // No channel context. Drop any pending injection — `#buildPromptText`
      // already short-circuits when `#channelContext` is null, so the next
      // prompt goes through without a channel-context block.
      if (this.#channelContext === null) return;
      this.#channelContext = null;
      this.#needsChannelContextInjection = false;
      return;
    }

    const nextContext: ChannelContext = {
      channelID: input.channelID,
      channelName: input.channelName,
    };

    if (
      this.#channelContext?.channelID === nextContext.channelID
      && this.#channelContext?.channelName === nextContext.channelName
    ) {
      return;
    }

    const previousChannelID = this.#channelContext?.channelID ?? null;
    this.#channelContext = nextContext;

    if (this.#sessionMode === "single_session") {
      if (!this.#activeSessionKey || previousChannelID !== nextContext.channelID) {
        this.#needsChannelContextInjection = true;
      }
      return;
    }

    if (this.#activeSessionKey === this.#makeSessionKey(nextContext.channelID)) {
      return;
    }

    this.#sessionReadyPromise = null;
    this.#sessionReadyKey = null;
    if (this.#connection && this.status === "ready") {
      void this.#ensureSessionReady().catch((error) => {
        this.#handleDisconnect(toErrorMessage(error));
      });
    }
  }

  async #bootstrapConnection(): Promise<void> {
    try {
      const { stream, socket, metadata } = await createACPBridgeStream({
        serverURL: this.#options.serverURL,
        token: this.#options.token,
        createSocket: this.#createSocket,
        onDisconnect: this.#handleBridgeDisconnectBound,
      });
      this.#bridgeMetadata = metadata;
      this.#socket = socket;
      socket.addEventListener("close", this.#handleSocketClose);
      socket.addEventListener("error", this.#handleSocketError);

      this.#connection = new ClientSideConnection(
        (connection) => ({
          connection,
          sessionUpdate: async (params: SessionNotification) => {
            await this.#handleSessionUpdate(params);
          },
          requestPermission: async (params: RequestPermissionRequest) => {
            return this.#rejectPermissionRequest(params);
          },
        }),
        stream,
      );

      await this.#connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: CLIENT_INFO,
      });
    } catch (error) {
      throw error;
    }
  }

  #handleBridgeDisconnect(error: Error): void {
    this.#handleDisconnect(toErrorMessage(error));
  }

  #logSessionModel(response: LoadSessionResponse | NewSessionResponse | null): void {
    const models = response?.models;
    if (!models?.currentModelId) {
      return;
    }

    const current = models.availableModels.find((model) => model.modelId === models.currentModelId);
    console.info(
      "[ACPClient] Current model:",
      current?.name ?? models.currentModelId,
      `(${models.currentModelId})`,
    );
  }

  async #ensureSessionReady(): Promise<void> {
    const sessionKey = this.#requireDesiredSessionKey();

    if (this.#sessionReadyPromise && this.#sessionReadyKey === sessionKey) {
      await this.#sessionReadyPromise;
      return;
    }

    this.#sessionReadyKey = sessionKey;
    this.#sessionReadyPromise = this.#activateSession(sessionKey);
    await this.#sessionReadyPromise;
  }

  async #activateSession(sessionKey: string): Promise<void> {
    const connection = this.#requireConnection();

    this.#resetTranscript();

    let sessionId: string;
    let loadedExistingSession = false;
    let sessionSetupResponse: LoadSessionResponse | NewSessionResponse | null = null;
    const sessionRequest = {
      cwd: this.#requireSessionCwd(),
      mcpServers: [],
      _meta: {
        sessionKey,
      },
    };

    try {
      this.#replayingHistory = true;
      this.#replayOpenUserMessageId = null;

      if (this.#bridgeMetadata?.sessionIdStrategy === "mapped") {
        const mappedSessionId = this.#mappedSessionStore.getActualSessionId(sessionKey);
        if (mappedSessionId) {
          try {
            const response = await connection.loadSession({
              ...sessionRequest,
              sessionId: mappedSessionId,
            });
            if (isEmptyLoadSessionResponse(response)) {
              throw new Error("Mapped ACP session was not found");
            }
            sessionSetupResponse = response;
            sessionId = mappedSessionId;
            loadedExistingSession = true;
          } catch {
            const session = await connection.newSession(sessionRequest);
            sessionSetupResponse = session;
            sessionId = session.sessionId;
            this.#mappedSessionStore.setActualSessionId(sessionKey, sessionId);
            loadedExistingSession = false;
          }
        } else {
          const session = await connection.newSession(sessionRequest);
          sessionSetupResponse = session;
          sessionId = session.sessionId;
          this.#mappedSessionStore.setActualSessionId(sessionKey, sessionId);
          loadedExistingSession = false;
        }
      } else {
        try {
          const response = await connection.loadSession({
            ...sessionRequest,
            sessionId: sessionKey,
          });
          sessionSetupResponse = response;
          sessionId = sessionKey;
          loadedExistingSession = this.#messagesById.size > 0;
        } catch {
          const session = await connection.newSession(sessionRequest);
          sessionSetupResponse = session;
          sessionId = session.sessionId;
          loadedExistingSession = false;
        }
      }
    } finally {
      this.#replayingHistory = false;
      this.#replayOpenUserMessageId = null;
      this.#closeOpenAssistant("final");
    }

    this.#logSessionModel(sessionSetupResponse);

    await connection.setSessionConfigOption({
      sessionId,
      configId: "verbose_level",
      value: "full",
    });

    this.#sessionId = sessionId;
    this.#activeSessionKey = sessionKey;

    this.#needsTelevisionSkillReminderInjection = true;
    if (loadedExistingSession) {
      this.#injectedChannelContextSessionKeys.add(sessionKey);
      if (this.#sessionMode === "single_session") {
        this.#needsChannelContextInjection = false;
      }
    } else {
      this.#injectedChannelContextSessionKeys.delete(sessionKey);
      this.#needsChannelContextInjection = this.#sessionMode === "single_session";
    }

    this.#disconnectError = null;
    this.#setStatus("ready");
  }

  async #handleSessionUpdate(notification: SessionNotification): Promise<void> {
    const update = notification.update;

    switch (update.sessionUpdate) {
      case "user_message_chunk":
        if (update.content.type === "text") {
          this.#appendUserText(update.content.text);
        }
        return;
      case "agent_message_chunk":
        if (update.content.type === "text") {
          this.#appendAssistantText(update.content.text);
        }
        return;
      case "tool_call":
        this.#appendToolCall(update);
        return;
      case "tool_call_update":
        this.#updateToolCall(update);
        return;
      case "agent_thought_chunk":
        return;
      default:
        return;
    }
  }

  async #rejectPermissionRequest(
    _params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    return { outcome: { outcome: "cancelled" } };
  }

  #appendAssistantText(chunk: string): void {
    this.#replayOpenUserMessageId = null;
    const normalizedChunk = normalizeAssistantMessageText(chunk);
    if (!normalizedChunk) {
      return;
    }

    if (!this.#openAssistantMessageId) {
      const message: AssistantMessage = {
        id: this.#mintMessageId("assistant"),
        kind: "assistant",
        text: normalizedChunk,
        status: "streaming",
      };
      this.#openAssistantMessageId = message.id;
      this.#appendMessage(message);
      return;
    }

    const message = this.#messagesById.get(this.#openAssistantMessageId);
    if (!message || message.kind !== "assistant") {
      throw new Error("Open assistant message invariant violated");
    }

    this.#replaceMessage({
      ...message,
      text: `${message.text}${normalizedChunk}`,
      status: "streaming",
    });
  }

  #appendToolCall(update: Extract<SessionNotification["update"], { sessionUpdate: "tool_call" }>): void {
    this.#closeOpenAssistant("final");

    const existing = this.#findToolCallMessage(update.toolCallId);
    const initialText = extractToolCallText("content" in update ? update.content : undefined);
    const nextMessage: ToolCallMessage = {
      id: existing?.id ?? this.#mintMessageId("tool"),
      kind: "tool_call",
      toolCallId: update.toolCallId,
      title: update.title,
      toolKind: update.kind ?? "other",
      status: update.status === "failed" ? "failed" : update.status === "completed" ? "completed" : "in_progress",
      text: existing?.text ?? initialText,
      locations: update.locations ?? existing?.locations,
    };

    if (existing) {
      this.#replaceMessage(nextMessage);
      return;
    }

    this.#appendMessage(nextMessage);
  }

  #updateToolCall(update: Extract<SessionNotification["update"], { sessionUpdate: "tool_call_update" }>): void {
    const existing = this.#findToolCallMessage(update.toolCallId);
    const currentText = existing?.text ?? "";
    const appendedText = extractToolCallText(update.content);
    const nextText = appendedText ? `${currentText}${appendedText}` : currentText;

    const nextMessage: ToolCallMessage = {
      id: existing?.id ?? this.#mintMessageId("tool"),
      kind: "tool_call",
      toolCallId: update.toolCallId,
      title: existing?.title ?? update.toolCallId,
      toolKind: existing?.toolKind ?? "other",
      status: update.status === "failed" ? "failed" : update.status === "completed" ? "completed" : "in_progress",
      text: nextText,
      locations: update.locations ?? existing?.locations,
    };

    if (existing) {
      this.#replaceMessage(nextMessage);
      return;
    }

    this.#appendMessage(nextMessage);
  }

  #appendUserText(chunk: string): void {
    this.#closeOpenAssistant("final");
    if (!chunk) {
      return;
    }

    const currentId = this.#replayingHistory ? this.#replayOpenUserMessageId : null;
    if (!currentId) {
      const normalizedChunk = normalizeUserMessageText(chunk);
      if (!normalizedChunk) {
        return;
      }
      const message: UserMessage = {
        id: this.#mintMessageId("user"),
        kind: "user",
        text: normalizedChunk,
        status: "final",
      };
      this.#appendMessage(message);
      if (this.#replayingHistory) {
        this.#replayOpenUserMessageId = message.id;
      }
      return;
    }

    const message = this.#messagesById.get(currentId);
    if (!message || message.kind !== "user") {
      throw new Error("Replay user message invariant violated");
    }

    this.#replaceMessage({
      ...message,
      text: normalizeUserMessageText(`${message.text}${chunk}`),
    });
  }

  #closeOpenAssistant(status: AssistantMessage["status"]): void {
    if (!this.#openAssistantMessageId) {
      return;
    }

    const message = this.#messagesById.get(this.#openAssistantMessageId);
    if (message?.kind === "assistant") {
      this.#replaceMessage({ ...message, status });
    }

    this.#openAssistantMessageId = null;
  }

  #appendMessage(message: ACPClientMessage): void {
    this.#messagesById.set(message.id, message);
    this.dispatchEvent(new ACPClientMessagesChangedEvent("messages-changed"));
  }

  #replaceMessage(message: ACPClientMessage): void {
    this.#messagesById.set(message.id, message);
    this.dispatchEvent(new ACPClientMessagesChangedEvent("messages-changed"));
  }

  #setStatus(next: ACPClientStatus): void {
    if (this.#status === next) {
      return;
    }

    this.#status = next;
    this.dispatchEvent(new ACPClientStatusChangedEvent("status-changed"));
  }

  #buildPromptText(text: string): string {
    const sessionKey = this.#activeSessionKey;
    if (!sessionKey) {
      return text;
    }

    const shouldInjectChannelContext = this.#channelContext
      ? this.#sessionMode === "single_session"
        ? this.#needsChannelContextInjection || !this.#injectedChannelContextSessionKeys.has(sessionKey)
        : !this.#injectedChannelContextSessionKeys.has(sessionKey)
      : false;
    const shouldInjectTelevisionSkillReminder = this.#needsTelevisionSkillReminderInjection
      && (this.#channelContext !== null || TELEVISION_RELATED_PROMPT_RE.test(text));
    const shouldInject = shouldInjectTelevisionSkillReminder || shouldInjectChannelContext;

    if (!shouldInject) {
      return text;
    }

    if (shouldInjectTelevisionSkillReminder) {
      this.#needsTelevisionSkillReminderInjection = false;
    }
    if (shouldInjectChannelContext) {
      this.#needsChannelContextInjection = false;
      this.#injectedChannelContextSessionKeys.add(sessionKey);
    }

    const lines = [
      "[Television channel context]",
      "This chat session is coming from a Television client.",
      "Using Television requires the knowledge in the `television` skill. Re-read it only if it is not already in context or you know it changed.",
      "If the skill is not installed, it can be installed via `tv skills install <your agent skills path>`.",
    ];

    const tvArgs = this.#bridgeMetadata?.tvArgs ?? [];
    if (tvArgs.length > 0) {
      lines.push(`To reach this Television server, add these arguments to each tv command that contacts it: ${tvArgs.map(formatShellArgument).join(" ")}`);
    }

    if (this.#channelContext) {
      lines.push("This conversation is currently attached to the channel below.");
      lines.push(`channel_id: ${this.#channelContext.channelID}`);
      lines.push(`channel_name: ${this.#channelContext.channelName ?? ""}`);
      lines.push("When the user asks to inspect or change Television state with the tv CLI, use this channel ID with the --channel argument.");
    } else {
      lines.push("There is currently no active Television channel.");
    }

    lines.push("[/Television channel context]", "", text);
    return lines.join("\n");
  }

  #mintMessageId(prefix: "user" | "assistant" | "tool"): MessageId {
    const id = `${prefix}-${this.#nextMessageId}`;
    this.#nextMessageId += 1;
    return id;
  }

  #findToolCallMessage(toolCallId: string): ToolCallMessage | null {
    for (const message of this.#messagesById.values()) {
      if (message?.kind === "tool_call" && message.toolCallId === toolCallId) {
        return message;
      }
    }

    return null;
  }

  #requireSessionId(): string {
    if (!this.#sessionId) {
      throw new Error("ACP session is not ready");
    }
    return this.#sessionId;
  }

  #requireConnection(): ClientSideConnection {
    if (!this.#connection) {
      throw new Error("ACP connection is not ready");
    }
    return this.#connection;
  }

  #requireSessionCwd(): string {
    const cwd = this.#bridgeMetadata?.sessionCwd;
    if (!cwd) {
      throw new Error("ACP bridge session cwd is not ready");
    }
    return cwd;
  }

  #requireDesiredSessionKey(): string {
    if (this.#sessionMode === "single_session") {
      return this.#decorateSessionKey(
        `${DEFAULT_SESSION_KEY}-${(this.#options.clientGUID ?? "default-client").toLowerCase()}`,
      );
    }

    const channelID = this.#channelContext?.channelID;
    if (!channelID) {
      throw new Error("Channel context is required for per-channel session mode");
    }

    return this.#makeSessionKey(channelID);
  }

  #makeSessionKey(channelID: string): string {
    return this.#decorateSessionKey(
      getSessionKey(this.#sessionMode, channelID, this.#options.clientGUID ?? "default-client"),
    );
  }

  #decorateSessionKey(baseSessionKey: string): string {
    if (this.#bridgeMetadata?.sessionIdStrategy === "deterministic" && this.#sessionEpoch > 0) {
      return `${baseSessionKey}:epoch-${this.#sessionEpoch}`;
    }
    return baseSessionKey;
  }

  readonly #handleSocketClose = (): void => {
    this.#handleDisconnect("ACP bridge websocket closed");
  };

  readonly #handleSocketError = (): void => {
    this.#handleDisconnect("ACP bridge websocket error");
  };

  #cleanupConnection(): void {
    this.#connection = null;
    this.#bootstrapPromise = null;
    this.#sessionReadyPromise = null;
    this.#sessionReadyKey = null;
    this.#sessionId = null;
    this.#activeSessionKey = null;
    this.#bridgeMetadata = null;

    if (this.#socket) {
      this.#socket.removeEventListener("close", this.#handleSocketClose);
      this.#socket.removeEventListener("error", this.#handleSocketError);
      this.#socket.close();
      this.#socket = null;
    }
  }

  #handleDisconnect(error?: string): void {
    const hasConnectionState = this.#connection !== null
      || this.#bootstrapPromise !== null
      || this.#sessionReadyPromise !== null
      || this.#sessionReadyKey !== null
      || this.#sessionId !== null
      || this.#activeSessionKey !== null
      || this.#bridgeMetadata !== null
      || this.#socket !== null;

    if (this.disposed || (this.status === "disconnected" && !hasConnectionState)) {
      return;
    }

    this.#closeOpenAssistant("error");
    this.#cleanupConnection();
    this.#disconnectError = error ?? null;
    this.#setStatus("disconnected");
  }

  #resetTranscript(): void {
    const hadMessages = this.#messagesById.size > 0;

    this.#openAssistantMessageId = null;
    this.#replayOpenUserMessageId = null;
    this.#nextMessageId = 1;
    this.#messagesById.clear();

    if (hadMessages) {
      this.dispatchEvent(new ACPClientMessagesChangedEvent("messages-changed"));
    }
  }

  #isDisconnected(): boolean {
    return this.status === "disconnected";
  }
}

function createMemoryMappedSessionStore(): ACPMappedSessionStore {
  const entries = new Map<string, string>();
  return {
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

function isEmptyLoadSessionResponse(response: LoadSessionResponse | null | undefined): boolean {
  if (response === null || response === undefined) {
    return true;
  }
  return typeof response === "object" && Object.keys(response).length === 0;
}

function getSessionKey(sessionMode: ACPSessionMode, channelID: string, clientGUID: string): string {
  if (sessionMode === "single_session") {
    return `${DEFAULT_SESSION_KEY}-${clientGUID.toLowerCase()}`;
  }

  return `agent:main:television-${clientGUID.toLowerCase()}-${channelID.toLowerCase()}`;
}

function trimLeadingBlankLines(text: string): string {
  return text.replace(/^(?:\s*\n)+/, "");
}

function normalizeUserMessageText(text: string): string {
  let normalized = text;
  normalized = normalized.replace(SENDER_BLOCK_RE, "");
  normalized = normalized.replace(WORKING_DIRECTORY_RE, "");
  normalized = normalized.replace(CHANNEL_CONTEXT_RE, "");
  normalized = trimLeadingBlankLines(normalized);
  return normalized;
}

function normalizeAssistantMessageText(text: string): string {
  let normalized = text;
  normalized = normalized.replace(DIRECTIVE_TAG_RE, "");
  normalized = trimLeadingBlankLines(normalized);
  return normalized;
}

function extractToolCallText(content: ToolCallContent[] | null | undefined): string {
  if (!content || content.length === 0) {
    return "";
  }

  return content
    .flatMap((entry) => {
      if (entry.type === "content" && entry.content.type === "text") {
        return [entry.content.text];
      }
      return [];
    })
    .join("");
}

async function createACPBridgeStream(options: {
  serverURL: string;
  token: string;
  createSocket: (url: string) => WebSocketLike;
  onDisconnect?: (error: Error) => void;
}): Promise<{ stream: Stream; socket: WebSocketLike; metadata: ACPBridgeReadyMetadata }> {
  const socket = options.createSocket(toWebSocketURL(options.serverURL, options.token));

  let readyResolved = false;
  let resolveReady!: (metadata: ACPBridgeReadyMetadata) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<ACPBridgeReadyMetadata>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const readable = new ReadableStream<AnyMessage>({
    start(controller) {
      let closed = false;
      const handleOpen = () => {
        socket.send(JSON.stringify({ type: "acp-bridge-connect" }));
      };

      const handleMessage = (event: unknown) => {
        const data = getEventData(event);
        if (!data) {
          return;
        }

        let message: BridgeMessage;
        try {
          message = JSON.parse(data) as BridgeMessage;
        } catch (error) {
          const wrapped = error instanceof Error ? error : new Error(String(error));
          rejectReady(wrapped);
          controller.error(wrapped);
          return;
        }

        switch (message.type) {
          case "acp-bridge-status":
            if (message.status === "ready") {
              let metadata: ACPBridgeReadyMetadata;
              try {
                metadata = readReadyMetadata(message);
              } catch (error) {
                const wrapped = error instanceof Error ? error : new Error(String(error));
                if (!readyResolved) {
                  rejectReady(wrapped);
                }
                controller.error(wrapped);
                return;
              }

              if (!readyResolved) {
                readyResolved = true;
                resolveReady(metadata);
              }
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
          case "acp-bridge-message":
            controller.enqueue(message.message);
            return;
        }
      };

      const handleClose = () => {
        if (closed) {
          return;
        }
        closed = true;
        const error = new Error("ACP bridge websocket closed");
        if (!readyResolved) {
          rejectReady(error);
        }
        options.onDisconnect?.(error);
        controller.close();
      };

      const handleError = () => {
        if (closed) {
          return;
        }
        closed = true;
        const error = new Error("ACP bridge websocket error");
        if (!readyResolved) {
          rejectReady(error);
        }
        options.onDisconnect?.(error);
        controller.error(error);
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("message", handleMessage);
      socket.addEventListener("close", handleClose);
      socket.addEventListener("error", handleError);
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

  const metadata = await ready;
  return { stream: { readable, writable }, socket, metadata };
}

function readReadyMetadata(message: BridgeStatusMessage): ACPBridgeReadyMetadata {
  const { agent, sessionIdStrategy, sessionCwd, tvArgs } = message;
  const validAgent = agent === "openclaw" || agent === "hermes";
  const validStrategy = sessionIdStrategy === "deterministic" || sessionIdStrategy === "mapped";
  if (validAgent && validStrategy && typeof sessionCwd === "string" && sessionCwd.length > 0 && isStringArray(tvArgs)) {
    return { agent, sessionIdStrategy, sessionCwd, tvArgs };
  }

  throw new Error("ACP bridge ready status missing bootstrap metadata");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Single-quotes an argument the shell would otherwise split or expand.
function formatShellArgument(argument: string): string {
  return SHELL_SAFE_ARGUMENT_RE.test(argument) ? argument : `'${argument.replace(/'/g, "'\\''")}'`;
}

function getEventData(event: unknown): string | null {
  if (typeof event === "string") {
    return event;
  }

  if (event instanceof Uint8Array) {
    return new TextDecoder().decode(event);
  }

  if (typeof Buffer !== "undefined" && event instanceof Buffer) {
    return event.toString("utf8");
  }

  if (typeof event === "object" && event !== null && "data" in event) {
    const data = (event as { data?: unknown }).data;
    if (typeof data === "string") {
      return data;
    }
    if (data instanceof Uint8Array) {
      return new TextDecoder().decode(data);
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data as Uint8Array[]).toString("utf8");
    }
  }

  return null;
}

function toWebSocketURL(serverURL: string, token: string): string {
  const parsed = new URL(serverURL);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/acp";
  parsed.search = "";
  parsed.searchParams.set("token", token);
  parsed.hash = "";
  return parsed.toString();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

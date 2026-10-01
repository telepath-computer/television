export type ACPBridgeAgent = "openclaw" | "hermes";
export type ACPBridgeSessionIdStrategy = "deterministic" | "mapped";

export interface ACPBridgeReadyMetadata {
  agent: ACPBridgeAgent;
  sessionIdStrategy: ACPBridgeSessionIdStrategy;
  sessionCwd: string;
  /** Arguments the agent passes to `tv` so its commands reach this server. */
  tvArgs: string[];
}

export type ACPBridgeClientMessage =
  | {
      type: "acp-bridge-connect";
    }
  | {
      type: "acp-bridge-message";
      message: unknown;
    };

export type ACPBridgeServerStatus = "launching" | "ready" | "error" | "exited";

export type ACPBridgeStatusMessage =
  | ({
      type: "acp-bridge-status";
      status: "ready";
      error?: string;
    } & ACPBridgeReadyMetadata)
  | {
      type: "acp-bridge-status";
      status: Exclude<ACPBridgeServerStatus, "ready">;
      error?: string;
    };

export type ACPBridgeServerMessage =
  | ACPBridgeStatusMessage
  | {
      type: "acp-bridge-message";
      message: unknown;
    };

export type MessageId = string;

export interface UserMessage {
  id: MessageId;
  kind: "user";
  text: string;
  status: "final";
}

export interface AssistantMessage {
  id: MessageId;
  kind: "assistant";
  text: string;
  status: "streaming" | "final" | "cancelled" | "error";
}

export type ToolCallMessageStatus = "in_progress" | "completed" | "failed";

export interface ToolCallMessage {
  id: MessageId;
  kind: "tool_call";
  toolCallId: string;
  title: string;
  // Mirrors @agentclientprotocol/sdk's ToolKind union plus the catch-all
  // "other"; widened to string so this package stays SDK-free.
  toolKind: string;
  status: ToolCallMessageStatus;
  text: string;
  // ACP ToolCallLocation[]; opaque here for the same reason as toolKind.
  locations?: unknown[];
}

export type ACPClientMessage = UserMessage | AssistantMessage | ToolCallMessage;

export function isACPBridgeClientMessage(value: unknown): value is ACPBridgeClientMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  const message = value as Record<string, unknown>;
  switch (message.type) {
    case "acp-bridge-connect":
      return true;
    case "acp-bridge-message":
      return "message" in message;
    default:
      return false;
  }
}

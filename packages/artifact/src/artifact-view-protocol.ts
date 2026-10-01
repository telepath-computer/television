/**
 * Artifact-view content protocol. Cross-runtime — no DOM references.
 *
 * Three message forms:
 *   - Notification: `{ type, ...fields }`. No id, no response.
 *   - Request:      `{ type, id, ...fields }`. Expects a matching response.
 *   - Response:     `{ type: "response", id, result | error }`.
 *
 * v1 messages are the minimum surface needed by the markdown view: a ready
 * handshake, host → view content and style notifications, and a view → host
 * content save.
 *
 * Bridge messages (wheel, scroll) live in the browser-only
 * subpath at `./browser/artifact-bridge.ts` — they require an installed
 * iframe bridge and are not consumed cross-runtime.
 */

// -----------------------------------------------------------------------------
// Wire messages
// -----------------------------------------------------------------------------

export interface ReadyNotification {
  type: "ready";
}

export interface ContentUpdatedNotification {
  type: "content-updated";
  content: string;
}

export interface StylesChangedNotification {
  type: "styles-changed";
}

export interface UpdateContentRequest {
  type: "update-content";
  id: string;
  content: string;
}

export interface ResponseMessage {
  type: "response";
  id: string;
  result?: Record<string, never>;
  error?: { message: string };
}

export type ViewToHostMessage = ReadyNotification | UpdateContentRequest;
export type HostToViewMessage = ContentUpdatedNotification | StylesChangedNotification | ResponseMessage;
export type ArtifactViewMessage = ViewToHostMessage | HostToViewMessage;

// -----------------------------------------------------------------------------
// Events dispatched by the browser-side runtime classes.
//
// Interfaces live here (cross-runtime type consumers can reference them) but
// the `defineEvent`-based const declarations live with the classes in
// `./browser/artifact-view-client.ts` to keep the root export DOM-free.
// -----------------------------------------------------------------------------

export interface ReadyEvent extends Event {
  type: "ready";
}

export interface ContentUpdatedEvent extends Event {
  type: "content-updated";
  content: string;
}

// -----------------------------------------------------------------------------
// Hand-written type guards. Used by the runtime classes to filter incoming
// `MessageEvent` payloads. Zod is not used here — the message surface is
// small, and the root export is deliberately kept zod-free so Node consumers
// don't pull zod transitively.
// -----------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isReadyNotification(value: unknown): value is ReadyNotification {
  if (!isRecord(value)) return false;
  if (value.type !== "ready") return false;
  return !("id" in value);
}

export function isContentUpdatedNotification(
  value: unknown,
): value is ContentUpdatedNotification {
  if (!isRecord(value)) return false;
  if (value.type !== "content-updated") return false;
  if (typeof value.content !== "string") return false;
  return !("id" in value);
}

export function isStylesChangedNotification(
  value: unknown,
): value is StylesChangedNotification {
  if (!isRecord(value)) return false;
  if (value.type !== "styles-changed") return false;
  return Object.keys(value).length === 1;
}

export function isUpdateContentRequest(value: unknown): value is UpdateContentRequest {
  if (!isRecord(value)) return false;
  if (value.type !== "update-content") return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.content !== "string") return false;
  return true;
}

export function isResponseMessage(value: unknown): value is ResponseMessage {
  if (!isRecord(value)) return false;
  if (value.type !== "response") return false;
  if (typeof value.id !== "string") return false;
  const hasResult = "result" in value && value.result !== undefined;
  const hasError = "error" in value && value.error !== undefined;
  if (hasResult === hasError) return false;
  if (hasResult) {
    if (!isRecord(value.result)) return false;
    if (Object.keys(value.result).length !== 0) return false;
  }
  if (hasError) {
    if (!isRecord(value.error)) return false;
    if (typeof (value.error as { message?: unknown }).message !== "string") return false;
  }
  return true;
}

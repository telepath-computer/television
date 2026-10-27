// The page connection's route and framing. Like the administrative routes',
// they are defined here, not by the specs, and are not a public API: the SDK
// is the supported client (specs/arch/resources/index.md#^rs-wire-boundary).
import type { EncodedUpdateEntry, EncodedWriteValue } from "./json-values.ts";
import type {
  AccessLevel,
  JsonReadResult,
  PageEvent,
  ResourceID,
  ResourceInfo,
  ResourceRefusalCode,
} from "./types.ts";
import { ARTIFACT_ROUTE_PREFIX } from "./wire.ts";

const CONNECTION_SUFFIX = "/v1/connection";

export const artifactRoutes = {
  /** The page connection under an artifact ID or a share ID. */
  connection: (id: string) => `${ARTIFACT_ROUTE_PREFIX}/${encodeURIComponent(id)}${CONNECTION_SUFFIX}`,
} as const;

/** The ID a page connection's path names, an artifact ID or a share ID, or null when the path is not a page connection's. */
export function parsePageConnectionPath(pathname: string): string | null {
  const prefix = `${ARTIFACT_ROUTE_PREFIX}/`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith(CONNECTION_SUFFIX)) return null;
  const encoded = pathname.slice(prefix.length, pathname.length - CONNECTION_SUFFIX.length);
  if (encoded.length === 0 || encoded.includes("/")) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/** A write on the page connection; values are carried in the placeholder encoding. */
export type PageWrite =
  | { kind: "set"; path: string; value: EncodedWriteValue }
  | { kind: "update"; path: string; entries: EncodedUpdateEntry[] }
  | { kind: "push"; path: string; key: string; value: EncodedWriteValue }
  | { kind: "remove"; path: string }
  /** A transaction's write: applied only when the value at `path` still equals `expected`. */
  | { kind: "compare-and-set"; path: string; expected: JsonReadResult; value: unknown };

export type PageWriteKind = PageWrite["kind"];

export const PAGE_WRITE_KINDS: readonly PageWriteKind[] = ["set", "update", "push", "remove", "compare-and-set"];

/**
 * A page's messages. An operation without `resourceID` addresses the
 * artifact's own store; one with it, another store by its resource ID.
 */
export type PageClientMessage =
  | { type: "list"; id: string }
  | { type: "info"; id: string; resourceID: string }
  | { type: "get"; id: string; resourceID?: string; path: string }
  | { type: "subscribe"; id: string; resourceID?: string; path: string }
  | { type: "unsubscribe"; id: string }
  | { type: "write"; seq: number; resourceID?: string; write: PageWrite };

/**
 * The page's access, which the opening state and each change of it carry
 * whole: the level the connection's ID carries on its artifact's own store,
 * absent when it reaches no artifact that has one; and with the bindings flag
 * on, that store's resource ID once its first write has created it, absent
 * while the bindings file cannot be read, and the artifact's explicit
 * bindings at the page's level on each.
 */
export interface PageAccess {
  access?: AccessLevel;
  store?: ResourceID;
  bindings: ResourceInfo[];
}

export type PageServerMessage =
  /** The opening state, sent first on every connection: the page's access and the server's time. */
  | ({ type: "open"; serverTime: number } & PageAccess)
  /**
   * The page's access again, after the share link the connection was opened
   * under changes level or, with the flag on, the artifact's own store gets
   * or loses its resource ID.
   */
  | ({ type: "access" } & PageAccess)
  /** Sent in place of the opening state when the resource layer refuses every request; the server then closes the connection. */
  | { type: "unavailable"; error: string }
  | { type: "resources"; id: string; resources: ResourceInfo[] }
  | { type: "resource"; id: string; resource: ResourceInfo }
  /**
   * A `get`'s answer, or a subscription's value on registration and after each
   * change. `seq` is the highest sequence number of this connection's writes
   * the value includes.
   */
  | { type: "value"; id: string; result: JsonReadResult; seq: number }
  /** A refused request, or the end of a subscription. */
  | { type: "error"; id: string; code: ResourceRefusalCode; error: string }
  | { type: "applied"; seq: number }
  | { type: "refused"; seq: number; code: ResourceRefusalCode; error: string }
  /** A compare-and-set write whose expected value no longer matched, with the value now at its path. */
  | { type: "mismatch"; seq: number; current: JsonReadResult; valueSeq: number }
  | { type: "event"; event: PageEvent };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/** The message's resource ID, when it addresses a store by one. */
function resourceIDOf(message: Record<string, unknown>): { resourceID?: string } {
  return typeof message.resourceID === "string" ? { resourceID: message.resourceID } : {};
}

function parseWrite(value: unknown): PageWrite | null {
  if (!isRecord(value) || typeof value.path !== "string") return null;
  switch (value.kind) {
    case "set":
      return { kind: "set", path: value.path, value: value.value as EncodedWriteValue };
    case "update":
      return { kind: "update", path: value.path, entries: value.entries as EncodedUpdateEntry[] };
    case "push":
      if (typeof value.key !== "string") return null;
      return { kind: "push", path: value.path, key: value.key, value: value.value as EncodedWriteValue };
    case "remove":
      return { kind: "remove", path: value.path };
    case "compare-and-set":
      return { kind: "compare-and-set", path: value.path, expected: value.expected as JsonReadResult, value: value.value };
    default:
      return null;
  }
}

/**
 * Parses a client message on the page connection, or returns null for one
 * whose framing is malformed. Values are left encoded: the server decodes
 * them when it applies the write, and refuses one it cannot use.
 */
export function parsePageClientMessage(text: string): PageClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const message = parsed;
  switch (message.type) {
    case "write": {
      if (!isCount(message.seq, 1) || !isOptionalString(message.resourceID)) return null;
      const write = parseWrite(message.write);
      if (write === null) return null;
      return { type: "write", seq: message.seq, ...resourceIDOf(message), write };
    }
    default:
      break;
  }
  if (typeof message.id !== "string") return null;
  switch (message.type) {
    case "list":
    case "unsubscribe":
      return { type: message.type, id: message.id };
    case "info":
      return typeof message.resourceID === "string" ? { type: "info", id: message.id, resourceID: message.resourceID } : null;
    case "get":
    case "subscribe":
      if (!isOptionalString(message.resourceID) || typeof message.path !== "string") return null;
      return { type: message.type, id: message.id, ...resourceIDOf(message), path: message.path };
    default:
      return null;
  }
}

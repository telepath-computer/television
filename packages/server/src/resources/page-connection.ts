import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  JSON_STORE_MAX_WRITE_MESSAGE_BYTES,
  decodeUpdateEntries,
  decodeWriteValue,
  isResourceRefusal,
  lowerAccess,
  parsePageClientMessage,
  resourceError,
  type AccessLevel,
  type PageAccess,
  type PageClientMessage,
  type PageEvent,
  type PageServerMessage,
  type PageWrite,
  type ResourceError,
  type ResourceEvent,
  type ResourceID,
  type ResourceInfo,
  type ResourceRefusalCode,
  type StoreAddress,
} from "@telepath-computer/television-shared/resources";
import type { JsonOperation } from "./json-store.ts";
import { isUnknownOutcome, type AccessChange, type ReachedArtifact, type ResourceLayer } from "./layer.ts";
import { errorMessage } from "./storage.ts";

export interface PageConnectionServerOptions {
  layer: ResourceLayer;
}

/** "Try again later": the resource layer refuses every request until a later start. */
const CLOSE_TRY_AGAIN_LATER = 1013;
/** What the connection's ID reaches changed: its share link was revoked or the artifact deleted. */
const CLOSE_ADDRESS_ENDED = 1000;

/**
 * The message a page receives with a refusal, written from its code and the
 * resource ID the request named, if any. An `unavailable` refusal says
 * whether its change's outcome is unknown (specs/arch/resources/index.md#Errors).
 */
function pageMessage(code: ResourceRefusalCode, resourceID: ResourceID | undefined, outcomeUnknown: boolean): string {
  const store = resourceID === undefined ? "this artifact's store" : `resource ${resourceID}`;
  switch (code) {
    case "no-store":
      return "This page's address reaches no artifact that has a store.";
    case "not-enabled":
      return "Using stores by resource ID is not enabled on this server.";
    case "not-bound":
      return `This artifact is not bound to ${store}.`;
    case "wrong-type":
      return `This operation does not apply to ${store}, which is of another type.`;
    case "read-only":
      return `This page can only read ${store}.`;
    case "not-found":
      return "The store this request addresses does not exist.";
    case "invalid-path":
      return "The JSON store refused this request's path.";
    case "invalid-value":
      return "The JSON store refused this request's value.";
    case "too-large":
      return "This write, or the store's value after it, would be larger than the JSON store allows.";
    case "unavailable":
      return outcomeUnknown
        ? "The server could not confirm saving this change, so its outcome is unknown. Read the store before trying again."
        : "The stored data this request needs is unavailable, or could not be saved.";
    case "not-artifact-page":
    case "no-artifact":
    case "not-shareable":
    case "not-shared":
    case "tokenless":
    case "access-required":
    case "read-write-unsupported":
    case "owner-binding":
    case "invalid-description":
    case "invalid-usage":
    case "still-bound":
    case "disconnected":
    case "max-retries":
      // No page operation is refused with these.
      return "The server refused this request.";
  }
}

/**
 * A refusal as a page receives it: its code and the page's message for it,
 * never the error's own message, which can name an artifact, as a failed
 * first write's names the store's owner, or the server's files
 * (specs/arch/resources/index.md#^rs-artifact-routes). That message is
 * logged for `unavailable`, and an error that is not a refusal is logged
 * and reported as `unavailable`.
 */
function pageRefusal(error: unknown, resourceID: ResourceID | undefined): { code: ResourceRefusalCode; error: string } {
  if (!isResourceRefusal(error)) {
    console.error("Resource page connection request failed", error);
    return { code: "unavailable", error: "The request failed on the server." };
  }
  if (error.code === "unavailable") console.warn(`Resource page connection request refused: ${error.message}`);
  return { code: error.code, error: pageMessage(error.code, resourceID, isUnknownOutcome(error)) };
}

function refusal(code: ResourceRefusalCode, resourceID?: ResourceID): ResourceError {
  return resourceError(code, pageMessage(code, resourceID, false));
}

const noStore = () => refusal("no-store");
const notBound = (resourceID: ResourceID) => refusal("not-bound", resourceID);
const readOnly = (resourceID: ResourceID | undefined) => refusal("read-only", resourceID);

function operationOf(write: PageWrite): JsonOperation {
  return write.kind;
}

/** What the server tells one open connection when what its ID reaches changes. */
interface OpenConnection {
  levelChanged(access: AccessLevel): void;
  /** An artifact's pointer to its own store was saved or removed. */
  storeChanged(artifactID: string): void;
  end(): void;
}

/**
 * The page connection at `/artifact-resources/<id>/v1/connection`, where the
 * ID is an artifact ID or a share ID (specs/arch/resources/index.md, The page
 * connection). The ID in the path is its whole authorization: it takes no
 * token, and every operation is checked against what the ID reaches when it
 * is applied. Nothing it sends carries an artifact ID, a share ID, a
 * description or a usage: every refusal it sends goes through `pageRefusal`.
 * Each connection stands alone: nothing about a page
 * outlives its connection (specs/arch/resources/index.md#^rs-page-connection).
 */
export class PageConnectionServer {
  private readonly layer: ResourceLayer;
  // A larger message closes the connection with 1009; the SDK never sends one
  // (specs/arch/resources/json-store.md#^js-arch-write-limit).
  private readonly wsServer = new WebSocketServer({ noServer: true, maxPayload: JSON_STORE_MAX_WRITE_MESSAGE_BYTES });
  private readonly cleanups = new Set<() => void>();
  /** The open connections by the ID in their address. */
  private readonly byID = new Map<string, Set<OpenConnection>>();
  private readonly stopAccessChanges: () => void;

  constructor(options: PageConnectionServerOptions) {
    this.layer = options.layer;
    this.stopAccessChanges = this.layer.onAccessChange((change) => this.accessChanged(change));
  }

  /** Opens a page connection under `id`, whatever the request's origin: the ID is its authority (specs/arch/resources/index.md#^rs-any-origin). */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, id: string): void {
    this.wsServer.handleUpgrade(request, socket, head, (ws) => this.serve(ws, id));
  }

  dispose(): Promise<void> {
    this.stopAccessChanges();
    for (const cleanup of [...this.cleanups]) cleanup();
    for (const client of this.wsServer.clients) client.terminate();
    return new Promise((resolve, reject) => this.wsServer.close((error) => (error ? reject(error) : resolve())));
  }

  /**
   * Sends a share link's new level to the connections opened under it, an
   * artifact's own store's resource ID to the connections that reach it, and
   * closes those whose ID's reach changed.
   */
  private accessChanged(change: AccessChange): void {
    if (change.kind === "level") {
      for (const connection of [...(this.byID.get(change.id) ?? [])]) connection.levelChanged(change.access);
      return;
    }
    if (change.kind === "store") {
      for (const connections of [...this.byID.values()]) {
        for (const connection of [...connections]) connection.storeChanged(change.artifactID);
      }
      return;
    }
    for (const id of change.ids) {
      for (const connection of [...(this.byID.get(id) ?? [])]) connection.end();
    }
  }

  private serve(ws: WebSocket, id: string): void {
    const { layer } = this;
    /**
     * The artifact the ID reached when the connection opened. A share ID
     * never moves to another artifact, and the connection closes when its ID
     * stops reaching it, so its events are this artifact's.
     */
    let artifactID: string | null = null;
    /** The page's level as last sent, from which a change of it tells which bindings' levels for the page change. */
    let level: AccessLevel | null = null;
    /** The artifact's explicit bindings as this connection last heard of them, each at its own level. */
    const bound = new Map<ResourceID, AccessLevel>();
    /** The resource ID of the artifact's own store as the page was last sent it. */
    let sentStore: ResourceID | undefined;
    /** Whether the opening state was sent: the resource layer could be used when the connection opened. */
    let opened = false;
    /** The highest sequence number of this connection's writes the server has handled. */
    let highestHandled = 0;
    /** Subscriptions, each to the artifact's own store or, by resource ID, another store. */
    const subscriptions = new Map<string, { resourceID: ResourceID | undefined; unsubscribe: () => void }>();
    let stopEvents: (() => void) | null = null;

    const send = (message: PageServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };

    /** Ends the subscriptions made to a store by its resource ID; those to the artifact's own store stay. */
    const endSubscriptions = (resourceID: ResourceID) => {
      for (const [subscriptionID, subscription] of subscriptions) {
        if (subscription.resourceID !== resourceID) continue;
        subscription.unsubscribe();
        subscriptions.delete(subscriptionID);
        send({ type: "error", id: subscriptionID, ...pageRefusal(notBound(resourceID), resourceID) });
      }
    };

    /** The page's level now: its ID's, or the last it was sent once the ID reaches nothing. */
    const currentLevel = (): AccessLevel => layer.resolveID(id)?.level ?? level ?? "read";

    /**
     * The event a page receives for a resource event, if any
     * (specs/arch/resources/index.md#^rs-arch-events): `changed` for its own
     * store without a resource ID, and with the flag on `destroyed` and
     * `changed` for its explicit bindings and `bound` and `unbound` for its
     * artifact's, never with an artifact ID, a description or a usage.
     */
    const pageEvent = (event: ResourceEvent): PageEvent | null => {
      if (artifactID === null) return null;
      switch (event.event) {
        case "created":
        case "updated":
          return null;
        case "changed":
          if (layer.ownStoreOf(artifactID) === event.resourceID) return { event: "changed", paths: event.paths };
          return bound.has(event.resourceID) ? { event: "changed", resourceID: event.resourceID, paths: event.paths } : null;
        case "destroyed":
          if (!bound.delete(event.resourceID)) return null;
          endSubscriptions(event.resourceID);
          return { event: "destroyed", resourceID: event.resourceID };
        case "bound":
          if (event.artifactID !== artifactID) return null;
          bound.set(event.resourceID, event.access);
          return { event: "bound", resourceID: event.resourceID, access: lowerAccess(currentLevel(), event.access) };
        case "unbound":
          if (event.artifactID !== artifactID) return null;
          bound.delete(event.resourceID);
          endSubscriptions(event.resourceID);
          return { event: "unbound", resourceID: event.resourceID };
      }
    };

    /** The resource ID of the artifact's own store as the page can address it: with the flag on, once written. */
    const ownStoreID = (): ResourceID | undefined =>
      artifactID !== null && layer.storesByResourceID && layer.hasOwnStore(artifactID) ? layer.ownStoreOf(artifactID) : undefined;

    /**
     * The page's access as it stands, which the opening state and each change
     * of it carry whole, so the SDK never holds a new level for one store
     * and the old one for another.
     */
    const pageAccess = (): PageAccess => {
      sentStore = ownStoreID();
      if (artifactID === null || level === null) return { bindings: [] };
      const pageLevel = level;
      return {
        ...(layer.hasOwnStore(artifactID) ? { access: level } : {}),
        ...(sentStore === undefined ? {} : { store: sentStore }),
        bindings: [...bound]
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([resourceID, bindingAccess]) => ({ resourceID, type: layer.storeType(resourceID), access: lowerAccess(pageLevel, bindingAccess) })),
      };
    };

    const forward = (event: ResourceEvent) => {
      const received = pageEvent(event);
      if (received !== null) send({ type: "event", event: received });
    };

    const connection: OpenConnection = {
      levelChanged: (access) => {
        const previous = level;
        level = access;
        send({ type: "access", ...pageAccess() });
        if (previous === null) return;
        for (const [resourceID, bindingAccess] of bound) {
          const now = lowerAccess(access, bindingAccess);
          if (now !== lowerAccess(previous, bindingAccess)) send({ type: "event", event: { event: "bound", resourceID, access: now } });
        }
      },
      // The artifact's own store got its resource ID at its first write, or lost it at a destroy.
      storeChanged: (changed) => {
        if (changed === artifactID && ownStoreID() !== sentStore) send({ type: "access", ...pageAccess() });
      },
      end: () => ws.close(CLOSE_ADDRESS_ENDED, "What this page's address reaches has changed."),
    };

    const cleanup = () => {
      for (const subscription of subscriptions.values()) subscription.unsubscribe();
      subscriptions.clear();
      stopEvents?.();
      stopEvents = null;
      const open = this.byID.get(id);
      open?.delete(connection);
      if (open?.size === 0) this.byID.delete(id);
      this.cleanups.delete(cleanup);
    };
    this.cleanups.add(cleanup);
    ws.on("close", cleanup);
    // A protocol error from the client: ws closes the connection itself, and
    // an unhandled error event would end the server's process.
    ws.on("error", cleanup);

    /**
     * The store an operation addresses, checked as the connection's ID and
     * the artifact's bindings stand when it is applied: the artifact's own
     * store at the ID's level, or with the flag on a store the artifact is
     * bound to at the lower of that and the binding's level. A write through
     * `read` access is refused before the type's code runs.
     */
    const target = (resourceID: ResourceID | undefined, operation: JsonOperation): StoreAddress => {
      const reached = layer.resolveID(id);
      const writes = layer.json.operationAccess[operation] === "write";
      if (resourceID === undefined) {
        if (reached === null || !layer.hasOwnStore(reached.artifactID)) throw noStore();
        if (reached.level === "read" && writes) throw readOnly(undefined);
        return { artifactID: reached.artifactID };
      }
      layer.requireStoresByResourceID();
      const binding = reached === null ? undefined : layer.artifactBindings(reached.artifactID).find((candidate) => candidate.resourceID === resourceID);
      if (binding === undefined) throw notBound(resourceID);
      if (lowerAccess((reached as ReachedArtifact).level, binding.access) === "read" && writes) throw readOnly(resourceID);
      return { resourceID };
    };

    /** The stores the artifact can use, its own once written, each at the page's level on it. */
    const infos = (): ResourceInfo[] => {
      layer.requireStoresByResourceID();
      const reached = layer.resolveID(id);
      if (reached === null) return [];
      return layer.artifactBindings(reached.artifactID).map((binding) => ({
        resourceID: binding.resourceID,
        type: layer.storeType(binding.resourceID),
        access: lowerAccess(reached.level, binding.access),
      }));
    };

    /** Sends the opening state, or `unavailable` and closes when the resource layer refuses every request. */
    const open = () => {
      try {
        layer.requireLoaded();
      } catch (error) {
        console.warn(`Resource page connection refused: ${errorMessage(error)}`);
        send({ type: "unavailable", error: "This server's resources are unavailable until it starts again." });
        ws.close(CLOSE_TRY_AGAIN_LATER, "Resources are unavailable.");
        return;
      }
      const reached = layer.resolveID(id);
      artifactID = reached?.artifactID ?? null;
      level = reached?.level ?? null;
      const explicit = reached === null ? [] : layer.explicitBindingsOf(reached.artifactID);
      for (const binding of explicit) bound.set(binding.resourceID, binding.access);
      stopEvents = layer.onEvent(forward);
      opened = true;
      const connections = this.byID.get(id) ?? new Set<OpenConnection>();
      connections.add(connection);
      this.byID.set(id, connections);
      send({ type: "open", serverTime: Date.now(), ...pageAccess() });
    };

    const subscribe = (subscriptionID: string, resourceID: ResourceID | undefined, path: string) => {
      subscriptions.get(subscriptionID)?.unsubscribe();
      subscriptions.delete(subscriptionID);
      try {
        const unsubscribe = layer.json.subscribe(target(resourceID, "subscribe"), path, {
          onValue: (result) => send({ type: "value", id: subscriptionID, result, seq: highestHandled }),
          // Only a store addressed by its resource ID ends: one through the
          // artifact follows its pointer, across a destroy and the next first write.
          onEnd: () => {
            subscriptions.delete(subscriptionID);
            send({ type: "error", id: subscriptionID, ...pageRefusal(resourceID === undefined ? noStore() : notBound(resourceID), resourceID) });
          },
        });
        subscriptions.set(subscriptionID, { resourceID, unsubscribe });
      } catch (error) {
        send({ type: "error", id: subscriptionID, ...pageRefusal(error, resourceID) });
      }
    };

    /** Applies a write after the checks; returns the current value when a compare-and-set no longer matches. */
    const apply = (resourceID: ResourceID | undefined, write: PageWrite) => {
      const store = target(resourceID, operationOf(write));
      switch (write.kind) {
        case "set":
          layer.json.write(store, { kind: "set", path: write.path, value: decodeWriteValue(write.value) });
          return null;
        case "update":
          layer.json.write(store, { kind: "update", path: write.path, entries: decodeUpdateEntries(write.entries) });
          return null;
        case "push":
          layer.json.push(store, write.path, write.key, decodeWriteValue(write.value));
          return null;
        case "remove":
          layer.json.write(store, { kind: "remove", path: write.path });
          return null;
        case "compare-and-set": {
          const outcome = layer.json.compareAndSet(store, write.path, write.expected, write.value);
          return outcome.applied ? null : outcome.current;
        }
      }
    };

    // A connection's writes are handled one at a time in the order received,
    // across all its stores (specs/arch/resources/index.md#^rs-write-sequence).
    const handleWrite = (seq: number, resourceID: ResourceID | undefined, write: PageWrite) => {
      // Raised first, so the write's own subscription updates carry it.
      highestHandled = Math.max(highestHandled, seq);
      try {
        const mismatch = apply(resourceID, write);
        if (mismatch === null) {
          send({ type: "applied", seq });
          return;
        }
        send({ type: "mismatch", seq, current: mismatch, valueSeq: highestHandled });
      } catch (error) {
        send({ type: "refused", seq, ...pageRefusal(error, resourceID) });
      }
    };

    const handle = (message: PageClientMessage) => {
      switch (message.type) {
        case "write":
          handleWrite(message.seq, message.resourceID, message.write);
          return;
        case "list":
          send({ type: "resources", id: message.id, resources: infos() });
          return;
        case "info": {
          const resource = infos().find((info) => info.resourceID === message.resourceID);
          if (resource === undefined) throw notBound(message.resourceID);
          send({ type: "resource", id: message.id, resource });
          return;
        }
        case "get":
          send({ type: "value", id: message.id, result: layer.json.get(target(message.resourceID, "get"), message.path), seq: highestHandled });
          return;
        case "subscribe":
          subscribe(message.id, message.resourceID, message.path);
          return;
        case "unsubscribe":
          subscriptions.get(message.id)?.unsubscribe();
          subscriptions.delete(message.id);
          return;
      }
    };

    ws.on("message", (data: RawData) => {
      const message = parsePageClientMessage(data.toString());
      if (message === null || !opened) return;
      try {
        handle(message);
      } catch (error) {
        // Writes answer their own refusals; only requests reach here.
        if ("id" in message) send({ type: "error", id: message.id, ...pageRefusal(error, "resourceID" in message ? message.resourceID : undefined) });
      }
    });
    open();
  }
}

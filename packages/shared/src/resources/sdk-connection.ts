// The resource SDK's side of the page connection (specs/arch/resources/sdk.md,
// Connection client). Browser-only: it uses `WebSocket`, `location` and timers.
import { resourceError, type ResourceError } from "./errors.ts";
import { checkWriteMessage } from "./json-apply.ts";
import {
  artifactRoutes,
  type PageAccess,
  type PageClientMessage,
  type PageServerMessage,
  type PageWrite,
} from "./page-wire.ts";
import type { AccessLevel, JsonReadResult, PageEvent, ResourceID, ResourceRefusalCode } from "./types.ts";

/** The first reconnection delay and the cap it doubles towards (specs/arch/resources/sdk.md#^sdk-reconnect). */
const BACKOFF_START_MS = 250;
const BACKOFF_CAP_MS = 30_000;

const ARTIFACT_PATH = /^\/artifact\/([^/]+)(?:\/|$)/;

/**
 * The ID in a page's path, `/artifact/<id>/…`, the artifact's ID or a share
 * ID, which the SDK cannot tell apart and needs not; or null on a page of
 * another form (specs/arch/resources/sdk.md#^sdk-artifact-id).
 */
export function pageIDFromPath(pathname: string): string | null {
  const match = ARTIFACT_PATH.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

/**
 * Calls a page's callback. An exception it throws is reported through the
 * browser's uncaught-error reporting and affects nothing else
 * (specs/arch/resources/sdk.md#^sdk-callback-isolation).
 */
export function callPage<Args extends unknown[]>(callback: (...args: Args) => unknown, ...args: Args): void {
  try {
    callback(...args);
  } catch (error) {
    if (typeof globalThis.reportError === "function") {
      globalThis.reportError(error);
    } else {
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}

function refusal(code: ResourceRefusalCode, error: string): ResourceError {
  return resourceError(code, error);
}

function disconnected(): ResourceError {
  return refusal("disconnected", "The page is disconnected from the server.");
}

/**
 * A store the page uses: `null` for its artifact's own store, which the page
 * addresses without a resource ID, or a store's resource ID.
 */
export type StoreKey = ResourceID | null;

/** The addresses of the artifact's own store: without a resource ID, and by its resource ID once known. */
function ownStoreAddresses(ownStore: ResourceID | undefined): StoreKey[] {
  return ownStore === undefined ? [null] : [null, ownStore];
}

/** Whether the page can reach its server (specs/arch/resources/sdk.md#^sdk-connection-status). */
export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected";

/** A registered status callback, with the status it last heard; null until its first call. */
interface StatusCallback {
  readonly callback: (status: ConnectionStatus) => void;
  heard: ConnectionStatus | null;
}

/** A registered access callback, with the level it last heard; undefined until its first call. */
interface AccessCallback {
  readonly callback: (access: AccessLevel | null) => void;
  heard: AccessLevel | null | undefined;
}

/** How the server answered a write that was not refused. */
export type WriteOutcome = { kind: "applied" } | { kind: "mismatch"; current: JsonReadResult; valueSeq: number };

/** An unconfirmed write, from the moment it is queued until it is acknowledged or rolled back. */
export interface QueuedWrite<Local = unknown> {
  readonly seq: number;
  readonly store: StoreKey;
  /** What the local view applies; opaque to the connection. */
  readonly local: Local;
  readonly message: string;
  readonly settle: { resolve: (outcome: WriteOutcome) => void; reject: (error: Error) => void };
  /**
   * Called as a compare-and-set that no longer matched leaves the queue,
   * before the local view is recomputed, so a transaction's next attempt
   * replaces it without the view showing anything in between.
   */
  readonly onMismatch: ((current: JsonReadResult) => void) | undefined;
}

export interface SubscriptionHandlers {
  onValue: (result: JsonReadResult, seq: number) => void;
  /** The subscription ended: the binding was removed, the resource destroyed or became unavailable. */
  onEnd: (error: ResourceError) => void;
}

type RequestMessage = Extract<PageClientMessage, { type: "list" | "info" | "get" }>;
/** A request as the caller gives it, before it is numbered. */
type RequestBody = RequestMessage extends infer Message ? (Message extends RequestMessage ? Omit<Message, "id"> : never) : never;
type Reply = Exclude<PageServerMessage, { type: "open" | "unavailable" | "applied" | "refused" | "mismatch" | "event" | "access" }>;

/** The address of a store on the wire: its own store has no resource ID. */
function addressOf(store: StoreKey): { resourceID?: ResourceID } {
  return store === null ? {} : { resourceID: store };
}

interface Request {
  readonly message: RequestMessage;
  readonly resolve: (reply: Reply) => void;
  readonly reject: (error: Error) => void;
}

interface Subscription {
  readonly store: StoreKey;
  readonly path: string;
  readonly handlers: SubscriptionHandlers;
}

/**
 * One page load's page connection. It opens when the page first needs it,
 * closes once nothing is outstanding, and reconnects with backoff when it is
 * lost. There is no offline mode: a loss rolls back every unconfirmed write
 * and rejects every outstanding request, and while the page is disconnected
 * requests and writes fail at once. Nothing is sent on more than one
 * connection; subscriptions are made again on each.
 */
export class SdkConnection<Local = unknown> {
  /** The ID in the page's address: its artifact's ID or a share ID. */
  readonly id: string;
  private socket: WebSocket | null = null;
  private currentStatus: ConnectionStatus = "idle";
  private readonly statusCallbacks = new Set<StatusCallback>();
  private serverTimeOffset = 0;
  /**
   * The page's level on its artifact's own store, null when its address
   * reaches no artifact that has a store, from the open connection's opening
   * state and changes of access; undefined while no connection's opening
   * state has arrived (specs/arch/resources/sdk.md#^sdk-access).
   */
  private level: AccessLevel | null | undefined = undefined;
  private readonly accessCallbacks = new Set<AccessCallback>();
  /** `getAccess` calls waiting for an opening state. */
  private readonly accessWaiters = new Set<{ resolve: (level: AccessLevel | null) => void; reject: (error: Error) => void }>();
  /** The resource ID of the artifact's own store, when the same connection gave it. */
  private ownStore: ResourceID | undefined = undefined;
  /** The page's level on each store its artifact is bound to explicitly, from the same connection. */
  private readonly bindings = new Map<ResourceID, AccessLevel>();
  /** Sequence numbers increase across connections, so a write made on a new connection is always above a value an earlier one sent. */
  private nextSeq = 1;
  /** The highest sequence number sent on the current connection: writes are sent in sequence order. */
  private sentSeq = 0;
  private nextID = 0;
  private readonly writes = new Map<number, QueuedWrite<Local>>();
  private readonly requests = new Map<string, Request>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly eventCallbacks = new Set<(event: PageEvent) => void>();
  private readonly queueObservers = new Set<(stores: readonly StoreKey[]) => void>();
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleCheckQueued = false;

  constructor(id: string) {
    this.id = id;
  }

  /** The server's clock as the page estimates it, from the last opening state. */
  serverNow(): number {
    return Date.now() + this.serverTimeOffset;
  }

  /** Unconfirmed writes, in sequence order. */
  queue(): QueuedWrite<Local>[] {
    return [...this.writes.values()];
  }

  /**
   * Calls `observer` with the stores whose queued writes changed whenever
   * writes are queued or leave the queue, giving the artifact's own store by
   * both its addresses.
   */
  observeQueue(observer: (stores: readonly StoreKey[]) => void): void {
    this.queueObservers.add(observer);
  }

  /**
   * Whether two addresses reach one store: the artifact's own store is one
   * store without a resource ID and, once the open connection has given it,
   * by its resource ID (specs/arch/resources/json-store.md#^js-arch-local-writes).
   */
  sameStore(left: StoreKey, right: StoreKey): boolean {
    const own = ownStoreAddresses(this.ownStore);
    return left === right || (own.includes(left) && own.includes(right));
  }

  // --- The connection status ---

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  /** Calls back with the status as it stands soon after registration, then with each change. */
  onStatus(callback: (status: ConnectionStatus) => void): () => void {
    const entry: StatusCallback = { callback, heard: null };
    this.statusCallbacks.add(entry);
    this.ensureConnected();
    queueMicrotask(() => {
      if (!this.statusCallbacks.has(entry) || entry.heard !== null) return;
      entry.heard = this.currentStatus;
      callPage(callback, this.currentStatus);
    });
    return () => {
      if (this.statusCallbacks.delete(entry)) this.queueIdleCheck();
    };
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    for (const entry of [...this.statusCallbacks]) {
      // A callback that has not heard its first status hears the one standing then.
      if (entry.heard === null || entry.heard === status || !this.statusCallbacks.has(entry)) continue;
      entry.heard = status;
      callPage(entry.callback, status);
    }
  }

  // --- The page's access level ---

  /**
   * Resolves with the page's level on its artifact's own store, null when its
   * address reaches no artifact that has a store. Waits while a connection
   * opens, and fails at once while the page is disconnected.
   */
  access(): Promise<AccessLevel | null> {
    if (this.currentStatus === "disconnected") return Promise.reject(disconnected());
    if (this.currentStatus === "connected" && this.level !== undefined) return Promise.resolve(this.level);
    return new Promise((resolve, reject) => {
      this.accessWaiters.add({ resolve, reject });
      this.ensureConnected();
    });
  }

  /** Calls back with the page's level once a connection's opening state has arrived, which may be at once, then with each change. */
  onAccess(callback: (access: AccessLevel | null) => void): () => void {
    const entry: AccessCallback = { callback, heard: undefined };
    this.accessCallbacks.add(entry);
    this.ensureConnected();
    if (this.level !== undefined) queueMicrotask(() => this.tellAccess(entry));
    return () => {
      if (this.accessCallbacks.delete(entry)) this.queueIdleCheck();
    };
  }

  private tellAccess(entry: AccessCallback): void {
    if (!this.accessCallbacks.has(entry) || this.level === undefined || entry.heard === this.level) return;
    entry.heard = this.level;
    callPage(entry.callback, this.level);
  }

  /**
   * The page's level on a store as the open connection reported it, for a
   * write's local check: on its artifact's own store by either address, and
   * on a bound store, whose level the server limits by that one; unknown
   * without an opening state on the open connection, and for a store the
   * page is not known to reach (specs/arch/resources/sdk.md#Handles).
   */
  private knownLevel(store: StoreKey): AccessLevel | undefined {
    if (this.level === undefined) return undefined;
    if (store === null || store === this.ownStore) return this.level ?? undefined;
    return this.bindings.get(store);
  }

  /** Takes the page's access whole, from an opening state or a change of it, and returns its level. */
  private takeAccess(access: PageAccess): AccessLevel | null {
    const level = access.access ?? null;
    const ownStore = this.ownStore;
    this.level = level;
    this.ownStore = access.store;
    this.bindings.clear();
    for (const binding of access.bindings) this.bindings.set(binding.resourceID, binding.access);
    // A write queued through either address now shows at both, or, when a destroy took the resource ID away, no longer does.
    if (this.ownStore !== ownStore && this.writes.size > 0) this.notifyQueue(ownStoreAddresses(ownStore), this.ownStore);
    return level;
  }

  // --- Requests, subscriptions and events ---

  /** Throws `disconnected` while the page is disconnected, when requests and writes fail at once. */
  requireReachable(): void {
    if (this.currentStatus === "disconnected") throw disconnected();
  }

  /** Sends a request once the connection is open; while the page is disconnected it fails at once. */
  request(body: RequestBody): Promise<Reply> {
    if (this.currentStatus === "disconnected") return Promise.reject(disconnected());
    const id = `r${this.nextID++}`;
    const full = { ...body, id } as RequestMessage;
    return new Promise<Reply>((resolve, reject) => {
      this.requests.set(id, { message: full, resolve, reject });
      this.ensureConnected();
      if (this.currentStatus === "connected") this.send(full);
    });
  }

  /** Subscribes on this connection and every later one, until the subscription ends or is unsubscribed. */
  subscribe(store: StoreKey, path: string, handlers: SubscriptionHandlers): () => void {
    const id = `s${this.nextID++}`;
    this.subscriptions.set(id, { store, path, handlers });
    this.ensureConnected();
    if (this.currentStatus === "connected") this.send({ type: "subscribe", id, ...addressOf(store), path });
    return () => {
      if (!this.subscriptions.delete(id)) return;
      if (this.currentStatus === "connected") this.send({ type: "unsubscribe", id });
      this.queueIdleCheck();
    };
  }

  onEvent(callback: (event: PageEvent) => void): () => void {
    // Each registration is its own entry, so registering one function twice needs two unsubscribes.
    const entry = (event: PageEvent) => callback(event);
    this.eventCallbacks.add(entry);
    this.ensureConnected();
    return () => {
      if (this.eventCallbacks.delete(entry)) this.queueIdleCheck();
    };
  }

  // --- Writes ---

  /**
   * Queues a write and sends it once a connection's opening state has
   * arrived. Throws, queueing nothing, while the page is disconnected, when
   * the open connection reported the page's level on the store as `read`,
   * or when the message would exceed the message limit.
   */
  write(store: StoreKey, write: PageWrite, local: Local, onMismatch?: (current: JsonReadResult) => void): Promise<WriteOutcome> {
    this.requireReachable();
    if (this.knownLevel(store) === "read") {
      throw refusal("read-only", store === null ? "This page can only read this artifact's store." : `This page can only read resource ${store}.`);
    }
    const seq = this.nextSeq;
    const message = JSON.stringify({ type: "write", seq, ...addressOf(store), write } satisfies PageClientMessage);
    checkWriteMessage(message);
    this.nextSeq += 1;
    let settle!: QueuedWrite["settle"];
    const done = new Promise<WriteOutcome>((resolve, reject) => {
      settle = { resolve, reject };
    });
    this.writes.set(seq, { seq, store, local, message, settle, onMismatch });
    this.ensureConnected();
    this.notifyQueue([store], this.ownStore);
    this.flushWrites();
    return done;
  }

  // --- The connection ---

  private needed(): boolean {
    return (
      this.writes.size > 0 ||
      this.requests.size > 0 ||
      this.accessWaiters.size > 0 ||
      this.subscriptions.size > 0 ||
      this.eventCallbacks.size > 0 ||
      this.accessCallbacks.size > 0 ||
      this.statusCallbacks.size > 0
    );
  }

  /** Opens a connection when the page has none and is not waiting to reconnect. */
  private ensureConnected(): void {
    if (this.socket !== null || this.reconnectTimer !== null) return;
    this.setStatus("connecting");
    this.connect();
  }

  private connect(): void {
    this.reconnectTimer = null;
    // wss: on a page loaded over https:, as through a front that terminates TLS (specs/arch/resources/sdk.md#^sdk-connection).
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${artifactRoutes.connection(this.id)}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket || typeof event.data !== "string") return;
      this.receive(JSON.parse(event.data) as PageServerMessage);
    });
    socket.addEventListener("close", () => this.closed(socket));
  }

  private queueIdleCheck(): void {
    if (this.idleCheckQueued) return;
    this.idleCheckQueued = true;
    queueMicrotask(() => {
      this.idleCheckQueued = false;
      if (this.needed()) return;
      if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.attempt = 0;
      const socket = this.socket;
      this.socket = null;
      this.forgetAccess();
      socket?.close();
      this.setStatus("idle");
    });
  }

  /** A connection closed, not by the SDK: the page is disconnected until a later connection's opening state. */
  private closed(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    // The writes it rolls back count for the own store by the address the connection gave.
    const ownStore = this.ownStore;
    this.forgetAccess();
    if (!this.needed()) {
      this.setStatus("idle");
      return;
    }
    const base = Math.min(BACKOFF_CAP_MS, BACKOFF_START_MS * 2 ** this.attempt);
    this.attempt += 1;
    // Equal jitter: half the interval fixed, half random.
    this.reconnectTimer = setTimeout(() => this.connect(), base / 2 + (Math.random() * base) / 2);
    // The page hears the status first, so what it does on hearing the rest of the loss sees it.
    this.setStatus("disconnected");
    this.failOutstanding(disconnected(), ownStore);
    this.queueIdleCheck();
  }

  /**
   * The access came from a connection's opening state, changes of it and
   * events, so it holds only while that connection is open: a level changed
   * while the page has no connection reaches it with the next opening state.
   * Access callbacks keep what they last heard, and hear the next opening
   * state's level only if it differs.
   */
  private forgetAccess(): void {
    this.level = undefined;
    this.ownStore = undefined;
    this.bindings.clear();
  }

  /** Rolls back every unconfirmed write at once and rejects it and every outstanding request with `error`. */
  private failOutstanding(error: ResourceError, ownStore: ResourceID | undefined): void {
    const rolledBack = this.queue();
    this.writes.clear();
    const requests = [...this.requests.values(), ...this.accessWaiters];
    this.requests.clear();
    this.accessWaiters.clear();
    if (rolledBack.length > 0) this.notifyQueue([...new Set(rolledBack.map((queued) => queued.store))], ownStore);
    for (const queued of rolledBack) queued.settle.reject(error);
    for (const request of requests) request.reject(error);
  }

  private send(message: PageClientMessage): void {
    this.socket?.send(JSON.stringify(message));
  }

  /**
   * Sends, in sequence order, every queued write not yet sent on the open
   * connection. Writes are sent only here, so a write the page makes while it
   * hears an earlier one still reaches the server after it.
   */
  private flushWrites(): void {
    if (this.currentStatus !== "connected") return;
    for (let seq = this.sentSeq + 1; seq < this.nextSeq; seq++) {
      this.sentSeq = seq;
      const queued = this.writes.get(seq);
      if (queued) this.socket?.send(queued.message);
    }
  }

  /** Tells the queue's observers whose queued writes changed, naming the own store, when it is among them, by both the addresses `ownStore` gives it. */
  private notifyQueue(stores: readonly StoreKey[], ownStore: ResourceID | undefined): void {
    const own = ownStoreAddresses(ownStore);
    const changed = stores.some((store) => own.includes(store)) ? [...new Set([...stores, ...own])] : stores;
    for (const observer of this.queueObservers) observer(changed);
  }

  private open(message: Extract<PageServerMessage, { type: "open" }>): void {
    this.attempt = 0;
    this.serverTimeOffset = message.serverTime - Date.now();
    const level = this.takeAccess(message);
    for (const [id, subscription] of this.subscriptions) this.send({ type: "subscribe", id, ...addressOf(subscription.store), path: subscription.path });
    for (const request of this.requests.values()) this.send(request.message);
    // Only writes made while this connection was opening are queued: a loss leaves none.
    const first = this.writes.keys().next();
    this.sentSeq = (first.done === true ? this.nextSeq : first.value) - 1;
    this.setStatus("connected");
    const waiters = [...this.accessWaiters];
    this.accessWaiters.clear();
    for (const waiter of waiters) waiter.resolve(level);
    this.accessChanged();
    this.flushWrites();
    this.queueIdleCheck();
  }

  /** Tells each access callback the level now, if it has not heard it. */
  private accessChanged(): void {
    for (const entry of [...this.accessCallbacks]) this.tellAccess(entry);
  }

  private receive(message: PageServerMessage): void {
    switch (message.type) {
      case "open":
        this.open(message);
        return;
      case "unavailable":
        this.refuseEverything(refusal("unavailable", message.error));
        return;
      case "applied":
        this.acknowledge(message.seq, (queued) => queued.settle.resolve({ kind: "applied" }));
        return;
      case "mismatch":
        this.acknowledge(message.seq, (queued) => {
          queued.onMismatch?.(message.current);
          queued.settle.resolve({ kind: "mismatch", current: message.current, valueSeq: message.valueSeq });
        });
        return;
      case "refused":
        this.acknowledge(message.seq, (queued) => queued.settle.reject(refusal(message.code, message.error)));
        return;
      case "access":
        // No level is an artifact without a store, whatever the share link's level.
        this.takeAccess(message);
        this.accessChanged();
        return;
      case "event":
        this.event(message.event);
        return;
      case "value": {
        const subscription = this.subscriptions.get(message.id);
        if (subscription) {
          subscription.handlers.onValue(message.result, message.seq);
          return;
        }
        this.answer(message.id, message);
        return;
      }
      case "error": {
        const subscription = this.subscriptions.get(message.id);
        if (subscription) {
          this.subscriptions.delete(message.id);
          subscription.handlers.onEnd(refusal(message.code, message.error));
          this.queueIdleCheck();
          return;
        }
        const request = this.requests.get(message.id);
        if (!request) return;
        this.requests.delete(message.id);
        request.reject(refusal(message.code, message.error));
        this.queueIdleCheck();
        return;
      }
      case "resources":
      case "resource":
        this.answer(message.id, message);
        return;
    }
  }

  private answer(id: string, reply: Reply): void {
    const request = this.requests.get(id);
    if (!request) return;
    this.requests.delete(id);
    request.resolve(reply);
    this.queueIdleCheck();
  }

  private acknowledge(seq: number, settle: (queued: QueuedWrite<Local>) => void): void {
    const queued = this.writes.get(seq);
    if (!queued) return;
    this.writes.delete(seq);
    settle(queued);
    this.notifyQueue([queued.store], this.ownStore);
    this.queueIdleCheck();
  }

  private event(event: PageEvent): void {
    switch (event.event) {
      case "bound":
        this.bindings.set(event.resourceID, event.access);
        break;
      case "unbound":
      case "destroyed":
        this.bindings.delete(event.resourceID);
        break;
      default:
        break;
    }
    for (const callback of [...this.eventCallbacks]) callPage(callback, event);
  }

  /** The resource layer refuses every request: subscriptions end, and everything outstanding fails, with `unavailable`. */
  private refuseEverything(error: ResourceError): void {
    for (const [id, subscription] of [...this.subscriptions]) {
      this.subscriptions.delete(id);
      subscription.handlers.onEnd(error);
    }
    this.failOutstanding(error, this.ownStore);
    this.queueIdleCheck();
  }
}

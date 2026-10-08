import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import {
  adminRoutes,
  artifactRoutes,
  encodeUpdateEntries,
  encodeWriteValue,
  storeQuery,
  type AccessLevel,
  type JSONValue,
  type JsonReadResult,
  type PageClientMessage,
  type PageEvent,
  type PageServerMessage,
  type PageWrite,
  type ResourceEvent,
  type StoreAddress,
  type UpdateEntryValue,
  type WriteValue,
} from "@telepath-computer/television-shared/resources";
import { getArtifactLiveMetadataPath } from "../../src/artifact-paths.ts";
import { Server } from "../../src/server.ts";
import type { ServerStore } from "../../src/server-store.ts";
import { nodeResourceStorageOperations, type ResourceStorageOperations } from "../../src/resources/storage.ts";
import { createServingStore } from "../../../../test/helpers/serving-store.ts";

export interface StartOptions {
  /** Reuse a home, as a restart over the same storage does. */
  home?: string;
  /** The built resource SDK's directory, to serve /sdk/v1/resources.js. */
  sdkDir?: string;
  /** A directory served at the server's root, as the web app's is. */
  staticDir?: string;
  auth?: boolean;
  storage?: ResourceStorageOperations;
  /** An onboarding content tree the store installs from on its serving boot. */
  onboardingContentPath?: string;
  /** Versioned canonical build output, served at /canonical/v<n>/. */
  canonicalDir?: string;
  /** The bindings hook (proofs/arch/resources/index.md, Test hooks). */
  resourceBindings?: boolean;
  /** The ID-generator hook (proofs/arch/resources/index.md, Test hooks). */
  generateID?: () => string;
}

/** What `createArtifact` registers. */
export interface ArtifactFixture {
  /** The content's form: an HTML file by default. */
  form?: "html" | "htm" | "markdown" | "folder" | "url";
  /** A fixed ID, as earlier releases' onboarding gave its artifacts. */
  id?: string;
  /** Where the content is written, without its extension, instead of a new name in the home. */
  at?: string;
}

export interface HttpResult {
  status: number;
  // Test assertions read whatever shape the route answered with.
  body: any;
  headers: Headers;
}

export interface RequestOptions {
  /** The bearer token to send: the server's by default, `null` for none. */
  token?: string | null;
  headers?: Record<string, string>;
  /** A raw body sent as is, in place of JSON. */
  rawBody?: string;
}

/** A really-running in-process server over temporary storage on the real filesystem. */
export class RunningServer {
  readonly server: Server;
  readonly store: ServerStore;
  readonly home: string;
  readonly baseURL: string;
  private readonly context: ResourceTestContext;

  constructor(context: ResourceTestContext, server: Server, store: ServerStore, home: string) {
    this.context = context;
    this.server = server;
    this.store = store;
    this.home = home;
    this.baseURL = server.getBaseURL();
  }

  get token(): string {
    return this.store.authToken;
  }

  get host(): string {
    return new URL(this.baseURL).host;
  }

  async request(method: string, route: string, body?: unknown, options: RequestOptions = {}): Promise<HttpResult> {
    const headers: Record<string, string> = { ...options.headers };
    const token = options.token === undefined ? this.token : options.token;
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    let payload: string | undefined;
    if (options.rawBody !== undefined) {
      payload = options.rawBody;
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["Content-Type"] ??= "application/json";
    }
    const response = await fetch(`${this.baseURL}${route}`, { method, headers, body: payload });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      // Not JSON: keep the text.
    }
    return { status: response.status, body: parsed, headers: response.headers };
  }

  /** Creates a store with the bindings flag on; the result's body carries its summary. */
  async createJsonStore(input: { description?: string; usage?: string; value?: JSONValue } = {}): Promise<HttpResult> {
    return this.request("POST", adminRoutes.jsonCreate, {
      description: input.description ?? "A store a test created",
      ...(input.usage === undefined ? {} : { usage: input.usage }),
      ...(input.value === undefined ? {} : { value: input.value }),
    });
  }

  /** Creates a store with the bindings flag on and returns its resource ID. */
  async createdStore(input: { description?: string; usage?: string; value?: JSONValue } = {}): Promise<string> {
    const created = await this.createJsonStore(input);
    if (created.status !== 201) throw new Error(`creating a store answered ${created.status}: ${JSON.stringify(created.body)}`);
    return (created.body as { resource: { resourceID: string } }).resource.resourceID;
  }

  /** The resource ID an artifact's record points to, if it has one. */
  storePointer(artifactID: string): string | undefined {
    return (JSON.parse(readFileSync(this.recordFile(artifactID), "utf8")) as { store?: string }).store;
  }

  async jsonGet(store: StoreAddress, jsonPath = ""): Promise<HttpResult> {
    const query = storeQuery(store);
    query.set("path", jsonPath);
    return this.request("GET", `${adminRoutes.jsonGet}?${query.toString()}`);
  }

  async jsonSet(store: StoreAddress, jsonPath: string, value: WriteValue): Promise<HttpResult> {
    return this.request("POST", adminRoutes.jsonSet, { store, path: jsonPath, value: encodeWriteValue(value) });
  }

  async jsonUpdate(store: StoreAddress, jsonPath: string, values: Record<string, UpdateEntryValue>): Promise<HttpResult> {
    return this.request("POST", adminRoutes.jsonUpdate, { store, path: jsonPath, entries: encodeUpdateEntries(values) });
  }

  async jsonPush(store: StoreAddress, jsonPath: string, key: string, value: WriteValue): Promise<HttpResult> {
    return this.request("POST", adminRoutes.jsonPush, { store, path: jsonPath, key, value: encodeWriteValue(value) });
  }

  async jsonRemove(store: StoreAddress, jsonPath: string): Promise<HttpResult> {
    return this.request("POST", adminRoutes.jsonRemove, { store, path: jsonPath });
  }

  /** The path of an artifact's record file. */
  recordFile(artifactID: string): string {
    return getArtifactLiveMetadataPath(this.home, artifactID);
  }

  async bind(resourceID: string, artifactID: string, access: "read" | "read-write"): Promise<HttpResult> {
    return this.request("POST", adminRoutes.bind(resourceID), { artifactID, access });
  }

  async unbind(resourceID: string, artifactID: string): Promise<HttpResult> {
    return this.request("POST", adminRoutes.unbind(resourceID), { artifactID });
  }

  async info(resourceID: string): Promise<HttpResult> {
    return this.request("GET", adminRoutes.info(resourceID));
  }

  async list(artifactID?: string): Promise<HttpResult> {
    return this.request("GET", artifactID === undefined ? adminRoutes.list : `${adminRoutes.list}?artifact=${encodeURIComponent(artifactID)}`);
  }

  async describe(resourceID: string, change: { description?: string; usage?: string }): Promise<HttpResult> {
    return this.request("POST", adminRoutes.describe(resourceID), change);
  }

  async destroy(resourceID: string, force = false): Promise<HttpResult> {
    return this.request("POST", adminRoutes.destroy(resourceID), force ? { force: true } : {});
  }

  /** Shares an artifact at `access`, or, when it is undefined, with no level given. */
  async share(artifactID: string, access?: "read" | "read-write", options: RequestOptions = {}): Promise<HttpResult> {
    return this.request("POST", adminRoutes.share(artifactID), access === undefined ? {} : { access }, options);
  }

  /** Shares an artifact and returns its share ID. */
  async sharedAt(artifactID: string, access: "read" | "read-write"): Promise<string> {
    const shared = await this.share(artifactID, access);
    if (shared.status !== 200) throw new Error(`sharing answered ${shared.status}: ${JSON.stringify(shared.body)}`);
    return (shared.body as { shareID: string }).shareID;
  }

  async unshare(artifactID: string, options: RequestOptions = {}): Promise<HttpResult> {
    return this.request("POST", adminRoutes.unshare(artifactID), {}, options);
  }

  /** Registers an artifact on the first channel, an HTML file unless `fixture` says otherwise, and returns its ID. */
  createArtifact(title = "Artifact", fixture: ArtifactFixture = {}): string {
    const channel = this.store.listChannels()[0]!;
    const id = fixture.id === undefined ? {} : { id: fixture.id };
    if (fixture.form === "url") {
      return this.store.createArtifact({ ...id, kind: "url", title, channelID: channel.id, url: "https://example.com/" }).id;
    }
    const base = fixture.at ?? path.join(this.home, `${title.replace(/\W+/g, "-")}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(path.dirname(base), { recursive: true });
    let target: string;
    if (fixture.form === "folder") {
      mkdirSync(base);
      writeFileSync(path.join(base, "index.html"), "<!doctype html><title>artifact</title>");
      target = `${base}/`;
    } else {
      target = `${base}.${fixture.form === "markdown" ? "md" : (fixture.form ?? "html")}`;
      writeFileSync(target, fixture.form === "markdown" ? "# Artifact\n" : "<!doctype html><title>artifact</title>");
    }
    return this.store.createArtifact({ ...id, kind: "path", title, channelID: channel.id, path: target }).id;
  }

  wsURL(route: string, query: Record<string, string> = {}): string {
    const url = new URL(route, this.baseURL);
    url.protocol = "ws:";
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.toString();
  }

  /** Opens a page connection under an artifact ID or a share ID; resolves once the opening state arrives. */
  async pageConnection(id: string, options: PageConnectionOptions = {}): Promise<PageConnectionClient> {
    const client = await this.pageSocket(id, options);
    await client.opened();
    return client;
  }

  /** Opens a page connection without waiting for the opening state. */
  async pageSocket(id: string, options: PageConnectionOptions = {}): Promise<PageConnectionClient> {
    const socket = new WebSocket(this.wsURL(artifactRoutes.connection(id), options.query), { headers: { ...options.headers } });
    this.context.track(socket);
    const client = new PageConnectionClient(socket);
    await openOrRefusal(socket);
    return client;
  }

  /**
   * Opens `/events` with the server's token, or `token` (`null` for none),
   * and resolves once the stream's first message has arrived, after which
   * every resource event reaches the client.
   */
  async eventsClient(options: { token?: string | null } = {}): Promise<EventsClient> {
    const token = options.token === undefined ? this.token : options.token;
    const socket = new WebSocket(this.wsURL("/events", token === null ? {} : { token }));
    this.context.track(socket);
    const client = new EventsClient(socket);
    await openOrRefusal(socket);
    await client.log.waitFor(() => true);
    return client;
  }

  /** Stops the server, keeping its storage. */
  async stop(): Promise<void> {
    await this.context.stop(this);
  }
}

/** Resolves when a WebSocket opens; rejects with the HTTP status when its upgrade is refused. */
export function openOrRefusal(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("unexpected-response", (_request, response) => {
      reject(Object.assign(new Error(`upgrade refused with ${response.statusCode}`), { status: response.statusCode }));
      response.resume();
      socket.terminate();
    });
    socket.once("error", reject);
  });
}

export interface PageConnectionOptions {
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

/** Builds page writes in the placeholder encoding the SDK sends. */
export const pageWrite = {
  set: (path: string, value: WriteValue): PageWrite => ({ kind: "set", path, value: encodeWriteValue(value) }),
  update: (path: string, values: Record<string, UpdateEntryValue>): PageWrite => ({ kind: "update", path, entries: encodeUpdateEntries(values) }),
  push: (path: string, key: string, value: WriteValue): PageWrite => ({ kind: "push", path, key, value: encodeWriteValue(value) }),
  remove: (path: string): PageWrite => ({ kind: "remove", path }),
  compareAndSet: (path: string, expected: JsonReadResult, value: JSONValue): PageWrite => ({ kind: "compare-and-set", path, expected, value }),
};

/** A page message's store: its artifact's own store, or the store with `resourceID`. */
function addressed(resourceID: string | undefined): { resourceID?: string } {
  return resourceID === undefined ? {} : { resourceID };
}

class MessageLog<T> {
  readonly messages: T[] = [];
  private readonly waiters = new Set<() => void>();

  push(message: T): void {
    this.messages.push(message);
    for (const waiter of [...this.waiters]) waiter();
  }

  /** The first message at or after `from` that matches, waiting for it to arrive. */
  waitFor(predicate: (message: T) => boolean, from = 0, timeoutMs = 5_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = (): boolean => {
        const found = this.messages.slice(from).find(predicate);
        if (found === undefined) return false;
        this.waiters.delete(waiter);
        clearTimeout(timer);
        resolve(found);
        return true;
      };
      const waiter = () => void check();
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`no matching message within ${timeoutMs}ms; saw ${JSON.stringify(this.messages.slice(from))}`));
      }, timeoutMs);
      if (!check()) this.waiters.add(waiter);
    });
  }
}

type OpenMessage = Extract<PageServerMessage, { type: "open" }>;
type WriteReply = Extract<PageServerMessage, { type: "applied" | "refused" | "mismatch" }>;

/** A client that plays the SDK's side of the page connection through the shared framing. */
export class PageConnectionClient {
  readonly socket: WebSocket;
  readonly log = new MessageLog<PageServerMessage>();
  /** Resolves with the close code once the connection has closed. */
  readonly closed: Promise<number>;
  private nextID = 0;

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (data) => this.log.push(JSON.parse(data.toString()) as PageServerMessage));
    this.closed = new Promise((resolve) => socket.once("close", (code) => resolve(code)));
  }

  get messages(): PageServerMessage[] {
    return this.log.messages;
  }

  /** The opening state; only after `opened()` has resolved. */
  get opening(): OpenMessage {
    const first = this.messages[0];
    if (first?.type !== "open") throw new Error(`no opening state; first message ${JSON.stringify(first)}`);
    return first;
  }

  get events(): PageEvent[] {
    return this.messages.flatMap((message) => (message.type === "event" ? [message.event] : []));
  }

  /** The levels the server sent after the opening state, in order: undefined for no level. */
  get accessChanges(): Array<AccessLevel | undefined> {
    return this.messages.flatMap((message) => (message.type === "access" ? [message.access] : []));
  }

  send(message: PageClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Resolves with the opening state; rejects when the connection ends or answers otherwise first. */
  async opened(): Promise<OpenMessage> {
    const first = await this.firstMessage();
    if (first?.type === "open") return first;
    throw new Error(first ? `page connection answered ${JSON.stringify(first)}` : "page connection closed before its opening state");
  }

  /** The connection's first message, or null when it closes without one. */
  firstMessage(): Promise<PageServerMessage | null> {
    const first = this.messages[0];
    if (first || this.socket.readyState === WebSocket.CLOSED) return Promise.resolve(first ?? null);
    return new Promise((resolve) => {
      // Registered after the constructor's listener, so the log already holds the message.
      const settle = () => {
        this.socket.off("message", settle);
        this.socket.off("close", settle);
        resolve(this.messages[0] ?? null);
      };
      this.socket.on("message", settle);
      this.socket.on("close", settle);
    });
  }

  newID(): string {
    return `request-${this.nextID++}`;
  }

  /** Sends a request and resolves with the first reply that carries its ID. */
  async request(message: PageClientMessage & { id: string }): Promise<PageServerMessage> {
    const from = this.messages.length;
    this.send(message);
    return this.log.waitFor((reply) => "id" in reply && reply.id === message.id, from);
  }

  list(): Promise<PageServerMessage> {
    return this.request({ type: "list", id: this.newID() });
  }

  info(resourceID: string): Promise<PageServerMessage> {
    return this.request({ type: "info", id: this.newID(), resourceID });
  }

  /** Reads the artifact's own store, or with `resourceID` another store. */
  get(path = "", resourceID?: string): Promise<PageServerMessage> {
    return this.request({ type: "get", id: this.newID(), ...addressed(resourceID), path });
  }

  /** Starts a subscription to the artifact's own store, or with `resourceID` another store, and returns its ID once its first reply arrives. */
  async subscribe(path = "", resourceID?: string): Promise<string> {
    const id = this.newID();
    await this.request({ type: "subscribe", id, ...addressed(resourceID), path });
    return id;
  }

  /** Every reply a request or subscription received, in order. */
  replies(id: string): PageServerMessage[] {
    return this.messages.filter((message) => "id" in message && message.id === id);
  }

  /** The values a subscription received, in order. */
  values(id: string): Array<{ result: JsonReadResult; seq: number }> {
    return this.replies(id).flatMap((message) => (message.type === "value" ? [{ result: message.result, seq: message.seq }] : []));
  }

  /**
   * Sends a write to the artifact's own store, or with `resourceID` another
   * store, and resolves with the first answer for its sequence number that
   * arrives after it.
   */
  async write(seq: number, write: PageWrite, resourceID?: string): Promise<WriteReply> {
    const from = this.messages.length;
    this.send({ type: "write", seq, ...addressed(resourceID), write });
    return this.waitForWriteReply(seq, from);
  }

  waitForWriteReply(seq: number, from = 0): Promise<WriteReply> {
    return this.log.waitFor(
      (message) => (message.type === "applied" || message.type === "refused" || message.type === "mismatch") && message.seq === seq,
      from,
    ) as Promise<WriteReply>;
  }

  waitForEvent(predicate: (event: PageEvent) => boolean, from = 0): Promise<PageEvent> {
    return this.log
      .waitFor((message) => message.type === "event" && predicate(message.event), from)
      .then((message) => (message as { event: PageEvent }).event);
  }

  /** Closes the connection and resolves once it has closed. */
  async close(): Promise<void> {
    this.socket.close();
    await this.closed;
  }
}

/** A client of the `/events` stream, collecting every message it receives. */
export class EventsClient {
  readonly socket: WebSocket;
  readonly log = new MessageLog<{ type: string; event?: ResourceEvent }>();

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (data) => this.log.push(JSON.parse(data.toString()) as { type: string }));
  }

  get resourceMessages(): Array<{ type: string; event?: ResourceEvent }> {
    return this.log.messages.filter((message) => message.type === "resource-event");
  }

  /** The resource events received so far, in order. */
  get events(): ResourceEvent[] {
    return this.resourceMessages.map((message) => message.event!);
  }

  waitForEvent(predicate: (event: ResourceEvent) => boolean, from = 0): Promise<ResourceEvent> {
    return this.log
      .waitFor((message) => message.type === "resource-event" && predicate(message.event!), from)
      .then((message) => message.event!);
  }
}

/** A storage operation a test can make fail. */
export type StorageOperation = keyof ResourceStorageOperations;

/**
 * The storage-operations hook (proofs/arch/resources/index.md, Test hooks):
 * Node's operations, except that `fail` makes the calls of one operation on a
 * path containing `file` throw, until `succeed`; several may fail at once.
 * With `corrupt`, a failing directory flush first overwrites the file last
 * renamed into that directory with text that is not JSON, so a read of it
 * finds it not valid.
 */
export function failingStorage(): {
  storage: ResourceStorageOperations;
  fail(operation: StorageOperation, file: string, options?: { corrupt?: boolean }): void;
  succeed(): void;
} {
  const plans: Array<{ operation: StorageOperation; file: string; corrupt: boolean }> = [];
  const lastRenamed = new Map<string, string>();
  const wrap = <K extends StorageOperation>(operation: K): ResourceStorageOperations[K] =>
    ((...args: string[]) => {
      const target = operation === "writeTemporaryFile" ? args[0]! : args[args.length - 1]!;
      const plan = plans.find((candidate) => candidate.operation === operation && target.includes(candidate.file));
      if (plan !== undefined) {
        const renamed = lastRenamed.get(target);
        if (plan.corrupt && operation === "flushDirectory" && renamed !== undefined) writeFileSync(renamed, "{ not valid");
        throw new Error(`injected ${operation} failure`);
      }
      const result = (nodeResourceStorageOperations[operation] as (...a: string[]) => unknown)(...args);
      if (operation === "rename") lastRenamed.set(path.dirname(args[1]!), args[1]!);
      return result;
    }) as ResourceStorageOperations[K];
  return {
    storage: {
      writeTemporaryFile: wrap("writeTemporaryFile"),
      flushFile: wrap("flushFile"),
      rename: wrap("rename"),
      flushDirectory: wrap("flushDirectory"),
      deleteFile: wrap("deleteFile"),
      createDirectory: wrap("createDirectory"),
      removeDirectory: wrap("removeDirectory"),
      readFile: wrap("readFile"),
      readDirectory: wrap("readDirectory"),
      exists: wrap("exists"),
    },
    fail: (operation, file, options = {}) => {
      plans.push({ operation, file, corrupt: options.corrupt ?? false });
    },
    succeed: () => {
      plans.length = 0;
    },
  };
}

/** Tracks servers, homes and sockets a test creates, and cleans them up. */
export class ResourceTestContext {
  private readonly homes: string[] = [];
  private readonly running = new Set<Server>();
  private readonly sockets: WebSocket[] = [];

  home(): string {
    const home = mkdtempSync(path.join(os.tmpdir(), "television-resources-"));
    this.homes.push(home);
    return home;
  }

  track(socket: WebSocket): void {
    this.sockets.push(socket);
  }

  async start(options: StartOptions = {}): Promise<RunningServer> {
    const home = options.home ?? this.home();
    const store = createServingStore(home, {
      ...(options.storage ? { resourceStorageOperations: options.storage } : {}),
      ...(options.onboardingContentPath ? { onboardingContentPath: options.onboardingContentPath } : {}),
      ...(options.generateID ? { generateID: options.generateID } : {}),
    });
    const server = new Server({
      store,
      host: "127.0.0.1",
      port: 0,
      auth: options.auth ?? true,
      ...(options.sdkDir ? { sdkDir: options.sdkDir } : {}),
      ...(options.staticDir ? { staticDir: options.staticDir } : {}),
      ...(options.canonicalDir ? { canonicalDir: options.canonicalDir } : {}),
      ...(options.resourceBindings === undefined ? {} : { resourceBindings: options.resourceBindings }),
    });
    await server.start();
    this.running.add(server);
    return new RunningServer(this, server, store, home);
  }

  async stop(running: RunningServer): Promise<void> {
    if (!this.running.delete(running.server)) return;
    await running.server.dispose();
  }

  async cleanup(): Promise<void> {
    for (const socket of this.sockets.splice(0)) socket.terminate();
    for (const server of [...this.running]) await server.dispose();
    this.running.clear();
    for (const home of this.homes.splice(0)) rmSync(home, { recursive: true, force: true });
  }
}

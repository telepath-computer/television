import { type Artifact } from "@telepath-computer/television-artifact";
import { TELEVISION_CLIENT_META_HEADER } from "./types.ts";
import type {
  ArtifactPatch,
  CreateArtifactResult,
  DeleteArtifactResult,
  DisplayPatch,
  DisplayState,
  FocusResult,
  NewArtifact,
  Channel,
  ChannelPatch,
  ChannelRemovalResult,
  ClientTelemetryMeta,
  TelemetryStatus,
  ThemeRegistrySnapshot,
} from "./types.ts";
import { RequestError, ValidationError } from "./errors.ts";
import {
  adminRoutes,
  checkWriteMessage,
  encodeUpdateEntries,
  encodeWriteValue,
  jsonEqual,
  parseJsonPath,
  pathsMeet,
  resourceError,
  storeQuery,
  validateJsonValue,
  type AccessLevel,
  type BindResponse,
  type DescribeRequest,
  type DestroyResponse,
  type InfoResponse,
  type JSONValue,
  type JsonReadResult,
  type ListResponse,
  type ResourceEvent,
  type ResourceID,
  type ResourceSummary,
  type ShareResponse,
  type StoreAddress,
  type SummaryResponse,
} from "./resources/index.ts";

const HTTP_OK = 200;
const HTTP_MULTIPLE_CHOICES = 300;
const HTTP_UNAUTHORIZED = 401;

// The `/events` stream (specs/arch/resources/index.md#^rs-events-stream).
const EVENTS_ROUTE = "/events";
const EVENTS_AUTH_FAILED_CLOSE_CODE = 4401;

type HTTPMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface TelevisionClientOptions {
  token?: string;
  onUnauthorized?: () => void;
  telemetryMeta?: ClientTelemetryMeta;
}

export interface HealthStatus {
  status: string;
  /**
   * The server's release version; "0.0.0" for development builds
   * (specs/arch/updates/version-advertisement.md ^health-version). Optional
   * because servers before 0.1.179 do not send it, and this client may be
   * pointed at one (e.g. `tv status` against an old daemon).
   */
  version?: string;
  bindAddresses: string[];
  /** The origins the server can be reached at, a wildcard listener expanded (specs/arch/cli/index.md#^cli-server-origins). */
  origins: string[];
  port: number;
}

/**
 * Shared HTTP plumbing: fetch, auth header, error shape, JSON parsing.
 * Private to this module; sub-clients consume it but never re-export it.
 */
class HttpRequester {
  readonly serverURL: string;
  private readonly token: string | undefined;
  private readonly onUnauthorized: (() => void) | undefined;
  private readonly telemetryMeta: ClientTelemetryMeta | undefined;

  constructor(serverURL: string, options: TelevisionClientOptions) {
    this.serverURL = serverURL.replace(/\/$/, "");
    this.token = options.token;
    this.onUnauthorized = options.onUnauthorized;
    this.telemetryMeta = options.telemetryMeta;
  }

  async requestJSON<T>(
    method: HTTPMethod,
    pathname: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    return this.requestSerializedJSON<T>(method, pathname, body !== undefined ? JSON.stringify(body) : undefined);
  }

  /** As `requestJSON`, with a body already serialized as JSON. */
  async requestSerializedJSON<T>(method: HTTPMethod, pathname: string, body?: string): Promise<T> {
    const response = await this.request(
      method,
      pathname,
      body,
      body !== undefined ? { "content-type": "application/json" } : undefined,
    );
    const payload = (await parseJSON(response)) as Record<string, unknown>;
    if (!response.ok || response.status < HTTP_OK || response.status >= HTTP_MULTIPLE_CHOICES) {
      if (response.status === HTTP_UNAUTHORIZED) this.onUnauthorized?.();
      throw this.createError(
        typeof payload.error === "string" ? payload.error : response.statusText,
        response.status,
      );
    }
    return payload as T;
  }

  async requestVoid(method: HTTPMethod, pathname: string, body?: Record<string, unknown>): Promise<void> {
    const response = await this.request(
      method,
      pathname,
      body !== undefined ? JSON.stringify(body) : undefined,
      body !== undefined ? { "content-type": "application/json" } : undefined,
    );
    if (!response.ok) {
      if (response.status === HTTP_UNAUTHORIZED) this.onUnauthorized?.();
      throw this.createError(
        await extractErrorMessage(response, response.statusText),
        response.status,
      );
    }
  }

  async requestText(method: HTTPMethod, pathname: string): Promise<string> {
    const response = await this.request(method, pathname);
    if (!response.ok) {
      if (response.status === HTTP_UNAUTHORIZED) this.onUnauthorized?.();
      throw this.createError(
        await extractErrorMessage(response, response.statusText),
        response.status,
      );
    }
    return response.text();
  }

  async requestRawVoid(method: HTTPMethod, pathname: string, body: string): Promise<void> {
    const response = await this.request(method, pathname, body, { "content-type": "text/markdown; charset=utf-8" });
    if (!response.ok) {
      if (response.status === HTTP_UNAUTHORIZED) this.onUnauthorized?.();
      throw this.createError(
        await extractErrorMessage(response, response.statusText),
        response.status,
      );
    }
  }

  /** The URL of a WebSocket route, carrying the token as the `token` query parameter. */
  webSocketURL(pathname: string): string {
    const url = new URL(`${this.serverURL}${pathname}`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (this.token) url.searchParams.set("token", this.token);
    return url.toString();
  }

  /** The error of a request the server rejected as unauthorized, reported as an HTTP `401` is. */
  unauthorizedError(message: string): RequestError {
    this.onUnauthorized?.();
    return this.createError(message, HTTP_UNAUTHORIZED);
  }

  createError(message: string, status?: number): RequestError {
    const fields: { serverURL: string; status?: number } = { serverURL: this.serverURL };
    if (status !== undefined) {
      fields.status = status;
    }
    return new RequestError(message, fields);
  }

  private async request(
    method: HTTPMethod,
    pathname: string,
    body?: string,
    headers?: Record<string, string>,
  ): Promise<Response> {
    const url = `${this.serverURL}${pathname}`;
    try {
      return await fetch(url, {
        method,
        headers: this.buildHeaders(headers),
        body,
      });
    } catch (error) {
      throw this.createError(error instanceof Error ? error.message : "Failed to reach server");
    }
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> | undefined {
    const headers: Record<string, string> = { ...(extra ?? {}) };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (this.telemetryMeta) {
      headers[TELEVISION_CLIENT_META_HEADER] = JSON.stringify(this.telemetryMeta);
    }
    return Object.keys(headers).length > 0 ? headers : undefined;
  }
}

async function parseJSON(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    const text = await response.text().catch(() => "");
    return text ? { message: text } : {};
  }
}

async function extractErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    if (typeof payload.error === "string") {
      return payload.error;
    }
    if (typeof payload.message === "string") {
      return payload.message;
    }
  } catch {
    // fall through
  }
  return fallback;
}

function formatChannelChoices(channels: Channel[]): string {
  return channels.map((channel) => `${channel.name} (${channel.id})`).join(", ");
}


/** Channel CRUD endpoints. */
export class ChannelClient {
  readonly #http: HttpRequester;

  constructor(http: HttpRequester) {
    this.#http = http;
  }

  list(): Promise<{ channels: Channel[] }> {
    return this.#http.requestJSON<{ channels: Channel[] }>("GET", "/channels");
  }

  async get(
    input: { channelID?: string } = {},
  ): Promise<{ channel: Channel; artifacts: Artifact[] }> {
    const channelID = await this.#resolveChannelID(input.channelID);
    return this.#http.requestJSON<{ channel: Channel; artifacts: Artifact[] }>(
      "GET",
      `/channels/${encodeURIComponent(channelID)}`,
    );
  }

  create(input: { name: string; id?: string }): Promise<{ channel: Channel }> {
    const body: Record<string, unknown> = { name: input.name };
    if (input.id !== undefined) {
      body.id = input.id;
    }
    return this.#http.requestJSON<{ channel: Channel }>("POST", "/channels", body);
  }

  update(input: { channelID: string } & ChannelPatch): Promise<{ channel: Channel }> {
    const { channelID, ...body } = input;
    return this.#http.requestJSON<{ channel: Channel }>(
      "PATCH",
      `/channels/${encodeURIComponent(channelID)}`,
      body,
    );
  }

  remove(input: { channelID: string }): Promise<ChannelRemovalResult> {
    return this.#http.requestJSON<ChannelRemovalResult>(
      "DELETE",
      `/channels/${encodeURIComponent(input.channelID)}`,
    );
  }

  async #resolveChannelID(channelID: string | undefined): Promise<string> {
    if (channelID !== undefined) {
      return channelID;
    }
    const { channels } = await this.list();
    if (channels.length === 1) {
      return channels[0].id;
    }
    if (channels.length === 0) {
      throw new ValidationError("channelID is required, but no channels exist.");
    }
    throw new ValidationError(
      `channelID is required when multiple channels exist. Available channels: ${formatChannelChoices(channels)}`,
    );
  }
}

/** Artifact registry CRUD. */
export class ArtifactClient {
  readonly #http: HttpRequester;

  constructor(http: HttpRequester) {
    this.#http = http;
  }

  /** Create an artifact on a channel in one round trip. */
  create(input: ({ channelID: string } & NewArtifact)): Promise<CreateArtifactResult> {
    const body: Record<string, unknown> = {
      kind: input.kind,
      title: input.title,
    };
    switch (input.kind) {
      case "path":
        body.path = input.path;
        break;
      case "url":
        body.url = input.url;
        break;
    }
    body.channelID = input.channelID;
    return this.#http.requestJSON<CreateArtifactResult>("POST", "/artifacts", body);
  }

  /**
   * List artifacts. With no filter, returns every artifact known to the
   * server. `channelID` filters to a single channel's members.
   */
  list(input: { channelID?: string } = {}): Promise<{ artifacts: Artifact[] }> {
    const params = new URLSearchParams();
    if (input.channelID !== undefined) params.set("channelID", input.channelID);
    const query = params.toString();
    return this.#http.requestJSON<{ artifacts: Artifact[] }>(
      "GET",
      query ? `/artifacts?${query}` : "/artifacts",
    );
  }

  get(input: { artifactID: string }): Promise<{ artifact: Artifact }> {
    return this.#http.requestJSON<{ artifact: Artifact }>(
      "GET",
      `/artifacts/${encodeURIComponent(input.artifactID)}`,
    );
  }

  update(input: { artifactID: string } & ArtifactPatch): Promise<{ artifact: Artifact }> {
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.path !== undefined) body.path = input.path;
    if (input.url !== undefined) body.url = input.url;
    return this.#http.requestJSON<{ artifact: Artifact }>(
      "PATCH",
      `/artifacts/${encodeURIComponent(input.artifactID)}`,
      body,
    );
  }

  /**
   * Delete an artifact: remove its owning card from its channel and remove the
   * registry metadata. The pointed-to path/URL is not touched.
   */
  delete(input: { artifactID: string }): Promise<DeleteArtifactResult> {
    return this.#http.requestJSON<DeleteArtifactResult>(
      "DELETE",
      `/artifacts/${encodeURIComponent(input.artifactID)}`,
    );
  }
}

/** Installed-theme registry endpoints. */
export class ThemeClient {
  readonly #http: HttpRequester;

  constructor(http: HttpRequester) {
    this.#http = http;
  }

  list(): Promise<ThemeRegistrySnapshot> {
    return this.#http.requestJSON<ThemeRegistrySnapshot>("GET", "/themes");
  }

  refresh(): Promise<ThemeRegistrySnapshot> {
    return this.#http.requestJSON<ThemeRegistrySnapshot>("POST", "/themes/refresh");
  }
}

/** Markdown content endpoint. */
export class MarkdownClient {
  readonly #http: HttpRequester;

  constructor(http: HttpRequester) {
    this.#http = http;
  }

  get(input: { artifactID: string }): Promise<string> {
    return this.#http.requestText("GET", `/markdown/${encodeURIComponent(input.artifactID)}`);
  }

  update(input: { artifactID: string; content: string }): Promise<void> {
    return this.#http.requestRawVoid(
      "PUT",
      `/markdown/${encodeURIComponent(input.artifactID)}`,
      input.content,
    );
  }
}

export class TelemetryControlClient {
  readonly #http: HttpRequester;

  constructor(http: HttpRequester) {
    this.#http = http;
  }

  status(): Promise<TelemetryStatus> {
    return this.#http.requestJSON<TelemetryStatus>("GET", "/telemetry");
  }

  enable(): Promise<TelemetryStatus> {
    return this.#http.requestJSON<TelemetryStatus>("POST", "/telemetry/enable");
  }

  disable(): Promise<TelemetryStatus> {
    return this.#http.requestJSON<TelemetryStatus>("POST", "/telemetry/disable");
  }
}

/** Display-control endpoints (focused channel + pins + theme + transient focus signals). */
export class DisplayClient {
  readonly #http: HttpRequester;

  constructor(http: HttpRequester) {
    this.#http = http;
  }

  get(): Promise<DisplayState> {
    return this.#http.requestJSON<DisplayState>("GET", "/display");
  }

  patch(input: DisplayPatch): Promise<void> {
    const body: Record<string, unknown> = {};
    if (input.focusedChannelId !== undefined) body.focusedChannelId = input.focusedChannelId;
    if (input.pinnedChannelIds !== undefined) body.pinnedChannelIds = input.pinnedChannelIds;
    if (input.activeThemeName !== undefined) body.activeThemeName = input.activeThemeName;
    if (input.appearanceMode !== undefined) body.appearanceMode = input.appearanceMode;
    if (input.themeJavaScriptConsentIds !== undefined) {
      body.themeJavaScriptConsentIds = input.themeJavaScriptConsentIds;
    }
    return this.#http.requestVoid("PATCH", "/display", body);
  }

  focus(input: { artifactID: string }): Promise<FocusResult> {
    return this.#http.requestJSON<FocusResult>("POST", "/display/focus", { artifactID: input.artifactID });
  }
}

/** A reading of the `/events` stream, and how to end it early. */
interface EventStreamReading {
  /** Resolves when the reading is aborted; rejects when it fails or the connection ends. */
  readonly finished: Promise<void>;
  readonly ended: boolean;
  end(error: Error): void;
}

/**
 * Reads the `/events` stream (specs/arch/resources/index.md#^rs-cli-integration):
 * calls `onReady` once the stream's first message has arrived, after which
 * every resource event reaches the reader, and `onEvent` with each resource
 * event, ignoring the stream's other messages, until `signal` aborts, which
 * resolves. A handler that throws ends the reading with its error. A
 * connection the server closes with 4401 fails as an HTTP `401` does; one that
 * closes otherwise, or never opens, fails as an unreachable server does.
 */
function readEventStream(
  http: HttpRequester,
  handlers: { onReady?: () => void; onEvent: (event: ResourceEvent) => void },
  signal: AbortSignal | undefined,
): EventStreamReading {
  let ended = false;
  let end: (error?: Error) => void = () => undefined;
  const finished = new Promise<void>((resolve, reject) => {
    let socket: WebSocket | null = null;
    end = (error) => {
      if (ended) return;
      ended = true;
      signal?.removeEventListener("abort", onAbort);
      socket?.close();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => end();
    if (signal?.aborted) {
      end();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    socket = new WebSocket(http.webSocketURL(EVENTS_ROUTE));
    let opened = false;
    let ready = false;
    const run = (handler: () => void) => {
      try {
        handler();
      } catch (error) {
        end(error instanceof Error ? error : new Error(String(error)));
      }
    };
    socket.addEventListener("open", () => {
      opened = true;
    });
    socket.addEventListener("message", (event) => {
      if (ended) return;
      if (!ready) {
        ready = true;
        if (handlers.onReady) run(handlers.onReady);
      }
      let message: { type?: unknown; event?: ResourceEvent };
      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        return;
      }
      if (ended || message.type !== "resource-event" || message.event === undefined) return;
      const resourceEvent = message.event;
      run(() => handlers.onEvent(resourceEvent));
    });
    socket.addEventListener("close", (event) => {
      if (event.code === EVENTS_AUTH_FAILED_CLOSE_CODE) end(http.unauthorizedError("Unauthorized"));
      else end(http.createError(opened ? "The event stream ended." : "Could not open the event stream."));
    });
  });
  return {
    finished,
    get ended() {
      return ended;
    },
    end: (error) => end(error),
  };
}

function sameReadResult(left: JsonReadResult, right: JsonReadResult): boolean {
  if (!left.exists || !right.exists) return left.exists === right.exists;
  return jsonEqual(left.value, right.value);
}

/**
 * Returns `value` once it is plain JSON, and otherwise refuses it as the store
 * would (specs/arch/resources/json-store.md#^js-arch-values). Serializing would
 * hide a value that is not: an infinity, which JSON text such as `1e400`
 * parses to, becomes `null`.
 */
function plainValue(value: unknown): JSONValue {
  validateJsonValue(value);
  return value;
}

/** The JSON store's agent operations (specs/arch/resources/json-store.md#^js-arch-cli). */
export class JsonStoreClient {
  readonly #http: HttpRequester;

  constructor(http: HttpRequester) {
    this.#http = http;
  }

  /** With the bindings flag on: creates a store and resolves with its summary, which carries its resource ID. */
  async create(input: { description: string; usage?: string; value?: JSONValue }): Promise<ResourceSummary> {
    const body: Record<string, unknown> = { description: input.description };
    if (input.usage !== undefined) body.usage = input.usage;
    if (input.value !== undefined) body.value = plainValue(input.value);
    return (await this.#write<SummaryResponse>(adminRoutes.jsonCreate, body)).resource;
  }

  get(input: { store: StoreAddress; path: string }): Promise<JsonReadResult> {
    const query = storeQuery(input.store);
    query.set("path", input.path);
    return this.#http.requestJSON<JsonReadResult>("GET", `${adminRoutes.jsonGet}?${query.toString()}`);
  }

  async set(input: { store: StoreAddress; path: string; value: JSONValue }): Promise<void> {
    await this.#write(adminRoutes.jsonSet, { store: input.store, path: input.path, value: encodeWriteValue(plainValue(input.value)) });
  }

  async update(input: { store: StoreAddress; path: string; values: Record<string, JSONValue> }): Promise<void> {
    for (const key of Object.keys(input.values)) plainValue(input.values[key]);
    await this.#write(adminRoutes.jsonUpdate, { store: input.store, path: input.path, entries: encodeUpdateEntries(input.values) });
  }

  async push(input: { store: StoreAddress; path: string; key: string; value: JSONValue }): Promise<void> {
    await this.#write(adminRoutes.jsonPush, { store: input.store, path: input.path, key: input.key, value: encodeWriteValue(plainValue(input.value)) });
  }

  async remove(input: { store: StoreAddress; path: string }): Promise<void> {
    await this.#write(adminRoutes.jsonRemove, { store: input.store, path: input.path });
  }

  /**
   * Calls onValue with the value at the path, then again whenever a read
   * finds it changed, until signal aborts or the stream's connection ends.
   * It reads after the stream's first message and after each `changed` event
   * for its store whose paths meet its own, one read at a time, recognizing
   * its store by the address it was given
   * (specs/arch/resources/json-store.md#^js-arch-watch).
   */
  watch(input: {
    store: StoreAddress;
    path: string;
    onValue: (result: JsonReadResult) => void;
    signal?: AbortSignal;
  }): Promise<void> {
    let watched: string[];
    try {
      watched = parseJsonPath(input.path);
    } catch (error) {
      return Promise.reject(error);
    }
    let last: JsonReadResult | null = null;
    let reading = false;
    let readAgain = false;
    const read = () => {
      if (reading) {
        readAgain = true;
        return;
      }
      reading = true;
      this.get({ store: input.store, path: input.path }).then((result) => {
        reading = false;
        if (stream.ended) return;
        if (last === null || !sameReadResult(result, last)) {
          last = result;
          try {
            input.onValue(result);
          } catch (error) {
            stream.end(error instanceof Error ? error : new Error(String(error)));
            return;
          }
        }
        if (readAgain) {
          readAgain = false;
          read();
        }
      }, (error: unknown) => stream.end(error instanceof Error ? error : new Error(String(error))));
    };
    const stream = readEventStream(this.#http, {
      onReady: read,
      onEvent: (event) => {
        const { store } = input;
        const isOwn = (fields: { resourceID: string; artifactID?: string }) =>
          "artifactID" in store ? fields.artifactID === store.artifactID : fields.resourceID === store.resourceID;
        if (event.event === "destroyed" && isOwn(event)) {
          // A store addressed by its resource ID is gone; an artifact's store has
          // no value until its next write (specs/arch/resources/json-store.md#^js-arch-watch).
          if ("resourceID" in store) throw resourceError("not-found", `Resource not found: ${store.resourceID}`);
          read();
          return;
        }
        if (event.event !== "changed" || !isOwn(event)) return;
        if (event.paths.some((path) => pathsMeet(parseJsonPath(path), watched))) read();
      },
    }, input.signal);
    return stream.finished;
  }

  /**
   * Sends a write, refusing with `too-large`, without sending it, one whose
   * body is over the message limit (specs/arch/resources/json-store.md#^js-arch-write-limit).
   */
  #write<T>(pathname: string, body: Record<string, unknown>): Promise<T> {
    const text = JSON.stringify(body);
    checkWriteMessage(text);
    return this.#http.requestSerializedJSON<T>("POST", pathname, text);
  }
}

/** Resource administration over the administrative routes (specs/arch/resources/index.md#^rs-cli-integration). */
export class ResourcesClient {
  readonly json: JsonStoreClient;
  readonly #http: HttpRequester;

  constructor(http: HttpRequester) {
    this.#http = http;
    this.json = new JsonStoreClient(http);
  }

  /** Creates the artifact's share link at this level, or changes its level; without a level the server shares at `read`, refusing a `read-write` link. */
  share(input: { artifactID: string; access?: AccessLevel }): Promise<ShareResponse> {
    return this.#http.requestJSON<ShareResponse>("POST", adminRoutes.share(input.artifactID), input.access === undefined ? {} : { access: input.access });
  }

  /** Revokes the artifact's share link. */
  async unshare(input: { artifactID: string }): Promise<void> {
    await this.#http.requestJSON("POST", adminRoutes.unshare(input.artifactID), {});
  }

  async list(input: { artifactID?: string } = {}): Promise<Array<ResourceSummary & { access?: AccessLevel }>> {
    const query = input.artifactID === undefined ? "" : `?${new URLSearchParams({ artifact: input.artifactID }).toString()}`;
    return (await this.#http.requestJSON<ListResponse>("GET", `${adminRoutes.list}${query}`)).resources;
  }

  /** A resource's summary and bindings, an own store's owner included. */
  async info(input: { resourceID: ResourceID }): Promise<InfoResponse["resource"]> {
    return (await this.#http.requestJSON<InfoResponse>("GET", adminRoutes.info(input.resourceID))).resource;
  }

  /** Changes the description, the usage or both; at least one is given. */
  async describe(input: { resourceID: ResourceID; description?: string; usage?: string }): Promise<ResourceSummary> {
    const body: DescribeRequest & Record<string, unknown> = {};
    if (input.description !== undefined) body.description = input.description;
    if (input.usage !== undefined) body.usage = input.usage;
    return (await this.#http.requestJSON<SummaryResponse>("POST", adminRoutes.describe(input.resourceID), body)).resource;
  }

  destroy(input: { resourceID: ResourceID; force?: boolean }): Promise<DestroyResponse> {
    return this.#http.requestJSON<DestroyResponse>("POST", adminRoutes.destroy(input.resourceID), input.force === undefined ? {} : { force: input.force });
  }

  /** With the bindings flag on. */
  bind(input: { resourceID: ResourceID; artifactID: string; access: AccessLevel }): Promise<BindResponse> {
    return this.#http.requestJSON<BindResponse>("POST", adminRoutes.bind(input.resourceID), { artifactID: input.artifactID, access: input.access });
  }

  /** With the bindings flag on. */
  async unbind(input: { resourceID: ResourceID; artifactID: string }): Promise<void> {
    await this.#http.requestJSON("POST", adminRoutes.unbind(input.resourceID), { artifactID: input.artifactID });
  }

  /** Reads the `/events` stream and calls onEvent for every resource event on it until signal aborts or the stream's connection ends. */
  events(input: { onEvent: (event: ResourceEvent) => void; signal?: AbortSignal }): Promise<void> {
    return readEventStream(this.#http, { onEvent: input.onEvent }, input.signal).finished;
  }
}

/** Whether the server enables browser demo mode (specs/product/artifacts.md#^af-demo-mode). */
export interface DemoModeStatus {
  browserExternalPages: boolean;
}

/**
 * Typed HTTP client for the Television server's REST API. Used by the CLI
 * and the browser.
 */
export class TelevisionClient {
  readonly channels: ChannelClient;
  readonly artifacts: ArtifactClient;
  readonly display: DisplayClient;
  readonly themes: ThemeClient;
  readonly markdown: MarkdownClient;
  readonly telemetry: TelemetryControlClient;
  readonly resources: ResourcesClient;
  readonly #http: HttpRequester;

  constructor(serverURL: string, options: TelevisionClientOptions = {}) {
    this.#http = new HttpRequester(serverURL, options);
    this.channels = new ChannelClient(this.#http);
    this.artifacts = new ArtifactClient(this.#http);
    this.display = new DisplayClient(this.#http);
    this.themes = new ThemeClient(this.#http);
    this.markdown = new MarkdownClient(this.#http);
    this.telemetry = new TelemetryControlClient(this.#http);
    this.resources = new ResourcesClient(this.#http);
  }

  health(): Promise<HealthStatus> {
    return this.#http.requestJSON<HealthStatus>("GET", "/health");
  }

  demoMode(): Promise<DemoModeStatus> {
    return this.#http.requestJSON<DemoModeStatus>("GET", "/demo-mode");
  }
}

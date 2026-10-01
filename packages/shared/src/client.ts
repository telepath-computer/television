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

const HTTP_OK = 200;
const HTTP_MULTIPLE_CHOICES = 300;
const HTTP_UNAUTHORIZED = 401;

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
    const response = await this.request(
      method,
      pathname,
      body !== undefined ? JSON.stringify(body) : undefined,
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
  readonly #http: HttpRequester;

  constructor(serverURL: string, options: TelevisionClientOptions = {}) {
    this.#http = new HttpRequester(serverURL, options);
    this.channels = new ChannelClient(this.#http);
    this.artifacts = new ArtifactClient(this.#http);
    this.display = new DisplayClient(this.#http);
    this.themes = new ThemeClient(this.#http);
    this.markdown = new MarkdownClient(this.#http);
    this.telemetry = new TelemetryControlClient(this.#http);
  }

  health(): Promise<HealthStatus> {
    return this.#http.requestJSON<HealthStatus>("GET", "/health");
  }

  demoMode(): Promise<DemoModeStatus> {
    return this.#http.requestJSON<DemoModeStatus>("GET", "/demo-mode");
  }
}

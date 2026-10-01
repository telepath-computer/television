import { EventTarget } from "@rupertsworld/event-target";
import {
  ChangeEvent,
  ServerEventMessageEvent,
  type ClientTelemetryMeta,
  type ServerStatusMessage,
} from "@telepath-computer/television-shared";
import { ulid } from "ulid";
import { ChannelsChangedEvent, ServerReconnectedEvent, ServerStatusEvent } from "../events.ts";
import {
  clearAuthToken,
  getAuthToken,
  LocalStore,
  normalizeServerURL,
  setAuthToken,
} from "../store.ts";
import {
  AuthError,
  ServerConnection,
  type ServerConnectionOptions,
  type WebSocketLike,
} from "./server-connection.ts";
import {
  getBrowserLocalStorage,
  loadClientGUID,
  type StorageLike,
} from "./acp-session-store.ts";

const DEFAULT_CONNECTION_NAME = "Local";

export interface ServerConnectionOwnerOptions {
  localStore: LocalStore;
  serverURL: string;
  launchToken?: string | null;
  connectionName?: string;
  createSocket?: (url: string) => WebSocketLike;
  createConnection?: (options: ServerConnectionOptions) => ServerConnection;
  /**
   * Persistent storage for the ACP client GUID and mapped session envelope.
   * Defaults to browser `localStorage`; tests can pass memory storage or null.
   */
  acpStorage?: StorageLike | null;
  /** Resolved ACP client GUID override used by deterministic tests. */
  clientGUID?: string;
  /** Standard telemetry metadata attached to browser/Electron communications. */
  telemetryMeta?: ClientTelemetryMeta | null;
  /** Desktop upgrade gate decision installed before the connection starts. */
  decideBoot?: (message: ServerStatusMessage) => "boot" | "halt";
  /** Shared navigation latch probe installed before the connection starts. */
  navigationPending?: () => boolean;
}

/**
 * Owns the browser's one server connection. `ServerConnection` retains socket,
 * retry, bootstrap, telemetry, ACP, and transport behavior; this owner selects
 * launch credentials, forwards its public events, and controls its lifetime.
 */
export class ServerConnectionOwner extends EventTarget<
  ChangeEvent | ServerEventMessageEvent | ChannelsChangedEvent | ServerReconnectedEvent | ServerStatusEvent
> {
  readonly connection: ServerConnection;
  readonly clientGUID: string;
  readonly acpStorage: StorageLike | null;
  connectError: string | null = null;

  readonly #localStore: LocalStore;
  #disposed = false;

  constructor(options: ServerConnectionOwnerOptions) {
    super();
    this.#localStore = options.localStore;
    this.acpStorage = options.acpStorage === undefined
      ? getBrowserLocalStorage()
      : options.acpStorage;
    this.clientGUID = options.clientGUID
      ?? (this.acpStorage ? loadClientGUID(this.acpStorage) : ulid().toLowerCase());

    const serverURL = normalizeServerURL(options.serverURL);
    if (options.launchToken !== undefined && options.launchToken !== null) {
      this.#localStore.set(setAuthToken(this.#localStore.get(), serverURL, options.launchToken));
    }
    const token = options.launchToken
      ?? getAuthToken(this.#localStore.get(), serverURL);
    const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
    const createConnection = options.createConnection
      ?? ((connectionOptions: ServerConnectionOptions) => new ServerConnection(connectionOptions));

    this.connection = createConnection({
      url: serverURL,
      name: options.connectionName ?? DEFAULT_CONNECTION_NAME,
      token,
      createSocket,
      clientGUID: this.clientGUID,
      acpStorage: this.acpStorage,
      telemetryMeta: options.telemetryMeta ?? null,
      decideBoot: options.decideBoot,
      navigationPending: options.navigationPending,
    });

    this.connection.addEventListener("change", this.#handleConnectionChange);
    this.connection.addEventListener("server-event", this.#handleServerEvent);
    this.connection.addEventListener("channels-changed", this.#handleChannelsChanged);
    this.connection.addEventListener("server-reconnected", this.#handleServerReconnected);
    this.connection.addEventListener("server-status", this.#handleServerStatus);
  }

  get storedAuthToken(): string | null {
    return getAuthToken(this.#localStore.get(), this.connection.url);
  }

  /** Start or restart the owned connection with its current token. */
  async connect(): Promise<void> {
    await this.#connectWithToken(this.connection.token);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.connection.removeEventListener("change", this.#handleConnectionChange);
    this.connection.removeEventListener("server-event", this.#handleServerEvent);
    this.connection.removeEventListener("channels-changed", this.#handleChannelsChanged);
    this.connection.removeEventListener("server-reconnected", this.#handleServerReconnected);
    this.connection.removeEventListener("server-status", this.#handleServerStatus);
    this.connection.dispose();
  }

  async #connectWithToken(token: string | null): Promise<void> {
    if (this.#disposed) return;
    this.#setConnectError(null);
    try {
      await this.connection.connect(token);
    } catch (error) {
      this.#setConnectError(
        error instanceof AuthError
          ? null
          : error instanceof Error
            ? error.message
            : String(error),
      );
    }
  }

  #setConnectError(error: string | null): void {
    if (this.connectError === error) return;
    this.connectError = error;
    this.dispatchEvent(new ChangeEvent("change"));
  }

  #clearRejectedToken(): void {
    if (
      this.connection.status !== "unauthorized" ||
      !this.connection.hasAuthRejected
    ) {
      return;
    }
    const current = this.#localStore.get();
    const next = clearAuthToken(current, this.connection.url);
    if (next !== current) this.#localStore.set(next);
    if (this.connection.token !== null) this.connection.clearToken();
  }

  readonly #handleConnectionChange = (): void => {
    if (this.#disposed) return;
    this.#clearRejectedToken();
    this.dispatchEvent(new ChangeEvent("change"));
  };

  readonly #handleServerEvent = (event: ServerEventMessageEvent): void => {
    if (this.#disposed) return;
    this.dispatchEvent(
      new ServerEventMessageEvent("server-event", {
        serverURL: event.serverURL,
        event: event.event,
      }),
    );
  };

  readonly #handleChannelsChanged = (): void => {
    if (this.#disposed) return;
    this.dispatchEvent(new ChannelsChangedEvent("channels-changed"));
  };

  readonly #handleServerReconnected = (event: ServerReconnectedEvent): void => {
    if (this.#disposed) return;
    this.dispatchEvent(
      new ServerReconnectedEvent("server-reconnected", { serverURL: event.serverURL }),
    );
  };

  readonly #handleServerStatus = (event: ServerStatusEvent): void => {
    if (this.#disposed) return;
    this.dispatchEvent(
      new ServerStatusEvent("server-status", {
        serverURL: event.serverURL,
        message: event.message,
      }),
    );
  };
}

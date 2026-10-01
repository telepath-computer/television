import { EventTarget } from "@rupertsworld/event-target";
import {
  TelevisionClient,
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  getChannelArtifactIDs,
  removeArtifactFromPages,
  RequestError,
  TELEMETRY_SIGNAL_MESSAGE_TYPE,
  type ClientSignalEventName,
  type ClientTelemetryMeta,
  type ServerEvent,
  type ServerStatusMessage,
  type Channel,
  type UpdateState,
  type TelemetryActivitySignal,
  type TelemetryClientSignal,
} from "@telepath-computer/television-shared";
import { ChangeEvent, ServerEventMessageEvent } from "@telepath-computer/television-shared";
import { ChannelsChangedEvent, ServerReconnectedEvent, ServerStatusEvent } from "../events.ts";
import type { Artifact } from "@telepath-computer/television-artifact";
import { normalizeServerURL } from "../store.ts";
import { artifactRenderRoute } from "../artifact-dispatcher.ts";
import { isElectronMode } from "../config.ts";
import {
  createTelemetryActivityAgent,
  encodeClientTelemetryMetaSearchParams,
  type TelemetryActivityAgent,
  type TelemetryActivityDocumentTarget,
  type TelemetryActivityEventTarget,
} from "./telemetry-client.ts";
import { ACPClient, type ACPMappedSessionStore } from "./acp-client.ts";
import {
  StorageMappedSessionStore,
  MemoryMappedSessionStore,
  type StorageLike,
} from "./acp-session-store.ts";

export interface WebSocketLike {
  readyState: number;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

export interface EventTargetLike {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export interface PageVisibilitySource extends EventTargetLike {
  readonly visibilityState: string;
}

/**
 * `disconnected` is the implicit-retry state — the connection is not
 * established and auto-reconnect is (or will be) trying. There's no
 * separate "actively attempting" status: `disconnected` means "not
 * connected, doing what it can". See `attempting` + `nextRetryAt`
 * for the fine-grained sub-state UIs that need it.
 *
 * `unauthorized` is the dead-end state — auth was rejected and no
 * auto-reconnect is armed; the user has to enter a token.
 */
export type ServerStatus = "unauthorized" | "disconnected" | "connected";

/**
 * Boot-barrier phase of the current connection attempt
 * (specs/arch/updates/desktop-upgrade-gate.md ^boot-barrier):
 * `pending` until the boot decision, `halted` when the barrier stopped the
 * store bootstrap (the socket stays open — ^gate-reevaluation), `booted`
 * once the bootstrap has started. Without a `decideBoot` hook the state goes
 * straight to `booted` on socket open — the non-Electron composition,
 * structurally today's behavior.
 */
export type BootState = "pending" | "halted" | "booted";

export interface ServerConnectionOptions {
  url: string;
  name: string;
  token?: string | null;
  createSocket?: (url: string) => WebSocketLike;
  createClient?: (url: string, token: string | null, telemetryMeta: ClientTelemetryMeta | null) => TelevisionClient;
  telemetryMeta?: ClientTelemetryMeta | null;
  telemetryWindowTarget?: TelemetryActivityEventTarget | null;
  telemetryDocumentTarget?: TelemetryActivityDocumentTarget | null;
  clientGUID?: string;
  /**
   * Backing storage for the ACP mapped-session envelope. When provided, the
   * server's ACP client uses a `StorageMappedSessionStore` keyed against this
   * URL; when omitted or null, an in-memory store is used (sessions don't
   * persist across reloads).
   */
  acpStorage?: StorageLike | null;
  /**
   * Override for the mapped-session store. Tests pass an in-memory or
   * inspectable implementation; production resolves the store from
   * `acpStorage` instead.
   */
  mappedSessionStore?: ACPMappedSessionStore;
  /**
   * Optional websocket factory for the ACP bridge. Defaults to `createSocket`
   * when omitted; tests use this to inject a fake bridge.
   */
  createACPSocket?: (url: string) => WebSocketLike;
  /**
   * Optional event source for the page-visibility wake signal. Defaults to
   * `document` when present, undefined otherwise (e.g. in Node tests).
   * Must expose both `addEventListener`/`removeEventListener` and a
   * `visibilityState` getter so we can confirm a visibilitychange
   * transitioned to "visible".
   */
  visibilityEventTarget?: PageVisibilitySource | null;
  /**
   * Optional event source for the network-online wake signal. Defaults to
   * `window` when present, undefined otherwise.
   */
  networkEventTarget?: EventTargetLike | null;
  /**
   * The boot barrier's decision hook
   * (specs/arch/updates/desktop-upgrade-gate.md ^boot-barrier). When present,
   * the store bootstrap waits for the connection attempt's FIRST
   * `server-status` message and runs only on "boot"; "halt" leaves the
   * connection open and un-bootstrapped (`bootState` "halted") and the
   * `connect()` promise pending — a halted boot never "succeeds"; its exits
   * are a page reload or a reconnect. When absent, the bootstrap runs on
   * socket open exactly as before.
   */
  decideBoot?: (message: ServerStatusMessage) => "boot" | "halt";
  /**
   * The page's navigation-pending probe (navigation-latch.ts): true once a
   * reload has been requested on this page. A dying page must not BEGIN a
   * store bootstrap — `location.reload()` does not preempt the running task,
   * so without this guard a halted page whose gate retracts (or a stale page
   * the reload agent is replacing) could still fire channels/display fetches
   * before the navigation lands. Defaults to "never pending".
   */
  navigationPending?: () => boolean;
}

const AUTH_FAILED_CLOSE_CODE = 4401;
const HTTP_UNAUTHORIZED = 401;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;

export class AuthError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Single Television server connection. Owns the `/events` WebSocket
 * subscription and a `TelevisionClient` for HTTP reads/writes. Emits
 * `change` on status updates and `server-event` for each incoming domain
 * event.
 *
 * Lifecycle: once `connect()` has succeeded, the connection auto-reconnects
 * across non-auth socket drops with exponential backoff (1s → 30s). Page
 * visibility and network-online events kick an immediate retry attempt.
 * Only a 4401 close or a 401 bootstrap response disarms auto-reconnect and
 * surfaces `"unauthorized"` (the only path that puts the user back on the
 * access-token screen).
 */
export class ServerConnection extends EventTarget<
  ChangeEvent | ServerEventMessageEvent | ChannelsChangedEvent | ServerReconnectedEvent | ServerStatusEvent
> {
  readonly url: string;
  readonly name: string;
  readonly telemetryMeta: ClientTelemetryMeta | null;
  status: ServerStatus = "unauthorized";
  channels = new Map<string, Channel>();
  client: TelevisionClient;
  readonly acpClient: ACPClient;

  private _token: string | null;
  /**
   * True while a connect attempt is actively in flight (socket open +
   * bootstrap). False both before any attempt and during the inter-retry
   * wait. UI uses this together with `nextRetryAt` to distinguish a
   * fresh "Connecting" state from a "Disconnected — reattempting"
   * state.
   */
  attempting = false;
  /**
   * Epoch ms of the next scheduled retry, or null when no retry timer
   * is pending. Set by `scheduleRetry`, cleared at attempt start, on
   * `dispose()`, and on auth-rejection.
   */
  nextRetryAt: number | null = null;
  /**
   * True once this connection has reached `"connected"` status at least
   * once. Never resets. UI uses it to distinguish a never-connected
   * "Connecting…" state from a connected-then-dropped "Disconnected,
   * reattempting…" state, both of which otherwise look identical from
   * `status` alone.
   */
  hasEverConnected = false;
  /** Completed unreachable reconnects since the last successful connection. */
  failedReconnectAttempts = 0;
  /** Browser demo mode as the server reported it when this page connected. */
  browserDemoMode = false;
  hasAuthRejected = false;
  /** Boot-barrier phase of the current attempt; see `BootState`. */
  bootState: BootState = "pending";
  /**
   * The server's release version, from its last `server-status` message
   * (version-advertisement.md ^events-version); null before the first one.
   */
  serverVersion: string | null = null;
  /**
   * The client-held update state (update-channel.md ^relay), retained like
   * `channels` from the last `server-status` message so consumers read the
   * present rather than depending on having heard the broadcast — the update
   * notification mounts with the chrome, after the connect-time status.
   * Last-known-good: never cleared, only replaced.
   */
  updateState: UpdateState | null = null;
  /** Boot-barrier decision hook installed before the connection starts. */
  private readonly decideBoot: ((message: ServerStatusMessage) => "boot" | "halt") | null;
  /** Shared navigation latch probe installed before the connection starts. */
  private readonly navigationPending: () => boolean;

  /** Current token. Read-only from outside the class; set via `connect(token)`. */
  get token(): string | null {
    return this._token;
  }

  clearToken(): void {
    this._token = null;
    this.acpClient.setToken(null);
    this.client = this.createClient(this.url, null, this.telemetryMeta);
  }
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly createClient: (url: string, token: string | null, telemetryMeta: ClientTelemetryMeta | null) => TelevisionClient;
  private socket: WebSocketLike | null = null;
  private connectAttempt = 0;
  private autoReconnect = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = INITIAL_RETRY_DELAY_MS;
  private readonly visibilityEventTarget: PageVisibilitySource | null;
  private readonly networkEventTarget: EventTargetLike | null;
  private readonly onVisibilityChange: () => void;
  private readonly onNetworkOnline: () => void;
  private readonly telemetryActivityAgent: TelemetryActivityAgent | null;

  constructor(options: ServerConnectionOptions) {
    super();
    this.url = normalizeServerURL(options.url);
    this.name = options.name;
    this.decideBoot = options.decideBoot ?? null;
    this.navigationPending = options.navigationPending ?? ((): boolean => false);
    this._token = options.token ?? null;
    this.telemetryMeta = options.telemetryMeta ?? null;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.createClient =
      options.createClient ?? ((url, token, telemetryMeta) => new TelevisionClient(url, {
        token: token ?? undefined,
        onUnauthorized: () => this.handleAuthRejected(),
        ...(telemetryMeta ? { telemetryMeta } : {}),
      }));
    this.client = this.createClient(this.url, this._token, this.telemetryMeta);

    const mappedSessionStore: ACPMappedSessionStore =
      options.mappedSessionStore
      ?? (options.acpStorage
        ? new StorageMappedSessionStore(options.acpStorage, this.url)
        : new MemoryMappedSessionStore());

    this.acpClient = new ACPClient({
      serverURL: this.url,
      token: this._token ?? "",
      ...(options.createACPSocket
        ? { createSocket: options.createACPSocket }
        : options.createSocket
          ? { createSocket: options.createSocket }
          : {}),
      ...(options.clientGUID ? { clientGUID: options.clientGUID } : {}),
      mappedSessionStore,
    });

    this.visibilityEventTarget =
      options.visibilityEventTarget !== undefined
        ? options.visibilityEventTarget
        : typeof document !== "undefined"
          ? (document as unknown as PageVisibilitySource)
          : null;
    this.networkEventTarget =
      options.networkEventTarget !== undefined
        ? options.networkEventTarget
        : typeof window !== "undefined"
          ? (window as unknown as EventTargetLike)
          : null;

    this.onVisibilityChange = () => {
      if (this.isPageVisible()) {
        this.kickReconnect();
      }
    };
    this.onNetworkOnline = () => {
      this.kickReconnect();
    };

    this.visibilityEventTarget?.addEventListener(
      "visibilitychange",
      this.onVisibilityChange,
    );
    this.networkEventTarget?.addEventListener("online", this.onNetworkOnline);

    const telemetryDocumentTarget = options.telemetryDocumentTarget !== undefined
      ? options.telemetryDocumentTarget
      : typeof document !== "undefined"
        ? (document as unknown as TelemetryActivityDocumentTarget)
        : null;
    const telemetryWindowTarget = options.telemetryWindowTarget !== undefined
      ? options.telemetryWindowTarget
      : typeof window !== "undefined"
        ? (window as unknown as TelemetryActivityEventTarget)
        : null;
    this.telemetryActivityAgent = this.telemetryMeta && telemetryDocumentTarget && telemetryWindowTarget
      ? createTelemetryActivityAgent({
          meta: this.telemetryMeta,
          documentTarget: telemetryDocumentTarget,
          windowTarget: telemetryWindowTarget,
          send: (signal) => this.sendTelemetryActivity(signal),
        })
      : null;
  }

  /**
   * Begin (or restart) the lifecycle with this token. Resolves on first
   * successful socket + bootstrap; rejects on first failure (auth or
   * transport). After success, auto-reconnect runs forever across
   * non-auth drops. Calling `connect()` again cancels any pending retry,
   * replaces the stored token, and starts a fresh attempt with backoff
   * reset.
   */
  async connect(token: string | null): Promise<void> {
    this._token = token;
    this.hasAuthRejected = false;
    this.acpClient.setToken(token);
    this.cancelRetryTimer();
    this.retryDelay = INITIAL_RETRY_DELAY_MS;

    // Don't short-circuit on a null token — the server may be running
    // with no auth required. Let the connection attempt proceed; if the
    // server rejects with 4401 / 401, the failure path routes to
    // "unauthorized" and surfaces the auth modal.
    //
    // Arm before the first attempt: once a caller asks to connect, the
    // class wants to stay connected. `handleAttemptFailure` will disarm
    // only on a real auth rejection. Transient failures schedule a retry
    // in the background while the promise rejects to the caller.
    this.autoReconnect = true;
    await this.attempt();
  }

  dispose(): void {
    this.autoReconnect = false;
    this.connectAttempt += 1;
    this.cancelRetryTimer();
    this.socket?.close();
    this.socket = null;
    this.setStatus("unauthorized");
    this.visibilityEventTarget?.removeEventListener(
      "visibilitychange",
      this.onVisibilityChange,
    );
    this.networkEventTarget?.removeEventListener("online", this.onNetworkOnline);
    this.telemetryActivityAgent?.stop();
    this.acpClient.dispose();
  }

  getViewURL(artifact: Artifact): string {
    const route = artifactRenderRoute(artifact, this.renderOptions());
    if (isElectronMode()) return new URL(route.viewURL, this.url).toString();
    return route.renderer === "proxy-iframe"
      ? new URL(route.viewURL, this.url).toString()
      : route.viewURL;
  }

  /** A server that cannot answer leaves demo mode off. */
  private async readDemoMode(): Promise<{ browserExternalPages: boolean } | null> {
    try {
      return await this.client.demoMode();
    } catch {
      return null;
    }
  }

  private renderOptions(): { electron: boolean; browserDemo: boolean } {
    return { electron: isElectronMode(), browserDemo: this.browserDemoMode };
  }

  getContentURL(artifact: Artifact): string | null {
    const contentURL = artifactRenderRoute(artifact, this.renderOptions()).contentURL;
    return contentURL === null ? null : new URL(contentURL, this.url).toString();
  }

  /**
   * Create a channel on this server. Seeds the new channel into the
   * local `channels` map so callers can immediately activate it without
   * waiting for the server's `channel-created` broadcast.
   */
  async createChannel(name: string): Promise<Channel> {
    const { channel } = await this.client.channels.create({ name });
    this.channels.set(channel.id, structuredClone(channel));
    return channel;
  }

  applyServerEvent(event: ServerEvent): void {
    switch (event.type) {
      case "channel-created":
        this.channels.set(event.channel.id, structuredClone(event.channel));
        this.dispatchEvent(new ChannelsChangedEvent("channels-changed"));
        break;
      case "channel-updated":
        this.channels.set(event.channel.id, structuredClone(event.channel));
        this.dispatchEvent(new ChannelsChangedEvent("channels-changed"));
        break;
      case "channel-removed":
        this.channels.delete(event.channelID);
        this.dispatchEvent(new ChannelsChangedEvent("channels-changed"));
        break;
      case "artifact-created": {
        const channel = this.channels.get(event.channelID);
        if (channel && !getChannelArtifactIDs(channel).includes(event.artifact.id)) {
          channel.layout = [
            ...channel.layout,
            {
              artifactIds: [event.artifact.id],
              geometry: { ...DEFAULT_PAGE_GEOMETRY },
              size: { ...DEFAULT_PAGE_SIZE },
            },
          ];
        }
        break;
      }
      case "artifact-removed": {
        const channel = this.channels.get(event.channelID);
        if (channel) {
          channel.layout = removeArtifactFromPages(channel.layout, event.artifactID);
        }
        break;
      }
      case "artifact-updated":
      case "artifact-content-changed":
      case "channel-changed":
      case "pinned-channels-changed":
      case "theme-changed":
      case "appearance-changed":
      case "artifact-focus":
        break;
      default:
        return assertNever(event, "server event");
    }
  }

  private async attempt(): Promise<void> {
    this.attempting = true;
    this.nextRetryAt = null;
    this.connectAttempt += 1;
    this.bootState = "pending";
    const attempt = this.connectAttempt;
    this.socket?.close();
    this.client = this.createClient(this.url, this._token, this.telemetryMeta);

    this.setStatus("disconnected");
    this.dispatchEvent(new ChangeEvent("change"));

    const socket = this.createSocket(toEventsWebSocketURL(this.url, this._token, this.telemetryMeta));
    this.socket = socket;

    return await new Promise<void>((resolve, reject) => {
      let settled = false;
      let initialized = false;

      const finishConnected = () => {
        if (settled || this.connectAttempt !== attempt) return;
        settled = true;
        initialized = true;
        this.retryDelay = INITIAL_RETRY_DELAY_MS;
        this.hasEverConnected = true;
        this.failedReconnectAttempts = 0;
        this.setStatus("connected");
        this.telemetryActivityAgent?.start();
        resolve();
      };

      const finishError = (error: Error) => {
        if (settled || this.connectAttempt !== attempt) return;
        settled = true;
        reject(error);
      };

      const bootstrap = async () => {
        // Captured before finishConnected() records this attempt: true only
        // when an earlier attempt already bootstrapped, i.e. a reconnect.
        const isReconnect = this.hasEverConnected;
        try {
          const [{ channels }, display, demoMode] = await Promise.all([
            this.client.channels.list(),
            this.client.display.get(),
            // Demo mode takes effect when the app loads, so a reconnect keeps
            // the value this page started with.
            isReconnect ? null : this.readDemoMode(),
          ]);
          if (!isReconnect) this.browserDemoMode = demoMode?.browserExternalPages === true;
          this.channels = new Map(
            channels.map((channel) => [channel.id, structuredClone(channel)]),
          );
          this.acpClient.setEnabled(display.acpEnabled);
          this.dispatchEvent(new ChangeEvent("change"));
          if (isReconnect) {
            // Channel mutations broadcast during the outage were lost. The
            // refetch above already replaced the map, but list consumers
            // (picker, tab strip) only re-render on channels-changed.
            this.dispatchEvent(new ChannelsChangedEvent("channels-changed"));
          }
          this.dispatchEvent(
            new ServerEventMessageEvent("server-event", {
              serverURL: this.url,
              event: { type: "channel-changed", channelID: display.focusedChannelId },
            }),
          );
          this.dispatchEvent(
            new ServerEventMessageEvent("server-event", {
              serverURL: this.url,
              event: {
                type: "pinned-channels-changed",
                pinnedChannelIds: [...display.pinnedChannelIds],
              },
            }),
          );
          finishConnected();
          if (isReconnect && this.connectAttempt === attempt) {
            // After the synthetic display events above, so the focused-channel
            // change has already been applied and the refresh targets the
            // channel the server currently considers focused.
            this.dispatchEvent(
              new ServerReconnectedEvent("server-reconnected", { serverURL: this.url }),
            );
          }
        } catch (error) {
          if (isUnauthorizedRequestError(error)) {
            finishError(new AuthError());
            return;
          }
          finishError(error instanceof Error ? error : new Error(String(error)));
        }
      };

      socket.addEventListener("open", () => {
        // Boot barrier (^boot-barrier): with a decision hook the store
        // bootstrap waits for the attempt's first server-status message;
        // without one it runs on open — the non-Electron composition,
        // structurally unchanged.
        if (this.decideBoot === null) {
          this.bootState = "booted";
          if (!this.navigationPending()) void bootstrap();
        }
      });

      socket.addEventListener("message", (event) => {
        // Route by `type` ahead of applyServerEvent: applyServerEvent stays
        // domain-only, and this routing layer is the single place non-domain
        // messages are admitted. Unrecognized types are dropped deliberately
        // (specs/arch/updates/version-advertisement.md ^unknown-messages) —
        // the lockstep server↔client shapes may change freely between
        // releases (arch/updates/index.md ^updates-lockstep-contracts).
        const message = parseEventsMessage(event);
        if (!message) {
          return;
        }
        if (message.type === "server-status") {
          const statusMessage = message as unknown as ServerStatusMessage;
          this.serverVersion = statusMessage.version;
          this.updateState = statusMessage.update ?? null;
          // The boot decision (one per attempt) is computed and RECORDED
          // before the dispatch, so barrier-aware listeners — the gate
          // controller's render and its telemetry signal, which needs the
          // halted-state send path below — observe a settled bootState. The
          // bootstrap itself starts only after the dispatch, so the reload
          // agent evaluates this status first (^reload-gate-precedence via
          // listener order; a permitted reload wins by navigating).
          let startBootstrap = false;
          if (this.decideBoot !== null && this.bootState === "pending" && this.connectAttempt === attempt) {
            if (this.decideBoot(statusMessage) === "boot") {
              this.bootState = "booted";
              startBootstrap = true;
            } else {
              // Halted (^boot-barrier step 4): no store bootstrap; the
              // socket stays open for re-evaluation (^gate-reevaluation).
              this.bootState = "halted";
              this.attempting = false;
            }
          }
          this.dispatchEvent(
            new ServerStatusEvent("server-status", {
              serverURL: this.url,
              message: statusMessage,
            }),
          );
          if (startBootstrap) {
            // Checked AFTER the dispatch: a listener may have just begun a
            // navigation (the reload agent, or the gate controller's
            // retraction exit) — the dying page must not start a functional
            // bootstrap (^gate-reevaluation, ^reload-gate-precedence).
            if (!this.navigationPending()) void bootstrap();
          } else if (this.bootState === "halted" && !this.navigationPending()) {
            // ApplicationService projects the halted presentation and its
            // latest instructions from this change. A navigation that won the
            // status race suppresses publication on the dying page.
            this.dispatchEvent(new ChangeEvent("change"));
          }
          return;
        }
        if (!isServerEventType(message.type)) {
          return;
        }
        const serverEvent = message as unknown as ServerEvent;
        this.applyServerEvent(serverEvent);
        this.dispatchEvent(
          new ServerEventMessageEvent("server-event", { serverURL: this.url, event: serverEvent }),
        );
      });

      socket.addEventListener("close", (event) => {
        if (this.connectAttempt !== attempt) {
          return;
        }

        this.socket = null;
        const closeCode = getCloseCode(event);

        if (!settled) {
          finishError(
            closeCode === AUTH_FAILED_CLOSE_CODE
              ? new AuthError()
              : new Error("Connection closed before initialization"),
          );
          return;
        }

        // Post-success close. The attempt promise has already resolved, so
        // we can't reject through it — handle the disposition inline.
        if (!initialized) return;
        if (closeCode === AUTH_FAILED_CLOSE_CODE) {
          this.handleAuthRejected();
          return;
        }
        this.handleTransportFailure(new Error("Connection closed"));
      });

      socket.addEventListener("error", () => {
        if (this.connectAttempt !== attempt) {
          return;
        }
        if (settled) {
          if (!initialized) return;
          // Post-success error without a follow-up close — drive the
          // same transport-failure path so we schedule a retry instead
          // of relying on `finishError`, which is a no-op once settled.
          this.handleTransportFailure(new Error("WebSocket error"));
          return;
        }
        finishError(new Error("WebSocket connection failed"));
      });
    }).then(
      () => {
        this.attempting = false;
      },
      (error: unknown) => {
        // Any error after the initial connect must be handled here too —
        // a post-success path won't be raised to the caller since
        // `attempt()`'s promise has already resolved.
        this.attempting = false;
        this.handleAttemptFailure(error);
        throw error;
      },
    );
  }

  private handleAuthRejected(): void {
    this.hasAuthRejected = true;
    this.autoReconnect = false;
    this.cancelRetryTimer();
    this.setStatus("unauthorized");
  }

  /**
   * Single failure path. Decides whether to disarm auto-reconnect and
   * surface `"unauthorized"`, or to schedule the next retry. Clears any
   * existing timer before scheduling.
   */
  private handleAttemptFailure(error: unknown): void {
    if (error instanceof AuthError) {
      this.handleAuthRejected();
      return;
    }
    if (!this.autoReconnect) {
      // Failure during the initial connect — propagate to the caller and
      // leave status as "disconnected" (the caller will react).
      return;
    }
    if (this.hasEverConnected) this.failedReconnectAttempts += 1;
    this.scheduleRetry();
  }

  /**
   * Called when a socket that previously bootstrapped successfully drops
   * for a non-auth reason. The attempt promise has already resolved, so
   * the error doesn't propagate to a caller — we handle it inline.
   */
  private handleTransportFailure(_error: Error): void {
    if (!this.autoReconnect) return;
    this.setStatus("disconnected");
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    this.cancelRetryTimer();
    // Invalidate any further events from the failed socket. The local
    // `attempt` const captured by each socket's listeners no longer
    // matches `this.connectAttempt`, so they bail at their first check.
    // Without this, an `error` + `close` pair on the same socket would
    // schedule two retries (consuming two backoff steps from one
    // logical failure).
    this.connectAttempt += 1;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_DELAY_MS);
    this.nextRetryAt = Date.now() + delay;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.attempt().catch(() => {
        // handleAttemptFailure already ran; swallow.
      });
    }, delay);
    this.dispatchEvent(new ChangeEvent("change"));
  }

  private cancelRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.nextRetryAt !== null) {
      this.nextRetryAt = null;
      this.dispatchEvent(new ChangeEvent("change"));
    }
  }

  private kickReconnect(): void {
    if (!this.autoReconnect) return;
    if (this.status === "connected") return;
    // In-flight guard: don't stack a second attempt on top of one that's
    // already creating a socket and bootstrapping. A wake signal during
    // an active attempt is a no-op; the in-flight attempt either
    // succeeds (covered) or fails and reschedules (also covered).
    if (this.attempting) return;
    this.cancelRetryTimer();
    this.retryDelay = INITIAL_RETRY_DELAY_MS;
    void this.attempt().catch(() => {
      // handleAttemptFailure already ran; swallow.
    });
  }

  private sendTelemetryActivity(signal: TelemetryActivitySignal): void {
    if (this.status !== "connected") return;
    this.socket?.send(JSON.stringify(signal));
  }

  /**
   * Report a client-observed telemetry moment over the /events socket in the
   * TelemetryClientSignal envelope (specs/arch/telemetry/client-signals.md).
   * Always sends when connected — the client is deliberately telemetry-unaware
   * (^signal-forwarding): opt-out suppression is server-side behind capture(),
   * and the server validates every signal against the registry before
   * forwarding (^signal-validation). Property values must match the closed
   * server registry for the event; anything else is silently dropped.
   */
  sendTelemetrySignal(event: ClientSignalEventName, properties: Record<string, string>): void {
    if (!this.telemetryMeta) return;
    // A halted boot may still signal (desktop-upgrade-gate.md ^gate-telemetry):
    // the gate's signal rides the already-open, authed /events socket that
    // delivered the gating server-status — the barrier fences off the
    // functional boot, not telemetry.
    if (this.status !== "connected" && this.bootState !== "halted") return;
    const signal: TelemetryClientSignal = {
      type: TELEMETRY_SIGNAL_MESSAGE_TYPE,
      clientId: this.telemetryMeta.clientId,
      event,
      properties,
    };
    this.socket?.send(JSON.stringify(signal));
  }

  private setStatus(status: ServerStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.dispatchEvent(new ChangeEvent("change"));
  }

  private isPageVisible(): boolean {
    if (this.visibilityEventTarget === null) return true;
    return this.visibilityEventTarget.visibilityState === "visible";
  }
}

function assertNever(value: never, context: string): never {
  throw new Error(`Unexpected ${context}: ${JSON.stringify(value)}`);
}

function toEventsWebSocketURL(url: string, token: string | null, telemetryMeta: ClientTelemetryMeta | null = null): string {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/events";
  parsed.search = "";
  if (token) {
    parsed.searchParams.set("token", token);
  }
  if (telemetryMeta) {
    for (const [name, value] of encodeClientTelemetryMetaSearchParams(telemetryMeta)) {
      parsed.searchParams.set(name, value);
    }
  }
  parsed.hash = "";
  return parsed.toString();
}

function getCloseCode(event: unknown): number | null {
  return typeof event === "object" &&
      event !== null &&
      "code" in event &&
      typeof event.code === "number"
    ? event.code
    : null;
}

/**
 * The /events routing table: the message `type`s admitted to the domain path
 * (applyServerEvent + the server-event dispatch). The Record forces
 * compile-time sync with the ServerEvent union in both directions — a new
 * union variant fails to compile until it is admitted here.
 */
const SERVER_EVENT_TYPE_FLAGS: Record<ServerEvent["type"], true> = {
  "artifact-created": true,
  "artifact-updated": true,
  "artifact-content-changed": true,
  "artifact-removed": true,
  "channel-created": true,
  "channel-updated": true,
  "channel-removed": true,
  "channel-changed": true,
  "pinned-channels-changed": true,
  "theme-changed": true,
  "appearance-changed": true,
  "artifact-focus": true,
};
const SERVER_EVENT_TYPES: ReadonlySet<string> = new Set(Object.keys(SERVER_EVENT_TYPE_FLAGS));

function isServerEventType(type: string): type is ServerEvent["type"] {
  return SERVER_EVENT_TYPES.has(type);
}

/** Parse a raw /events frame to a routable message: JSON carrying a string `type`. */
function parseEventsMessage(event: unknown): { type: string } | null {
  const data =
    typeof event === "string"
      ? event
      : typeof event === "object" &&
          event !== null &&
          "data" in event &&
          typeof event.data === "string"
        ? event.data
        : "";

  if (!data) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("type" in parsed) || typeof parsed.type !== "string") {
    return null;
  }
  return parsed as { type: string };
}

function isUnauthorizedRequestError(error: unknown): boolean {
  return error instanceof RequestError && error.status === HTTP_UNAUTHORIZED;
}

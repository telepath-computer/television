import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { IncomingMessage } from "node:http";
import { withDisposable } from "@telepath-computer/utils/disposable";
import { TELEMETRY_ACTIVITY_MESSAGE_TYPE } from "@telepath-computer/television-shared";
import type {
  AppearanceChangedEvent,
  ResourceEventMessage,
  ArtifactFocusEvent,
  ArtifactContentChangedEvent,
  ArtifactCreatedEvent,
  ArtifactRemovedEvent,
  ArtifactUpdatedEvent,
  ServerEvent,
  ServerStatusMessage,
  ChannelChangedEvent,
  ChannelCreatedEvent,
  ChannelRemovedEvent,
  ChannelUpdatedEvent,
  PinnedChannelsChangedEvent,
  ThemeChangedEvent,
} from "@telepath-computer/television-shared";
import { ServerStore } from "./server-store.ts";
import { isAuthorizedQueryToken } from "./auth.ts";
import { parseClientTelemetryMetaFromRequest, type TelemetryClientContext } from "./telemetry/client-meta.ts";
import { validateClientSignal } from "./telemetry/client-signals.ts";
import type { TelemetryEvent } from "./telemetry/types.ts";

export const AUTH_FAILED_CLOSE_CODE = 4401;

export interface EventStreamServerOptions {
  store: ServerStore;
  authRequired: boolean;
  /**
   * Producer of the `server-status` message sent to each client immediately
   * after connection-level auth passes — the FIRST message on the connection,
   * before any broadcast event: the Electron boot barrier makes its
   * halt-or-boot decision from it (specs/arch/updates/version-advertisement.md
   * ^events-version).
   */
  buildServerStatus?: () => ServerStatusMessage;
  recordTelemetryActivity?: (clientContext: TelemetryClientContext) => void;
  /**
   * Sink for validated client telemetry signals
   * (specs/arch/telemetry/client-signals.md ^signal-forwarding). Receives the
   * chokepoint-ready event produced by the signal validator; the wiring in
   * server.ts forwards it through the telemetry runtime's `capture()`.
   */
  recordTelemetryClientSignal?: (clientContext: TelemetryClientContext, event: TelemetryEvent) => void;
}

/**
 * WebSocket pub-sub for server-side domain events. The only accepted
 * client→server messages are the content-free telemetry activity signal and
 * the registry-validated telemetry client signal
 * (specs/arch/telemetry/client-signals.md); everything else is dropped
 * silently, never answered.
 */
export class EventStreamServer extends withDisposable(class {}) {
  readonly wsServer: WebSocketServer;
  private readonly store: ServerStore;
  private readonly authRequired: boolean;
  private readonly buildServerStatus: (() => ServerStatusMessage) | undefined;
  private readonly recordTelemetryActivity: ((clientContext: TelemetryClientContext) => void) | undefined;
  private readonly recordTelemetryClientSignal: ((clientContext: TelemetryClientContext, event: TelemetryEvent) => void) | undefined;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(options: EventStreamServerOptions) {
    super();
    this.store = options.store;
    this.authRequired = options.authRequired;
    this.buildServerStatus = options.buildServerStatus;
    this.recordTelemetryActivity = options.recordTelemetryActivity;
    this.recordTelemetryClientSignal = options.recordTelemetryClientSignal;
    this.wsServer = new WebSocketServer({ noServer: true });

    this.wsServer.on("connection", (socket: WebSocket, request) => {
      if (this.authRequired && !isAuthorizedQueryToken(request.url, this.store.authToken)) {
        socket.close(AUTH_FAILED_CLOSE_CODE, "Authentication failed");
        return;
      }

      // Same-tick send inside the connection callback is the first-message
      // mechanism: store broadcasts reach this socket only through
      // wsServer.clients, and this callback completes before the socket can
      // receive any of them (^events-version; the race-shaped seam in
      // test/version-advertisement.test.ts proves it rather than trusting it).
      if (this.buildServerStatus) {
        socket.send(JSON.stringify(this.buildServerStatus()));
      }

      const clientContext = parseClientTelemetryMetaFromRequest(request);
      socket.on("message", (data: RawData) => {
        // Both accepted client→server messages require the connection's
        // telemetry identity; without it everything drops.
        if (!clientContext) return;
        const parsed = parseJSONMessage(data);
        if (parsed === null) return;
        if (isTelemetryActivityMessage(parsed, clientContext.clientId)) {
          this.recordTelemetryActivity?.(clientContext);
          return;
        }
        const signal = validateClientSignal(parsed, clientContext.clientId);
        if (signal) this.recordTelemetryClientSignal?.(clientContext, signal);
      });
    });

    this.subscribeStore();
  }

  /**
   * Re-broadcast the current server-status to every connected client — the
   * update-state-change relay (specs/arch/updates/update-channel.md ^relay).
   */
  broadcastServerStatus(): void {
    if (!this.buildServerStatus) return;
    const payload = JSON.stringify(this.buildServerStatus());
    for (const socket of this.wsServer.clients) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  /** Number of currently-open `/events` sockets. */
  getConnectedClientCount(): number {
    let count = 0;
    for (const socket of this.wsServer.clients) {
      if (socket.readyState === WebSocket.OPEN) {
        count++;
      }
    }
    return count;
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ): void {
    this.wsServer.handleUpgrade(request, socket, head, (ws) => {
      this.wsServer.emit("connection", ws, request);
    });
  }

  dispose(): Promise<void> {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
    this.unsubscribe.length = 0;

    for (const socket of this.wsServer.clients) {
      socket.terminate();
    }

    return new Promise<void>((resolve, reject) => {
      this.wsServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private subscribeStore(): void {
    const onArtifactCreated = (event: ArtifactCreatedEvent) => {
      this.broadcast({ type: "artifact-created", channelID: event.channelID, artifact: event.artifact });
    };
    const onArtifactUpdated = (event: ArtifactUpdatedEvent) => {
      this.broadcast({ type: "artifact-updated", artifact: event.artifact });
    };
    const onArtifactRemoved = (event: ArtifactRemovedEvent) => {
      this.broadcast({ type: "artifact-removed", artifactID: event.artifactID, channelID: event.channelID });
    };
    const onArtifactContentChanged = (event: ArtifactContentChangedEvent) => {
      this.broadcast({ type: "artifact-content-changed", artifactID: event.artifactID });
    };
    const onChannelCreated = (event: ChannelCreatedEvent) => {
      this.broadcast({ type: "channel-created", channel: event.channel });
    };
    const onChannelUpdated = (event: ChannelUpdatedEvent) => {
      this.broadcast({ type: "channel-updated", channel: event.channel });
    };
    const onChannelRemoved = (event: ChannelRemovedEvent) => {
      this.broadcast({ type: "channel-removed", channelID: event.channelID });
    };
    const onChannelChanged = (event: ChannelChangedEvent) => {
      this.broadcast({ type: "channel-changed", channelID: event.channelID });
    };
    const onPinnedChannelsChanged = (event: PinnedChannelsChangedEvent) => {
      this.broadcast({ type: "pinned-channels-changed", pinnedChannelIds: event.pinnedChannelIds });
    };
    const onThemeChanged = (event: ThemeChangedEvent) => {
      this.broadcast({
        type: "theme-changed",
        themeName: event.themeName,
        activeThemeColorScheme: event.activeThemeColorScheme,
        themeJavaScriptConsentIds: [...event.themeJavaScriptConsentIds],
      });
    };
    const onAppearanceChanged = (event: AppearanceChangedEvent) => {
      this.broadcast({ type: "appearance-changed", appearanceMode: event.appearanceMode });
    };
    const onArtifactFocus = (event: ArtifactFocusEvent) => {
      this.broadcast({ type: "artifact-focus", channelID: event.channelID, artifactID: event.artifactID });
    };

    this.store.addEventListener("artifact-created", onArtifactCreated);
    this.store.addEventListener("artifact-updated", onArtifactUpdated);
    this.store.addEventListener("artifact-removed", onArtifactRemoved);
    this.store.addEventListener("artifact-content-changed", onArtifactContentChanged);
    this.store.addEventListener("channel-created", onChannelCreated);
    this.store.addEventListener("channel-updated", onChannelUpdated);
    this.store.addEventListener("channel-removed", onChannelRemoved);
    this.store.addEventListener("channel-changed", onChannelChanged);
    this.store.addEventListener("pinned-channels-changed", onPinnedChannelsChanged);
    this.store.addEventListener("theme-changed", onThemeChanged);
    this.store.addEventListener("appearance-changed", onAppearanceChanged);
    this.store.addEventListener("artifact-focus", onArtifactFocus);

    // Resource events ride the stream outside the ServerEvent union
    // (specs/arch/resources/index.md#^rs-events-stream).
    const stopResourceEvents = this.store.resources.onEvent((event) => {
      this.broadcast({ type: "resource-event", event } satisfies ResourceEventMessage);
    });

    this.unsubscribe.push(
      stopResourceEvents,
      () => this.store.removeEventListener("artifact-created", onArtifactCreated),
      () => this.store.removeEventListener("artifact-updated", onArtifactUpdated),
      () => this.store.removeEventListener("artifact-removed", onArtifactRemoved),
      () => this.store.removeEventListener("artifact-content-changed", onArtifactContentChanged),
      () => this.store.removeEventListener("channel-created", onChannelCreated),
      () => this.store.removeEventListener("channel-updated", onChannelUpdated),
      () => this.store.removeEventListener("channel-removed", onChannelRemoved),
      () => this.store.removeEventListener("channel-changed", onChannelChanged),
      () => this.store.removeEventListener("pinned-channels-changed", onPinnedChannelsChanged),
      () => this.store.removeEventListener("theme-changed", onThemeChanged),
      () => this.store.removeEventListener("appearance-changed", onAppearanceChanged),
      () => this.store.removeEventListener("artifact-focus", onArtifactFocus),
    );
  }

  private broadcast(event: ServerEvent | ResourceEventMessage): void {
    const payload = JSON.stringify(event);
    for (const socket of this.wsServer.clients) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }
}

function parseJSONMessage(data: RawData): unknown | null {
  try {
    return JSON.parse(data.toString()) as unknown;
  } catch {
    return null;
  }
}

// The activity signal's exact payload contract: the fixed type, the
// connection's client id, and nothing else. It is an input to the session
// lifecycle, not a recorded event (client-signals.md ^activity-boundary).
function isTelemetryActivityMessage(parsed: unknown, expectedClientId: string): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const record = parsed as Record<string, unknown>;
  return record.type === TELEMETRY_ACTIVITY_MESSAGE_TYPE && record.clientId === expectedClientId && Object.keys(record).length === 2;
}

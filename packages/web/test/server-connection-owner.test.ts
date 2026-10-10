import { describe, expect, it, vi } from "vitest";
import {
  ChangeEvent,
  ServerEventMessageEvent,
  type Channel,
  type ClientTelemetryMeta,
  type ServerEvent,
  type ServerStatusMessage,
} from "@telepath-computer/television-shared";
import {
  ChannelsChangedEvent,
  ServerReconnectedEvent,
  ServerStatusEvent,
} from "../src/events.ts";
import {
  AuthError,
  ServerConnection,
  type ServerConnectionOptions,
} from "../src/services/server-connection.ts";
import { ServerConnectionOwner } from "../src/services/server-connection-owner.ts";
import { LocalStore, type LocalState, type StorageLike } from "../src/store.ts";

const SERVER_URL = "http://localhost:32848";

function createMemoryStorage(): StorageLike {
  const backing = new Map<string, string>();
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => {
      backing.set(key, value);
    },
  };
}

function createLocalStore(state: Partial<LocalState> = {}): LocalStore {
  return new LocalStore(
    `test-${Math.random()}`,
    { authTokens: {}, ...state },
    { storage: createMemoryStorage() },
  );
}

function createChannel(id: string, name: string): Channel {
  return { id, name, layout: [] };
}

class TestServer extends ServerConnection {
  readonly connectCalls: Array<string | null> = [];
  disposeCalls = 0;
  nextConnectError: unknown = null;

  override async connect(token: string | null): Promise<void> {
    this.connectCalls.push(token);
    if (this.nextConnectError !== null) {
      const error = this.nextConnectError;
      this.nextConnectError = null;
      throw error;
    }
  }

  override dispose(): void {
    this.disposeCalls += 1;
  }

  rejectAuthentication(): void {
    this.status = "unauthorized";
    this.hasAuthRejected = true;
    this.dispatchEvent(new ChangeEvent("change"));
  }

  emitServerEvent(event: ServerEvent): void {
    this.dispatchEvent(new ServerEventMessageEvent("server-event", { event }));
  }

  emitServerStatus(message: ServerStatusMessage): void {
    this.dispatchEvent(new ServerStatusEvent("server-status", { message }));
  }
}

function createOwner(options: {
  localStore?: LocalStore;
  serverURL?: string;
  launchToken?: string | null;
  telemetryMeta?: ClientTelemetryMeta;
} = {}): { owner: ServerConnectionOwner; server: TestServer; creations: ServerConnectionOptions[] } {
  const creations: ServerConnectionOptions[] = [];
  let server: TestServer | null = null;
  const owner = new ServerConnectionOwner({
    localStore: options.localStore ?? createLocalStore(),
    serverURL: options.serverURL ?? SERVER_URL,
    launchToken: options.launchToken,
    telemetryMeta: options.telemetryMeta,
    acpStorage: null,
    createSocket: vi.fn(),
    createConnection(connectionOptions) {
      creations.push(connectionOptions);
      server = new TestServer(connectionOptions);
      return server;
    },
  });
  if (server === null) throw new Error("connection factory was not called");
  return { owner, server, creations };
}

describe("ServerConnectionOwner", () => {
  it("constructs exactly one normalized launch connection with launch credentials and metadata", () => {
    const localStore = createLocalStore({ authTokens: { [SERVER_URL]: "stored-token" } });
    const telemetryMeta: ClientTelemetryMeta = {
      clientId: "client-owner",
      userAgent: "UnitAgent/123",
      clientApp: "browser",
    };

    const { owner, server, creations } = createOwner({
      localStore,
      serverURL: `${SERVER_URL}/ignored/path`,
      launchToken: "launch-token",
      telemetryMeta,
    });

    expect(creations).toHaveLength(1);
    expect(owner.connection).toBe(server);
    expect(server.url).toBe(SERVER_URL);
    expect(server.token).toBe("launch-token");
    expect(server.telemetryMeta).toBe(telemetryMeta);
    expect(localStore.get().authTokens).toEqual({ [SERVER_URL]: "launch-token" });
    expect(owner).not.toHaveProperty("servers");
    expect(owner).not.toHaveProperty("activeServer");
    expect(owner).not.toHaveProperty("setActive");
  });

  it("uses the stored token for the launch origin when no launch token exists", () => {
    const localStore = createLocalStore({ authTokens: { [SERVER_URL]: "stored-token" } });
    const { owner, server } = createOwner({ localStore });

    expect(server.token).toBe("stored-token");
    expect(owner.storedAuthToken).toBe("stored-token");
  });

  it("starts the connection while retaining only non-auth connect errors", async () => {
    const localStore = createLocalStore();
    const { owner, server } = createOwner({ localStore });

    server.nextConnectError = new Error("offline");
    await owner.connect();
    expect(owner.connectError).toBe("offline");

    server.nextConnectError = new AuthError();
    await owner.connect();
    expect(owner.connection).toBe(server);
    expect(server.connectCalls).toEqual([null, null]);
    expect(owner.connectError).toBeNull();
  });

  it("clears a token only after the connection rejects authentication", () => {
    const localStore = createLocalStore({ authTokens: { [SERVER_URL]: "bad-token" } });
    const { owner, server } = createOwner({ localStore });

    server.status = "unauthorized";
    server.dispatchEvent(new ChangeEvent("change"));
    expect(owner.storedAuthToken).toBe("bad-token");

    server.rejectAuthentication();
    expect(owner.storedAuthToken).toBeNull();
    expect(server.token).toBeNull();
  });

  it("forwards the connection event contract until idempotent disposal", () => {
    const { owner, server } = createOwner();
    const changed = vi.fn();
    const serverEvents = vi.fn();
    const channelChanges = vi.fn();
    const reconnects = vi.fn();
    const statuses = vi.fn();
    owner.addEventListener("change", changed);
    owner.addEventListener("server-event", serverEvents);
    owner.addEventListener("channels-changed", channelChanges);
    owner.addEventListener("server-reconnected", reconnects);
    owner.addEventListener("server-status", statuses);

    const channel = createChannel("channel-1", "Default");
    const status: ServerStatusMessage = {
      type: "server-status",
      version: "1.2.3",
      requiredDesktopVersion: null,
      update: null,
    };
    server.dispatchEvent(new ChangeEvent("change"));
    server.emitServerEvent({ type: "channel-created", channel });
    server.dispatchEvent(new ChannelsChangedEvent("channels-changed"));
    server.dispatchEvent(new ServerReconnectedEvent("server-reconnected"));
    server.emitServerStatus(status);

    expect(changed).toHaveBeenCalledTimes(1);
    expect(serverEvents).toHaveBeenCalledTimes(1);
    expect(channelChanges).toHaveBeenCalledTimes(1);
    expect(reconnects).toHaveBeenCalledTimes(1);
    expect(statuses).toHaveBeenCalledTimes(1);

    owner.dispose();
    owner.dispose();
    server.dispatchEvent(new ChangeEvent("change"));
    server.emitServerStatus(status);
    expect(server.disposeCalls).toBe(1);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(statuses).toHaveBeenCalledTimes(1);
  });
});

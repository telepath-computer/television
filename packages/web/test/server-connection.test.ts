import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  TELEMETRY_ACTIVITY_MESSAGE_TYPE,
  type ClientTelemetryMeta,
} from "@telepath-computer/television-shared";
import { ACTIVITY_DEBOUNCE_MS } from "../src/services/telemetry-client.ts";
import { ServerConnection } from "../src/services/server-connection.ts";

function connection(): ServerConnection {
  return new ServerConnection({
    url: "http://example.test",
    name: "test",
    token: null,
    createSocket: () => ({
      readyState: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
      send: () => {},
      close: () => {},
    }),
  });
}

describe("ServerConnection artifact routing", () => {
  it("returns dispatcher URLs without resolving the removed view registry or content API", () => {
    const c = connection();
    expect(c.getViewURL({ id: "a", kind: "path", title: "A", path: "/tmp/a.html" })).toBe("http://example.test/artifact/a/a.html");
    expect(c.getContentURL({ id: "a", kind: "path", title: "A", path: "/tmp/a.html" })).toBeNull();
    expect(c.getViewURL({ id: "m", kind: "path", title: "M", path: "/tmp/m.md" })).toBe("/views/markdown/");
    expect(c.getContentURL({ id: "m", kind: "path", title: "M", path: "/tmp/m.md" })).toBe("http://example.test/markdown/m");
    expect(c.getViewURL({ id: "u", kind: "url", title: "U", url: "https://example.com" })).toBe("/views/url-unsupported/");
    expect(c.getContentURL({ id: "u", kind: "url", title: "U", url: "https://example.com" })).toBeNull();
    c.dispose();
  });
});


class FakeSocket {
  readyState = 0;
  listeners = new Map<string, Set<(event: unknown) => void>>();
  sent: string[] = [];
  closed = false;

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void { this.sent.push(data); }

  close(): void { this.closed = true; }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeEventTarget {
  listeners = new Map<string, Set<(event: unknown) => void>>();
  visibilityState = "hidden";
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({});
  }
}

function createClient(overrides: Partial<{ channels: unknown; display: unknown }> = {}) {
  return {
    channels: overrides.channels ?? { list: vi.fn(async () => ({ channels: [{ id: "screen-1", name: "One", layout: [] }] })) },
    display: overrides.display ?? { get: vi.fn(async () => ({
      focusedChannelId: "screen-1",
      pinnedChannelIds: [],
      activeThemeName: null,
      acpEnabled: false,
    })) },
  } as any;
}

describe("ServerConnection lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // Contract (^ap-ac-retry-count): socket/client peers and the scheduler are
  // substitutes; real failure, timing and recovery are crossed by the app walks.
  it("counts completed unreachable reconnects once and resets on success", async () => {
    const sockets: FakeSocket[] = [];
    let halt = false;
    const emitStatus = () => sockets.at(-1)!.emit("message", { data: JSON.stringify({
      type: "server-status", version: "1.0.0", requiredDesktopVersion: null, update: null,
    }) });
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      decideBoot: () => halt ? "halt" : "boot",
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      createClient: () => createClient(),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });
    try {
      const connected = c.connect(null);
      sockets[0]!.emit("open");
      emitStatus();
      await connected;
      sockets[0]!.emit("error");
      sockets[0]!.emit("close");
      expect(c.failedReconnectAttempts).toBe(0);
      for (let count = 1; count <= 3; count += 1) {
        await vi.advanceTimersToNextTimerAsync();
        expect(sockets).toHaveLength(count + 1);
        expect(c.attempting).toBe(true);
        expect(c.failedReconnectAttempts).toBe(count - 1);
        sockets.at(-1)!.emit("error");
        sockets.at(-1)!.emit("close");
        await vi.advanceTimersByTimeAsync(0);
        expect(c.failedReconnectAttempts).toBe(count);
        expect(c.attempting).toBe(false);
        expect(c.nextRetryAt).not.toBeNull();
      }
      halt = true;
      await vi.advanceTimersToNextTimerAsync();
      sockets.at(-1)!.emit("open");
      emitStatus();
      expect(c.bootState).toBe("halted");
      expect(c.failedReconnectAttempts).toBe(3);
      expect(c.nextRetryAt).toBeNull();
      halt = false;
      const recovered = c.connect(null);
      sockets.at(-1)!.emit("open");
      emitStatus();
      await recovered;
      expect(c.status).toBe("connected");
      expect(c.failedReconnectAttempts).toBe(0);
      sockets.at(-1)!.emit("close");
      expect(c.failedReconnectAttempts).toBe(0);
      await vi.advanceTimersToNextTimerAsync();
      sockets.at(-1)!.emit("close", { code: 4401 });
      await vi.advanceTimersByTimeAsync(0);
      expect(c.status).toBe("unauthorized");
      expect(c.failedReconnectAttempts).toBe(0);
      expect(c.nextRetryAt).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      c.dispose();
      vi.useRealTimers();
    }
  });

  it("connects, bootstraps channels/display, emits status changes, and records hasEverConnected", async () => {
    const sockets: FakeSocket[] = [];
    const changes: string[] = [];
    const serverEvents: unknown[] = [];
    const client = createClient();
    const createClientMock = vi.fn(() => client);
    const c = new ServerConnection({
      url: "http://example.test/path?ignored=1",
      name: "test",
      token: "token",
      createSocket: (url) => {
        expect(url).toBe("ws://example.test/events?token=token");
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      createClient: createClientMock,
      visibilityEventTarget: null,
      networkEventTarget: null,
    });
    c.addEventListener("change", () => changes.push(c.status));
    c.addEventListener("server-event", (event) => serverEvents.push((event as unknown as { event: unknown }).event));

    const connected = c.connect("token");
    expect(c.status).toBe("disconnected");
    sockets[0]!.emit("open");
    await connected;

    expect(c.url).toBe("http://example.test");
    expect(createClientMock).toHaveBeenLastCalledWith("http://example.test", "token", null);
    expect(client.channels.list).toHaveBeenCalledTimes(1);
    expect(client.display.get).toHaveBeenCalledTimes(1);
    expect(c.status).toBe("connected");
    expect(c.hasEverConnected).toBe(true);
    expect(c.nextRetryAt).toBeNull();
    expect([...c.channels.values()]).toEqual([{ id: "screen-1", name: "One", layout: [] }]);
    expect(changes).toEqual(["disconnected", "disconnected", "disconnected", "connected"]);
    expect(serverEvents).toContainEqual({ type: "channel-changed", channelID: "screen-1" });
    expect(serverEvents).toContainEqual({ type: "pinned-channels-changed", pinnedChannelIds: [] });
    c.dispose();
  });

  it("attaches one telemetry metadata bundle to the /events URL and HTTP client", async () => {
    const socket = new FakeSocket();
    const client = createClient();
    const telemetryMeta: ClientTelemetryMeta = {
      clientId: "client-connection",
      userAgent: "UnitAgent/123",
      clientApp: "desktop",
      desktopAppVersion: "0.1.170",
    };
    const socketURLs: string[] = [];
    const createClientMock = vi.fn(() => client);
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      token: "token",
      telemetryMeta,
      createSocket: (url) => {
        socketURLs.push(url);
        return socket;
      },
      createClient: createClientMock,
      visibilityEventTarget: null,
      networkEventTarget: null,
    });

    const connected = c.connect("token");
    socket.emit("open");
    await connected;

    const url = new URL(socketURLs[0]!);
    expect(url.searchParams.get("token")).toBe("token");
    expect(url.searchParams.get("clientId")).toBe(telemetryMeta.clientId);
    expect(url.searchParams.get("userAgent")).toBe(telemetryMeta.userAgent);
    expect(url.searchParams.get("clientApp")).toBe("desktop");
    expect(url.searchParams.get("desktopAppVersion")).toBe("0.1.170");
    expect(createClientMock).toHaveBeenLastCalledWith("http://example.test", "token", telemetryMeta);
    c.dispose();
  });

  it("starts a content-free activity agent that sends over the connected socket", async () => {
    const socket = new FakeSocket();
    const telemetryWindow = new FakeEventTarget();
    const telemetryDocument = new FakeEventTarget();
    telemetryDocument.visibilityState = "visible";
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      telemetryMeta: { clientId: "client-activity", userAgent: "UnitAgent/123", clientApp: "browser" },
      createSocket: () => socket,
      createClient: () => createClient(),
      visibilityEventTarget: null,
      networkEventTarget: null,
      telemetryWindowTarget: telemetryWindow,
      telemetryDocumentTarget: telemetryDocument,
    });

    const connected = c.connect(null);
    socket.emit("open");
    await connected;

    telemetryWindow.emit("pointerdown");
    telemetryWindow.emit("keydown");
    vi.advanceTimersByTime(ACTIVITY_DEBOUNCE_MS);
    telemetryWindow.emit("scroll");

    expect(socket.sent.map((payload) => JSON.parse(payload) as unknown)).toEqual([
      { type: TELEMETRY_ACTIVITY_MESSAGE_TYPE, clientId: "client-activity" },
      { type: TELEMETRY_ACTIVITY_MESSAGE_TYPE, clientId: "client-activity" },
    ]);
    c.dispose();
  });

  it("server-event listener fires with the parsed ServerEvent on each /events message", async () => {
    const socket = new FakeSocket();
    const serverEvents: unknown[] = [];
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      token: "token",
      createSocket: () => socket,
      createClient: () => createClient(),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });
    c.addEventListener("server-event", (event) => {
      serverEvents.push((event as unknown as { event: unknown }).event);
    });

    const connected = c.connect("token");
    socket.emit("open");
    await connected;

    const event = {
      type: "artifact-created" as const,
      channelID: "screen-1",
      artifact: { id: "artifact-1", kind: "path" as const, title: "HTML", path: "/tmp/a.html" },
    };
    socket.emit("message", { data: JSON.stringify(event) });

    expect(serverEvents).toEqual([
      { type: "channel-changed", channelID: "screen-1" },
      { type: "pinned-channels-changed", pinnedChannelIds: [] },
      event,
    ]);
    expect(c.channels.get("screen-1")?.layout).toEqual([{
      artifactIds: ["artifact-1"],
      geometry: { kind: "single", full_screen: false },
      size: DEFAULT_PAGE_SIZE,
    }]);
    c.dispose();
  });

  it("bootstraps null focus and ordered pins from /display", async () => {
    const socket = new FakeSocket();
    const serverEvents: unknown[] = [];
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      token: "token",
      createSocket: () => socket,
      createClient: () => createClient({
        display: { get: vi.fn(async () => ({
          focusedChannelId: null,
          pinnedChannelIds: ["screen-1"],
          activeThemeName: null,
          acpEnabled: false,
        })) },
      }),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });
    c.addEventListener("server-event", (event) => {
      serverEvents.push((event as unknown as { event: unknown }).event);
    });

    const connected = c.connect("token");
    socket.emit("open");
    await connected;

    expect(serverEvents).toContainEqual({ type: "channel-changed", channelID: null });
    expect(serverEvents).toContainEqual({
      type: "pinned-channels-changed",
      pinnedChannelIds: ["screen-1"],
    });
    c.dispose();
  });

  it("applies artifact-removed and channel-updated events to the local channel map", async () => {
    const socket = new FakeSocket();
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      token: "token",
      createSocket: () => socket,
      createClient: () => createClient({
        channels: { list: vi.fn(async () => ({ channels: [{
          id: "screen-1",
          name: "One",
          layout: [{
            artifactIds: ["artifact-1"],
            geometry: { kind: "single", full_screen: false },
            size: DEFAULT_PAGE_SIZE,
          }],
        }] })) },
      }),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });

    const connected = c.connect("token");
    socket.emit("open");
    await connected;

    socket.emit("message", { data: JSON.stringify({ type: "artifact-removed", channelID: "screen-1", artifactID: "artifact-1" }) });
    expect(c.channels.get("screen-1")?.layout).toEqual([]);

    socket.emit("message", { data: JSON.stringify({ type: "channel-updated", channel: { id: "screen-1", name: "Renamed", layout: [] } }) });
    expect(c.channels.get("screen-1")?.name).toBe("Renamed");
    c.dispose();
  });

  it("POSTs via the client, seeds the channels map, and returns the new channel", async () => {
    const created = { id: "screen-new", name: "New", layout: [] };
    const client = createClient({
      channels: {
        list: vi.fn(async () => ({ channels: [] })),
        create: vi.fn(async () => ({ channel: created })),
      },
    });
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => new FakeSocket(),
      createClient: () => client,
      visibilityEventTarget: null,
      networkEventTarget: null,
    });

    const result = await c.createChannel("New");

    expect(result).toEqual(created);
    expect(c.channels.get(created.id)).toEqual(created);
    expect(client.channels.create).toHaveBeenCalledWith({ name: "New" });
    c.dispose();
  });

  it("exposes a non-null disabled ACP client at construction", () => {
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      visibilityEventTarget: null,
      networkEventTarget: null,
    });

    expect(c.acpClient).not.toBeNull();
    expect(c.acpClient.enabled).toBe(false);
    c.dispose();
  });

  it("disables the ACP client from the display bootstrap when ACP is unavailable", async () => {
    const socket = new FakeSocket();
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => socket,
      createClient: () => createClient({
        display: { get: vi.fn(async () => ({
          focusedChannelId: "screen-1",
          pinnedChannelIds: [],
          activeThemeName: null,
          acpEnabled: false,
        })) },
      }),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });

    const connected = c.connect(null);
    socket.emit("open");
    await connected;

    expect(c.acpClient.enabled).toBe(false);
    c.dispose();
  });

  it("uses the latest auth token when opening the ACP WebSocket", async () => {
    const eventSocket = new FakeSocket();
    const acpSocket = new FakeSocket();
    const acpURLs: string[] = [];
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      token: null,
      createSocket: () => eventSocket,
      createACPSocket: (url) => {
        acpURLs.push(url);
        return acpSocket;
      },
      createClient: () => createClient({
        display: { get: vi.fn(async () => ({
          focusedChannelId: "screen-1",
          pinnedChannelIds: [],
          activeThemeName: null,
          acpEnabled: true,
        })) },
      }),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });

    const connected = c.connect("fresh-token");
    eventSocket.emit("open");
    await connected;

    const acpConnect = c.acpClient.connect();
    expect(acpURLs[0]).toBe("ws://example.test/acp?token=fresh-token");
    acpSocket.emit("error", {});
    await expect(acpConnect).rejects.toThrow("ACP bridge websocket error");
    c.dispose();
  });

  it("keeps the same acpClient instance across HTTP reconnects", async () => {
    const sockets: FakeSocket[] = [];
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      createClient: () => createClient(),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });
    const initial = c.acpClient;

    const first = c.connect(null);
    sockets[0]!.emit("open");
    await first;
    sockets[0]!.emit("close", { code: 1006 });
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);

    expect(c.acpClient).toBe(initial);
    c.dispose();
  });

  it("surfaces AuthError and stops retrying on 4401 close before bootstrap", async () => {
    const socket = new FakeSocket();
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => socket,
      createClient: () => createClient(),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });

    const connecting = c.connect("bad");
    socket.emit("close", { code: 4401 });

    await expect(connecting).rejects.toMatchObject({ name: "AuthError" });
    expect(c.status).toBe("unauthorized");
    expect(c.nextRetryAt).toBeNull();
    c.dispose();
  });

  // Contract: injected socket and HTTP-client sources replace transport. The
  // real rejection and recovery remain in e2e/auth.01.test.ts.
  it("clears authorization rejection when starting a new connection", async () => {
    const sockets: FakeSocket[] = [];
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      createClient: () => createClient(),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });

    const initial = c.connect(null);
    sockets[0]!.emit("close", { code: 4401 });
    await expect(initial).rejects.toMatchObject({ name: "AuthError" });
    expect(c.hasAuthRejected).toBe(true);

    const rejected = c.connect("bad-token");
    expect(c.hasAuthRejected).toBe(false);
    sockets[1]!.emit("close", { code: 4401 });
    await expect(rejected).rejects.toMatchObject({ name: "AuthError" });
    expect(c.hasAuthRejected).toBe(true);

    const accepted = c.connect("good-token");
    expect(c.hasAuthRejected).toBe(false);
    sockets[2]!.emit("open");
    await accepted;
    expect(c.status).toBe("connected");
    expect(c.hasAuthRejected).toBe(false);
    c.dispose();
  });

  it("4401 close after a successful connect transitions to 'unauthorized' and stops retrying", async () => {
    const socket = new FakeSocket();
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => socket,
      createClient: () => createClient(),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });

    const connected = c.connect(null);
    socket.emit("open");
    await connected;
    socket.emit("close", { code: 4401 });

    expect(c.status).toBe("unauthorized");
    expect(c.nextRetryAt).toBeNull();
    c.dispose();
  });

  it("treats 401 bootstrap responses as AuthError", async () => {
    const socket = new FakeSocket();
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => socket,
      createClient: () => createClient({ channels: { list: vi.fn(async () => { const error = new Error("Unauthorized") as any; error.status = 401; error.name = "RequestError"; Object.setPrototypeOf(error, (await import("@telepath-computer/television-shared")).RequestError.prototype); throw error; }) } }),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });

    const connecting = c.connect("bad");
    socket.emit("open");
    await expect(connecting).rejects.toMatchObject({ name: "AuthError" });
    expect(c.status).toBe("unauthorized");
    expect(c.hasAuthRejected).toBe(true);
    c.dispose();
  });

  it("auto-reconnects after post-success close with exponential backoff metadata", async () => {
    const sockets: FakeSocket[] = [];
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      createClient: () => createClient(),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });

    const first = c.connect(null);
    sockets[0]!.emit("open");
    await first;
    sockets[0]!.emit("close", { code: 1006 });

    expect(c.status).toBe("disconnected");
    expect(c.hasEverConnected).toBe(true);
    expect(c.nextRetryAt).toEqual(expect.any(Number));
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1]!.emit("error", {});
    await Promise.resolve();
    expect(c.nextRetryAt).toEqual(expect.any(Number));
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    c.dispose();
  });

  it("error followed by close on the same socket does not double-schedule a retry", async () => {
    const sockets: FakeSocket[] = [];
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      createClient: () => createClient(),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });

    const connected = c.connect(null);
    sockets[0]!.emit("open");
    await connected;
    sockets[0]!.emit("error", {});
    const firstRetryAt = c.nextRetryAt;
    sockets[0]!.emit("close", { code: 1006 });

    expect(c.nextRetryAt).toBe(firstRetryAt);
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    c.dispose();
  });

  it("a wake signal during an in-flight attempt is a no-op", async () => {
    const visibility = new FakeEventTarget();
    const sockets: FakeSocket[] = [];
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      createClient: () => createClient(),
      visibilityEventTarget: visibility,
      networkEventTarget: null,
    });

    const first = c.connect(null);
    sockets[0]!.emit("error", {});
    await expect(first).rejects.toThrow("WebSocket connection failed");
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);

    visibility.visibilityState = "visible";
    visibility.emit("visibilitychange");
    expect(sockets).toHaveLength(2);
    c.dispose();
  });

  it("a non-401 bootstrap failure during a retry schedules another attempt", async () => {
    const sockets: FakeSocket[] = [];
    const client = createClient({
      channels: { list: vi.fn(async () => { throw new Error("boom"); }) },
    });
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      createClient: () => client,
      visibilityEventTarget: null,
      networkEventTarget: null,
    });

    const first = c.connect(null);
    sockets[0]!.emit("error", {});
    await expect(first).rejects.toThrow("WebSocket connection failed");
    vi.advanceTimersByTime(1000);
    sockets[1]!.emit("open");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(c.nextRetryAt).toEqual(expect.any(Number));
    vi.advanceTimersByTime(2000);
    expect(sockets).toHaveLength(3);
    c.dispose();
  });

  it("a subsequent connect() while a retry is pending cancels the timer and starts fresh", async () => {
    const sockets: FakeSocket[] = [];
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      createClient: () => createClient(),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });

    const first = c.connect(null);
    sockets[0]!.emit("error", {});
    await expect(first).rejects.toThrow("WebSocket connection failed");
    expect(c.nextRetryAt).not.toBeNull();

    const second = c.connect("fresh");
    expect(c.nextRetryAt).toBeNull();
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    sockets[1]!.emit("open");
    await second;
    c.dispose();
  });

  it("wake signals cancel a pending retry and attempt immediately", async () => {
    const visibility = new FakeEventTarget();
    const network = new FakeEventTarget();
    const sockets: FakeSocket[] = [];
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      createClient: () => createClient(),
      visibilityEventTarget: visibility,
      networkEventTarget: network,
    });

    const first = c.connect(null);
    sockets[0]!.emit("open");
    await first;
    sockets[0]!.emit("close", { code: 1006 });
    expect(c.nextRetryAt).not.toBeNull();

    visibility.visibilityState = "visible";
    visibility.emit("visibilitychange");
    expect(c.nextRetryAt).toBeNull();
    expect(sockets).toHaveLength(2);
    sockets[1]!.emit("error", {});
    await Promise.resolve();
    network.emit("online");
    expect(sockets).toHaveLength(3);
    c.dispose();
  });

  it("wake signal while connected is a no-op", async () => {
    const visibility = new FakeEventTarget();
    const network = new FakeEventTarget();
    const sockets: FakeSocket[] = [];
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      createClient: () => createClient(),
      visibilityEventTarget: visibility,
      networkEventTarget: network,
    });

    const connected = c.connect(null);
    sockets[0]!.emit("open");
    await connected;

    visibility.visibilityState = "visible";
    visibility.emit("visibilitychange");
    network.emit("online");
    expect(sockets).toHaveLength(1);
    c.dispose();
  });

  it("wake signal after 4401 is a no-op", async () => {
    const visibility = new FakeEventTarget();
    const network = new FakeEventTarget();
    const sockets: FakeSocket[] = [];
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      createClient: () => createClient(),
      visibilityEventTarget: visibility,
      networkEventTarget: network,
    });

    const connecting = c.connect("bad");
    sockets[0]!.emit("close", { code: 4401 });
    await expect(connecting).rejects.toMatchObject({ name: "AuthError" });

    visibility.visibilityState = "visible";
    visibility.emit("visibilitychange");
    network.emit("online");
    expect(sockets).toHaveLength(1);
    expect(c.nextRetryAt).toBeNull();
    c.dispose();
  });

  it("dispose closes sockets, disposes ACP, clears retry metadata, and removes wake listeners", async () => {
    const visibility = new FakeEventTarget();
    const network = new FakeEventTarget();
    const socket = new FakeSocket();
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      createSocket: () => socket,
      createClient: () => createClient(),
      visibilityEventTarget: visibility,
      networkEventTarget: network,
    });
    const acpDispose = vi.spyOn(c.acpClient, "dispose");

    const connected = c.connect(null);
    socket.emit("open");
    await connected;
    expect(c.nextRetryAt).toBeNull();

    c.dispose();
    expect(socket.closed).toBe(true);
    expect(c.nextRetryAt).toBeNull();
    expect(c.status).toBe("unauthorized");
    expect(acpDispose).toHaveBeenCalled();
    expect(visibility.listeners.get("visibilitychange")?.size ?? 0).toBe(0);
    expect(network.listeners.get("online")?.size ?? 0).toBe(0);
  });
});

// Contract tests for the client's /events message routing
// (specs/arch/updates/version-advertisement.md ^t-unknown-message; messages
// injected through the fake socket — greenlit by the spec, the real websocket
// crossing owned by ^t-reload-wiring and ^t-server-status-on-connect). The
// routing makes dropping unknown message types a deliberate contract
// (^unknown-messages) — what lets the lockstep server↔client shapes change
// freely (arch/updates/index.md ^updates-lockstep-contracts).
describe("ServerConnection /events message routing", () => {
  async function connectedWithSocket() {
    const socket = new FakeSocket();
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      token: "token",
      createSocket: () => socket,
      createClient: () => createClient(),
      visibilityEventTarget: null,
      networkEventTarget: null,
    });
    const connected = c.connect("token");
    socket.emit("open");
    await connected;
    return { c, socket };
  }

  it("ignores a message with an unrecognized type without throwing, and the socket keeps working", async () => {
    const { c, socket } = await connectedWithSocket();
    const serverEvents: unknown[] = [];
    c.addEventListener("server-event", (event) => serverEvents.push((event as unknown as { event: { type: string } }).event));

    expect(() => {
      socket.emit("message", { data: JSON.stringify({ type: "mystery-future-message", payload: "x" }) });
    }).not.toThrow();
    expect(serverEvents).toHaveLength(0);

    // The connection is unharmed: a known domain event still flows.
    socket.emit("message", { data: JSON.stringify({ type: "channel-changed", channelID: "screen-1" }) });
    expect(serverEvents).toEqual([{ type: "channel-changed", channelID: "screen-1" }]);
    c.dispose();
  });

  it("drops valid JSON that carries no string type", async () => {
    const { c, socket } = await connectedWithSocket();
    const serverEvents: unknown[] = [];
    c.addEventListener("server-event", () => serverEvents.push(true));

    expect(() => {
      socket.emit("message", { data: "{}" });
      socket.emit("message", { data: "42" });
      socket.emit("message", { data: JSON.stringify({ type: 7 }) });
      socket.emit("message", { data: JSON.stringify([1, 2, 3]) });
    }).not.toThrow();
    expect(serverEvents).toHaveLength(0);
    c.dispose();
  });

  it("routes server-status to its own handler, not the domain event path", async () => {
    const { c, socket } = await connectedWithSocket();
    const statuses: unknown[] = [];
    const serverEvents: unknown[] = [];
    c.addEventListener("server-status", (event) => {
      const received = event as unknown as { serverURL: string; message: unknown };
      statuses.push({ serverURL: received.serverURL, message: received.message });
    });
    c.addEventListener("server-event", () => serverEvents.push(true));

    const message = { type: "server-status", version: "1.2.3", requiredDesktopVersion: null, update: null };
    socket.emit("message", { data: JSON.stringify(message) });

    expect(statuses).toEqual([{ serverURL: "http://example.test", message }]);
    expect(serverEvents).toHaveLength(0);
    c.dispose();
  });

  it("retains serverVersion and updateState from each server-status — replaced by the next, never cleared by a disconnect (^relay)", async () => {
    const { c, socket } = await connectedWithSocket();
    expect(c.serverVersion).toBeNull();
    expect(c.updateState).toBeNull();

    const toast = { version: "1.5.0", markdown: "Release 1.5.0 is out." };
    socket.emit("message", {
      data: JSON.stringify({ type: "server-status", version: "1.2.3", requiredDesktopVersion: null, update: { toast, desktop: null } }),
    });
    expect(c.serverVersion).toBe("1.2.3");
    expect(c.updateState).toEqual({ toast, desktop: null });

    // The next status REPLACES the retained state (here: no update anymore).
    socket.emit("message", {
      data: JSON.stringify({ type: "server-status", version: "1.2.4", requiredDesktopVersion: null, update: null }),
    });
    expect(c.serverVersion).toBe("1.2.4");
    expect(c.updateState).toBeNull();

    socket.emit("message", {
      data: JSON.stringify({ type: "server-status", version: "1.2.4", requiredDesktopVersion: null, update: { toast, desktop: null } }),
    });
    expect(c.updateState).toEqual({ toast, desktop: null });

    // A dropped socket does not clear the retained state: last-known-good
    // applies until a new status replaces it (update-channel.md ^relay).
    socket.emit("close", { code: 1000 });
    expect(c.serverVersion).toBe("1.2.4");
    expect(c.updateState).toEqual({ toast, desktop: null });
    c.dispose();
  });

  it("still applies and dispatches known ServerEvent types through the domain path", async () => {
    const { c, socket } = await connectedWithSocket();
    const serverEvents: Array<{ type: string }> = [];
    c.addEventListener("server-event", (event) => serverEvents.push((event as unknown as { event: { type: string } }).event));

    socket.emit("message", { data: JSON.stringify({ type: "channel-updated", channel: { id: "screen-1", name: "Renamed", layout: [] } }) });
    expect(c.channels.get("screen-1")?.name).toBe("Renamed");
    expect(serverEvents.map((event) => event.type)).toEqual(["channel-updated"]);
    c.dispose();
  });
});

// Contract tests for the client half of the telemetry signal
// (specs/arch/telemetry/client-signals.md): sendTelemetrySignal wraps the
// caller's event in the TelemetryClientSignal envelope — the connection's
// client id, the fixed message type — and sends it over the connected /events
// socket. The client is deliberately telemetry-unaware (^signal-forwarding):
// it always sends; opt-out suppression lives server-side behind capture().
// Server-side acceptance is owned by ^t-signal-validation /
// ^t-signal-forwarding; this covers only the sender's envelope and gating.
describe("ServerConnection telemetry signal sender", () => {
  const telemetryMeta: ClientTelemetryMeta = {
    clientId: "client-signal-sender",
    userAgent: "UnitAgent/123",
    clientApp: "browser",
  };

  function build(input: { meta: ClientTelemetryMeta | null }) {
    const socket = new FakeSocket();
    const c = new ServerConnection({
      url: "http://example.test",
      name: "test",
      token: "token",
      telemetryMeta: input.meta,
      createSocket: () => socket,
      createClient: () => createClient(),
      visibilityEventTarget: null,
      networkEventTarget: null,
      telemetryWindowTarget: null,
      telemetryDocumentTarget: null,
    });
    return { c, socket };
  }

  it("sends the enveloped signal with the connection's client id over the connected socket", async () => {
    const { c, socket } = build({ meta: telemetryMeta });
    const connected = c.connect("token");
    socket.emit("open");
    await connected;

    c.sendTelemetrySignal("update_toast_shown", { server_version: "1.2.3", channel_version: "1.2.4" });
    c.sendTelemetrySignal("client_autoreloaded", {});

    expect(socket.sent.map((payload) => JSON.parse(payload) as unknown)).toEqual([
      {
        type: "telemetry-signal",
        clientId: "client-signal-sender",
        event: "update_toast_shown",
        properties: { server_version: "1.2.3", channel_version: "1.2.4" },
      },
      {
        type: "telemetry-signal",
        clientId: "client-signal-sender",
        event: "client_autoreloaded",
        properties: {},
      },
    ]);
    c.dispose();
  });

  it("drops the send while not connected — before connect and after dispose", async () => {
    const { c, socket } = build({ meta: telemetryMeta });
    c.sendTelemetrySignal("update_toast_shown", { channel_version: "1.2.4" });
    expect(socket.sent).toEqual([]);

    const connected = c.connect("token");
    socket.emit("open");
    await connected;
    c.dispose();

    c.sendTelemetrySignal("update_toast_shown", { channel_version: "1.2.4" });
    expect(socket.sent).toEqual([]);
  });

  it("sends nothing when the connection has no telemetry metadata (no client id to ride)", async () => {
    const { c, socket } = build({ meta: null });
    const connected = c.connect("token");
    socket.emit("open");
    await connected;

    c.sendTelemetrySignal("update_toast_shown", { channel_version: "1.2.4" });
    expect(socket.sent).toEqual([]);
    c.dispose();
  });
});

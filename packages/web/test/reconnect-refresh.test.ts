import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PAGE_GEOMETRY,
  type Channel,
  type TabPage,
  type TelevisionClient,
} from "@telepath-computer/television-shared";
import type { Artifact } from "@telepath-computer/television-artifact";
import { ServerConnection } from "../src/services/server-connection.ts";
import { ServerConnectionOwner } from "../src/services/server-connection-owner.ts";
import { ApplicationService } from "../src/services/application-service.ts";
import { LocalStore, type LocalState, type StorageLike } from "../src/store.ts";

// Service-level corroboration for reconnect convergence
// (specs/arch/channel-state/index.md#^cs-converge). Injected socket and HTTP
// sources drive the real ServerConnectionOwner, ServerConnection, and
// ApplicationService stack through disconnect, retry, and complete refresh;
// the real browser/server acceptance crossing lives in the split
// reload-after-reconnect files.

const SERVER_URL = "http://reconnect.test";

class FakeSocket {
  readyState = 0;
  listeners = new Map<string, Set<(event: unknown) => void>>();
  closed = false;

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(): void {}

  close(): void {
    this.closed = true;
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

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
  const initial: LocalState = {
    authTokens: {},
    ...state,
  };
  return new LocalStore("test-" + Math.random(), initial, { storage: createMemoryStorage() });
}

/**
 * Mutable server-side truth. The fake TelevisionClient reads it lazily, so
 * tests mutate it while "disconnected" and the next reconnect bootstrap
 * observes the post-outage state — exactly like a real server whose events
 * were lost while no /events socket was open.
 */
interface ServerTruth {
  channels: Channel[];
  artifactsByChannel: Map<string, Artifact[]>;
  focusedChannelId: string | null;
  pinnedChannelIds: string[];
}

function createTruthClient(truth: ServerTruth): TelevisionClient {
  return {
    channels: {
      list: vi.fn(async () => ({ channels: structuredClone(truth.channels) })),
      get: vi.fn(async ({ channelID }: { channelID: string }) => {
        const channel = truth.channels.find((entry) => entry.id === channelID);
        if (!channel) throw new Error(`Channel not found: ${channelID}`);
        return {
          channel: structuredClone(channel),
          artifacts: structuredClone(truth.artifactsByChannel.get(channelID) ?? []),
        };
      }),
      update: vi.fn(async () => ({ channel: { id: "", name: "", layout: [] } })),
      create: vi.fn(async () => ({ channel: { id: "", name: "", layout: [] } })),
      remove: vi.fn(async () => ({})),
    },
    display: {
      get: vi.fn(async () => ({
        focusedChannelId: truth.focusedChannelId,
        pinnedChannelIds: [...truth.pinnedChannelIds],
        activeThemeName: null,
        themeJavaScriptConsentIds: [],
        acpEnabled: false,
      })),
      patch: vi.fn(async () => undefined),
    },
    artifacts: {
      delete: vi.fn(async () => ({})),
    },
  } as unknown as TelevisionClient;
}

function page(
  artifactID: string,
  fullScreen = false,
  size = { width: 531.25, height: 731.5 },
): TabPage {
  return {
    artifactIds: [artifactID],
    geometry: fullScreen
      ? { kind: "single", full_screen: true }
      : { ...DEFAULT_PAGE_GEOMETRY },
    size: { ...size },
  };
}

const ARTIFACT_A: Artifact = { id: "art-a", kind: "path", title: "A", path: "/tmp/a.md" };
const ARTIFACT_B: Artifact = { id: "art-b", kind: "path", title: "B", path: "/tmp/b.html" };

function createTruth(): ServerTruth {
  return {
    channels: [{ id: "scr-1", name: "One", layout: [page("art-a")] }],
    artifactsByChannel: new Map([["scr-1", [structuredClone(ARTIFACT_A)]]]),
    focusedChannelId: "scr-1",
    pinnedChannelIds: [],
  };
}

interface Harness {
  truth: ServerTruth;
  sockets: FakeSocket[];
  localStore: LocalStore;
  connectionOwner: ServerConnectionOwner;
  server: ServerConnection;
  applicationService: ApplicationService;
}

function createHarness(): Harness {
  const truth = createTruth();
  const sockets: FakeSocket[] = [];
  const localStore = createLocalStore();
  let server: ServerConnection | null = null;
  const connectionOwner = new ServerConnectionOwner({
    localStore,
    serverURL: SERVER_URL,
    acpStorage: null,
    clientGUID: "test-guid",
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    createConnection: (options) => {
      server = new ServerConnection({
        ...options,
        createClient: () => createTruthClient(truth),
        visibilityEventTarget: null,
        networkEventTarget: null,
      });
      return server;
    },
  });
  if (server === null) throw new Error("connection factory was not called");
  const applicationService = new ApplicationService({ connectionOwner });
  return { truth, sockets, localStore, connectionOwner, server, applicationService };
}

function disposeHarness(harness: Harness): void {
  harness.applicationService.dispose();
  harness.connectionOwner.dispose();
}

async function settle(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
}

async function connectInitial(harness: Harness): Promise<void> {
  const connected = harness.connectionOwner.connect();
  harness.sockets[0]!.emit("open");
  await connected;
  await settle();
}

function disconnect(harness: Harness): void {
  harness.sockets.at(-1)!.emit("close", { code: 1006 });
  expect(harness.server.status).toBe("disconnected");
}

/** Advance through the 1s retry, open the next socket, let bootstrap finish. */
async function reconnect(harness: Harness): Promise<void> {
  const socketsBefore = harness.sockets.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(harness.sockets.length).toBe(socketsBefore + 1);
  harness.sockets.at(-1)!.emit("open");
  await settle();
  expect(harness.server.status).toBe("connected");
}

describe("reconnect convergence (service stack)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("control: connects and resolves the focused application channel with its artifacts", async () => {
    const harness = createHarness();
    await connectInitial(harness);

    const focused = harness.applicationService.snapshot.focusedChannel;
    expect(focused?.id).toBe("scr-1");
    expect(focused?.artifacts.some(({ id }) => id === "art-a")).toBe(true);
    disposeHarness(harness);
  });

  it("artifact added to the focused channel while disconnected appears after reconnect", async () => {
    const harness = createHarness();
    await connectInitial(harness);
    expect(harness.applicationService.snapshot.focusedChannel?.artifacts.some(({ id }) => id === "art-a")).toBe(true);

    disconnect(harness);
    harness.truth.channels[0]!.layout.push(page("art-b"));
    harness.truth.artifactsByChannel.get("scr-1")!.push(structuredClone(ARTIFACT_B));

    await reconnect(harness);

    const focused = harness.applicationService.snapshot.focusedChannel;
    expect(focused?.id).toBe("scr-1");
    expect(focused?.artifacts.some(({ id }) => id === "art-b")).toBe(true);
    expect(JSON.stringify(focused?.pages)).toContain("art-b");
    disposeHarness(harness);
  });

  it("artifact removed while disconnected disappears after reconnect", async () => {
    const harness = createHarness();
    await connectInitial(harness);
    expect(harness.applicationService.snapshot.focusedChannel?.artifacts.some(({ id }) => id === "art-a")).toBe(true);

    disconnect(harness);
    harness.truth.channels[0]!.layout = [];
    harness.truth.artifactsByChannel.set("scr-1", []);

    await reconnect(harness);

    const focused = harness.applicationService.snapshot.focusedChannel;
    expect(focused?.id).toBe("scr-1");
    expect(focused?.artifacts.some(({ id }) => id === "art-a")).toBe(false);
    expect(focused?.pages).toEqual([]);
    disposeHarness(harness);
  });

  it("channel rename and full-screen change while disconnected converge after reconnect", async () => {
    const harness = createHarness();
    await connectInitial(harness);
    expect(harness.applicationService.snapshot.focusedChannel?.name).toBe("One");

    disconnect(harness);
    harness.truth.channels[0]!.name = "Renamed";
    const refreshedPage = page("art-a", true, { width: 643.75, height: 743.25 });
    harness.truth.channels[0]!.layout = [refreshedPage];

    await reconnect(harness);

    const focused = harness.applicationService.snapshot.focusedChannel;
    expect(focused?.id).toBe("scr-1");
    expect(focused?.name).toBe("Renamed");
    expect(focused?.pages).toEqual([refreshedPage]);
    disposeHarness(harness);
  });

  it("dispatches an application change after reconnect replaces the snapshot", async () => {
    const harness = createHarness();
    await connectInitial(harness);
    const changed = vi.fn();
    harness.applicationService.addEventListener("change", changed);

    disconnect(harness);
    changed.mockClear();
    harness.truth.channels[0]!.name = "Renamed";
    harness.truth.channels.push({ id: "scr-2", name: "Two", layout: [] });

    await reconnect(harness);

    expect(changed).toHaveBeenCalled();
    expect(harness.applicationService.snapshot.channels.map(({ id }) => id)).toEqual(["scr-1", "scr-2"]);
    disposeHarness(harness);
  });

  it("control: reconnect bootstrap refreshes the connection-level channels map", async () => {
    const harness = createHarness();
    await connectInitial(harness);

    disconnect(harness);
    harness.truth.channels[0]!.name = "Renamed";
    harness.truth.channels.push({ id: "scr-2", name: "Two", layout: [] });

    await reconnect(harness);

    expect(harness.server.channels.get("scr-1")?.name).toBe("Renamed");
    expect(harness.server.channels.has("scr-2")).toBe(true);
    disposeHarness(harness);
  });

  it("control: focus and pins changed while disconnected recover after reconnect", async () => {
    const harness = createHarness();
    await connectInitial(harness);
    expect(harness.applicationService.snapshot.focusedChannel?.id).toBe("scr-1");

    disconnect(harness);
    harness.truth.channels.push({ id: "scr-2", name: "Two", layout: [page("art-b")] });
    harness.truth.artifactsByChannel.set("scr-2", [structuredClone(ARTIFACT_B)]);
    harness.truth.focusedChannelId = "scr-2";
    harness.truth.pinnedChannelIds = ["scr-2", "scr-1"];

    await reconnect(harness);

    expect(harness.applicationService.snapshot.focusedChannel?.id).toBe("scr-2");
    expect(harness.applicationService.snapshot.focusedChannel?.artifacts.some(({ id }) => id === "art-b")).toBe(true);
    expect(harness.applicationService.snapshot.display.pinnedChannelIds).toEqual(["scr-2", "scr-1"]);
    disposeHarness(harness);
  });
});

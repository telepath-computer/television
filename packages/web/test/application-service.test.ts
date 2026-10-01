import { afterEach, describe, expect, it, vi } from "vitest";
import type { Artifact } from "@telepath-computer/television-artifact";
import {
  AppearanceChangedEvent,
  ArtifactContentChangedEvent,
  ArtifactFocusEvent,
  ChangeEvent,
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  RequestError,
  ServerEventMessageEvent,
  ThemeChangedEvent,
  type Channel,
  type DisplayPatch,
  type DisplayState,
  type ServerEvent,
  type TabPage,
  type TelevisionClient,
  type ThemeRegistrySnapshot,
  type UpdateState,
} from "@telepath-computer/television-shared";
import { ApplicationService } from "../src/services/application-service.ts";
import type { ServerConnection } from "../src/services/server-connection.ts";
import type { ServerConnectionOwner } from "../src/services/server-connection-owner.ts";

const SERVER_URL = "http://application.test";

function page(
  artifactIds: string[],
  fullScreen = false,
  size: { width: number; height: number } = DEFAULT_PAGE_SIZE,
): TabPage {
  return {
    artifactIds,
    geometry: { ...DEFAULT_PAGE_GEOMETRY, full_screen: fullScreen },
    size: { ...size },
  };
}

function channel(id: string, name: string, artifactIds: string[] = []): Channel {
  return { id, name, layout: artifactIds.map((id) => page([id])) };
}

function artifact(id: string, title = id): Artifact {
  return { id, kind: "path", title, path: `/tmp/${id}.html` };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

type DisplayFixtureState = Omit<
  DisplayState,
  "activeThemeColorScheme" | "themeJavaScriptConsentIds"
> & {
  activeThemeColorScheme?: DisplayState["activeThemeColorScheme"];
  themeJavaScriptConsentIds?: string[];
};

interface ClientOverrides {
  listChannels?: () => Promise<{ channels: Channel[] }>;
  getDisplay?: () => Promise<DisplayFixtureState>;
  getChannel?: (input: { channelID: string }) => Promise<{ channel: Channel; artifacts: Artifact[] }>;
  createChannel?: (input: { name: string }) => Promise<{ channel: Channel }>;
  updateChannel?: (input: { channelID: string; name?: string; layout?: TabPage[] }) => Promise<{ channel: Channel }>;
  removeChannel?: (input: { channelID: string }) => Promise<unknown>;
  patchDisplay?: (input: DisplayPatch) => Promise<void>;
  listThemes?: () => Promise<ThemeRegistrySnapshot>;
  refreshThemes?: () => Promise<ThemeRegistrySnapshot>;
  getArtifact?: (input: { artifactID: string }) => Promise<{ artifact: Artifact }>;
  deleteArtifact?: (input: { artifactID: string }) => Promise<unknown>;
}

function createClient(options: ClientOverrides = {}): TelevisionClient {
  return {
    channels: {
      list: vi.fn(options.listChannels ?? (async () => ({ channels: [] }))),
      get: vi.fn(options.getChannel ?? (async ({ channelID }: { channelID: string }) => ({
        channel: channel(channelID, channelID),
        artifacts: [],
      }))),
      create: vi.fn(options.createChannel ?? (async ({ name }: { name: string }) => ({
        channel: channel("created", name),
      }))),
      update: vi.fn(options.updateChannel ?? (async (input: { channelID: string; name?: string; layout?: TabPage[] }) => ({
        channel: channel(input.channelID, input.name ?? input.channelID),
      }))),
      remove: vi.fn(options.removeChannel ?? (async ({ channelID }: { channelID: string }) => ({ channelID }))),
    },
    display: {
      get: vi.fn(async () => {
        const display = await (options.getDisplay ?? (async () => ({
          focusedChannelId: null,
          pinnedChannelIds: [],
          activeThemeName: null,
          appearanceMode: "system" as const,
          acpEnabled: false,
        })))();
        return {
          activeThemeColorScheme: null,
          themeJavaScriptConsentIds: [],
          ...display,
        };
      }),
      patch: vi.fn(options.patchDisplay ?? (async () => undefined)),
    },
    themes: {
      list: vi.fn(options.listThemes ?? (async () => ({ themes: [], errors: [] }))),
      refresh: vi.fn(options.refreshThemes ?? (async () => ({ themes: [], errors: [] }))),
    },
    artifacts: {
      get: vi.fn(options.getArtifact ?? (async ({ artifactID }: { artifactID: string }) => ({
        artifact: artifact(artifactID),
      }))),
      delete: vi.fn(options.deleteArtifact ?? (async ({ artifactID }: { artifactID: string }) => ({ artifactID }))),
    },
    markdown: {
      get: vi.fn(async ({ artifactID }: { artifactID: string }) => `content:${artifactID}`),
      update: vi.fn(async () => undefined),
    },
  } as unknown as TelevisionClient;
}

class FakeACPClient {
  enabled: boolean | null = null;
  contexts: Array<{ channelID: string; channelName: string } | null> = [];

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  setChannelContext(value: { channelID: string; channelName: string } | null): void {
    this.contexts.push(value);
  }
}

class FakeConnection extends EventTarget {
  readonly url = SERVER_URL;
  readonly name = "Application";
  readonly acpClient = new FakeACPClient();
  client: TelevisionClient;
  status: "unauthorized" | "disconnected" | "connected" = "disconnected";
  bootState: "pending" | "halted" | "booted" = "pending";
  hasEverConnected = false;
  hasAuthRejected = false;
  nextRetryAt: number | null = null;
  failedReconnectAttempts = 0;
  updateState: UpdateState | null = null;

  constructor(client: TelevisionClient) {
    super();
    this.client = client;
  }

  getViewURL(value: Artifact): string {
    return `${SERVER_URL}/view/${value.id}`;
  }

  getContentURL(value: Artifact): string | null {
    return value.kind === "path" ? `${SERVER_URL}/content/${value.id}` : null;
  }
}

class FakeOwner extends EventTarget {
  readonly connection: FakeConnection;
  connectError: string | null = null;

  constructor(client: TelevisionClient) {
    super();
    this.connection = new FakeConnection(client);
  }

  connect(): void {
    this.connection.status = "connected";
    this.connection.bootState = "booted";
    this.connection.hasEverConnected = true;
    this.dispatchEvent(new ChangeEvent("change"));
  }

  disconnect(): void {
    this.connection.status = "disconnected";
    this.dispatchEvent(new ChangeEvent("change"));
  }

  emitChange(): void {
    this.dispatchEvent(new ChangeEvent("change"));
  }

  emitServerEvent(event: ServerEvent): void {
    this.dispatchEvent(new ServerEventMessageEvent("server-event", {
      serverURL: this.connection.url,
      event,
    }));
  }
}

function createService(
  client: TelevisionClient,
  navigationKeyHandler?: (key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown") => void,
  retainedGateHalted?: () => boolean,
): {
  owner: FakeOwner;
  service: ApplicationService;
} {
  const owner = new FakeOwner(client);
  const service = new ApplicationService({
    connectionOwner: owner as unknown as ServerConnectionOwner,
    navigationKeyHandler,
    retainedGateHalted,
  });
  return { owner, service };
}

async function settle(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

function pendingPageWriteCount(service: ApplicationService): number {
  return (service as unknown as {
    pendingPageWrites: ReadonlyMap<string, unknown>;
  }).pendingPageWrites.size;
}

describe("ApplicationService snapshot", () => {
  it("exposes immutable complete channels, display state, pages, and artifact records", async () => {
    const first = channel("channel-a", "A", ["artifact-a"]);
    const second = channel("channel-b", "B", ["artifact-b"]);
    const client = createClient({
      listChannels: async () => ({ channels: [first, second] }),
      getDisplay: async () => ({
        focusedChannelId: second.id,
        pinnedChannelIds: [second.id, first.id],
        activeThemeName: "dark",
        activeThemeColorScheme: "dark",
        appearanceMode: "system",
        acpEnabled: true,
      }),
      getChannel: async ({ channelID }) => {
        const value = channelID === first.id ? first : second;
        const id = value.layout[0]!.artifactIds[0]!;
        return { channel: value, artifacts: [artifact(id)] };
      },
    });
    const { owner, service } = createService(client);

    owner.connect();
    await settle();

    const snapshot = service.snapshot;
    expect(snapshot.ready).toBe(true);
    expect(snapshot.channels.map(({ id }) => id)).toEqual([first.id, second.id]);
    expect(snapshot.channels[0]?.pages).toEqual(first.layout);
    expect(snapshot.channels[0]?.artifacts).toEqual([artifact("artifact-a")]);
    expect(snapshot.display).toEqual({
      focusedChannelId: second.id,
      pinnedChannelIds: [second.id, first.id],
      activeThemeName: "dark",
      activeThemeColorScheme: "dark",
      appearanceMode: "system",
      themeJavaScriptConsentIds: [],
      acpEnabled: true,
    });
    expect(snapshot.focusedChannel).toBe(snapshot.channels[1]);
    expect(owner.connection.acpClient.enabled).toBe(true);
    expect(owner.connection.acpClient.contexts.at(-1)).toEqual({
      channelID: second.id,
      channelName: "B",
    });

    expect(() => (snapshot.channels as unknown as Channel[]).push(channel("x", "X"))).toThrow();
    expect(() => (snapshot.display.pinnedChannelIds as string[]).push("x")).toThrow();
    expect(() => (snapshot.channels[0]!.pages[0]!.artifactIds as string[]).push("x")).toThrow();
    expect(snapshot.channels[0]!.pages[0]!.size).toEqual(DEFAULT_PAGE_SIZE);
    expect(Object.isFrozen(snapshot.channels[0]!.pages[0]!.size)).toBe(true);
    expect(() => {
      (snapshot.channels[0]!.pages[0]!.size as { width: number }).width = 1;
    }).toThrow();
    expect(service.snapshot.channels[0]?.pages).toEqual(first.layout);
  });

  it("projects connection facts without placing them in display or channel state", () => {
    const { owner, service } = createService(createClient());

    expect(service.snapshot.connection).toEqual({
      authorizationRequired: false,
      gateHalted: false,
      status: "disconnected",
      hasEverConnected: false,
      failedReconnectAttempts: 0,
      firstConnectError: null,
      nextRetryAt: null,
      upgradeInstructions: null,
    });

    owner.connectError = "offline";
    owner.emitChange();
    expect(service.snapshot.connection.firstConnectError).toBe("offline");

    owner.connection.status = "unauthorized";
    owner.connection.hasAuthRejected = true;
    owner.emitChange();
    expect(service.snapshot.connection).toMatchObject({
      authorizationRequired: true,
      status: "unauthorized",
    });

    owner.connection.bootState = "halted";
    owner.connection.nextRetryAt = 12_345;
    owner.connection.updateState = {
      toast: null,
      desktop: { upgradeMarkdown: "Use the channel upgrade." },
    };
    owner.emitChange();
    expect(service.snapshot.connection).toMatchObject({
      authorizationRequired: true,
      gateHalted: true,
      status: "unauthorized",
      hasEverConnected: false,
      firstConnectError: "offline",
      nextRetryAt: 12_345,
      upgradeInstructions: { upgradeMarkdown: "Use the channel upgrade." },
    });
    const instructions = service.snapshot.connection.upgradeInstructions!;
    expect(Object.isFrozen(instructions)).toBe(true);
    expect(() => {
      (instructions as { upgradeMarkdown: string }).upgradeMarkdown = "mutated";
    }).toThrow();

    owner.connection.hasEverConnected = true;
    owner.connection.failedReconnectAttempts = 3;
    owner.emitChange();
    expect(service.snapshot.connection.failedReconnectAttempts).toBe(3);
    expect(service.snapshot.connection.firstConnectError).toBeNull();
    expect(service.snapshot.display).not.toHaveProperty("status");
  });

  it("retains the gate projection while reconnect resets the attempt boot state", () => {
    let retainedGateHalted = false;
    const { owner, service } = createService(
      createClient(),
      undefined,
      () => retainedGateHalted,
    );

    owner.connection.bootState = "halted";
    owner.emitChange();
    expect(service.snapshot.connection.gateHalted).toBe(true);

    retainedGateHalted = true;
    owner.connection.bootState = "pending";
    owner.emitChange();
    expect(service.snapshot.connection.gateHalted).toBe(true);

    retainedGateHalted = false;
    owner.connection.bootState = "booted";
    owner.emitChange();
    expect(service.snapshot.connection.gateHalted).toBe(false);
  });

  it("applies every state-bearing live event and forwards transient artifact signals", async () => {
    const first = channel("channel-a", "A", ["artifact-a"]);
    const client = createClient({
      listChannels: async () => ({ channels: [first] }),
      getDisplay: async () => ({
        focusedChannelId: first.id,
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        acpEnabled: false,
      }),
      getChannel: async () => ({ channel: first, artifacts: [artifact("artifact-a", "Old")] }),
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();
    const changes = vi.fn();
    const contentChanges = vi.fn();
    const focusSignals = vi.fn();
    const themeChanges = vi.fn();
    service.addEventListener("change", changes);
    service.addEventListener("artifact-content-changed", contentChanges);
    service.addEventListener("artifact-focus", focusSignals);
    service.addEventListener("theme-changed", themeChanges);

    const second = channel("channel-b", "B");
    owner.emitServerEvent({ type: "channel-created", channel: second });
    owner.emitServerEvent({
      type: "artifact-created",
      channelID: second.id,
      artifact: artifact("artifact-b", "Before"),
    });
    owner.emitServerEvent({
      type: "artifact-updated",
      artifact: artifact("artifact-b", "After"),
    });
    owner.emitServerEvent({
      type: "channel-updated",
      channel: { ...second, name: "Renamed", layout: [page(["artifact-b"], true)] },
    });
    owner.emitServerEvent({ type: "pinned-channels-changed", pinnedChannelIds: [second.id] });
    owner.emitServerEvent({ type: "channel-changed", channelID: second.id });
    owner.emitServerEvent({
      type: "theme-changed",
      themeName: "light",
      activeThemeColorScheme: "light",
      themeJavaScriptConsentIds: [],
    });
    owner.emitServerEvent({ type: "artifact-content-changed", artifactID: "artifact-b" });
    owner.emitServerEvent({ type: "artifact-focus", channelID: second.id, artifactID: "artifact-b" });

    expect(service.snapshot.channels.map(({ id }) => id)).toEqual([first.id, second.id]);
    expect(service.snapshot.focusedChannel?.name).toBe("Renamed");
    expect(service.snapshot.focusedChannel?.pages).toEqual([page(["artifact-b"], true)]);
    expect(service.snapshot.focusedChannel?.artifacts[0]?.title).toBe("After");
    expect(service.snapshot.display.pinnedChannelIds).toEqual([second.id]);
    expect(service.snapshot.display.activeThemeName).toBe("light");
    expect(contentChanges).toHaveBeenCalledOnce();
    expect((contentChanges.mock.calls[0]?.[0] as ArtifactContentChangedEvent).artifactID).toBe("artifact-b");
    expect(focusSignals).toHaveBeenCalledOnce();
    expect((focusSignals.mock.calls[0]?.[0] as ArtifactFocusEvent).channelID).toBe(second.id);
    expect(themeChanges).toHaveBeenCalledOnce();
    expect((themeChanges.mock.calls[0]?.[0] as ThemeChangedEvent).themeName).toBe("light");

    owner.emitServerEvent({ type: "artifact-removed", channelID: second.id, artifactID: "artifact-b" });
    expect(service.snapshot.focusedChannel?.pages).toEqual([]);
    expect(service.snapshot.focusedChannel?.artifacts).toEqual([]);

    owner.emitServerEvent({ type: "channel-removed", channelID: second.id });
    expect(service.snapshot.channels.map(({ id }) => id)).toEqual([first.id]);
    expect(service.snapshot.focusedChannel).toBeNull();
    expect(changes.mock.calls.length).toBeGreaterThan(0);
  });

  it("emits reconnect content refresh only for retained path artifacts after publishing current state", async () => {
    const retained = artifact("retained");
    const removed = artifact("removed");
    const added = artifact("added");
    const external: Artifact = {
      id: "external",
      kind: "url",
      title: "External",
      url: "https://example.test/artifact",
    };
    const initial = channel("channel-a", "Initial", [
      retained.id,
      removed.id,
      external.id,
    ]);
    const current = channel("channel-a", "Current", [
      retained.id,
      added.id,
      external.id,
    ]);
    let detail = {
      channel: initial,
      artifacts: [retained, removed, external],
    };
    const client = createClient({
      listChannels: async () => ({ channels: [detail.channel] }),
      getDisplay: async () => ({
        focusedChannelId: initial.id,
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        acpEnabled: false,
      }),
      getChannel: async () => structuredClone(detail),
    });
    const { owner, service } = createService(client);
    const observed: Array<{ artifactID: string; snapshotArtifactIDs: string[] }> = [];
    service.addEventListener("artifact-content-changed", (event) => {
      observed.push({
        artifactID: event.artifactID,
        snapshotArtifactIDs: service.snapshot.focusedChannel?.artifacts
          .map(({ id }) => id) ?? [],
      });
    });

    owner.connect();
    await settle();
    expect(observed).toEqual([]);

    owner.disconnect();
    detail = {
      channel: current,
      artifacts: [retained, added, external],
    };
    owner.connect();
    await settle();

    expect(observed).toEqual([{
      artifactID: retained.id,
      snapshotArtifactIDs: [retained.id, added.id, external.id],
    }]);
  });

  it("does not expose stale artifact records after removing their channel", async () => {
    const first = channel("channel-a", "A", ["artifact-a"]);
    const client = createClient({
      listChannels: async () => ({ channels: [first] }),
      getDisplay: async () => ({ focusedChannelId: first.id, pinnedChannelIds: [], activeThemeName: null, appearanceMode: "system", acpEnabled: false }),
      getChannel: async () => ({ channel: first, artifacts: [artifact("artifact-a")] }),
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();

    owner.emitServerEvent({ type: "channel-removed", channelID: first.id });

    expect(service.snapshot.channels).toEqual([]);
    expect(service.snapshot.focusedChannel).toBeNull();
    expect(service.snapshot.channels.flatMap(({ artifacts }) => artifacts)).toEqual([]);
  });
});

describe("ApplicationService local page selection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("remembers selected pages per channel without writing selection to the server or browser storage", async () => {
    const storage = {
      clear: vi.fn(),
      getItem: vi.fn((_key: string) => null),
      key: vi.fn((_index: number) => null),
      removeItem: vi.fn((_key: string) => undefined),
      setItem: vi.fn((_key: string, _value: string) => undefined),
      length: 0,
    } satisfies Storage;
    vi.stubGlobal("localStorage", storage);

    const first = channel("channel-a", "A", ["artifact-a1", "artifact-a2"]);
    const second = channel("channel-b", "B", ["artifact-b1", "artifact-b2"]);
    const channels = new Map([[first.id, first], [second.id, second]]);
    const client = createClient({
      listChannels: async () => ({ channels: [first, second] }),
      getDisplay: async () => ({
        focusedChannelId: first.id,
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        acpEnabled: false,
      }),
      getChannel: async ({ channelID }) => {
        const value = channels.get(channelID)!;
        return {
          channel: value,
          artifacts: value.layout.flatMap(({ artifactIds }) => artifactIds.map((id) => artifact(id))),
        };
      },
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();

    const initialFirst = service.snapshot.channels[0]!;
    expect(initialFirst.selectedPage).toBe(initialFirst.pages[0]);
    expect(Object.isFrozen(initialFirst.selectedPage)).toBe(true);

    owner.emitServerEvent({
      type: "channel-updated",
      channel: { ...first, layout: [page(["artifact-a2"]), page(["artifact-a1"])] },
    });
    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-a1"]);

    owner.emitServerEvent({
      type: "channel-updated",
      channel: { ...second, layout: [page(["artifact-b2"]), page(["artifact-b1"])] },
    });
    service.selectPage(first.id, "artifact-a2");
    owner.emitServerEvent({ type: "channel-changed", channelID: second.id });
    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-b2"]);

    service.selectPage(second.id, "artifact-b1");
    owner.emitServerEvent({ type: "channel-changed", channelID: first.id });
    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-a2"]);

    owner.emitServerEvent({ type: "channel-changed", channelID: second.id });
    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-b1"]);
    expect(client.display.patch).not.toHaveBeenCalled();
    expect(client.channels.update).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();

    const beforeInvalidSelection = service.snapshot;
    service.selectPage(second.id, "missing-artifact");
    service.selectPage("missing-channel", "artifact-b1");
    expect(service.snapshot).toBe(beforeInvalidSelection);
  });

  it("keeps a selected page while it has an artifact and falls back at its removed position", async () => {
    const value: Channel = {
      ...channel("channel-a", "A"),
      layout: [
        page(["artifact-a1", "artifact-a2"]),
        page(["artifact-b"]),
        page(["artifact-c"]),
      ],
    };
    const client = createClient({
      listChannels: async () => ({ channels: [value] }),
      getDisplay: async () => ({
        focusedChannelId: value.id,
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        acpEnabled: false,
      }),
      getChannel: async () => ({
        channel: value,
        artifacts: value.layout.flatMap(({ artifactIds }) => artifactIds.map((id) => artifact(id))),
      }),
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();

    service.selectPage(value.id, "artifact-a1");
    owner.emitServerEvent({
      type: "artifact-removed",
      channelID: value.id,
      artifactID: "artifact-a1",
    });
    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-a2"]);

    service.selectPage(value.id, "artifact-b");
    owner.emitServerEvent({
      type: "artifact-removed",
      channelID: value.id,
      artifactID: "artifact-b",
    });
    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-c"]);

    owner.emitServerEvent({
      type: "artifact-removed",
      channelID: value.id,
      artifactID: "artifact-c",
    });
    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-a2"]);

    owner.emitServerEvent({
      type: "artifact-removed",
      channelID: value.id,
      artifactID: "artifact-a2",
    });
    expect(service.snapshot.focusedChannel?.selectedPage).toBeNull();
  });

  it("follows page membership across reorder and refresh but a new service starts on the first page", async () => {
    let current = channel("channel-a", "A", ["artifact-a", "artifact-b", "artifact-c"]);
    const client = createClient({
      listChannels: async () => ({ channels: [current] }),
      getDisplay: async () => ({
        focusedChannelId: current.id,
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        acpEnabled: false,
      }),
      getChannel: async () => ({
        channel: current,
        artifacts: current.layout.flatMap(({ artifactIds }) => artifactIds.map((id) => artifact(id))),
      }),
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();
    service.selectPage(current.id, "artifact-b");

    current = { ...current, layout: [page(["artifact-c"]), page(["artifact-a"]), page(["artifact-b"])] };
    owner.emitServerEvent({ type: "channel-updated", channel: current });
    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-b"]);
    expect(service.snapshot.focusedChannel?.pages.indexOf(
      service.snapshot.focusedChannel.selectedPage!,
    )).toBe(2);

    owner.disconnect();
    current = { ...current, layout: [page(["artifact-a"]), page(["artifact-b"]), page(["artifact-c"])] };
    owner.connect();
    await settle();
    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-b"]);

    service.dispose();
    const reloaded = createService(client);
    reloaded.owner.connect();
    await settle();
    expect(reloaded.service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-a"]);
  });

  it("uses transient artifact focus received during bootstrap to select the containing page", async () => {
    const first = channel("channel-a", "A", ["artifact-a"]);
    const second = channel("channel-b", "B", ["artifact-b1", "artifact-b2"]);
    const list = deferred<{ channels: Channel[] }>();
    const client = createClient({
      listChannels: () => list.promise,
      getDisplay: async () => ({
        focusedChannelId: first.id,
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        acpEnabled: false,
      }),
      getChannel: async ({ channelID }) => {
        const value = channelID === first.id ? first : second;
        return {
          channel: value,
          artifacts: value.layout.flatMap(({ artifactIds }) => artifactIds.map((id) => artifact(id))),
        };
      },
    });
    const { owner, service } = createService(client);
    owner.connect();
    owner.emitServerEvent({ type: "channel-changed", channelID: second.id });
    owner.emitServerEvent({
      type: "artifact-focus",
      channelID: second.id,
      artifactID: "artifact-b2",
    });
    list.resolve({ channels: [first, second] });
    await settle();

    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-b2"]);
    expect(client.display.patch).not.toHaveBeenCalled();
  });
});

describe("ApplicationService no-lost-event merge", () => {
  it("replays an event over a bootstrap response that predates it", async () => {
    const stale = channel("channel-a", "Before");
    const list = deferred<{ channels: Channel[] }>();
    const client = createClient({
      listChannels: () => list.promise,
      getDisplay: async () => ({ focusedChannelId: stale.id, pinnedChannelIds: [], activeThemeName: null, appearanceMode: "system", acpEnabled: false }),
      getChannel: async () => ({ channel: stale, artifacts: [] }),
    });
    const { owner, service } = createService(client);

    owner.connect();
    expect(client.channels.list).toHaveBeenCalledOnce();
    owner.emitServerEvent({ type: "channel-updated", channel: { ...stale, name: "After" } });
    list.resolve({ channels: [stale] });
    await settle();

    expect(service.snapshot.ready).toBe(true);
    expect(service.snapshot.channels[0]?.name).toBe("After");
  });

  it("keeps an event applied during a refresh when the response already includes it", async () => {
    const initial = channel("channel-a", "Initial");
    const current = channel("channel-a", "Current");
    let listResult: Promise<{ channels: Channel[] }> = Promise.resolve({ channels: [initial] });
    let detail = initial;
    const client = createClient({
      listChannels: () => listResult,
      getDisplay: async () => ({ focusedChannelId: initial.id, pinnedChannelIds: [], activeThemeName: null, appearanceMode: "system", acpEnabled: false }),
      getChannel: async () => ({ channel: detail, artifacts: [] }),
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();
    expect(service.snapshot.channels[0]?.name).toBe("Initial");

    owner.disconnect();
    const refresh = deferred<{ channels: Channel[] }>();
    listResult = refresh.promise;
    detail = current;
    owner.connect();
    owner.emitServerEvent({ type: "channel-updated", channel: current });
    expect(service.snapshot.channels[0]?.name).toBe("Current");
    refresh.resolve({ channels: [current] });
    await settle();

    expect(service.snapshot.channels[0]?.name).toBe("Current");
  });
});

describe("ApplicationService page writes", () => {
  it("updates target pages optimistically and sends the page replacement", async () => {
    const value = channel("channel-a", "A", ["artifact-a", "artifact-b"]);
    const client = createClient({
      listChannels: async () => ({ channels: [value] }),
      getDisplay: async () => ({ focusedChannelId: value.id, pinnedChannelIds: [], activeThemeName: null, appearanceMode: "system", acpEnabled: false }),
      getChannel: async () => ({ channel: value, artifacts: [artifact("artifact-a"), artifact("artifact-b")] }),
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();
    const next = [
      page(["artifact-b"]),
      page(["artifact-a"], true, { width: 612.5, height: 701.25 }),
    ];

    service.selectPage(value.id, "artifact-a");
    service.updateChannelPages(value.id, next);

    expect(service.snapshot.focusedChannel?.pages).toEqual(next);
    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-a"]);
    expect(client.channels.update).toHaveBeenCalledWith({ channelID: value.id, layout: next });
  });

  it("rolls target pages back when the server rejects the write", async () => {
    const value = channel("channel-a", "A", ["artifact-a", "artifact-b"]);
    const client = createClient({
      listChannels: async () => ({ channels: [value] }),
      getDisplay: async () => ({ focusedChannelId: value.id, pinnedChannelIds: [], activeThemeName: null, appearanceMode: "system", acpEnabled: false }),
      getChannel: async () => ({ channel: value, artifacts: [artifact("artifact-a"), artifact("artifact-b")] }),
      updateChannel: async () => {
        throw new RequestError("page replacement rejected", {
          serverURL: SERVER_URL,
          status: 400,
        });
      },
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();

    service.selectPage(value.id, "artifact-b");
    const write = service.updateChannelPages(value.id, [page(["artifact-b"]), page(["artifact-a"], true)]);
    await expect(write).rejects.toMatchObject({
      name: "RequestError",
      status: 400,
    });

    expect(service.snapshot.focusedChannel?.pages).toEqual(value.layout);
    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-b"]);
    expect(client.channels.get).toHaveBeenCalledOnce();
  });

  it("refetches one channel after an ambiguous page write and replays an event over the response", async () => {
    const value = channel("channel-a", "A", ["artifact-a", "artifact-b"]);
    const update = deferred<{ channel: Channel }>();
    const recovery = deferred<{ channel: Channel; artifacts: Artifact[] }>();
    let channelReads = 0;
    const client = createClient({
      listChannels: async () => ({ channels: [value] }),
      getDisplay: async () => ({ focusedChannelId: value.id, pinnedChannelIds: [], activeThemeName: null, appearanceMode: "system", acpEnabled: false }),
      getChannel: async () => {
        channelReads += 1;
        if (channelReads > 1) return recovery.promise;
        return { channel: value, artifacts: [artifact("artifact-a"), artifact("artifact-b")] };
      },
      updateChannel: () => update.promise,
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();
    const optimistic = [page(["artifact-b"]), page(["artifact-a"], true)];
    const write = service.updateChannelPages(value.id, optimistic);

    update.reject(new RequestError("response lost before confirmation", {
      serverURL: SERVER_URL,
    }));
    await settle();
    expect(client.channels.get).toHaveBeenCalledTimes(2);
    owner.emitServerEvent({
      type: "artifact-created",
      channelID: value.id,
      artifact: artifact("artifact-c"),
    });
    recovery.resolve({
      channel: value,
      artifacts: [artifact("artifact-a"), artifact("artifact-b")],
    });
    const failure = await write.catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "RequestError", serverURL: SERVER_URL });
    expect(failure).not.toHaveProperty("status");

    expect(pendingPageWriteCount(service)).toBe(0);
    expect(service.snapshot.focusedChannel?.pages).toEqual([
      ...value.layout,
      page(["artifact-c"]),
    ]);
    expect(service.snapshot.focusedChannel?.artifacts.map(({ id }) => id)).toEqual([
      "artifact-a",
      "artifact-b",
      "artifact-c",
    ]);
    expect(client.channels.list).toHaveBeenCalledOnce();
    expect(client.display.get).toHaveBeenCalledOnce();
    expect(client.artifacts.get).not.toHaveBeenCalled();
  });

  it("refetches only one channel after a 5xx page-write outcome", async () => {
    const value = channel("channel-a", "A", ["artifact-a", "artifact-b"]);
    const recovered: Channel = {
      ...value,
      layout: [page(["artifact-a"], true), page(["artifact-b"])],
    };
    const writeError = new RequestError("page replacement failed", {
      serverURL: SERVER_URL,
      status: 500,
    });
    let channelReads = 0;
    const client = createClient({
      listChannels: async () => ({ channels: [value] }),
      getDisplay: async () => ({ focusedChannelId: value.id, pinnedChannelIds: [], activeThemeName: null, appearanceMode: "system", acpEnabled: false }),
      getChannel: async () => {
        channelReads += 1;
        return {
          channel: channelReads === 1 ? value : recovered,
          artifacts: [artifact("artifact-a"), artifact("artifact-b")],
        };
      },
      updateChannel: async () => {
        throw writeError;
      },
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();
    const optimistic = [page(["artifact-b"]), page(["artifact-a"], true)];

    const failure = await service.updateChannelPages(value.id, optimistic)
      .catch((error: unknown) => error);

    expect(failure).toBe(writeError);
    expect(client.channels.get).toHaveBeenCalledTimes(2);
    expect(service.snapshot.focusedChannel?.pages).toEqual(recovered.layout);
    expect(pendingPageWriteCount(service)).toBe(0);
    expect(client.channels.list).toHaveBeenCalledOnce();
    expect(client.display.get).toHaveBeenCalledOnce();
    expect(client.artifacts.get).not.toHaveBeenCalled();
  });

  it("preserves the original ambiguous page-write error when its recovery read fails", async () => {
    const value = channel("channel-a", "A", ["artifact-a", "artifact-b"]);
    const writeError = new RequestError("page response lost", {
      serverURL: SERVER_URL,
    });
    const recoveryError = new RequestError("channel recovery also lost", {
      serverURL: SERVER_URL,
    });
    let channelReads = 0;
    const client = createClient({
      listChannels: async () => ({ channels: [value] }),
      getDisplay: async () => ({ focusedChannelId: value.id, pinnedChannelIds: [], activeThemeName: null, appearanceMode: "system", acpEnabled: false }),
      getChannel: async () => {
        channelReads += 1;
        if (channelReads > 1) throw recoveryError;
        return {
          channel: value,
          artifacts: [artifact("artifact-a"), artifact("artifact-b")],
        };
      },
      updateChannel: async () => {
        throw writeError;
      },
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();
    const optimistic = [page(["artifact-b"]), page(["artifact-a"], true)];

    const failure = await service.updateChannelPages(value.id, optimistic)
      .catch((error: unknown) => error);

    expect(failure).toBe(writeError);
    expect(pendingPageWriteCount(service)).toBe(0);
    expect(service.snapshot.focusedChannel?.pages).toEqual(optimistic);
    expect(client.channels.get).toHaveBeenCalledTimes(2);
  });

  it("keeps authoritative channel-event pages when a pending response rejects", async () => {
    const value = channel("channel-a", "A", ["artifact-a", "artifact-b"]);
    const update = deferred<{ channel: Channel }>();
    const client = createClient({
      listChannels: async () => ({ channels: [value] }),
      getDisplay: async () => ({ focusedChannelId: value.id, pinnedChannelIds: [], activeThemeName: null, appearanceMode: "system", acpEnabled: false }),
      getChannel: async () => ({ channel: value, artifacts: [artifact("artifact-a"), artifact("artifact-b")] }),
      updateChannel: () => update.promise,
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();
    const write = service.updateChannelPages(value.id, [page(["artifact-b"]), page(["artifact-a"], true)]);
    const authoritative = [page(["artifact-a"], true), page(["artifact-b"])];

    owner.emitServerEvent({ type: "channel-updated", channel: { ...value, layout: authoritative } });
    vi.mocked(client.channels.get).mockResolvedValue({
      channel: { ...value, layout: authoritative },
      artifacts: [artifact("artifact-a"), artifact("artifact-b")],
    });
    update.reject(new RequestError("response lost after authoritative event", {
      serverURL: SERVER_URL,
    }));
    await expect(write).rejects.toThrow("response lost after authoritative event");

    expect(client.channels.get).toHaveBeenCalledTimes(2);
    expect(service.snapshot.focusedChannel?.pages).toEqual(authoritative);
  });

  it("preserves live artifact state and clears each pending result across rejected page writes", async () => {
    const value: Channel = {
      ...channel("channel-a", "A"),
      layout: [page(["artifact-a"]), page(["artifact-b"]), page(["artifact-d"])],
    };
    const firstWrite = deferred<{ channel: Channel }>();
    const secondWrite = deferred<{ channel: Channel }>();
    const writes = [firstWrite, secondWrite];
    const client = createClient({
      listChannels: async () => ({ channels: [value] }),
      getDisplay: async () => ({
        focusedChannelId: value.id,
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        acpEnabled: false,
      }),
      getChannel: async () => ({
        channel: value,
        artifacts: [artifact("artifact-a"), artifact("artifact-b"), artifact("artifact-d", "Before")],
      }),
      updateChannel: () => writes.shift()!.promise,
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();
    service.selectPage(value.id, "artifact-d");

    const first = service.updateChannelPages(value.id, [
      page(["artifact-d"]),
      page(["artifact-b"]),
      page(["artifact-a"]),
    ]);
    expect(pendingPageWriteCount(service)).toBe(1);
    owner.emitServerEvent({
      type: "artifact-created",
      channelID: value.id,
      artifact: artifact("artifact-c"),
    });
    owner.emitServerEvent({
      type: "artifact-updated",
      artifact: artifact("artifact-d", "After"),
    });
    owner.emitServerEvent({
      type: "artifact-removed",
      channelID: value.id,
      artifactID: "artifact-b",
    });
    owner.emitServerEvent({
      type: "pinned-channels-changed",
      pinnedChannelIds: [value.id],
    });
    firstWrite.reject(new RequestError("first page replacement rejected", {
      serverURL: SERVER_URL,
      status: 400,
    }));
    await expect(first).rejects.toMatchObject({ status: 400 });

    expect(pendingPageWriteCount(service)).toBe(0);
    expect(service.snapshot.focusedChannel?.pages).toEqual([
      page(["artifact-a"]),
      page(["artifact-d"]),
      page(["artifact-c"]),
    ]);
    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-d"]);
    expect(service.snapshot.focusedChannel?.artifacts).toEqual([
      artifact("artifact-a"),
      artifact("artifact-d", "After"),
      artifact("artifact-c"),
    ]);
    expect(service.snapshot.display.pinnedChannelIds).toEqual([value.id]);

    const second = service.updateChannelPages(value.id, [
      page(["artifact-c"]),
      page(["artifact-d"]),
      page(["artifact-a"]),
    ]);
    expect(pendingPageWriteCount(service)).toBe(1);
    expect(service.snapshot.focusedChannel?.pages[0]?.artifactIds).toEqual(["artifact-c"]);
    owner.emitServerEvent({
      type: "artifact-created",
      channelID: value.id,
      artifact: artifact("artifact-e"),
    });
    secondWrite.reject(new RequestError("second page replacement rejected", {
      serverURL: SERVER_URL,
      status: 409,
    }));
    await expect(second).rejects.toMatchObject({ status: 409 });

    expect(pendingPageWriteCount(service)).toBe(0);
    expect(service.snapshot.focusedChannel?.pages).toEqual([
      page(["artifact-a"]),
      page(["artifact-d"]),
      page(["artifact-c"]),
      page(["artifact-e"]),
    ]);
    expect(service.snapshot.focusedChannel?.artifacts.map(({ id }) => id)).toEqual([
      "artifact-a",
      "artifact-d",
      "artifact-c",
      "artifact-e",
    ]);
  });

  it("silently refuses malformed pages without changing state or issuing a request", async () => {
    const value = channel("channel-a", "A", ["artifact-a"]);
    const client = createClient({
      listChannels: async () => ({ channels: [value] }),
      getDisplay: async () => ({ focusedChannelId: value.id, pinnedChannelIds: [], activeThemeName: null, appearanceMode: "system", acpEnabled: false }),
      getChannel: async () => ({ channel: value, artifacts: [artifact("artifact-a")] }),
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();
    vi.mocked(client.channels.update).mockClear();
    const changed = vi.fn();
    service.addEventListener("change", changed);

    service.updateChannelPages(value.id, [page([])]);

    expect(service.snapshot.focusedChannel?.pages).toEqual(value.layout);
    expect(client.channels.update).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });
});

describe("ApplicationService appearance state", () => {
  // proofs/arch/themes/index.md#^themes-t-active-color-scheme-application
  it("tracks the confirmed active theme and scheme together without registry state", async () => {
    const client = createClient({
      getDisplay: async () => ({
        focusedChannelId: null,
        pinnedChannelIds: [],
        activeThemeName: "fixed-dark",
        activeThemeColorScheme: "dark",
        appearanceMode: "light",
        themeJavaScriptConsentIds: [],
        acpEnabled: false,
      }),
    });
    const { owner, service } = createService(client);
    const themeEvents: ThemeChangedEvent[] = [];
    service.addEventListener("theme-changed", (event) => themeEvents.push(event));
    owner.connect();
    await settle();

    expect(service.snapshot.display).toMatchObject({
      activeThemeName: "fixed-dark",
      activeThemeColorScheme: "dark",
      appearanceMode: "light",
    });
    expect(service.snapshot).not.toHaveProperty("themes");
    expect(client.themes.list).not.toHaveBeenCalled();
    expect(client.themes.refresh).not.toHaveBeenCalled();

    owner.emitServerEvent({ type: "appearance-changed", appearanceMode: "dark" });
    expect(service.snapshot.display).toMatchObject({
      activeThemeName: "fixed-dark",
      activeThemeColorScheme: "dark",
      appearanceMode: "dark",
    });

    owner.emitServerEvent({
      type: "theme-changed",
      themeName: "adaptive",
      activeThemeColorScheme: "light dark",
      themeJavaScriptConsentIds: ["adaptive"],
    });
    expect(service.snapshot.display).toMatchObject({
      activeThemeName: "adaptive",
      activeThemeColorScheme: "light dark",
      appearanceMode: "dark",
      themeJavaScriptConsentIds: ["adaptive"],
    });
    expect(themeEvents).toHaveLength(1);
    expect(themeEvents[0]).toMatchObject({
      themeName: "adaptive",
      activeThemeColorScheme: "light dark",
    });
  });

  // proofs/arch/themes/index.md#^themes-t-appearance-application
  it("applies appearance events and recovers confirmed display after an uncertain write", async () => {
    let display: DisplayState = {
      focusedChannelId: null,
      pinnedChannelIds: [],
      activeThemeName: null,
      activeThemeColorScheme: null,
      appearanceMode: "system",
      themeJavaScriptConsentIds: [],
      acpEnabled: false,
    };
    let writeCount = 0;
    const writeError = new RequestError("appearance response lost", {
      serverURL: SERVER_URL,
      status: 500,
    });
    const client = createClient({
      getDisplay: async () => structuredClone(display),
      patchDisplay: async (input) => {
        writeCount += 1;
        if (writeCount === 1) return;
        display = { ...display, appearanceMode: input.appearanceMode! };
        throw writeError;
      },
    });
    const { owner, service } = createService(client);
    const appearanceEvents = vi.fn();
    service.addEventListener("appearance-changed", appearanceEvents);
    owner.connect();
    await settle();

    owner.emitServerEvent({ type: "appearance-changed", appearanceMode: "dark" });
    expect(service.snapshot.display.appearanceMode).toBe("dark");
    expect(appearanceEvents).toHaveBeenCalledOnce();
    const appearanceEvent = appearanceEvents.mock.calls[0]?.[0] as AppearanceChangedEvent;
    expect(appearanceEvent).toBeInstanceOf(Event);
    expect(appearanceEvent).toMatchObject({
      type: "appearance-changed",
      appearanceMode: "dark",
    });

    await service.setAppearanceMode("light");
    expect(client.display.patch).toHaveBeenNthCalledWith(1, { appearanceMode: "light" });
    expect(service.snapshot.display.appearanceMode).toBe("dark");
    expect(client.display.get).toHaveBeenCalledOnce();

    const failure = await service.setAppearanceMode("system")
      .catch((error: unknown) => error);
    expect(failure).toBe(writeError);
    expect(client.display.patch).toHaveBeenNthCalledWith(2, { appearanceMode: "system" });
    expect(client.display.get).toHaveBeenCalledTimes(2);
    expect(service.snapshot.display.appearanceMode).toBe("system");
  });
});

describe("ApplicationService theme settings", () => {
  // proofs/arch/themes/index.md#^themes-t-settings-application
  it("serves theme settings and recovers confirmed selection after an uncertain write", async () => {
    const listed: ThemeRegistrySnapshot = {
      themes: [{
        id: "clouds",
        name: "Clouds",
        version: "1.0.0",
        colorScheme: "light dark",
      }],
      errors: [],
    };
    const refreshed: ThemeRegistrySnapshot = {
      themes: [
        ...listed.themes,
        { id: "slate", name: "Slate", version: "2.0.0", colorScheme: "dark" },
      ],
      errors: [{ folder: "broken", error: "manifest.json is missing" }],
    };
    let display: DisplayState = {
      focusedChannelId: null,
      pinnedChannelIds: [],
      activeThemeName: null,
      activeThemeColorScheme: null,
      appearanceMode: "system",
      themeJavaScriptConsentIds: [],
      acpEnabled: false,
    };
    let writeCount = 0;
    const writeError = new RequestError("theme response lost", {
      serverURL: SERVER_URL,
      status: 500,
    });
    const client = createClient({
      getDisplay: async () => structuredClone(display),
      listThemes: async () => listed,
      refreshThemes: async () => refreshed,
      patchDisplay: async (input) => {
        writeCount += 1;
        if (writeCount === 1) return;
        display = { ...display, activeThemeName: input.activeThemeName! };
        throw writeError;
      },
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();

    await expect(service.listThemes()).resolves.toEqual(listed);
    await expect(service.refreshThemes()).resolves.toEqual(refreshed);
    expect(client.themes.list).toHaveBeenCalledOnce();
    expect(client.themes.refresh).toHaveBeenCalledOnce();

    await service.setActiveTheme("clouds");
    expect(client.display.patch).toHaveBeenNthCalledWith(1, { activeThemeName: "clouds" });
    expect(service.snapshot.display.activeThemeName).toBeNull();

    owner.emitServerEvent({
      type: "theme-changed",
      themeName: "clouds",
      activeThemeColorScheme: "light dark",
      themeJavaScriptConsentIds: [],
    });
    expect(service.snapshot.display.activeThemeName).toBe("clouds");

    const failure = await service.setActiveTheme(null).catch((error: unknown) => error);
    expect(failure).toBe(writeError);
    expect(client.display.patch).toHaveBeenNthCalledWith(2, { activeThemeName: null });
    expect(client.display.get).toHaveBeenCalledTimes(2);
    expect(service.snapshot.display.activeThemeName).toBeNull();
  });

  // proofs/arch/themes/index.md#^themes-t-javascript-consent-application
  it("tracks confirmed consent and patches complete exact-ID sets without speculative state", async () => {
    const write = deferred<void>();
    const client = createClient({
      getDisplay: async () => ({
        focusedChannelId: null,
        pinnedChannelIds: [],
        activeThemeName: "Theme.ID",
        appearanceMode: "system",
        themeJavaScriptConsentIds: ["other-theme"],
        acpEnabled: false,
      }),
      patchDisplay: () => write.promise,
    });
    const { owner, service } = createService(client);
    const consentService = service as typeof service & {
      setThemeJavaScriptConsent(themeId: string, enabled: boolean): Promise<void>;
    };
    owner.connect();
    await settle();

    expect(service.snapshot.display.themeJavaScriptConsentIds)
      .toEqual(["other-theme"]);
    expect(Object.isFrozen(service.snapshot.display.themeJavaScriptConsentIds))
      .toBe(true);

    const add = consentService.setThemeJavaScriptConsent("Theme.ID", true);
    expect(client.display.patch).toHaveBeenCalledWith({
      themeJavaScriptConsentIds: ["other-theme", "Theme.ID"],
    });
    expect(service.snapshot.display.themeJavaScriptConsentIds)
      .toEqual(["other-theme"]);
    write.resolve();
    await add;
    expect(service.snapshot.display.themeJavaScriptConsentIds)
      .toEqual(["other-theme"]);

    owner.emitServerEvent({
      type: "theme-changed",
      themeName: "Theme.ID",
      activeThemeColorScheme: "light dark",
      themeJavaScriptConsentIds: ["other-theme", "Theme.ID"],
    });
    expect(service.snapshot.display.themeJavaScriptConsentIds)
      .toEqual(["other-theme", "Theme.ID"]);

    await consentService.setThemeJavaScriptConsent("other-theme", false);
    expect(client.display.patch).toHaveBeenLastCalledWith({
      themeJavaScriptConsentIds: ["Theme.ID"],
    });
  });

  // proofs/arch/themes/index.md#^themes-t-javascript-consent-application
  it("recovers confirmed consent after an uncertain failed write", async () => {
    const writeError = new RequestError("consent response lost", {
      serverURL: SERVER_URL,
      status: 500,
    });
    let display: DisplayState = {
      focusedChannelId: null,
      pinnedChannelIds: [],
      activeThemeName: "Theme.ID",
      activeThemeColorScheme: "light dark",
      appearanceMode: "system",
      themeJavaScriptConsentIds: ["Theme.ID", "other-theme"],
      acpEnabled: false,
    };
    const client = createClient({
      getDisplay: async () => structuredClone(display),
      patchDisplay: async () => {
        display = { ...display, themeJavaScriptConsentIds: ["other-theme"] };
        throw writeError;
      },
    });
    const { owner, service } = createService(client);
    const consentService = service as typeof service & {
      setThemeJavaScriptConsent(themeId: string, enabled: boolean): Promise<void>;
    };
    owner.connect();
    await settle();

    const failure = await consentService
      .setThemeJavaScriptConsent("Theme.ID", false)
      .catch((error: unknown) => error);

    expect(failure).toBe(writeError);
    expect(client.display.patch).toHaveBeenCalledWith({
      themeJavaScriptConsentIds: ["other-theme"],
    });
    expect(client.display.get).toHaveBeenCalledTimes(2);
    expect(service.snapshot.display.themeJavaScriptConsentIds)
      .toEqual(["other-theme"]);
  });
});

describe("ApplicationService ambiguous write recovery", () => {
  it("refetches the affected collection, channel, and display after ambiguous channel operations", async () => {
    const first = channel("channel-a", "A");
    const second = channel("channel-b", "B");
    const renamed = { ...second, name: "Renamed" };
    const serverChannels = new Map([[first.id, first]]);
    let display: DisplayState = {
      focusedChannelId: first.id,
      pinnedChannelIds: [first.id],
      activeThemeName: null,
      activeThemeColorScheme: null,
      appearanceMode: "system",
      themeJavaScriptConsentIds: [],
      acpEnabled: false,
    };
    const creation = deferred<{ channel: Channel }>();
    const rename = deferred<{ channel: Channel }>();
    const removal = deferred<unknown>();
    const client = createClient({
      listChannels: async () => ({ channels: [...serverChannels.values()] }),
      getDisplay: async () => structuredClone(display),
      getChannel: async ({ channelID }) => {
        const value = serverChannels.get(channelID);
        if (!value) {
          throw new RequestError(`Channel not found: ${channelID}`, {
            serverURL: SERVER_URL,
            status: 404,
          });
        }
        return { channel: value, artifacts: [] };
      },
      createChannel: () => creation.promise,
      updateChannel: () => rename.promise,
      removeChannel: () => removal.promise,
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();

    const createWrite = service.createChannel(second.name);
    serverChannels.set(second.id, second);
    creation.reject(new RequestError("channel creation response lost", {
      serverURL: SERVER_URL,
    }));
    const createFailure = await createWrite.catch((error: unknown) => error);
    expect(createFailure).not.toHaveProperty("status");
    expect(service.snapshot.channels.map(({ id }) => id)).toEqual([first.id, second.id]);
    expect(client.channels.list).toHaveBeenCalledTimes(2);
    expect(client.display.get).toHaveBeenCalledTimes(2);
    expect(client.channels.get).toHaveBeenCalledOnce();

    const renameWrite = service.renameChannel(second.id, renamed.name);
    serverChannels.set(second.id, renamed);
    rename.reject(new RequestError("channel rename response lost", {
      serverURL: SERVER_URL,
    }));
    const renameFailure = await renameWrite.catch((error: unknown) => error);
    expect(renameFailure).not.toHaveProperty("status");
    expect(service.snapshot.channels.find(({ id }) => id === second.id)?.name)
      .toBe(renamed.name);
    expect(client.channels.list).toHaveBeenCalledTimes(2);
    expect(client.display.get).toHaveBeenCalledTimes(2);
    expect(client.channels.get).toHaveBeenCalledTimes(2);

    const removeWrite = service.deleteChannel(second.id);
    serverChannels.delete(second.id);
    display = { ...display, focusedChannelId: first.id, pinnedChannelIds: [first.id] };
    removal.reject(new RequestError("channel deletion response lost", {
      serverURL: SERVER_URL,
    }));
    const removeFailure = await removeWrite.catch((error: unknown) => error);
    expect(removeFailure).not.toHaveProperty("status");
    expect(service.snapshot.channels.map(({ id }) => id)).toEqual([first.id]);
    expect(service.snapshot.display).toMatchObject(display);
    expect(client.channels.list).toHaveBeenCalledTimes(2);
    expect(client.display.get).toHaveBeenCalledTimes(3);
    expect(client.channels.get).toHaveBeenCalledTimes(3);
    expect(client.artifacts.get).not.toHaveBeenCalled();
  });

  it("preserves the original ambiguous write error when its recovery read fails", async () => {
    const first = channel("channel-a", "A");
    const display: DisplayState = {
      focusedChannelId: first.id,
      pinnedChannelIds: [first.id],
      activeThemeName: null,
      activeThemeColorScheme: null,
      appearanceMode: "system",
      themeJavaScriptConsentIds: [],
      acpEnabled: false,
    };
    const writeError = new RequestError("focus response lost", {
      serverURL: SERVER_URL,
    });
    const recoveryError = new RequestError("display recovery also lost", {
      serverURL: SERVER_URL,
    });
    let displayReads = 0;
    const client = createClient({
      listChannels: async () => ({ channels: [first] }),
      getDisplay: async () => {
        displayReads += 1;
        if (displayReads > 1) throw recoveryError;
        return display;
      },
      getChannel: async () => ({ channel: first, artifacts: [] }),
      patchDisplay: async () => {
        throw writeError;
      },
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();

    const failure = await service.focusChannel(first.id)
      .catch((error: unknown) => error);

    expect(failure).toBe(writeError);
    expect(service.snapshot.display).toMatchObject(display);
    expect(client.display.get).toHaveBeenCalledTimes(2);
    expect(client.channels.list).toHaveBeenCalledOnce();
    expect(client.channels.get).toHaveBeenCalledOnce();
    expect(client.artifacts.get).not.toHaveBeenCalled();
  });

  it("does not let recovery from before reconnect overwrite the completed bootstrap", async () => {
    const first = channel("channel-a", "A");
    const second = channel("channel-b", "B");
    const initial: DisplayState = {
      focusedChannelId: first.id,
      pinnedChannelIds: [first.id],
      activeThemeName: null,
      activeThemeColorScheme: null,
      appearanceMode: "system",
      themeJavaScriptConsentIds: [],
      acpEnabled: false,
    };
    const stale: DisplayState = {
      ...initial,
      pinnedChannelIds: [first.id],
    };
    const fresh: DisplayState = {
      ...initial,
      pinnedChannelIds: [second.id],
    };
    const recovery = deferred<DisplayState>();
    const writeError = new RequestError("pin response lost", {
      serverURL: SERVER_URL,
    });
    let displayReads = 0;
    const client = createClient({
      listChannels: async () => ({ channels: [first, second] }),
      getDisplay: () => {
        displayReads += 1;
        if (displayReads === 1) return Promise.resolve(initial);
        if (displayReads === 2) return recovery.promise;
        return Promise.resolve(fresh);
      },
      getChannel: async ({ channelID }) => ({
        channel: channelID === first.id ? first : second,
        artifacts: [],
      }),
      patchDisplay: async () => {
        throw writeError;
      },
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();

    const write = service.setPinnedChannelIds([second.id]);
    await settle();
    expect(client.display.get).toHaveBeenCalledTimes(2);

    owner.disconnect();
    owner.connect();
    await settle();
    expect(service.snapshot.display.pinnedChannelIds).toEqual([second.id]);

    recovery.resolve(stale);
    const failure = await write.catch((error: unknown) => error);
    expect(failure).toBe(writeError);
    expect(service.snapshot.display.pinnedChannelIds).toEqual([second.id]);
  });

  it("scoped recovery captures the active refresh sequence without cancelling the in-flight complete bootstrap", async () => {
    const first = channel("channel-a", "A");
    const second = channel("channel-b", "B");
    const initial: DisplayState = {
      focusedChannelId: first.id,
      pinnedChannelIds: [first.id],
      activeThemeName: null,
      activeThemeColorScheme: null,
      appearanceMode: "system",
      themeJavaScriptConsentIds: [],
      acpEnabled: false,
    };
    const fresh: DisplayState = {
      focusedChannelId: second.id,
      pinnedChannelIds: [second.id],
      activeThemeName: null,
      activeThemeColorScheme: null,
      appearanceMode: "system",
      themeJavaScriptConsentIds: [],
      acpEnabled: false,
    };
    const reconnectChannels = deferred<{ channels: Channel[] }>();
    const writeError = new RequestError("pin response lost", {
      serverURL: SERVER_URL,
    });
    let listReads = 0;
    let displayReads = 0;
    const client = createClient({
      listChannels: () => {
        listReads += 1;
        return listReads === 1
          ? Promise.resolve({ channels: [first] })
          : reconnectChannels.promise;
      },
      getDisplay: async () => {
        displayReads += 1;
        return displayReads === 1 ? initial : fresh;
      },
      getChannel: async ({ channelID }) => ({
        channel: channelID === first.id ? first : second,
        artifacts: [],
      }),
      patchDisplay: async () => {
        throw writeError;
      },
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();

    owner.disconnect();
    owner.connect();
    await settle();
    expect(client.channels.list).toHaveBeenCalledTimes(2);

    const write = service.setPinnedChannelIds([second.id]);
    const failure = await write.catch((error: unknown) => error);
    expect(failure).toBe(writeError);
    expect(client.display.get).toHaveBeenCalledTimes(3);

    reconnectChannels.resolve({ channels: [first, second] });
    await settle();

    expect(service.snapshot.channels.map(({ id }) => id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(service.snapshot.display).toMatchObject(fresh);
    expect(service.snapshot.focusedChannel?.id).toBe(second.id);
  });

  it("refetches only display after 5xx focus and lost pin-list outcomes", async () => {
    const first = channel("channel-a", "A");
    const second = channel("channel-b", "B");
    let display: DisplayState = {
      focusedChannelId: first.id,
      pinnedChannelIds: [first.id],
      activeThemeName: null,
      activeThemeColorScheme: null,
      appearanceMode: "system",
      themeJavaScriptConsentIds: [],
      acpEnabled: false,
    };
    const focusWrite = deferred<void>();
    const pinWrite = deferred<void>();
    const writes = [focusWrite, pinWrite];
    const client = createClient({
      listChannels: async () => ({ channels: [first, second] }),
      getDisplay: async () => structuredClone(display),
      getChannel: async ({ channelID }) => ({
        channel: channelID === first.id ? first : second,
        artifacts: [],
      }),
      patchDisplay: () => writes.shift()!.promise,
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();

    const focus = service.focusChannel(second.id);
    display = { ...display, focusedChannelId: second.id };
    focusWrite.reject(new RequestError("focus write failed", {
      serverURL: SERVER_URL,
      status: 500,
    }));
    const focusFailure = await focus.catch((error: unknown) => error);
    expect(focusFailure).toMatchObject({
      name: "RequestError",
      serverURL: SERVER_URL,
      status: 500,
    });
    expect(service.snapshot.display.focusedChannelId).toBe(second.id);
    expect(client.display.get).toHaveBeenCalledTimes(2);

    const pins = service.setPinnedChannelIds([second.id]);
    pinWrite.reject(new RequestError("pin request lost", {
      serverURL: SERVER_URL,
    }));
    const pinFailure = await pins.catch((error: unknown) => error);
    expect(pinFailure).toMatchObject({ name: "RequestError", serverURL: SERVER_URL });
    expect(pinFailure).not.toHaveProperty("status");
    expect(service.snapshot.display.pinnedChannelIds).toEqual([first.id]);
    expect(client.display.get).toHaveBeenCalledTimes(3);

    expect(client.channels.list).toHaveBeenCalledOnce();
    expect(client.channels.get).toHaveBeenCalledTimes(2);
    expect(client.artifacts.get).not.toHaveBeenCalled();
  });

  it.each([
    {
      outcome: "present",
      readArtifact: async () => ({ artifact: artifact("artifact-b", "Recovered") }),
      expectedPages: [page(["artifact-a"]), page(["artifact-b"])],
      expectedArtifacts: [artifact("artifact-a"), artifact("artifact-b", "Recovered")],
      expectedSelection: ["artifact-b"],
    },
    {
      outcome: "absent",
      readArtifact: async () => {
        throw new RequestError("Artifact not found", {
          serverURL: SERVER_URL,
          status: 404,
        });
      },
      expectedPages: [page(["artifact-a"])],
      expectedArtifacts: [artifact("artifact-a")],
      expectedSelection: ["artifact-a"],
    },
  ])("refetches only the affected artifact when ambiguous deletion leaves it $outcome", async ({
    readArtifact,
    expectedPages,
    expectedArtifacts,
    expectedSelection,
  }) => {
    const value = channel("channel-a", "A", ["artifact-a", "artifact-b"]);
    const deletion = deferred<unknown>();
    const client = createClient({
      listChannels: async () => ({ channels: [value] }),
      getDisplay: async () => ({
        focusedChannelId: value.id,
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        acpEnabled: false,
      }),
      getChannel: async () => ({
        channel: value,
        artifacts: [artifact("artifact-a"), artifact("artifact-b")],
      }),
      getArtifact: readArtifact,
      deleteArtifact: () => deletion.promise,
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();
    service.selectPage(value.id, "artifact-b");

    const write = service.deleteArtifact("artifact-b");
    deletion.reject(new RequestError("artifact deletion outcome unknown", {
      serverURL: SERVER_URL,
    }));
    const failure = await write.catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "RequestError", serverURL: SERVER_URL });
    expect(failure).not.toHaveProperty("status");

    expect(service.snapshot.focusedChannel?.pages).toEqual(expectedPages);
    expect(service.snapshot.focusedChannel?.artifacts).toEqual(expectedArtifacts);
    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(expectedSelection);
    expect(client.artifacts.get).toHaveBeenCalledOnce();
    expect(client.channels.list).toHaveBeenCalledOnce();
    expect(client.channels.get).toHaveBeenCalledOnce();
    expect(client.display.get).toHaveBeenCalledOnce();
  });
});

describe("ApplicationService definitive write rejection", () => {
  it("keeps server truth and live artifact state after a rejected focus write", async () => {
    const first = channel("channel-a", "A", ["artifact-a"]);
    const second = channel("channel-b", "B");
    const patch = deferred<void>();
    const client = createClient({
      listChannels: async () => ({ channels: [first, second] }),
      getDisplay: async () => ({
        focusedChannelId: first.id,
        pinnedChannelIds: [first.id],
        activeThemeName: null,
        appearanceMode: "system",
        acpEnabled: false,
      }),
      getChannel: async ({ channelID }) => ({
        channel: channelID === first.id ? first : second,
        artifacts: channelID === first.id ? [artifact("artifact-a", "Before")] : [],
      }),
      patchDisplay: () => patch.promise,
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();

    const write = service.focusChannel(second.id);
    owner.emitServerEvent({
      type: "artifact-updated",
      artifact: artifact("artifact-a", "After"),
    });
    patch.reject(new RequestError("focus rejected", {
      serverURL: SERVER_URL,
      status: 404,
    }));
    await expect(write).rejects.toMatchObject({
      name: "RequestError",
      status: 404,
    });

    expect(service.snapshot.display).toMatchObject({
      focusedChannelId: first.id,
      pinnedChannelIds: [first.id],
    });
    expect(service.snapshot.channels[0]?.artifacts[0]?.title).toBe("After");
    expect(client.display.get).toHaveBeenCalledOnce();
    expect(owner.connection.status).toBe("connected");
  });

  it("keeps server truth and an unrelated focus event after a rejected pin-list write", async () => {
    const first = channel("channel-a", "A");
    const second = channel("channel-b", "B");
    const patch = deferred<void>();
    const client = createClient({
      listChannels: async () => ({ channels: [first, second] }),
      getDisplay: async () => ({
        focusedChannelId: first.id,
        pinnedChannelIds: [first.id],
        activeThemeName: null,
        appearanceMode: "system",
        acpEnabled: false,
      }),
      getChannel: async ({ channelID }) => ({
        channel: channelID === first.id ? first : second,
        artifacts: [],
      }),
      patchDisplay: () => patch.promise,
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();

    const write = service.setPinnedChannelIds([second.id]);
    owner.emitServerEvent({ type: "channel-changed", channelID: second.id });
    patch.reject(new RequestError("pins rejected", {
      serverURL: SERVER_URL,
      status: 400,
    }));
    await expect(write).rejects.toMatchObject({
      name: "RequestError",
      status: 400,
    });

    expect(service.snapshot.display).toMatchObject({
      focusedChannelId: second.id,
      pinnedChannelIds: [first.id],
    });
    expect(client.display.get).toHaveBeenCalledOnce();
    expect(owner.connection.status).toBe("connected");
  });

  it("keeps artifact projection, selection, and unrelated events after rejected deletion", async () => {
    const value = channel("channel-a", "A", ["artifact-a", "artifact-b"]);
    const deletion = deferred<unknown>();
    const client = createClient({
      listChannels: async () => ({ channels: [value] }),
      getDisplay: async () => ({
        focusedChannelId: value.id,
        pinnedChannelIds: [],
        activeThemeName: null,
        appearanceMode: "system",
        acpEnabled: false,
      }),
      getChannel: async () => ({
        channel: value,
        artifacts: [artifact("artifact-a", "Before"), artifact("artifact-b")],
      }),
      deleteArtifact: () => deletion.promise,
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();
    service.selectPage(value.id, "artifact-b");

    const write = service.deleteArtifact("artifact-b");
    owner.emitServerEvent({
      type: "artifact-updated",
      artifact: artifact("artifact-a", "After"),
    });
    owner.emitServerEvent({
      type: "pinned-channels-changed",
      pinnedChannelIds: [value.id],
    });
    deletion.reject(new RequestError("artifact deletion rejected", {
      serverURL: SERVER_URL,
      status: 404,
    }));
    await expect(write).rejects.toMatchObject({
      name: "RequestError",
      status: 404,
    });

    expect(service.snapshot.focusedChannel?.pages).toEqual(value.layout);
    expect(service.snapshot.focusedChannel?.selectedPage?.artifactIds).toEqual(["artifact-b"]);
    expect(service.snapshot.focusedChannel?.artifacts).toEqual([
      artifact("artifact-a", "After"),
      artifact("artifact-b"),
    ]);
    expect(service.snapshot.display.pinnedChannelIds).toEqual([value.id]);
    expect(client.artifacts.get).not.toHaveBeenCalled();
    expect(owner.connection.status).toBe("connected");
  });
});

describe("ApplicationService operations and disposal", () => {
  it("delivers physical arrows to its one application navigation callback", () => {
    const navigationKeyHandler = vi.fn();
    const { service } = createService(createClient(), navigationKeyHandler);

    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const) {
      service.handleNavigationKey(key);
    }

    expect(navigationKeyHandler.mock.calls).toEqual([
      ["ArrowLeft"],
      ["ArrowRight"],
      ["ArrowUp"],
      ["ArrowDown"],
    ]);
  });

  it("routes target operations through the one connection", async () => {
    const value = channel("channel-a", "A");
    const client = createClient({
      listChannels: async () => ({ channels: [value] }),
      getDisplay: async () => ({ focusedChannelId: value.id, pinnedChannelIds: [], activeThemeName: null, appearanceMode: "system", acpEnabled: false }),
      getChannel: async () => ({ channel: value, artifacts: [] }),
    });
    const { owner, service } = createService(client);
    owner.connect();
    await settle();

    await service.createChannel("New");
    await service.focusChannel(value.id);
    await service.setPinnedChannelIds([value.id]);
    await service.renameChannel(value.id, "Renamed");
    await service.deleteChannel(value.id);
    await service.deleteArtifact("artifact-a");
    expect(await service.readMarkdown("artifact-a")).toBe("content:artifact-a");
    await service.writeMarkdown("artifact-a", "changed");

    expect(client.channels.create).toHaveBeenCalledWith({ name: "New" });
    expect(client.display.patch).toHaveBeenCalledWith({ focusedChannelId: value.id });
    expect(client.display.patch).toHaveBeenCalledWith({ pinnedChannelIds: [value.id] });
    expect(client.channels.update).toHaveBeenCalledWith({ channelID: value.id, name: "Renamed" });
    expect(client.channels.remove).toHaveBeenCalledWith({ channelID: value.id });
    expect(client.artifacts.delete).toHaveBeenCalledWith({ artifactID: "artifact-a" });
    expect(client.markdown.get).toHaveBeenCalledWith({ artifactID: "artifact-a" });
    expect(client.markdown.update).toHaveBeenCalledWith({ artifactID: "artifact-a", content: "changed" });
    expect(service.getArtifactViewURL(artifact("artifact-a"))).toBe(`${SERVER_URL}/view/artifact-a`);
    expect(service.getArtifactContentURL(artifact("artifact-a"))).toBe(`${SERVER_URL}/content/artifact-a`);
  });

  it("stops applying events and in-flight snapshots after idempotent disposal", async () => {
    const list = deferred<{ channels: Channel[] }>();
    const client = createClient({ listChannels: () => list.promise });
    const { owner, service } = createService(client);
    owner.connect();
    const before = service.snapshot;

    service.dispose();
    service.dispose();
    owner.emitServerEvent({ type: "channel-created", channel: channel("late", "Late") });
    list.resolve({ channels: [channel("late", "Late")] });
    await settle();

    expect(service.snapshot).toBe(before);
  });
});

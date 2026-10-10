import { EventTarget } from "@rupertsworld/event-target";
import type { Artifact } from "@telepath-computer/television-artifact";
import type { NavigationKey } from "@telepath-computer/television-artifact/browser";
import {
  AppearanceChangedEvent,
  ArtifactContentChangedEvent,
  ArtifactFocusEvent,
  ChangeEvent,
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  getPageArtifactIds,
  removeArtifactFromPages,
  RequestError,
  ThemeChangedEvent,
  validatePageLayout,
  type AppearanceMode,
  type Channel,
  type DesktopUpgradeInstructions,
  type DisplayState,
  type ServerEvent,
  type ServerEventMessageEvent,
  type TabPage,
  type ThemeColorScheme,
  type ThemeRegistrySnapshot,
} from "@telepath-computer/television-shared";
import type { ServerStatus } from "./server-connection.ts";
import type { ServerConnectionOwner } from "./server-connection-owner.ts";

export interface ApplicationPageSnapshot {
  readonly artifactIds: readonly string[];
  readonly geometry: Readonly<TabPage["geometry"]>;
  readonly size: Readonly<TabPage["size"]>;
}

export interface ApplicationChannelSnapshot {
  readonly id: string;
  readonly name: string;
  readonly pages: readonly ApplicationPageSnapshot[];
  readonly selectedPage: ApplicationPageSnapshot | null;
  readonly artifacts: readonly Readonly<Artifact>[];
  readonly onboarding?: Readonly<NonNullable<Channel["onboarding"]>>;
}

export interface ApplicationDisplaySnapshot {
  readonly focusedChannelId: string | null;
  readonly pinnedChannelIds: readonly string[];
  readonly activeThemeName: string | null;
  readonly activeThemeColorScheme: ThemeColorScheme | null;
  readonly appearanceMode: AppearanceMode;
  readonly themeJavaScriptConsentIds: readonly string[];
  readonly acpEnabled: boolean;
}

export interface ApplicationConnectionSnapshot {
  readonly authorizationRequired: boolean;
  readonly gateHalted: boolean;
  readonly status: ServerStatus;
  readonly hasEverConnected: boolean;
  readonly failedReconnectAttempts: number;
  readonly firstConnectError: string | null;
  readonly nextRetryAt: number | null;
  readonly upgradeInstructions: DesktopUpgradeInstructions | null;
}

export interface ApplicationSnapshot {
  readonly ready: boolean;
  readonly channels: readonly ApplicationChannelSnapshot[];
  readonly display: ApplicationDisplaySnapshot;
  readonly focusedChannel: ApplicationChannelSnapshot | null;
  readonly connection: ApplicationConnectionSnapshot;
}

interface MutableChannelState {
  channel: Channel;
  artifacts: Map<string, Artifact>;
}

interface MutableApplicationState {
  channels: Map<string, MutableChannelState>;
  display: DisplayState;
}

interface PendingPageWrite {
  previousPages: TabPage[];
}

const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CLIENT_ERROR_MAX = 500;
const HTTP_SERVER_ERROR_MAX = 600;

const EMPTY_DISPLAY: DisplayState = {
  focusedChannelId: null,
  pinnedChannelIds: [],
  activeThemeName: null,
  activeThemeColorScheme: null,
  appearanceMode: "system",
  themeJavaScriptConsentIds: [],
  acpEnabled: false,
};

/**
 * The browser's one public state edge. It projects immutable render snapshots
 * from the owned server connection, merges complete fetches with live events,
 * and carries application operations back to that connection.
 */
export class ApplicationService extends EventTarget<
  ChangeEvent | AppearanceChangedEvent | ArtifactContentChangedEvent | ArtifactFocusEvent | ThemeChangedEvent
> {
  readonly #connectionOwner: ServerConnectionOwner;
  readonly #navigationKeyHandler: ((key: NavigationKey) => void) | undefined;
  readonly #retainedGateHalted: () => boolean;
  readonly #eventBuffers = new Set<ServerEvent[]>();
  private readonly pendingPageWrites = new Map<string, PendingPageWrite>();
  readonly #selectedPageArtifactIds = new Map<string, readonly string[]>();
  #state: MutableApplicationState = createEmptyState();
  #snapshot: ApplicationSnapshot;
  #ready = false;
  #connected = false;
  #refreshSequence = 0;
  #disposed = false;

  constructor(options: {
    connectionOwner: ServerConnectionOwner;
    navigationKeyHandler?: (key: NavigationKey) => void;
    /** Existing gate-controller projection retained between boot decisions. */
    retainedGateHalted?: () => boolean;
  }) {
    super();
    this.#connectionOwner = options.connectionOwner;
    this.#navigationKeyHandler = options.navigationKeyHandler;
    this.#retainedGateHalted = options.retainedGateHalted ?? (() => false);
    this.#snapshot = this.#buildSnapshot();
    this.#connectionOwner.addEventListener("change", this.#handleConnectionChange);
    this.#connectionOwner.addEventListener("server-event", this.#handleServerEvent);
    this.#handleConnectionChange();
  }

  get snapshot(): ApplicationSnapshot {
    return this.#snapshot;
  }

  /** Delivers a physical arrow to the application's one navigation handler. */
  handleNavigationKey(key: NavigationKey): void {
    this.#assertNotDisposed();
    this.#navigationKeyHandler?.(key);
  }

  async createChannel(name: string): Promise<Channel> {
    this.#assertNotDisposed();
    const { channel } = await this.#writeWithAmbiguousRecovery(
      this.#connectionOwner.connection.client.channels.create({ name }),
      () => this.#recoverChannelCollectionAndDisplayFromServer(),
    );
    return channel;
  }

  focusChannel(channelId: string): Promise<void> {
    this.#assertNotDisposed();
    return this.#writeWithAmbiguousRecovery(
      this.#connectionOwner.connection.client.display.patch({
        focusedChannelId: channelId,
      }),
      () => this.#recoverDisplayFromServer(),
    );
  }

  setPinnedChannelIds(channelIds: readonly string[]): Promise<void> {
    this.#assertNotDisposed();
    return this.#writeWithAmbiguousRecovery(
      this.#connectionOwner.connection.client.display.patch({
        pinnedChannelIds: [...channelIds],
      }),
      () => this.#recoverDisplayFromServer(),
    );
  }

  listThemes(): Promise<ThemeRegistrySnapshot> {
    this.#assertNotDisposed();
    return this.#connectionOwner.connection.client.themes.list();
  }

  refreshThemes(): Promise<ThemeRegistrySnapshot> {
    this.#assertNotDisposed();
    return this.#connectionOwner.connection.client.themes.refresh();
  }

  setActiveTheme(activeThemeName: string | null): Promise<void> {
    this.#assertNotDisposed();
    return this.#writeWithAmbiguousRecovery(
      this.#connectionOwner.connection.client.display.patch({ activeThemeName }),
      () => this.#recoverDisplayFromServer(),
    );
  }

  setAppearanceMode(appearanceMode: AppearanceMode): Promise<void> {
    this.#assertNotDisposed();
    return this.#writeWithAmbiguousRecovery(
      this.#connectionOwner.connection.client.display.patch({ appearanceMode }),
      () => this.#recoverDisplayFromServer(),
    );
  }

  setThemeJavaScriptConsent(themeId: string, enabled: boolean): Promise<void> {
    this.#assertNotDisposed();
    const confirmed = this.#state.display.themeJavaScriptConsentIds;
    const next = enabled
      ? confirmed.includes(themeId) ? [...confirmed] : [...confirmed, themeId]
      : confirmed.filter((id) => id !== themeId);
    return this.#writeWithAmbiguousRecovery(
      this.#connectionOwner.connection.client.display.patch({
        themeJavaScriptConsentIds: next,
      }),
      () => this.#recoverDisplayFromServer(),
    );
  }

  /** Select the page containing `artifactId` for this browser session only. */
  selectPage(channelId: string, artifactId: string): void {
    this.#assertNotDisposed();
    if (!rememberSelectedPage(
      this.#state,
      this.#selectedPageArtifactIds,
      channelId,
      artifactId,
    )) return;
    this.#publish();
  }

  async renameChannel(channelId: string, name: string): Promise<void> {
    this.#assertNotDisposed();
    await this.#writeWithAmbiguousRecovery(
      this.#connectionOwner.connection.client.channels.update({
        channelID: channelId,
        name,
      }),
      () => this.#recoverChannelFromServer(channelId),
    );
  }

  async deleteChannel(channelId: string): Promise<void> {
    this.#assertNotDisposed();
    await this.#writeWithAmbiguousRecovery(
      this.#connectionOwner.connection.client.channels.remove({
        channelID: channelId,
      }),
      () => this.#recoverChannelAndDisplayFromServer(channelId),
    );
  }

  /**
   * Replace a channel's pages optimistically. An authoritative event ends the
   * pending write. A definitive 4xx clears and rolls back the matching result;
   * a statusless or 5xx failure refreshes the channel before reaching the caller.
   */
  updateChannelPages(channelId: string, pages: readonly TabPage[]): Promise<void> {
    this.#assertNotDisposed();
    const validation = validatePageLayout(pages);
    const current = this.#state.channels.get(channelId);
    if (!validation.valid || !current) return Promise.resolve();

    const nextPages = clonePages(pages);
    const previousPages = clonePages(current.channel.layout);
    const pending: PendingPageWrite = { previousPages };
    reconcileSelectedPage(
      this.#selectedPageArtifactIds,
      channelId,
      previousPages,
      nextPages,
    );
    current.channel = { ...current.channel, layout: nextPages };
    this.pendingPageWrites.set(channelId, pending);
    this.#publish();

    return this.#connectionOwner.connection.client.channels.update({
      channelID: channelId,
      layout: clonePages(nextPages),
    }).then(
      () => {
        if (this.pendingPageWrites.get(channelId) === pending) {
          this.pendingPageWrites.delete(channelId);
        }
      },
      async (error: unknown) => {
        if (this.#disposed) throw error;

        const isCurrent = this.pendingPageWrites.get(channelId) === pending;
        if (isCurrent) this.pendingPageWrites.delete(channelId);
        if (isOutcomeAmbiguousWriteFailure(error)) {
          await this.#attemptRecovery(
            () => this.#recoverChannelFromServer(channelId),
          );
          throw error;
        }
        if (!isCurrent || !isDefinitiveWriteRejection(error)) throw error;

        const latest = this.#state.channels.get(channelId);
        if (!latest) throw error;
        const rollbackPages = clonePages(pending.previousPages);
        reconcileSelectedPage(
          this.#selectedPageArtifactIds,
          channelId,
          latest.channel.layout,
          rollbackPages,
        );
        latest.channel = {
          ...latest.channel,
          layout: rollbackPages,
        };
        this.#publish();
        throw error;
      },
    );
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    this.#assertNotDisposed();
    const channelId = findArtifactChannelId(this.#state, artifactId);
    await this.#writeWithAmbiguousRecovery(
      this.#connectionOwner.connection.client.artifacts.delete({
        artifactID: artifactId,
      }),
      () => this.#recoverArtifactFromServer(artifactId, channelId),
    );
  }

  readMarkdown(artifactId: string): Promise<string> {
    this.#assertNotDisposed();
    return this.#connectionOwner.connection.client.markdown.get({
      artifactID: artifactId,
    });
  }

  writeMarkdown(artifactId: string, content: string): Promise<void> {
    this.#assertNotDisposed();
    return this.#connectionOwner.connection.client.markdown.update({
      artifactID: artifactId,
      content,
    });
  }

  /** The connected server's browser demo mode (specs/product/artifacts.md#^af-demo-mode). */
  get browserDemoMode(): boolean {
    return this.#connectionOwner.connection.browserDemoMode;
  }

  getArtifactViewURL(artifact: Artifact): string {
    this.#assertNotDisposed();
    return this.#connectionOwner.connection.getViewURL(artifact);
  }

  getArtifactContentURL(artifact: Artifact): string | null {
    this.#assertNotDisposed();
    return this.#connectionOwner.connection.getContentURL(artifact);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#refreshSequence += 1;
    this.#eventBuffers.clear();
    this.pendingPageWrites.clear();
    this.#selectedPageArtifactIds.clear();
    this.#connectionOwner.removeEventListener("change", this.#handleConnectionChange);
    this.#connectionOwner.removeEventListener("server-event", this.#handleServerEvent);
  }

  readonly #handleConnectionChange = (): void => {
    if (this.#disposed) return;
    const connected = this.#connectionOwner.connection.status === "connected";
    if (connected && !this.#connected) {
      this.#connected = true;
      void this.#refreshFromServer();
    } else if (!connected && this.#connected) {
      this.#connected = false;
      this.#refreshSequence += 1;
    }
    this.#publish();
  };

  readonly #handleServerEvent = (message: ServerEventMessageEvent): void => {
    if (this.#disposed) return;
    for (const buffer of this.#eventBuffers) buffer.push(message.event);

    const event = message.event;
    if (event.type === "artifact-content-changed") {
      this.dispatchEvent(new ArtifactContentChangedEvent("artifact-content-changed", {
        artifactID: event.artifactID,
      }));
      return;
    }
    if (event.type === "artifact-focus") {
      if (this.#ready && rememberSelectedPage(
        this.#state,
        this.#selectedPageArtifactIds,
        event.channelID,
        event.artifactID,
      )) {
        this.#publish();
      }
      this.dispatchEvent(new ArtifactFocusEvent("artifact-focus", {
        channelID: event.channelID,
        artifactID: event.artifactID,
      }));
      return;
    }
    if (event.type === "theme-changed") {
      this.dispatchEvent(new ThemeChangedEvent("theme-changed", {
        themeName: event.themeName,
        activeThemeColorScheme: event.activeThemeColorScheme,
        themeJavaScriptConsentIds: [...event.themeJavaScriptConsentIds],
      }));
    }
    if (event.type === "appearance-changed") {
      this.dispatchEvent(new AppearanceChangedEvent("appearance-changed", {
        appearanceMode: event.appearanceMode,
      }));
    }

    if (!this.#ready) return;
    applyServerEvent(
      this.#state,
      event,
      this.pendingPageWrites,
      this.#selectedPageArtifactIds,
    );
    rememberFocusedPage(this.#state, this.#selectedPageArtifactIds);
    this.#publish();
  };

  async #writeWithAmbiguousRecovery<T>(
    write: Promise<T>,
    recover: () => Promise<void>,
  ): Promise<T> {
    try {
      return await write;
    } catch (error) {
      if (!this.#disposed && isOutcomeAmbiguousWriteFailure(error)) {
        await this.#attemptRecovery(recover);
      }
      throw error;
    }
  }

  async #attemptRecovery(recover: () => Promise<void>): Promise<void> {
    try {
      await recover();
    } catch {
      // Recovery is one best-effort read. Preserve the originating write
      // failure if that read encounters the same transport outage.
    }
  }

  #recoverDisplayFromServer(): Promise<void> {
    const client = this.#connectionOwner.connection.client;
    return this.#recoverAffectedState(
      () => client.display.get(),
      (display) => this.#applyRecoveredDisplay(display),
    );
  }

  #recoverChannelCollectionAndDisplayFromServer(): Promise<void> {
    const client = this.#connectionOwner.connection.client;
    return this.#recoverAffectedState(
      async () => {
        const [{ channels }, display] = await Promise.all([
          client.channels.list(),
          client.display.get(),
        ]);
        return { channels, display };
      },
      ({ channels, display }) => {
        const recoveredIds = new Set(channels.map(({ id }) => id));
        for (const channelId of this.#state.channels.keys()) {
          if (recoveredIds.has(channelId)) continue;
          this.pendingPageWrites.delete(channelId);
          this.#selectedPageArtifactIds.delete(channelId);
          this.#state.channels.delete(channelId);
        }
        for (const channel of channels) {
          if (this.#state.channels.has(channel.id)) continue;
          this.#state.channels.set(channel.id, {
            channel: cloneChannel(channel),
            artifacts: new Map(),
          });
        }
        this.#applyRecoveredDisplay(display);
      },
    );
  }

  #recoverChannelFromServer(channelId: string): Promise<void> {
    const client = this.#connectionOwner.connection.client;
    return this.#recoverAffectedState(
      () => readMissingAsNull(() => client.channels.get({ channelID: channelId })),
      (detail) => this.#applyRecoveredChannel(channelId, detail),
    );
  }

  #recoverChannelAndDisplayFromServer(channelId: string): Promise<void> {
    const client = this.#connectionOwner.connection.client;
    return this.#recoverAffectedState(
      async () => {
        const [detail, display] = await Promise.all([
          readMissingAsNull(() => client.channels.get({ channelID: channelId })),
          client.display.get(),
        ]);
        return { detail, display };
      },
      ({ detail, display }) => {
        this.#applyRecoveredChannel(channelId, detail);
        this.#applyRecoveredDisplay(display);
      },
    );
  }

  #applyRecoveredDisplay(display: DisplayState): void {
    this.#state.display = cloneDisplay(display);
    this.#connectionOwner.connection.acpClient.setEnabled(display.acpEnabled);
  }

  #applyRecoveredChannel(
    channelId: string,
    detail: { channel: Channel; artifacts: Artifact[] } | null,
  ): void {
    this.pendingPageWrites.delete(channelId);
    const previous = this.#state.channels.get(channelId);
    if (detail === null) {
      this.#selectedPageArtifactIds.delete(channelId);
      this.#state.channels.delete(channelId);
      return;
    }
    reconcileSelectedPage(
      this.#selectedPageArtifactIds,
      channelId,
      previous?.channel.layout ?? [],
      detail.channel.layout,
    );
    this.#state.channels.set(channelId, {
      channel: cloneChannel(detail.channel),
      artifacts: new Map(
        detail.artifacts.map((artifact) => [
          artifact.id,
          structuredClone(artifact),
        ]),
      ),
    });
  }

  #recoverArtifactFromServer(
    artifactId: string,
    previousChannelId: string | null,
  ): Promise<void> {
    const client = this.#connectionOwner.connection.client;
    return this.#recoverAffectedState(
      () => readMissingAsNull(() => client.artifacts.get({ artifactID: artifactId })),
      (result) => {
        const channelId = findArtifactChannelId(this.#state, artifactId)
          ?? previousChannelId;
        if (result === null) {
          if (channelId !== null) {
            applyServerEvent(
              this.#state,
              { type: "artifact-removed", channelID: channelId, artifactID: artifactId },
              this.pendingPageWrites,
              this.#selectedPageArtifactIds,
            );
          }
          return;
        }
        const channel = channelId === null
          ? undefined
          : this.#state.channels.get(channelId);
        channel?.artifacts.set(artifactId, structuredClone(result.artifact));
      },
    );
  }

  async #recoverAffectedState<T>(
    read: () => Promise<T>,
    apply: (value: T) => void,
  ): Promise<void> {
    const refreshSequence = this.#refreshSequence;
    const events: ServerEvent[] = [];
    this.#eventBuffers.add(events);
    try {
      const value = await read();
      if (this.#disposed || refreshSequence !== this.#refreshSequence) return;

      apply(value);
      for (const event of events) {
        applyServerEvent(
          this.#state,
          event,
          this.pendingPageWrites,
          this.#selectedPageArtifactIds,
        );
      }
      rememberFocusedPage(this.#state, this.#selectedPageArtifactIds);
      this.#publish();
    } finally {
      this.#eventBuffers.delete(events);
    }
  }

  async #refreshFromServer(): Promise<void> {
    const sequence = ++this.#refreshSequence;
    const connection = this.#connectionOwner.connection;
    const client = connection.client;
    const events: ServerEvent[] = [];
    this.#eventBuffers.add(events);

    try {
      const [{ channels }, display] = await Promise.all([
        client.channels.list(),
        client.display.get(),
      ]);
      const details = await Promise.all(
        channels.map(({ id }) => client.channels.get({ channelID: id })),
      );
      if (this.#disposed || sequence !== this.#refreshSequence) return;

      const next: MutableApplicationState = {
        channels: new Map(),
        display: cloneDisplay(display),
      };
      for (const detail of details) {
        next.channels.set(detail.channel.id, {
          channel: cloneChannel(detail.channel),
          artifacts: new Map(
            detail.artifacts.map((value) => [value.id, structuredClone(value)]),
          ),
        });
      }
      reconcileSelectionsForSnapshot(
        this.#selectedPageArtifactIds,
        this.#state,
        next,
      );
      for (const event of events) {
        applyServerEvent(
          next,
          event,
          this.pendingPageWrites,
          this.#selectedPageArtifactIds,
        );
      }
      rememberFocusedPage(next, this.#selectedPageArtifactIds);

      const retainedPathArtifactIds = this.#ready
        ? findRetainedFocusedPathArtifactIds(this.#state, next)
        : [];
      this.pendingPageWrites.clear();
      this.#state = next;
      this.#ready = true;
      connection.acpClient.setEnabled(display.acpEnabled);
      this.#publish();
      for (const artifactID of retainedPathArtifactIds) {
        this.dispatchEvent(new ArtifactContentChangedEvent(
          "artifact-content-changed",
          { artifactID },
        ));
      }
    } catch {
      // Connection lifecycle owns retry. Keep the last complete render state;
      // the next successful connection transition starts another full fetch.
    } finally {
      this.#eventBuffers.delete(events);
    }
  }

  #publish(): void {
    if (this.#disposed) return;
    this.#snapshot = this.#buildSnapshot();
    this.#syncACPChannelContext();
    this.dispatchEvent(new ChangeEvent("change"));
  }

  #buildSnapshot(): ApplicationSnapshot {
    const channels = [...this.#state.channels.values()].map((channel) =>
      freezeChannelSnapshot(
        channel,
        this.#selectedPageArtifactIds.get(channel.channel.id),
      )
    );
    const focusedChannel = channels.find(
      ({ id }) => id === this.#state.display.focusedChannelId,
    ) ?? null;
    const connection = this.#connectionOwner.connection;
    return Object.freeze({
      ready: this.#ready,
      channels: Object.freeze(channels),
      display: freezeDisplaySnapshot(this.#state.display),
      focusedChannel,
      connection: Object.freeze({
        authorizationRequired: connection.hasAuthRejected,
        gateHalted: connection.bootState === "halted" || this.#retainedGateHalted(),
        status: connection.status,
        hasEverConnected: connection.hasEverConnected,
        failedReconnectAttempts: connection.failedReconnectAttempts,
        firstConnectError: connection.hasEverConnected
          ? null
          : this.#connectionOwner.connectError,
        nextRetryAt: connection.nextRetryAt,
        upgradeInstructions: freezeUpgradeInstructions(
          connection.updateState?.desktop ?? null,
        ),
      }),
    });
  }

  #syncACPChannelContext(): void {
    const focused = this.#snapshot.focusedChannel;
    this.#connectionOwner.connection.acpClient.setChannelContext(
      focused ? { channelID: focused.id, channelName: focused.name } : null,
    );
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new Error("ApplicationService is disposed");
  }
}

function findRetainedFocusedPathArtifactIds(
  previous: MutableApplicationState,
  next: MutableApplicationState,
): readonly string[] {
  const focusedChannelId = next.display.focusedChannelId;
  if (
    focusedChannelId === null ||
    previous.display.focusedChannelId !== focusedChannelId
  ) return [];

  const previousChannel = previous.channels.get(focusedChannelId);
  const nextChannel = next.channels.get(focusedChannelId);
  if (!previousChannel || !nextChannel) return [];

  const previousPageArtifactIds = new Set(
    getPageArtifactIds(previousChannel.channel.layout),
  );
  return getPageArtifactIds(nextChannel.channel.layout).filter((artifactID) =>
    previousPageArtifactIds.has(artifactID) &&
    previousChannel.artifacts.get(artifactID)?.kind === "path" &&
    nextChannel.artifacts.get(artifactID)?.kind === "path"
  );
}

function freezeUpgradeInstructions(
  instructions: DesktopUpgradeInstructions | null,
): DesktopUpgradeInstructions | null {
  return instructions === null ? null : Object.freeze({ ...instructions });
}

function createEmptyState(): MutableApplicationState {
  return {
    channels: new Map(),
    display: cloneDisplay(EMPTY_DISPLAY),
  };
}

function applyServerEvent(
  state: MutableApplicationState,
  event: ServerEvent,
  pendingPageWrites: Map<string, PendingPageWrite>,
  selectedPageArtifactIds: Map<string, readonly string[]>,
): void {
  switch (event.type) {
    case "channel-created":
      selectedPageArtifactIds.delete(event.channel.id);
      state.channels.set(event.channel.id, {
        channel: cloneChannel(event.channel),
        artifacts: new Map(),
      });
      return;
    case "channel-updated": {
      pendingPageWrites.delete(event.channel.id);
      const current = state.channels.get(event.channel.id);
      if (!current) {
        selectedPageArtifactIds.delete(event.channel.id);
        state.channels.set(event.channel.id, {
          channel: cloneChannel(event.channel),
          artifacts: new Map(),
        });
        return;
      }
      reconcileSelectedPage(
        selectedPageArtifactIds,
        event.channel.id,
        current.channel.layout,
        event.channel.layout,
      );
      const artifactIds = new Set(getPageArtifactIds(event.channel.layout));
      current.channel = cloneChannel(event.channel);
      for (const artifactId of current.artifacts.keys()) {
        if (!artifactIds.has(artifactId)) current.artifacts.delete(artifactId);
      }
      return;
    }
    case "channel-removed":
      pendingPageWrites.delete(event.channelID);
      selectedPageArtifactIds.delete(event.channelID);
      state.channels.delete(event.channelID);
      return;
    case "channel-changed":
      state.display.focusedChannelId = event.channelID;
      return;
    case "pinned-channels-changed":
      state.display.pinnedChannelIds = [...event.pinnedChannelIds];
      return;
    case "theme-changed":
      state.display.activeThemeName = event.themeName;
      state.display.activeThemeColorScheme = event.activeThemeColorScheme;
      state.display.themeJavaScriptConsentIds = [
        ...event.themeJavaScriptConsentIds,
      ];
      return;
    case "appearance-changed":
      state.display.appearanceMode = event.appearanceMode;
      return;
    case "artifact-created": {
      const current = state.channels.get(event.channelID);
      if (!current) return;
      const pending = pendingPageWrites.get(event.channelID);
      if (pending) {
        pending.previousPages = appendArtifactPageIfMissing(
          pending.previousPages,
          event.artifact.id,
        );
      }
      if (!getPageArtifactIds(current.channel.layout).includes(event.artifact.id)) {
        const previousPages = current.channel.layout;
        const nextPages = appendArtifactPageIfMissing(
          previousPages,
          event.artifact.id,
        );
        reconcileSelectedPage(
          selectedPageArtifactIds,
          event.channelID,
          previousPages,
          nextPages,
        );
        current.channel = {
          ...current.channel,
          layout: nextPages,
        };
      }
      current.artifacts.set(event.artifact.id, structuredClone(event.artifact));
      return;
    }
    case "artifact-updated":
      for (const current of state.channels.values()) {
        if (current.artifacts.has(event.artifact.id)) {
          current.artifacts.set(event.artifact.id, structuredClone(event.artifact));
          return;
        }
      }
      return;
    case "artifact-removed": {
      const current = state.channels.get(event.channelID);
      if (!current) return;
      const pending = pendingPageWrites.get(event.channelID);
      if (pending) {
        pending.previousPages = removeArtifactFromPages(
          pending.previousPages,
          event.artifactID,
        );
      }
      current.artifacts.delete(event.artifactID);
      const previousPages = current.channel.layout;
      const nextPages = removeArtifactFromPages(previousPages, event.artifactID);
      reconcileSelectedPage(
        selectedPageArtifactIds,
        event.channelID,
        previousPages,
        nextPages,
      );
      current.channel = {
        ...current.channel,
        layout: nextPages,
      };
      return;
    }
    case "artifact-focus":
      rememberSelectedPage(
        state,
        selectedPageArtifactIds,
        event.channelID,
        event.artifactID,
      );
      return;
    case "artifact-content-changed":
      return;
    default:
      return assertNever(event);
  }
}

function reconcileSelectionsForSnapshot(
  selectedPageArtifactIds: Map<string, readonly string[]>,
  previous: MutableApplicationState,
  next: MutableApplicationState,
): void {
  for (const channelId of selectedPageArtifactIds.keys()) {
    if (!next.channels.has(channelId)) selectedPageArtifactIds.delete(channelId);
  }
  for (const [channelId, nextChannel] of next.channels) {
    reconcileSelectedPage(
      selectedPageArtifactIds,
      channelId,
      previous.channels.get(channelId)?.channel.layout ?? [],
      nextChannel.channel.layout,
    );
  }
}

function reconcileSelectedPage(
  selectedPageArtifactIds: Map<string, readonly string[]>,
  channelId: string,
  previousPages: readonly TabPage[],
  nextPages: readonly TabPage[],
): void {
  const selectedArtifactIds = selectedPageArtifactIds.get(channelId);
  if (selectedArtifactIds === undefined) return;
  if (nextPages.length === 0) {
    selectedPageArtifactIds.delete(channelId);
    return;
  }

  const survivingIndex = findPageWithArtifactOverlap(nextPages, selectedArtifactIds);
  if (survivingIndex !== -1) {
    selectedPageArtifactIds.set(
      channelId,
      [...nextPages[survivingIndex]!.artifactIds],
    );
    return;
  }

  const previousIndex = findPageWithArtifactOverlap(previousPages, selectedArtifactIds);
  const fallbackIndex = previousIndex === -1
    ? 0
    : Math.min(previousIndex, nextPages.length - 1);
  selectedPageArtifactIds.set(channelId, [...nextPages[fallbackIndex]!.artifactIds]);
}

function rememberSelectedPage(
  state: MutableApplicationState,
  selectedPageArtifactIds: Map<string, readonly string[]>,
  channelId: string,
  artifactId: string,
): boolean {
  const channel = state.channels.get(channelId);
  const selectedPage = channel?.channel.layout.find(({ artifactIds }) =>
    artifactIds.includes(artifactId)
  );
  if (!selectedPage) return false;

  const previous = selectedPageArtifactIds.get(channelId);
  if (previous && haveSameArtifactIds(previous, selectedPage.artifactIds)) return false;
  selectedPageArtifactIds.set(channelId, [...selectedPage.artifactIds]);
  return true;
}

function rememberFocusedPage(
  state: MutableApplicationState,
  selectedPageArtifactIds: Map<string, readonly string[]>,
): void {
  const channelId = state.display.focusedChannelId;
  if (channelId === null || selectedPageArtifactIds.has(channelId)) return;
  const firstArtifactId = state.channels.get(channelId)?.channel.layout[0]?.artifactIds[0];
  if (firstArtifactId !== undefined) {
    rememberSelectedPage(state, selectedPageArtifactIds, channelId, firstArtifactId);
  }
}

function findPageWithArtifactOverlap(
  pages: readonly TabPage[],
  artifactIds: readonly string[],
): number {
  const candidates = new Set(artifactIds);
  return pages.findIndex((page) =>
    page.artifactIds.some((artifactId) => candidates.has(artifactId))
  );
}

function haveSameArtifactIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((artifactId, index) => artifactId === right[index]);
}

function freezeChannelSnapshot(
  value: MutableChannelState,
  selectedArtifactIds: readonly string[] | undefined,
): ApplicationChannelSnapshot {
  const pages = Object.freeze(value.channel.layout.map((page) => Object.freeze({
    artifactIds: Object.freeze([...page.artifactIds]),
    geometry: Object.freeze({ ...page.geometry }),
    size: Object.freeze({ ...page.size }),
  })));
  const selectedIndex = selectedArtifactIds === undefined
    ? 0
    : findPageWithArtifactOverlap(value.channel.layout, selectedArtifactIds);
  const selectedPage = pages[selectedIndex] ?? pages[0] ?? null;
  const artifacts = Object.freeze([...value.artifacts.values()].map((artifact) =>
    Object.freeze(structuredClone(artifact))
  ));
  const base = {
    id: value.channel.id,
    name: value.channel.name,
    pages,
    selectedPage,
    artifacts,
  };
  return Object.freeze(
    value.channel.onboarding
      ? { ...base, onboarding: Object.freeze({ ...value.channel.onboarding }) }
      : base,
  );
}

function freezeDisplaySnapshot(value: DisplayState): ApplicationDisplaySnapshot {
  return Object.freeze({
    focusedChannelId: value.focusedChannelId,
    pinnedChannelIds: Object.freeze([...value.pinnedChannelIds]),
    activeThemeName: value.activeThemeName,
    activeThemeColorScheme: value.activeThemeColorScheme,
    appearanceMode: value.appearanceMode,
    themeJavaScriptConsentIds: Object.freeze([
      ...value.themeJavaScriptConsentIds,
    ]),
    acpEnabled: value.acpEnabled,
  });
}

function appendArtifactPageIfMissing(
  pages: readonly TabPage[],
  artifactId: string,
): TabPage[] {
  if (getPageArtifactIds(pages).includes(artifactId)) return clonePages(pages);
  return [
    ...clonePages(pages),
    {
      artifactIds: [artifactId],
      geometry: { ...DEFAULT_PAGE_GEOMETRY },
      size: { ...DEFAULT_PAGE_SIZE },
    },
  ];
}

function isDefinitiveWriteRejection(error: unknown): error is RequestError & { status: number } {
  return error instanceof RequestError &&
    error.status !== undefined &&
    error.status >= HTTP_CLIENT_ERROR_MIN &&
    error.status < HTTP_CLIENT_ERROR_MAX;
}

function isOutcomeAmbiguousWriteFailure(error: unknown): error is RequestError {
  return error instanceof RequestError && (
    error.status === undefined
    || (error.status >= HTTP_CLIENT_ERROR_MAX && error.status < HTTP_SERVER_ERROR_MAX)
  );
}

async function readMissingAsNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof RequestError && error.status === HTTP_NOT_FOUND) return null;
    throw error;
  }
}

function findArtifactChannelId(
  state: MutableApplicationState,
  artifactId: string,
): string | null {
  for (const [channelId, channel] of state.channels) {
    if (channel.artifacts.has(artifactId)) return channelId;
  }
  return null;
}

function clonePages(value: readonly TabPage[]): TabPage[] {
  return value.map((page) => ({
    artifactIds: [...page.artifactIds],
    geometry: { ...page.geometry },
    size: { ...page.size },
  }));
}

function cloneChannel(value: Channel): Channel {
  return {
    id: value.id,
    name: value.name,
    layout: clonePages(value.layout),
    ...(value.onboarding ? { onboarding: { ...value.onboarding } } : {}),
  };
}

function cloneDisplay(value: DisplayState): DisplayState {
  return {
    focusedChannelId: value.focusedChannelId,
    pinnedChannelIds: [...value.pinnedChannelIds],
    activeThemeName: value.activeThemeName,
    activeThemeColorScheme: value.activeThemeColorScheme,
    appearanceMode: value.appearanceMode,
    themeJavaScriptConsentIds: [...value.themeJavaScriptConsentIds],
    acpEnabled: value.acpEnabled,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected server event: ${JSON.stringify(value)}`);
}

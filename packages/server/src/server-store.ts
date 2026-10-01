import { EventTarget } from "@rupertsworld/event-target";
import {
  AppearanceChangedEvent,
  ArtifactFocusEvent,
  ArtifactContentChangedEvent,
  ArtifactCreatedEvent,
  ArtifactRemovedEvent,
  ArtifactUpdatedEvent,
  ConflictError,
  InvalidRequestError,
  NotFoundError,
  ChannelChangedEvent,
  ChannelCreatedEvent,
  PinnedChannelsChangedEvent,
  ChannelRemovedEvent,
  ChannelUpdatedEvent,
  ThemeChangedEvent,
  type ArtifactRemovalResult,
  type StoreDomainEvent,
  type ChannelRemovalResult,
  type ThemeRegistrySnapshot,
} from "@telepath-computer/television-shared";
import { ulid } from "ulid";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  accessSync,
  constants,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  getChannelArtifactIDs,
  preservesPageMembership,
  removeArtifactFromPages,
  validatePageLayout,
  type AppearanceMode,
  type OnboardingChannelMarker,
  type Channel,
  type ChannelPatch,
  type DisplayPatch,
  type TabPage,
  type ThemeColorScheme,
} from "@telepath-computer/television-shared";
import {
  ArtifactSchema,
  createArtifact,
  hasTrailingSeparator,
  isAllowedArtifactFilePath,
  isExternalArtifactURL,
  isHtmlPath,
  isMarkdownPath,
  stripTrailingSeparators,
  type Artifact,
  type ArtifactKind,
} from "@telepath-computer/television-artifact";
import { createToken } from "./auth.ts";
import { defaultWatchContentFile, type ContentWatcher, type WatchContentFile } from "./file-watcher.ts";
import {
  getAgentArtifactsDir,
  getArtifactLiveMetadataPath,
  getArtifactsMetadataDir,
  getChannelsDir,
  getDisplayStatePath,
  getLegacyScreensDir,
  getOnboardingArtifactSentinelPath,
  getOnboardingStatePath,
  getTokenPath,
} from "./artifact-paths.ts";
import { runRedesignStorageMigration } from "./redesign-storage-migration.ts";
import { getThemeDir, getThemesDir, scanThemesDirectory } from "./themes.ts";
import type { TelemetryClientContext } from "./telemetry/client-meta.ts";
import type { ServerStoreTelemetryHooks } from "./telemetry/emitters.ts";
import type { ArtifactDeletionCause, ThemeChangeReason } from "./telemetry/types.ts";
import { runOnboardingBootstrap } from "./onboarding-installer.ts";
import {
  BUNDLED_THEME_STATE_VERSION,
  DEFAULT_BUNDLED_THEME_ID,
  runBundledThemeInstallation,
  type BundledThemeState,
  writeBundledThemeStateFile,
} from "./bundled-theme-installer.ts";

const JSON_INDENT_SPACES = 2;
const LAYOUT_VERSION = 2 as const;
const CONTENT_WATCH_DEBOUNCE_MS = 100;
const JSON_FILE_SUFFIX = ".json";
const DIRECTORY_INDEX_BASENAMES = ["index.html", "index.htm"] as const;
const BUNDLED_VIEW_IDS = new Set(["artifact-missing", "markdown"]);

type ThemeJavaScriptDeclarationValues = readonly [
  boolean | undefined,
  boolean | undefined,
  boolean | undefined,
];

function isBundledViewID(id: string): boolean {
  return BUNDLED_VIEW_IDS.has(id);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function sameIdMembership(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

function sameThemeJavaScriptDeclarations(
  left: ThemeJavaScriptDeclarationValues,
  right: ThemeJavaScriptDeclarationValues,
): boolean {
  return left.every((value, index) => value === right[index]);
}

function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === "system" || value === "light" || value === "dark";
}

function isThemeJavaScriptConsentIds(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(value).size === value.length;
}

/** Mirrors ArtifactPatch's complete title/path/url metadata surface. */
function hasSameArtifactMetadata(left: Artifact, right: Artifact): boolean {
  if (left.kind !== right.kind || left.title !== right.title) return false;
  return left.kind === "path" && right.kind === "path"
    ? left.path === right.path
    : left.kind === "url" && right.kind === "url" && left.url === right.url;
}

function hasExistingTelevisionDataStructure(storagePath: string): boolean {
  // File signals — written only by a completed serving bootstrap.
  // Token-only construction (readOrCreateAuthToken in the parent CLI)
  // runs ensureDirectories + loadOrCreateAuthToken and returns before
  // the serving-only work that writes these.
  if (existsSync(getDisplayStatePath(storagePath))) return true;
  if (existsSync(getOnboardingStatePath(storagePath))) return true;
  if (existsSync(getOnboardingArtifactSentinelPath(storagePath))) return true;

  // Directory-content signals — ensureDirectories creates these empty
  // in both token-only and serving construction. Non-empty content
  // requires a serving boot to have written into them.
  if (directoryIsNonEmpty(getChannelsDir(storagePath))) return true;
  if (directoryIsNonEmpty(getLegacyScreensDir(storagePath))) return true;
  if (directoryIsNonEmpty(getArtifactsMetadataDir(storagePath))) return true;
  if (directoryIsNonEmpty(getThemesDir(storagePath))) return true;
  if (directoryIsNonEmpty(getAgentArtifactsDir(storagePath))) return true;

  return false;
}

function directoryIsNonEmpty(dir: string): boolean {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

export interface ArtifactWatchTarget {
  readonly watchPath: string;
  readonly recursive: boolean;
}

export function artifactWatchTarget(artifact: Artifact): ArtifactWatchTarget | null {
  if (artifact.kind === "url") {
    return null;
  }
  if (hasTrailingSeparator(artifact.path)) {
    return { watchPath: artifact.path, recursive: true };
  }
  if (isMarkdownPath(artifact.path) || isHtmlPath(artifact.path)) {
    return { watchPath: artifact.path, recursive: false };
  }
  return null;
}

export interface ServerStoreOptions {
  storagePath: string;
  watchContentFile?: WatchContentFile;
  /**
   * Absolute path to a directory containing bundled views. Only fixed bundled
   * views are resolved from here in the path/url model; the generic view
   * registry is removed.
   */
  bundledViewsPath?: string;
  /** Root of the bundled onboarding-channels content tree, when one resolved. */
  onboardingContentPath?: string;
  /** Root of the bundled installed-theme package tree, when one resolved. */
  bundledThemesPath?: string;
  /**
   * `true` = serving construction: full bootstrap including onboarding
   * migration/install, the default-channel invariant, display state, and
   * watchers. `false`/absent = token-only (non-serving) construction: storage
   * directories, auth token, and metadata load only — no channels, no display
   * state, no onboarding (specs/arch/onboarding/installer.md#^token-only-boot).
   */
  installOnboardingChannels?: boolean;
}

export class ServerStore extends EventTarget<StoreDomainEvent> {
  readonly storagePath: string;
  readonly authToken: string;
  readonly dataDirCreated: boolean;
  private readonly channels = new Map<string, Channel>();
  private focusedChannelId: string | null = null;
  private pinnedChannelIds: string[] = [];
  private activeThemeName: string | null = null;
  private appearanceMode: AppearanceMode = "system";
  private themeJavaScriptConsentIds: string[] = [];
  private themeRegistry: ThemeRegistrySnapshot = { themes: [], errors: [] };
  private displayStateReady = false;
  private readonly _artifacts = new Map<string, Artifact>();
  private readonly artifactChannels = new Map<string, string>();
  private readonly contentWatchers = new Map<string, ContentWatcher>();
  private readonly contentWatchDebounceTimers = new Map<string, NodeJS.Timeout>();
  private themeWatcher: ContentWatcher | null = null;
  private themeWatcherFor: string | null = null;
  private themeWatchDebounceTimer: NodeJS.Timeout | null = null;
  private readonly watchContentFile: WatchContentFile;
  private readonly bundledViewsPath: string | undefined;
  private readonly onboardingContentPath: string | undefined;
  private readonly bundledThemesPath: string | undefined;
  private readonly serving: boolean;
  // True only while the constructor's install phase runs: content watchers
  // must not start before the final bootstrap step
  // (specs/arch/onboarding/installer.md#^bootstrap-sequence step 8).
  private inBootstrapInstall = false;
  private telemetryHooks: ServerStoreTelemetryHooks | null = null;

  // The serving bootstrap sequence and the token-only cutoff are spec'd:
  // specs/arch/onboarding/installer.md#^bootstrap-sequence, #^token-only-boot.
  constructor(options: ServerStoreOptions) {
    super();
    // Resolve once: every derived path — artifact copy destinations (which
    // the store's own absolute-path rule would reject), persisted artifact
    // metadata, watchers, state files — must not depend on the process cwd.
    this.storagePath = path.resolve(options.storagePath);
    this.serving = options.installOnboardingChannels === true;
    // Captured before migration or ordinary bootstrap creates the current
    // structure; populated legacy metadata still counts as prior serving.
    this.dataDirCreated = !hasExistingTelevisionDataStructure(this.storagePath);
    this.watchContentFile = options.watchContentFile ?? defaultWatchContentFile;
    this.bundledViewsPath = options.bundledViewsPath;
    this.onboardingContentPath = options.onboardingContentPath;
    this.bundledThemesPath = options.bundledThemesPath === undefined
      ? undefined
      : path.resolve(options.bundledThemesPath);
    if (this.serving) {
      runRedesignStorageMigration(this.storagePath);
    }
    this.ensureDirectories();
    this.authToken = this.loadOrCreateAuthToken();
    this.load();
    this.rebuildArtifactChannels();
    if (!this.serving) {
      // Token-only construction: no channels, no display state, no onboarding
      // install, no watchers. Default-channel setup belongs exclusively to the
      // serving-boot invariant below.
      return;
    }
    // Snapshot the no-content condition before the install loop; it gates the
    // focus rule (specs/arch/onboarding/installer.md#^onboarding-focus-rule).
    const noContentAtBoot =
      this._artifacts.size === 0 &&
      [...this.channels.values()].every((channel) => channel.layout.length === 0);
    this.inBootstrapInstall = true;
    const onboarding = runOnboardingBootstrap(
      {
        storagePath: this.storagePath,
        listChannels: () => this.listChannels(),
        hasArtifact: (id) => this._artifacts.has(id),
        createChannel: (input) => this.createChannel(input),
        createArtifact: (input) => this.createArtifact(input),
        setChannelLayout: (channelID, layout) => this.setChannelLayoutForInstall(channelID, layout),
      },
      this.onboardingContentPath,
    );
    this.inBootstrapInstall = false;
    // Serving boot: the default-channel invariant is the only code path that
    // creates "Default", and it never runs on a boot where the install loop
    // created channels (specs/arch/onboarding/installer.md#^default-screen).
    if (this.channels.size === 0) {
      this.createChannel({ name: "Default" });
    }
    const bundledThemeState = runBundledThemeInstallation(
      this.storagePath,
      this.bundledThemesPath,
    );
    this.refreshThemeRegistry();
    if (!this.loadDisplayState()) {
      this.initializeDisplayState();
    }
    this.completeDefaultThemeSelection(bundledThemeState);
    this.displayStateReady = true;
    this.clearUnregisteredActiveTheme();
    if (noContentAtBoot && onboarding.focusChannelID !== undefined && this.channels.has(onboarding.focusChannelID)) {
      this.patchDisplay({ focusedChannelId: onboarding.focusChannelID });
    }
    // Watchers start last (specs/arch/onboarding/installer.md#^bootstrap-sequence
    // step 8). Restarting an installer-created artifact's watcher is idempotent.
    for (const artifact of this._artifacts.values()) {
      this.startWatchingArtifactContent(artifact);
    }
    this.startWatchingActiveTheme();
  }

  setTelemetryHooks(hooks: ServerStoreTelemetryHooks | null): void {
    this.telemetryHooks = hooks;
  }

  getViews(): readonly [] {
    return [];
  }

  getViewPath(id: string): string | null {
    if (!isBundledViewID(id) || this.bundledViewsPath === undefined) {
      return null;
    }
    const viewPath = path.join(this.bundledViewsPath, id);
    return existsSync(path.join(viewPath, "index.html")) ? viewPath : null;
  }

  getChannel(id: string): { channel: Channel; artifacts: Artifact[] } | undefined {
    const channel = this.channels.get(id);
    if (!channel) {
      return undefined;
    }

    return {
      channel: channel,
      artifacts: getChannelArtifactIDs(channel)
        .map((artifactID) => this._artifacts.get(artifactID))
        .filter((artifact): artifact is Artifact => artifact !== undefined),
    };
  }

  getArtifact(id: string): Artifact | undefined {
    return this._artifacts.get(id);
  }


  listChannels(): Channel[] {
    return [...this.channels.values()];
  }

  listArtifacts(): Artifact[] {
    return [...this._artifacts.values()];
  }

  /** Create a new artifact and append its default page to the owning channel. */
  createArtifact(input: {
    id?: string;
    kind: ArtifactKind;
    title: string;
    channelID: string;
    path?: string;
    url?: string;
  }, telemetryContext?: TelemetryClientContext | null): Artifact {
    const channel = this.requireChannel(input.channelID);
    const artifact = this.createKindArtifact(input);
    const previousLayout = channel.layout;

    this.writeArtifact(artifact);
    channel.layout = [
      ...channel.layout,
      {
        artifactIds: [artifact.id],
        geometry: { ...DEFAULT_PAGE_GEOMETRY },
        size: { ...DEFAULT_PAGE_SIZE },
      },
    ];
    try {
      this.persistChannel(channel);
    } catch (error) {
      channel.layout = previousLayout;
      rmSync(getArtifactLiveMetadataPath(this.storagePath, artifact.id), { force: true });
      throw error;
    }

    this._artifacts.set(artifact.id, artifact);
    this.artifactChannels.set(artifact.id, channel.id);
    this.startWatchingArtifactContent(artifact);
    this.dispatchEvent(new ArtifactCreatedEvent("artifact-created", { channelID: channel.id, artifact }));
    this.emitTelemetry((hooks) => hooks.artifactCreated(artifact, telemetryContext));

    return artifact;
  }

  updateArtifact(input: { artifactID: string; fields: { title?: string; path?: string; url?: string } }, telemetryContext?: TelemetryClientContext | null): Artifact {
    const artifact = this._artifacts.get(input.artifactID);
    if (!artifact) {
      throw new NotFoundError(`Artifact not found: ${input.artifactID}`, { entityType: "artifact", entityID: input.artifactID });
    }

    let updated: Artifact = artifact;
    let pointerChanged = false;

    if (typeof input.fields.title === "string") {
      updated = { ...updated, title: input.fields.title } as Artifact;
    }

    if (input.fields.path !== undefined) {
      if (artifact.kind !== "path") {
        throw new InvalidRequestError("url artifacts cannot set path");
      }
      if (input.fields.url !== undefined) {
        throw new InvalidRequestError("artifact patch cannot set both path and url");
      }
      const artifactPath = this.normalizeArtifactPath(input.fields.path.trim());
      pointerChanged = artifactPath !== artifact.path;
      updated = { ...updated, path: artifactPath } as Artifact;
    }

    if (input.fields.url !== undefined) {
      if (artifact.kind !== "url") {
        throw new InvalidRequestError("path artifacts cannot set url");
      }
      const url = input.fields.url.trim();
      if (!isExternalArtifactURL(url)) {
        throw new InvalidRequestError(`url must be an absolute http(s) URL: ${url}`);
      }
      pointerChanged = url !== artifact.url;
      updated = { ...updated, url } as Artifact;
    }

    if (updated === artifact) return artifact;
    const metadataChanged = !hasSameArtifactMetadata(updated, artifact);

    this.writeArtifact(updated);
    this._artifacts.set(input.artifactID, updated);
    if (pointerChanged) {
      this.startWatchingArtifactContent(updated);
      const watcher = this.contentWatchers.get(updated.id);
      if (watcher) {
        this.scheduleArtifactContentChangedEvent(updated.id, watcher);
      }
    }
    this.dispatchEvent(new ArtifactUpdatedEvent("artifact-updated", { artifact: updated }));
    if (metadataChanged) {
      this.emitTelemetry((hooks) => hooks.artifactUpdated(updated, telemetryContext));
    }
    return updated;
  }

  /**
   * Delete an artifact: remove it from its owning page, then delete
   * the metadata record. The pointed-to path or URL is never removed.
   *
   * Throws `NotFoundError` when the artifact does not exist.
   */
  deleteArtifact(artifactID: string, telemetryContext?: TelemetryClientContext | null): ArtifactRemovalResult {
    return this.deleteArtifactWithCause(artifactID, "direct", telemetryContext);
  }

  private deleteArtifactWithCause(
    artifactID: string,
    deletionCause: ArtifactDeletionCause,
    telemetryContext?: TelemetryClientContext | null,
  ): ArtifactRemovalResult {
    const artifact = this._artifacts.get(artifactID);
    if (!artifact) {
      throw new NotFoundError(`Artifact not found: ${artifactID}`, { entityType: "artifact", entityID: artifactID });
    }

    const channelID = this.artifactChannels.get(artifactID);
    if (channelID !== undefined) {
      const channel = this.requireChannel(channelID);
      const previousLayout = channel.layout;
      channel.layout = removeArtifactFromPages(channel.layout, artifactID);
      try {
        this.persistChannel(channel);
      } catch (error) {
        channel.layout = previousLayout;
        throw error;
      }
      this.artifactChannels.delete(artifactID);
    }

    this.stopWatchingArtifactContent(artifactID);
    this._artifacts.delete(artifactID);
    rmSync(getArtifactLiveMetadataPath(this.storagePath, artifactID), { force: true });

    if (channelID !== undefined) {
      this.dispatchEvent(new ArtifactRemovedEvent("artifact-removed", { artifactID, channelID: channelID }));
    }
    this.emitTelemetry((hooks) =>
      hooks.artifactDeleted(artifact, deletionCause, telemetryContext)
    );

    return artifact.kind === "path"
      ? { outcome: "deleted", kind: "path", artifactID, path: artifact.path }
      : { outcome: "deleted", kind: "url", artifactID, url: artifact.url };
  }

  // `onboarding` is installer-only: routes never forward the field from
  // public request bodies (specs/arch/onboarding/installer.md#^marker-api-readonly).
  createChannel(input: { name: string; id?: string; onboarding?: OnboardingChannelMarker }, telemetryContext?: TelemetryClientContext | null): Channel {
    const shouldEstablishFocus = this.displayStateReady && this.focusedChannelId === null;
    const channel: Channel = {
      id: input.id ?? ulid(),
      name: input.name,
      layout: [],
      ...(input.onboarding ? { onboarding: input.onboarding } : {}),
    };
    this.channels.set(channel.id, channel);
    this.persistChannel(channel);
    if (shouldEstablishFocus) {
      this.persistDisplayState({
        focusedChannelId: channel.id,
        pinnedChannelIds: this.pinnedChannelIds,
        activeThemeName: this.activeThemeName,
        appearanceMode: this.appearanceMode,
        themeJavaScriptConsentIds: [...this.themeJavaScriptConsentIds],
      });
      this.focusedChannelId = channel.id;
    }
    this.dispatchEvent(new ChannelCreatedEvent("channel-created", { channel: channel }));
    if (shouldEstablishFocus) {
      this.dispatchEvent(new ChannelChangedEvent("channel-changed", { channelID: channel.id }));
    }
    this.emitTelemetry((hooks) => hooks.channelCreated(channel, telemetryContext));
    return channel;
  }

  updateChannel(input: { channelID: string; fields: ChannelPatch }, telemetryContext?: TelemetryClientContext | null): Channel {
    const channel = this.requireChannel(input.channelID);
    const previousName = channel.name;
    const nextName = input.fields.name ?? previousName;

    if (Array.isArray(input.fields.layout)) {
      const nextLayout = input.fields.layout.map((page) => structuredClone(page));
      const validation = validatePageLayout(nextLayout);
      if (!validation.valid) {
        throw new InvalidRequestError(validation.errors.join("; "));
      }
      assertPreservesPageMembership(channel.layout, nextLayout, input.channelID);
      const previousLayout = channel.layout;
      channel.name = nextName;
      channel.layout = nextLayout;
      try {
        this.persistChannel(channel);
      } catch (error) {
        channel.name = previousName;
        channel.layout = previousLayout;
        throw error;
      }
      this.rebuildArtifactChannelsForChannel(channel);
      this.dispatchEvent(new ChannelUpdatedEvent("channel-updated", { channel: channel }));
      if (nextName !== previousName) {
        this.emitTelemetry((hooks) => hooks.channelUpdated(channel, telemetryContext));
      }
      this.emitTelemetry((hooks) =>
        hooks.channelLayoutChanged(previousLayout, channel.layout, telemetryContext)
      );
      return channel;
    }

    channel.name = nextName;
    try {
      this.persistChannel(channel);
    } catch (error) {
      channel.name = previousName;
      throw error;
    }
    this.dispatchEvent(new ChannelUpdatedEvent("channel-updated", { channel: channel }));
    if (nextName !== previousName) {
      this.emitTelemetry((hooks) => hooks.channelUpdated(channel, telemetryContext));
    }

    return channel;
  }

  /** The channel that Television's GUI is currently focused on. */
  getFocusedChannelId(): string | null {
    return this.resolveFocusedChannelId(this.focusedChannelId);
  }

  getActiveThemeName(): string | null {
    return this.activeThemeName;
  }

  hasThemeJavaScriptConsent(themeID: string): boolean {
    return this.themeJavaScriptConsentIds.includes(themeID);
  }

  getThemeRegistry(): ThemeRegistrySnapshot {
    return {
      themes: this.themeRegistry.themes.map((theme) => ({ ...theme })),
      errors: this.themeRegistry.errors.map((error) => ({ ...error })),
    };
  }

  refreshThemeRegistry(telemetryContext?: TelemetryClientContext | null): ThemeRegistrySnapshot {
    const selectedThemeID = this.activeThemeName;
    const previousColorScheme = this.getActiveThemeColorScheme();
    const previousJavaScriptDeclarations = selectedThemeID === null
      ? null
      : this.registeredThemeJavaScriptDeclarations(selectedThemeID);
    this.themeRegistry = scanThemesDirectory(getThemesDir(this.storagePath));
    if (this.displayStateReady) {
      this.clearUnregisteredActiveTheme(telemetryContext);
      if (
        selectedThemeID !== null &&
        this.activeThemeName === selectedThemeID &&
        previousJavaScriptDeclarations !== null &&
        (
          previousColorScheme !== this.getActiveThemeColorScheme() ||
          !sameThemeJavaScriptDeclarations(
            previousJavaScriptDeclarations,
            this.registeredThemeJavaScriptDeclarations(selectedThemeID),
          )
        )
      ) {
        this.dispatchThemeChanged(selectedThemeID);
      }
    }
    return this.getThemeRegistry();
  }

  getDisplayState(): {
    focusedChannelId: string | null;
    pinnedChannelIds: string[];
    activeThemeName: string | null;
    activeThemeColorScheme: ThemeColorScheme | null;
    appearanceMode: AppearanceMode;
    themeJavaScriptConsentIds: string[];
  } {
    return {
      focusedChannelId: this.getFocusedChannelId(),
      pinnedChannelIds: [...this.pinnedChannelIds],
      activeThemeName: this.activeThemeName,
      activeThemeColorScheme: this.getActiveThemeColorScheme(),
      appearanceMode: this.appearanceMode,
      themeJavaScriptConsentIds: [...this.themeJavaScriptConsentIds],
    };
  }

  patchDisplay(input: DisplayPatch, telemetryContext?: TelemetryClientContext | null): void {
    this.applyDisplayPatch(input, "selection", telemetryContext);
  }

  private applyDisplayPatch(
    input: DisplayPatch,
    themeChangeReason: ThemeChangeReason,
    telemetryContext?: TelemetryClientContext | null,
  ): void {
    const currentFocusedChannelId = this.getFocusedChannelId();
    const previousPinnedChannelIds = this.pinnedChannelIds;
    let nextFocusedChannelId = this.focusedChannelId;
    let nextPinnedChannelIds = this.pinnedChannelIds;
    let nextActiveThemeName = this.activeThemeName;
    let nextAppearanceMode = this.appearanceMode;
    let nextThemeJavaScriptConsentIds = this.themeJavaScriptConsentIds;

    if (input.focusedChannelId !== undefined) {
      if (input.focusedChannelId === null) {
        if (this.channels.size !== 0) {
          throw new InvalidRequestError("focusedChannelId cannot be null while channels exist");
        }
        nextFocusedChannelId = null;
      } else {
        nextFocusedChannelId = this.requireChannel(input.focusedChannelId).id;
      }
    }

    if (input.pinnedChannelIds !== undefined) {
      if (new Set(input.pinnedChannelIds).size !== input.pinnedChannelIds.length) {
        throw new InvalidRequestError("pinnedChannelIds must not contain duplicate channel ids");
      }
      for (const channelId of input.pinnedChannelIds) {
        this.requireChannel(channelId);
      }
      nextPinnedChannelIds = [...input.pinnedChannelIds];
    }

    if (input.activeThemeName !== undefined) {
      if (input.activeThemeName !== null && !this.isThemeRegistered(input.activeThemeName)) {
        throw new NotFoundError(`Theme not found: ${input.activeThemeName}`, {
          entityType: "theme",
          entityID: input.activeThemeName,
        });
      }
      nextActiveThemeName = input.activeThemeName;
    }

    if (input.appearanceMode !== undefined) {
      if (!isAppearanceMode(input.appearanceMode)) {
        throw new InvalidRequestError(`Invalid appearance mode: ${String(input.appearanceMode)}`);
      }
      nextAppearanceMode = input.appearanceMode;
    }

    if (input.themeJavaScriptConsentIds !== undefined) {
      if (
        input.themeJavaScriptConsentIds.some((id) => typeof id !== "string" || id.length === 0) ||
        new Set(input.themeJavaScriptConsentIds).size !== input.themeJavaScriptConsentIds.length
      ) {
        throw new InvalidRequestError(
          "themeJavaScriptConsentIds must contain unique non-empty theme ids",
        );
      }
      nextThemeJavaScriptConsentIds = [...input.themeJavaScriptConsentIds];
    }

    const focusedChannelChanged = nextFocusedChannelId !== this.focusedChannelId;
    const pinnedChannelsChanged = !sameIds(nextPinnedChannelIds, this.pinnedChannelIds);
    const themeChanged = nextActiveThemeName !== this.activeThemeName;
    const appearanceChanged = nextAppearanceMode !== this.appearanceMode;
    const themeJavaScriptConsentChanged = !sameIdMembership(
      nextThemeJavaScriptConsentIds,
      this.themeJavaScriptConsentIds,
    );
    if (
      !focusedChannelChanged &&
      !pinnedChannelsChanged &&
      !themeChanged &&
      !appearanceChanged &&
      !themeJavaScriptConsentChanged
    ) {
      return;
    }

    this.persistDisplayState({
      focusedChannelId: this.resolveFocusedChannelId(nextFocusedChannelId),
      pinnedChannelIds: nextPinnedChannelIds,
      activeThemeName: nextActiveThemeName,
      appearanceMode: nextAppearanceMode,
      themeJavaScriptConsentIds: nextThemeJavaScriptConsentIds,
    });
    this.focusedChannelId = nextFocusedChannelId;
    this.pinnedChannelIds = nextPinnedChannelIds;
    this.activeThemeName = nextActiveThemeName;
    this.appearanceMode = nextAppearanceMode;
    this.themeJavaScriptConsentIds = nextThemeJavaScriptConsentIds;
    if (themeChanged) {
      this.startWatchingActiveTheme();
    }

    const nextFocusedResolved = this.getFocusedChannelId();
    if (currentFocusedChannelId !== nextFocusedResolved) {
      this.dispatchEvent(
        new ChannelChangedEvent("channel-changed", { channelID: nextFocusedResolved }),
      );
    }
    if (pinnedChannelsChanged) {
      this.dispatchEvent(
        new PinnedChannelsChangedEvent("pinned-channels-changed", {
          pinnedChannelIds: [...this.pinnedChannelIds],
        }),
      );
      this.emitTelemetry((hooks) =>
        hooks.channelPinsChanged(
          previousPinnedChannelIds,
          this.pinnedChannelIds,
          telemetryContext,
        )
      );
    }
    if (themeChanged || themeJavaScriptConsentChanged) {
      this.dispatchThemeChanged();
    }
    if (themeChanged) {
      this.emitTelemetry((hooks) => hooks.themeChanged(themeChangeReason, telemetryContext));
    }
    if (appearanceChanged) {
      this.emitTelemetry((hooks) => hooks.appearanceModeChanged(this.appearanceMode, telemetryContext));
      this.dispatchEvent(
        new AppearanceChangedEvent("appearance-changed", {
          appearanceMode: this.appearanceMode,
        }),
      );
    }
  }

  /**
   * Resolve the owning channel for `artifactID`, flip the active channel if
   * necessary, then broadcast an `artifact-focus` event for clients to
   * scroll-and-highlight.
   */
  focus(input: { artifactID: string }): { channelID: string; artifactID: string } {
    const artifact = this._artifacts.get(input.artifactID);
    if (!artifact) {
      throw new NotFoundError(`Artifact not found: ${input.artifactID}`, {
        entityType: "artifact",
        entityID: input.artifactID,
      });
    }

    const target = this.artifactChannels.get(input.artifactID);
    if (target === undefined) {
      throw new ConflictError(
        `Artifact ${input.artifactID} is not attached to any channel; cannot focus`,
      );
    }

    if (this.focusedChannelId !== target) {
      this.patchDisplay({ focusedChannelId: target });
    }
    this.dispatchEvent(
      new ArtifactFocusEvent("artifact-focus", { channelID: target, artifactID: input.artifactID }),
    );
    return { channelID: target, artifactID: input.artifactID };
  }

  removeChannel(channelID: string, telemetryContext?: TelemetryClientContext | null): ChannelRemovalResult {
    const channel = this.requireChannel(channelID);
    const previousFocusedChannelId = this.getFocusedChannelId();
    const nextPinnedChannelIds = this.pinnedChannelIds.filter((id) => id !== channel.id);
    const artifactIDs = [...new Set(getChannelArtifactIDs(channel))];
    const artifactResults = artifactIDs.map((artifactID) =>
      this.deleteArtifactWithCause(artifactID, "channel_deleted", telemetryContext)
    );
    const metadataPath = path.join(this.channelsDir, `${channel.id}.json`);
    rmSync(metadataPath, { force: true });
    this.channels.delete(channel.id);

    const nextFocusedChannelId = previousFocusedChannelId === channel.id
      ? this.pickDeletionSuccessorChannelID(nextPinnedChannelIds)
      : previousFocusedChannelId;
    const pinnedChannelsChanged = !sameIds(nextPinnedChannelIds, this.pinnedChannelIds);
    const focusedChannelChanged = nextFocusedChannelId !== previousFocusedChannelId;
    if (pinnedChannelsChanged || focusedChannelChanged) {
      this.persistDisplayState({
        focusedChannelId: nextFocusedChannelId,
        pinnedChannelIds: nextPinnedChannelIds,
        activeThemeName: this.activeThemeName,
        appearanceMode: this.appearanceMode,
        themeJavaScriptConsentIds: [...this.themeJavaScriptConsentIds],
      });
      this.pinnedChannelIds = nextPinnedChannelIds;
      this.focusedChannelId = nextFocusedChannelId;
    }

    this.dispatchEvent(new ChannelRemovedEvent("channel-removed", { channelID: channelID }));
    if (pinnedChannelsChanged) {
      this.dispatchEvent(
        new PinnedChannelsChangedEvent("pinned-channels-changed", {
          pinnedChannelIds: [...this.pinnedChannelIds],
        }),
      );
    }
    if (focusedChannelChanged) {
      this.dispatchEvent(
        new ChannelChangedEvent("channel-changed", { channelID: nextFocusedChannelId }),
      );
    }
    this.emitTelemetry((hooks) => hooks.channelDeleted(channel, telemetryContext));
    return { channelID: channelID, metadataPath, artifactResults };
  }

  dispose(): void {
    this.stopAllContentWatchers();
    this.stopWatchingActiveTheme();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  private emitTelemetry(callback: (hooks: ServerStoreTelemetryHooks) => void): void {
    if (!this.telemetryHooks) return;
    try {
      callback(this.telemetryHooks);
    } catch {
      // Telemetry hooks must never affect durable store mutations.
    }
  }

  private load(): void {
    if (existsSync(this.channelsDir)) {
      for (const file of readdirSync(this.channelsDir)) {
        if (!file.endsWith(JSON_FILE_SUFFIX)) continue;
        const filePath = path.join(this.channelsDir, file);
        let raw: Record<string, unknown>;
        try {
          raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
        } catch (error) {
          console.warn(`Skipping malformed JSON file: ${filePath}`, error);
          continue;
        }

        if (
          typeof raw.id !== "string" ||
          typeof raw.name !== "string" ||
          raw.layoutVersion !== LAYOUT_VERSION ||
          !validatePageLayout(raw.layout).valid
        ) {
          console.warn(`Skipping malformed channel file: ${filePath}`);
          continue;
        }

        // The onboarding marker must survive the field-by-field rebuild here:
        // dropping it on restart would break installer crash-retry reuse
        // (specs/arch/onboarding/installer.md, Onboarding channel marker).
        const onboarding = parseOnboardingMarker(raw.onboarding);
        this.channels.set(raw.id, {
          id: raw.id,
          name: raw.name,
          layout: structuredClone(raw.layout as TabPage[]),
          ...(onboarding ? { onboarding } : {}),
        });
      }
    }

    if (!existsSync(this.artifactsDir)) {
      return;
    }

    for (const file of readdirSync(this.artifactsDir)) {
      if (!file.endsWith(JSON_FILE_SUFFIX)) {
        continue;
      }
      const id = file.slice(0, -JSON_FILE_SUFFIX.length);
      const metadataPath = path.join(this.artifactsDir, file);
      const metadata = this.readArtifactFile(metadataPath, id);
      this._artifacts.set(id, metadata);
      // Content watchers start at the end of the serving bootstrap, never
      // during load (specs/arch/onboarding/installer.md#^bootstrap-sequence).
    }
  }

  private startWatchingArtifactContent(artifact: Artifact): void {
    if (this.inBootstrapInstall) {
      // Installer-created artifacts get their watcher from the constructor's
      // final watcher pass, exactly once, after display state and focus.
      return;
    }
    this.stopWatchingArtifactContent(artifact.id);

    const target = artifactWatchTarget(artifact);
    if (target === null) {
      return;
    }

    let watcher: ContentWatcher | undefined;
    let watcherOwned = false;
    let pendingChange = false;
    const scheduleChange = (): void => {
      if (!watcher || !watcherOwned) {
        pendingChange = true;
        return;
      }
      this.scheduleArtifactContentChangedEvent(artifact.id, watcher);
    };

    try {
      watcher = this.watchContentFile(target.watchPath, scheduleChange, {
        recursive: target.recursive,
        onWatcherDead: scheduleChange,
        onWatcherRearmed: scheduleChange,
      });
      watcher.on("error", (error) => {
        if (this.contentWatchers.get(artifact.id) !== watcher) {
          return;
        }
        console.warn(
          `Watcher error for artifact ${artifact.id}: ${target.watchPath}`,
          error,
        );
        this.stopWatchingArtifactContent(artifact.id);
      });
      this.contentWatchers.set(artifact.id, watcher);
      watcherOwned = true;
      if (pendingChange) {
        pendingChange = false;
        scheduleChange();
      }
    } catch (error) {
      console.warn(
        `Failed to watch artifact content path for ${artifact.id}: ${target.watchPath}`,
        error,
      );
    }
  }

  private stopWatchingArtifactContent(artifactID: string): void {
    const watcher = this.contentWatchers.get(artifactID);
    if (watcher) {
      watcher.close();
      this.contentWatchers.delete(artifactID);
    }

    const timer = this.contentWatchDebounceTimers.get(artifactID);
    if (timer) {
      clearTimeout(timer);
      this.contentWatchDebounceTimers.delete(artifactID);
    }
  }

  private stopAllContentWatchers(): void {
    for (const artifactID of this.contentWatchers.keys()) {
      this.stopWatchingArtifactContent(artifactID);
    }
  }

  private startWatchingActiveTheme(): void {
    this.stopWatchingActiveTheme();

    if (this.activeThemeName === null || !this.isThemeRegistered(this.activeThemeName)) {
      return;
    }

    const themeName = this.activeThemeName;
    const themePath = getThemeDir(this.storagePath, themeName);
    let watcher: ContentWatcher | undefined;
    let watcherOwned = false;
    let pendingChange = false;
    const scheduleChange = (): void => {
      if (!watcher || !watcherOwned) {
        pendingChange = true;
        return;
      }
      this.scheduleThemeChangedEvent(themeName, watcher);
    };

    try {
      watcher = this.watchContentFile(themePath, scheduleChange, {
        recursive: true,
        onWatcherDead: scheduleChange,
        onWatcherRearmed: scheduleChange,
      });
      watcher.on("error", (error) => {
        if (this.themeWatcher !== watcher) {
          return;
        }
        console.warn(
          `Watcher error for active theme ${themeName}: ${themePath}`,
          error,
        );
        this.stopWatchingActiveTheme();
      });
      this.themeWatcher = watcher;
      this.themeWatcherFor = themeName;
      watcherOwned = true;
      if (pendingChange) {
        pendingChange = false;
        scheduleChange();
      }
    } catch (error) {
      console.warn(
        `Failed to watch active theme path for ${themeName}: ${themePath}`,
        error,
      );
    }
  }

  private stopWatchingActiveTheme(): void {
    this.themeWatcher?.close();
    this.themeWatcher = null;
    this.themeWatcherFor = null;

    if (this.themeWatchDebounceTimer) {
      clearTimeout(this.themeWatchDebounceTimer);
      this.themeWatchDebounceTimer = null;
    }
  }

  private scheduleThemeChangedEvent(themeName: string, sourceWatcher: ContentWatcher): void {
    if (
      this.themeWatcher !== sourceWatcher ||
      this.themeWatcherFor !== themeName ||
      this.activeThemeName !== themeName
    ) {
      return;
    }

    if (this.themeWatchDebounceTimer) {
      clearTimeout(this.themeWatchDebounceTimer);
    }

    const timer = setTimeout(() => {
      if (this.themeWatchDebounceTimer !== timer) {
        return;
      }
      this.themeWatchDebounceTimer = null;
      if (
        this.themeWatcher !== sourceWatcher ||
        this.themeWatcherFor !== themeName ||
        this.activeThemeName !== themeName
      ) {
        return;
      }
      this.dispatchThemeChanged(themeName);
    }, CONTENT_WATCH_DEBOUNCE_MS);
    this.themeWatchDebounceTimer = timer;
  }

  private scheduleArtifactContentChangedEvent(
    artifactID: string,
    sourceWatcher: ContentWatcher,
  ): void {
    if (
      this.contentWatchers.get(artifactID) !== sourceWatcher ||
      !this._artifacts.has(artifactID)
    ) {
      return;
    }

    const existingTimer = this.contentWatchDebounceTimers.get(artifactID);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      if (this.contentWatchDebounceTimers.get(artifactID) !== timer) {
        return;
      }
      this.contentWatchDebounceTimers.delete(artifactID);
      if (
        this.contentWatchers.get(artifactID) !== sourceWatcher ||
        !this._artifacts.has(artifactID)
      ) {
        return;
      }
      this.dispatchEvent(
        new ArtifactContentChangedEvent("artifact-content-changed", { artifactID }),
      );
    }, CONTENT_WATCH_DEBOUNCE_MS);

    this.contentWatchDebounceTimers.set(artifactID, timer);
  }

  private requireChannel(channelID: string): Channel {
    const channel = this.channels.get(channelID);
    if (!channel) {
      throw new NotFoundError(`Channel not found: ${channelID}`, { entityType: "channel", entityID: channelID });
    }
    return channel;
  }

  private createKindArtifact(input: {
    id?: string;
    kind: ArtifactKind;
    title: string;
    path?: string;
    url?: string;
  }): Artifact {
    switch (input.kind) {
      case "path": {
        if (input.path === undefined) {
          throw new InvalidRequestError("path artifacts require path");
        }
        if (input.url !== undefined) {
          throw new InvalidRequestError("path artifacts cannot set url");
        }
        const artifactPath = this.normalizeArtifactPath(input.path.trim());
        return createArtifact({ ...(input.id ? { id: input.id } : {}), kind: "path", title: input.title, path: artifactPath });
      }
      case "url": {
        if (input.url === undefined) {
          throw new InvalidRequestError("url artifacts require url");
        }
        if (input.path !== undefined) {
          throw new InvalidRequestError("url artifacts cannot set path");
        }
        const url = input.url.trim();
        if (!isExternalArtifactURL(url)) {
          throw new InvalidRequestError(`url must be an absolute http(s) URL: ${url}`);
        }
        return createArtifact({ ...(input.id ? { id: input.id } : {}), kind: "url", title: input.title, url });
      }
    }
  }

  /**
   * Classify the supplied path by what is on disk and return the canonical
   * form to persist: directory paths always end with a trailing separator,
   * file paths never do. Callers may supply either form; the trailing
   * separator on the stored string is a server-maintained invariant that
   * routing (proxy, watcher, markdown gating, client dispatch) relies on
   * without statting.
   */
  private normalizeArtifactPath(artifactPath: string): string {
    if (!path.isAbsolute(artifactPath)) {
      throw new InvalidRequestError("path must be absolute");
    }

    const stripped = stripTrailingSeparators(artifactPath);

    let stat;
    try {
      accessSync(stripped, constants.R_OK);
      stat = statSync(stripped);
    } catch {
      throw new InvalidRequestError(`path does not exist or is not readable: ${artifactPath}`);
    }

    if (stat.isDirectory()) {
      const canonical = hasTrailingSeparator(stripped) ? stripped : `${stripped}${path.sep}`;
      if (!DIRECTORY_INDEX_BASENAMES.some((basename) => existsSync(path.join(canonical, basename)))) {
        throw new InvalidRequestError(`directory artifact must contain index.html or index.htm: ${canonical}`);
      }
      return canonical;
    }

    if (!stat.isFile()) {
      throw new InvalidRequestError(`path must resolve to a regular file or directory: ${artifactPath}`);
    }
    if (!isAllowedArtifactFilePath(stripped)) {
      throw new InvalidRequestError(`path extension must be one of .md, .markdown, .htm, .html: ${stripped}`);
    }
    return stripped;
  }

  /** Installer-only whole-page write for retry-safe onboarding installation. */
  private setChannelLayoutForInstall(channelID: string, layout: TabPage[]): void {
    const validation = validatePageLayout(layout);
    if (!validation.valid) {
      throw new InvalidRequestError(validation.errors.join("; "));
    }
    const channel = this.requireChannel(channelID);
    channel.layout = structuredClone(layout);
    this.persistChannel(channel);
    this.rebuildArtifactChannelsForChannel(channel);
  }

  private initializeDisplayState(): void {
    this.focusedChannelId = this.pickPreferredChannelID();
    this.pinnedChannelIds = [];
    this.activeThemeName = null;
    this.appearanceMode = "system";
    this.themeJavaScriptConsentIds = [];
    this.persistDisplayState();
  }

  private completeDefaultThemeSelection(state: BundledThemeState | null): void {
    if (
      state === null ||
      state.initialThemeSelectionComplete ||
      !state.installedThemeIDs.includes(DEFAULT_BUNDLED_THEME_ID)
    ) {
      return;
    }

    if (
      this.activeThemeName === null &&
      this.isThemeRegistered(DEFAULT_BUNDLED_THEME_ID)
    ) {
      this.persistDisplayState({
        ...this.getDisplayState(),
        activeThemeName: DEFAULT_BUNDLED_THEME_ID,
      });
      this.activeThemeName = DEFAULT_BUNDLED_THEME_ID;
    }

    writeBundledThemeStateFile(this.storagePath, {
      version: BUNDLED_THEME_STATE_VERSION,
      installedThemeIDs: state.installedThemeIDs,
      initialThemeSelectionComplete: true,
    });
  }

  private dispatchThemeChanged(themeName = this.activeThemeName): void {
    this.dispatchEvent(new ThemeChangedEvent("theme-changed", {
      themeName,
      activeThemeColorScheme: this.getActiveThemeColorScheme(themeName),
      themeJavaScriptConsentIds: [...this.themeJavaScriptConsentIds],
    }));
  }

  private getActiveThemeColorScheme(
    themeName = this.activeThemeName,
  ): ThemeColorScheme | null {
    if (themeName === null) return null;
    return this.themeRegistry.themes.find((theme) => theme.id === themeName)
      ?.colorScheme ?? null;
  }

  private isThemeRegistered(themeID: string): boolean {
    return this.themeRegistry.themes.some((theme) => theme.id === themeID);
  }

  private registeredThemeJavaScriptDeclarations(
    themeID: string,
  ): ThemeJavaScriptDeclarationValues {
    const theme = this.themeRegistry.themes.find((candidate) => candidate.id === themeID);
    return [
      theme?.enableMainJS,
      theme?.enableIframeBackgroundJS,
      theme?.enableIframeOverlayJS,
    ];
  }

  private clearUnregisteredActiveTheme(telemetryContext?: TelemetryClientContext | null): void {
    if (this.activeThemeName !== null && !this.isThemeRegistered(this.activeThemeName)) {
      this.applyDisplayPatch({ activeThemeName: null }, "fallback", telemetryContext);
    }
  }

  private ensureDirectories(): void {
    mkdirSync(path.join(this.storagePath, "state"), { recursive: true });
    mkdirSync(this.channelsDir, { recursive: true });
    mkdirSync(this.artifactsDir, { recursive: true });
    mkdirSync(getThemesDir(this.storagePath), { recursive: true });
    mkdirSync(getAgentArtifactsDir(this.storagePath), { recursive: true });
  }

  private rebuildArtifactChannels(): void {
    this.artifactChannels.clear();
    for (const channel of this.channels.values()) {
      this.rebuildArtifactChannelsForChannel(channel);
    }
  }

  private rebuildArtifactChannelsForChannel(channel: Channel): void {
    for (const [artifactID, channelID] of this.artifactChannels) {
      if (channelID === channel.id) {
        this.artifactChannels.delete(artifactID);
      }
    }
    for (const artifactID of getChannelArtifactIDs(channel)) {
      this.artifactChannels.set(artifactID, channel.id);
    }
  }

  private loadDisplayState(): boolean {
    if (!existsSync(this.displayStatePath)) {
      return false;
    }
    let raw: string;
    try {
      raw = readFileSync(this.displayStatePath, "utf8");
    } catch {
      return false;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      "focusedChannelId" in parsed &&
      (typeof (parsed as { focusedChannelId: unknown }).focusedChannelId === "string" ||
        (parsed as { focusedChannelId: unknown }).focusedChannelId === null) &&
      "pinnedChannelIds" in parsed &&
      Array.isArray((parsed as { pinnedChannelIds: unknown }).pinnedChannelIds) &&
      (parsed as { pinnedChannelIds: unknown[] }).pinnedChannelIds.every((id) => typeof id === "string") &&
      "activeThemeName" in parsed &&
      (typeof (parsed as { activeThemeName: unknown }).activeThemeName === "string" ||
        (parsed as { activeThemeName: unknown }).activeThemeName === null) &&
      "appearanceMode" in parsed &&
      isAppearanceMode((parsed as { appearanceMode: unknown }).appearanceMode) &&
      (!("themeJavaScriptConsentIds" in parsed) ||
        isThemeJavaScriptConsentIds(
          (parsed as { themeJavaScriptConsentIds: unknown }).themeJavaScriptConsentIds,
        ))
    ) {
      this.focusedChannelId = (parsed as { focusedChannelId: string | null }).focusedChannelId;
      this.pinnedChannelIds = [...(parsed as { pinnedChannelIds: string[] }).pinnedChannelIds];
      this.activeThemeName = (parsed as { activeThemeName: string | null }).activeThemeName;
      this.appearanceMode = (parsed as { appearanceMode: AppearanceMode }).appearanceMode;
      this.themeJavaScriptConsentIds = "themeJavaScriptConsentIds" in parsed
        ? [...(parsed as { themeJavaScriptConsentIds: string[] }).themeJavaScriptConsentIds]
        : [];
      return true;
    }
    return false;
  }

  private persistDisplayState(
    state: {
      focusedChannelId: string | null;
      pinnedChannelIds: string[];
      activeThemeName: string | null;
      appearanceMode: AppearanceMode;
      themeJavaScriptConsentIds: string[];
    } = {
      focusedChannelId: this.getFocusedChannelId(),
      pinnedChannelIds: [...this.pinnedChannelIds],
      activeThemeName: this.activeThemeName,
      appearanceMode: this.appearanceMode,
      themeJavaScriptConsentIds: [...this.themeJavaScriptConsentIds],
    },
  ): void {
    writeFileSync(
      this.displayStatePath,
      JSON.stringify({
        focusedChannelId: state.focusedChannelId,
        pinnedChannelIds: state.pinnedChannelIds,
        activeThemeName: state.activeThemeName,
        appearanceMode: state.appearanceMode,
        themeJavaScriptConsentIds: state.themeJavaScriptConsentIds,
      }, null, JSON_INDENT_SPACES),
    );
  }

  private get displayStatePath(): string {
    return getDisplayStatePath(this.storagePath);
  }

  private resolveFocusedChannelId(channelId: string | null): string | null {
    if (channelId === null) {
      return null;
    }
    return this.channels.has(channelId) ? channelId : null;
  }

  private pickPreferredChannelID(): string {
    const [firstChannel] = [...this.channels.values()].sort((a, b) => a.id.localeCompare(b.id));
    if (!firstChannel) {
      throw new Error("Cannot initialize display state without a channel");
    }
    return firstChannel.id;
  }

  private pickDeletionSuccessorChannelID(pinnedChannelIds: readonly string[]): string | null {
    for (const channelID of pinnedChannelIds) {
      if (this.channels.has(channelID)) {
        return channelID;
      }
    }

    let newestChannelID: string | null = null;
    for (const channelID of this.channels.keys()) {
      if (newestChannelID === null || channelID.localeCompare(newestChannelID) > 0) {
        newestChannelID = channelID;
      }
    }
    return newestChannelID;
  }

  private loadOrCreateAuthToken(): string {
    if (existsSync(this.tokenPath)) {
      return readFileSync(this.tokenPath, "utf8").trim();
    }

    const token = createToken();
    writeFileSync(this.tokenPath, `${token}\n`);
    return token;
  }

  private persistChannel(channel: Channel): void {
    if (!this.channels.has(channel.id)) {
      throw new Error(`Cannot persist channel ${channel.id}: not in live map`);
    }
    const stored = {
      id: channel.id,
      name: channel.name,
      layoutVersion: LAYOUT_VERSION,
      layout: channel.layout,
      ...(channel.onboarding ? { onboarding: channel.onboarding } : {}),
    };
    writeFileSync(
      path.join(this.channelsDir, `${channel.id}.json`),
      JSON.stringify(stored, null, JSON_INDENT_SPACES),
    );
  }

  private readArtifactFile(filePath: string, expectedID: string): Artifact {
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (error) {
      throw this.invalidMetadataFile(filePath, "unreadable", error);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw this.invalidMetadataFile(filePath, "invalid or unreadable JSON", error);
    }

    const result = ArtifactSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue?.path.join(".") || "artifact metadata";
      throw this.invalidMetadataFile(filePath, `${field} ${issue?.message ?? "is invalid"}`);
    }

    if (result.data.id !== expectedID) {
      throw this.invalidMetadataFile(
        filePath,
        `id ${result.data.id} does not match filename ${expectedID}`,
      );
    }

    if (result.data.kind === "path" && !path.isAbsolute(result.data.path)) {
      throw this.invalidMetadataFile(filePath, "path must be absolute");
    }

    return result.data;
  }

  /** Explain the invalid metadata and recovery without relying on repository docs. */
  private invalidMetadataFile(filePath: string, reason: string, cause?: unknown): Error {
    const message =
      `Invalid artifact metadata file ${filePath}: ${reason}\n` +
      `Correct this metadata file and restart Television, or delete only this metadata file to unregister the artifact; its artifact content will remain untouched.`;
    return cause !== undefined ? new Error(message, { cause }) : new Error(message);
  }

  private writeArtifact(artifact: Artifact): void {
    writeFileSync(getArtifactLiveMetadataPath(this.storagePath, artifact.id), JSON.stringify(artifact, null, JSON_INDENT_SPACES));
  }

  private get channelsDir(): string {
    return getChannelsDir(this.storagePath);
  }

  private get artifactsDir(): string {
    return getArtifactsMetadataDir(this.storagePath);
  }

  private get tokenPath(): string {
    return getTokenPath(this.storagePath);
  }
}

function parseOnboardingMarker(raw: unknown): OnboardingChannelMarker | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).length === 1 && typeof record.slug === "string") {
    return { slug: record.slug };
  }
  return undefined;
}

function assertPreservesPageMembership(
  existing: readonly TabPage[],
  proposed: readonly TabPage[],
  channelID: string,
): void {
  if (!preservesPageMembership(existing, proposed)) {
    throw new ConflictError(
      `Channel ${channelID} layout cannot add, remove, split, merge, or regroup page membership`,
    );
  }
}

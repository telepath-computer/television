// The onboarding installer: migrates the onboarding state file and installs
// bundled onboarding channels exactly once per slug per data directory.
// Spec: specs/arch/onboarding/installer.md.
//
// Runs inside the ServerStore constructor on serving boots, before telemetry
// hooks or event listeners attach — installs are server-generated and emit no
// CRUD telemetry (specs/arch/onboarding/installer.md#^telemetry-silence).
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  type Channel,
  type OnboardingChannelMarker,
  type TabPage,
} from "@telepath-computer/television-shared";
import type { Artifact, ArtifactKind } from "@telepath-computer/television-artifact";
import type { JSONValue } from "@telepath-computer/television-shared/resources";
import { getAgentArtifactsDir } from "./artifact-paths.ts";
import {
  isCalendarDate,
  loadOnboardingConfig,
  onboardingCopyName,
  resolveOnboardingArtifactSource,
  type OnboardingArtifactConfig,
  type OnboardingChannelConfig,
} from "./onboarding-content.ts";
import {
  ONBOARDING_STATE_VERSION,
  readLegacyOnboardingFile,
  readOnboardingStateFile,
  writeOnboardingStateFile,
  type OnboardingStateV2,
  type OnboardingStateV3,
} from "./onboarding-state.ts";
import { ONBOARDING_ARTIFACT_ID } from "./onboarding.ts";

const DAY_MS = 86_400_000;

// The legacy single-artifact payload recorded the welcome artifact that now
// lives under the `tv-guide` slug in the bundle
// (specs/arch/onboarding/installer.md#^migrate-v1).
const MIGRATED_TV_GUIDE_SLUG = "tv-guide";

/** The narrow store surface the installer drives. */
export interface OnboardingInstallTarget {
  storagePath: string;
  listChannels(): Channel[];
  hasArtifact(id: string): boolean;
  createChannel(input: { name: string; onboarding: OnboardingChannelMarker }): Channel;
  /** Creates an artifact with a generated ID. */
  createArtifact(input: {
    kind: ArtifactKind;
    title: string;
    channelID: string;
    path: string;
  }): Artifact;
  /** Replace the channel's pages in configured artifact order. */
  setChannelLayout(channelID: string, layout: TabPage[]): void;
  /** Writes `value` to the artifact's store as a set of the whole value through the resource layer; throws when the write fails. */
  writeStartingValue(artifactID: string, value: JSONValue): void;
}

export interface OnboardingBootstrapResult {
  /**
   * The channel to focus per the focus rule: the config's designated channel,
   * present only when its slug completed installation during this boot
   * (specs/arch/onboarding/installer.md#^onboarding-focus-rule).
   */
  focusChannelID: string | undefined;
}

/**
 * Migration then install loop
 * (specs/arch/onboarding/installer.md#^bootstrap-sequence steps 4).
 * Never throws: onboarding must never prevent a server from starting.
 */
export function runOnboardingBootstrap(
  target: OnboardingInstallTarget,
  contentPath: string | undefined,
): OnboardingBootstrapResult {
  let state: OnboardingStateV3;
  try {
    const migrated = migrateOnboardingState(target);
    if (migrated === undefined) {
      return { focusChannelID: undefined };
    }
    state = migrated;
  } catch (error) {
    console.warn("Onboarding state migration failed; skipping onboarding install for this boot.", error);
    return { focusChannelID: undefined };
  }

  if (contentPath === undefined) {
    return { focusChannelID: undefined };
  }

  const { config, errors } = loadOnboardingConfig(contentPath);
  if (!config) {
    console.warn(
      `Onboarding config at ${contentPath} is unusable; skipping onboarding install for this boot.\n` +
        errors.map((error) => `  - ${error}`).join("\n"),
    );
    return { focusChannelID: undefined };
  }

  // Slugs completed during this boot's loop, mapped to their channels.
  const completed = new Map<string, string>();

  for (const channelConfig of config.channels) {
    if (state.channels[channelConfig.slug] !== undefined) {
      continue;
    }
    try {
      const channelID = installChannel(target, contentPath, channelConfig);
      const nextState: OnboardingStateV3 = {
        version: ONBOARDING_STATE_VERSION,
        channels: {
          ...state.channels,
          [channelConfig.slug]: { installedAt: new Date().toISOString() },
        },
      };
      // Mark-last, persisted after each completed channel
      // (specs/arch/onboarding/installer.md#^per-channel-persistence). The
      // in-memory state advances only after the write succeeds: a failed mark
      // write must leave the slug unmarked everywhere, never riding along on
      // a later channel's successful write.
      writeOnboardingStateFile(target.storagePath, nextState);
      state = nextState;
      completed.set(channelConfig.slug, channelID);
    } catch (error) {
      // Failure containment: the slug stays unmarked and retries next boot;
      // startup continues (specs/arch/onboarding/installer.md#^failure-containment).
      console.warn(
        `Failed to install onboarding channel "${channelConfig.slug}"; it will retry on the next boot.`,
        error,
      );
    }
  }

  return { focusChannelID: completed.get(config.focusChannel) };
}

/**
 * Ensure `state/onboarding.json` exists when there is prior install evidence,
 * per the migration cases (specs/arch/onboarding/installer.md#Migration).
 * Returns the current state, or undefined when installation is disabled for
 * this boot (invalid state evidence —
 * specs/arch/onboarding/installer.md#^invalid-state-conservative).
 */
function migrateOnboardingState(target: OnboardingInstallTarget): OnboardingStateV3 | undefined {
  const existing = readOnboardingStateFile(target.storagePath);
  if (existing.status === "ok") {
    return existing.state;
  }
  if (existing.status === "v2") {
    const state = migrateV2State(existing.state);
    writeOnboardingStateFile(target.storagePath, state);
    return state;
  }
  if (existing.status === "invalid") {
    console.warn(
      `Onboarding state file is unreadable; skipping onboarding install for this boot rather than risking a duplicate install. ${existing.error}`,
    );
    return undefined;
  }

  const legacy = readLegacyOnboardingFile(target.storagePath);
  switch (legacy.status) {
    case "v1": {
      const state: OnboardingStateV3 = {
        version: ONBOARDING_STATE_VERSION,
        channels: {
          [MIGRATED_TV_GUIDE_SLUG]: { installedAt: legacy.installedAt ?? new Date().toISOString() },
        },
      };
      writeOnboardingStateFile(target.storagePath, state);
      return state;
    }
    case "v2": {
      const state = migrateV2State(legacy.state);
      writeOnboardingStateFile(target.storagePath, state);
      return state;
    }
    case "invalid":
      console.warn(
        `Legacy onboarding sentinel is unreadable; skipping onboarding install for this boot rather than risking a duplicate install. ${legacy.error}`,
      );
      return undefined;
    case "absent": {
      if (target.hasArtifact(ONBOARDING_ARTIFACT_ID)) {
        // The artifact was installed but the sentinel write was lost
        // (specs/arch/onboarding/installer.md#^migrate-legacy-artifact).
        const state: OnboardingStateV3 = {
          version: ONBOARDING_STATE_VERSION,
          channels: { [MIGRATED_TV_GUIDE_SLUG]: { installedAt: new Date().toISOString() } },
        };
        writeOnboardingStateFile(target.storagePath, state);
        return state;
      }
      // Nothing is pre-marked; no file simply means no channels received.
      return { version: ONBOARDING_STATE_VERSION, channels: {} };
    }
  }
}

function migrateV2State(state: OnboardingStateV2): OnboardingStateV3 {
  return { version: ONBOARDING_STATE_VERSION, channels: state.screens };
}

/** Install one channel; throws on any failure, leaving the slug unmarked. */
function installChannel(
  target: OnboardingInstallTarget,
  contentPath: string,
  channelConfig: OnboardingChannelConfig,
): string {
  // Resolve the target channel: reuse a marker-carrying channel (crash-retry
  // path) or create one (specs/arch/onboarding/installer.md#^channel-reuse).
  const existing = target.listChannels().find((channel) => channel.onboarding?.slug === channelConfig.slug);
  const channel = existing ?? target.createChannel({
    name: channelConfig.name,
    onboarding: { slug: channelConfig.slug },
  });

  // Copy content first — overwriting whatever exists at the destination,
  // because an unmarked slug's content is always copied fresh
  // (specs/arch/onboarding/installer.md#^copy-overwrite-unmarked). Sources
  // resolve lazily so a missing source fails only this channel
  // (specs/arch/onboarding/installer.md#^lazy-source-resolution).
  const copies: Array<{ artifactConfig: OnboardingArtifactConfig; destination: string }> = [];
  for (const artifactConfig of channelConfig.artifacts) {
    const resolved = resolveOnboardingArtifactSource(contentPath, channelConfig.slug, artifactConfig.slug);
    if (!resolved.ok) {
      throw new Error(resolved.error);
    }
    const copyName = onboardingCopyName(channelConfig.slug, artifactConfig.slug);
    const artifactsDir = getAgentArtifactsDir(target.storagePath);
    if (resolved.source.kind === "file") {
      // The destination extension follows the source file's, so an installed
      // markdown source is an ordinary markdown path artifact
      // (specs/arch/onboarding/installer.md#^copy-overwrite-unmarked).
      const destination = path.join(artifactsDir, `${copyName}${path.extname(resolved.source.path)}`);
      // The destination may hold anything — including a directory left by a
      // crash, manual edit, or source-shape change. Unmarked content is
      // always copied fresh, so clear it unconditionally.
      rmSync(destination, { recursive: true, force: true });
      cpSync(resolved.source.path, destination);
      copies.push({ artifactConfig, destination });
    } else {
      const destinationDir = path.join(artifactsDir, copyName);
      if (existsSync(destinationDir)) {
        rmSync(destinationDir, { recursive: true, force: true });
      }
      cpSync(resolved.source.path, destinationDir, { recursive: true });
      // Directory artifact paths carry a trailing separator by server
      // convention.
      copies.push({ artifactConfig, destination: destinationDir + path.sep });
    }
  }

  // Create every artifact in config order with a generated ID. An earlier
  // attempt's artifacts are never looked for, reused or bound
  // (specs/arch/onboarding/installer.md#^artifact-create).
  const installed = copies.map(({ artifactConfig, destination }) => ({
    artifactConfig,
    artifactID: target.createArtifact({
      kind: "path",
      title: artifactConfig.title,
      channelID: channel.id,
      path: destination,
    }).id,
  }));

  // Write each declared starting value, in config order
  // (specs/arch/onboarding/installer.md#^onboarding-store-install).
  for (const { artifactConfig, artifactID } of installed) {
    if (artifactConfig.store !== undefined) writeDeclaredStartingValue(target, channelConfig.slug, artifactConfig, artifactID);
  }

  // Write pages whole so a retry repairs partial or missing membership.
  target.setChannelLayout(
    channel.id,
    installed.map(({ artifactConfig, artifactID }) => ({
      artifactIds: [artifactID],
      geometry: { ...(artifactConfig.geometry ?? DEFAULT_PAGE_GEOMETRY) },
      size: { ...(artifactConfig.size ?? DEFAULT_PAGE_SIZE) },
    })),
  );

  return channel.id;
}

/**
 * Writes an artifact's declared starting value as its store's first write,
 * with its dates moved to the installation day. A failed write is only warned
 * about: the store keeps what the failed write left, and a declared starting
 * value never fails its channel.
 */
function writeDeclaredStartingValue(
  target: OnboardingInstallTarget,
  channelSlug: string,
  artifactConfig: OnboardingArtifactConfig,
  artifactID: string,
): void {
  const { value, shiftDatesFrom } = artifactConfig.store!;
  try {
    target.writeStartingValue(
      artifactID,
      shiftDatesFrom === undefined ? value : shiftCalendarDates(value, calendarDaysFrom(shiftDatesFrom, new Date())),
    );
  } catch (error) {
    console.warn(
      `Onboarding could not write the starting value of artifact "${artifactConfig.slug}" (${artifactID}) in channel "${channelSlug}" to its store; the channel still installs.`,
      error,
    );
  }
}

/** Whole calendar days from the day `from` names to the local day of `now`. */
function calendarDaysFrom(from: string, now: Date): number {
  return (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
}

/**
 * A declared starting value with every string that is a calendar date, at any
 * depth, moved by `days`; other strings and values are as declared
 * (specs/arch/onboarding/installer.md#^onboarding-store-dates).
 */
function shiftCalendarDates(value: JSONValue, days: number): JSONValue {
  if (isCalendarDate(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) return value.map((item) => shiftCalendarDates(item, days));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shiftCalendarDates(item, days)]));
  }
  return value;
}

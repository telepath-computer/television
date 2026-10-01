// The onboarding state file: which onboarding channels a data directory has
// received. Spec: specs/arch/onboarding/installer.md.
//
// The authoritative file is `state/onboarding.json` (v3 shape, the only shape
// this module writes). Screen-named v2 state and the legacy single-artifact
// sentinel at `state/onboarding-artifact.json` are migration inputs only. The
// legacy sentinel is never written or deleted
// (specs/arch/onboarding/installer.md#^legacy-file-kept).
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getOnboardingArtifactSentinelPath, getOnboardingStatePath } from "./artifact-paths.ts";
import { isValidOnboardingSlug } from "./onboarding-content.ts";
import { ONBOARDING_ARTIFACT_ID as LEGACY_ONBOARDING_ARTIFACT_ID } from "./onboarding.ts";

const JSON_INDENT_SPACES = 2;
export const ONBOARDING_STATE_VERSION = 3;

export interface OnboardingChannelInstallRecord {
  installedAt: string; // ISO 8601, when this slug's install completed
}

/** Current state shape and the only shape current code writes. */
export interface OnboardingStateV3 {
  version: typeof ONBOARDING_STATE_VERSION;
  channels: Record<string, OnboardingChannelInstallRecord>;
}

/** Pre-rename state shape, accepted only as a migration input. */
export interface OnboardingStateV2 {
  version: 2;
  screens: Record<string, OnboardingChannelInstallRecord>;
}

export type OnboardingStateFileRead =
  | { status: "ok"; state: OnboardingStateV3 }
  | { status: "v2"; state: OnboardingStateV2 }
  | { status: "absent" }
  | { status: "invalid"; error: string };

export type LegacyOnboardingFileRead =
  /** v1 payload; `installedAt` is undefined when the recorded value is unusable. */
  | { status: "v1"; installedAt: string | undefined }
  | { status: "v2"; state: OnboardingStateV2 }
  | { status: "absent" }
  | { status: "invalid"; error: string };

/** Strictly parse current v3 or migration-input v2 `state/onboarding.json`. */
export function readOnboardingStateFile(storagePath: string): OnboardingStateFileRead {
  const statePath = getOnboardingStatePath(storagePath);
  if (!existsSync(statePath)) {
    return { status: "absent" };
  }
  const parsed = parseJSONFile(statePath);
  if (!parsed.ok) {
    return { status: "invalid", error: parsed.error };
  }
  const current = parseV3State(parsed.value);
  if (current !== undefined) {
    return { status: "ok", state: current };
  }
  const legacy = parseV2State(parsed.value);
  return legacy !== undefined
    ? { status: "v2", state: legacy }
    : { status: "invalid", error: `not a version 2 or 3 onboarding state payload: ${statePath}` };
}

/**
 * Parse the legacy sentinel, which may hold the v1 single-artifact payload or
 * a valid v2 payload. The file itself is never modified.
 */
export function readLegacyOnboardingFile(storagePath: string): LegacyOnboardingFileRead {
  const legacyPath = getOnboardingArtifactSentinelPath(storagePath);
  if (!existsSync(legacyPath)) {
    return { status: "absent" };
  }
  const parsed = parseJSONFile(legacyPath);
  if (!parsed.ok) {
    return { status: "invalid", error: parsed.error };
  }
  const v2 = parseV2State(parsed.value);
  if (v2 !== undefined) {
    return { status: "v2", state: v2 };
  }
  const value = parsed.value;
  if (typeof value === "object" && value !== null && (value as { version?: unknown }).version === 1) {
    // The v1 payload always recorded the legacy artifact ID; a version-1
    // object without it is not the spec'd sentinel and therefore not install
    // evidence (specs/arch/onboarding/installer.md#^invalid-state-conservative).
    // An unusable `installedAt` alone stays a valid v1 read: migration falls
    // back to migration time for the timestamp only.
    if ((value as { artifactID?: unknown }).artifactID !== LEGACY_ONBOARDING_ARTIFACT_ID) {
      return { status: "invalid", error: `not a recognized onboarding payload: ${legacyPath}` };
    }
    const installedAt = (value as { installedAt?: unknown }).installedAt;
    return {
      status: "v1",
      installedAt: isUsableTimestamp(installedAt) ? installedAt : undefined,
    };
  }
  return { status: "invalid", error: `not a recognized onboarding payload: ${legacyPath}` };
}

/**
 * The writer's temporary-file path, in the same directory as the state file.
 * Exported so the state-writer failure-injection test can occupy it with real
 * filesystem state instead of replacing the writer
 * (proofs/arch/onboarding/installer.md#^t-state-writer).
 */
export function getOnboardingStateTempPath(storagePath: string): string {
  const statePath = getOnboardingStatePath(storagePath);
  return path.join(path.dirname(statePath), `.${path.basename(statePath)}.tmp-${process.pid}`);
}

/**
 * Atomically rewrite `state/onboarding.json`: the new content is written to a
 * temporary file in the same directory and renamed into place, so the file on
 * disk is always either the previous or the new complete version
 * (specs/arch/onboarding/installer.md#^state-file-atomic).
 */
export function writeOnboardingStateFile(storagePath: string, state: OnboardingStateV3): void {
  const statePath = getOnboardingStatePath(storagePath);
  const tempPath = getOnboardingStateTempPath(storagePath);
  try {
    writeFileSync(tempPath, JSON.stringify(state, null, JSON_INDENT_SPACES));
    renameSync(tempPath, statePath);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Best-effort cleanup only; the original failure is what matters.
    }
    throw error;
  }
}

function parseJSONFile(filePath: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    return { ok: false, error: `cannot read ${filePath}: ${describeError(error)}` };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: `cannot parse ${filePath}: ${describeError(error)}` };
  }
}

function parseV3State(value: unknown): OnboardingStateV3 | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as { version?: unknown; channels?: unknown; screens?: unknown };
  if (candidate.version !== ONBOARDING_STATE_VERSION || candidate.screens !== undefined) {
    return undefined;
  }
  const channels = parseInstallRecords(candidate.channels);
  return channels === undefined ? undefined : { version: ONBOARDING_STATE_VERSION, channels };
}

function parseV2State(value: unknown): OnboardingStateV2 | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as { version?: unknown; screens?: unknown; channels?: unknown };
  if (candidate.version !== 2 || candidate.channels !== undefined) {
    return undefined;
  }
  const screens = parseInstallRecords(candidate.screens);
  return screens === undefined ? undefined : { version: 2, screens };
}

function parseInstallRecords(value: unknown): Record<string, OnboardingChannelInstallRecord> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const records: Record<string, OnboardingChannelInstallRecord> = {};
  for (const [slug, record] of Object.entries(value)) {
    // Keys are onboarding slugs and timestamps must be syntactically usable;
    // anything else is a malformed file, which disables installation rather
    // than counting as install evidence
    // (specs/arch/onboarding/installer.md#^invalid-state-conservative).
    if (!isValidOnboardingSlug(slug)) {
      return undefined;
    }
    if (
      typeof record !== "object" ||
      record === null ||
      !isUsableTimestamp((record as { installedAt?: unknown }).installedAt)
    ) {
      return undefined;
    }
    records[slug] = { installedAt: (record as { installedAt: string }).installedAt };
  }
  return records;
}

function isUsableTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

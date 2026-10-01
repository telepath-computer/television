import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getTelemetryStatePath } from "../artifact-paths.ts";
import type { TelemetryStatus, TelemetrySuppressionReason } from "@telepath-computer/television-shared";
import { telemetryVersion, type TelemetryEvent } from "./types.ts";

declare const __TV_TELEMETRY_BUILD__: string | undefined;

export type { TelemetryStatus, TelemetryStatusState, TelemetrySuppressionReason } from "@telepath-computer/television-shared";

export const TELEMETRY_STATE_SCHEMA_VERSION = 1;

const SEMVER_MAJOR_CAPTURE_INDEX = 1;
const SEMVER_MINOR_CAPTURE_INDEX = 2;
const SEMVER_PATCH_CAPTURE_INDEX = 3;
const SEMVER_PRERELEASE_CAPTURE_INDEX = 4;

export interface TelemetryState {
  schemaVersion: 1;
  userId: string;
  optedOut: boolean;
  lastVersion: string;
}

export interface TelemetryEnv {
  DO_NOT_TRACK?: string;
  CI?: string;
  TV_TELEMETRY_TEST?: string;
  TELEVISION_DEVELOPER_HOME?: string;
  [key: string]: string | undefined;
}

export interface LoadTelemetryStateOptions {
  lastVersion?: string;
  userIdFactory?: () => string;
}

export interface DeriveBootTelemetryOptions extends Pick<LoadTelemetryStateOptions, "userIdFactory"> {
  dataDirCreated: boolean;
}

export interface LoadedTelemetryState {
  state: TelemetryState;
  created: boolean;
}

export interface BootTelemetryDerivation {
  state: TelemetryState;
  events: TelemetryEvent[];
  installed: boolean;
  upgraded: boolean;
  previousVersion: string | null;
}

export async function readTelemetryState(storagePath: string): Promise<TelemetryState | null> {
  try {
    return normalizeTelemetryState(JSON.parse(await readFile(getTelemetryStatePath(storagePath), "utf8")) as unknown);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    if (error instanceof SyntaxError || error instanceof InvalidTelemetryStateError) return null;
    throw error;
  }
}

export async function writeTelemetryState(storagePath: string, state: TelemetryState): Promise<void> {
  const statePath = getTelemetryStatePath(storagePath);
  await mkdir(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, statePath);
}

export async function loadOrMintTelemetryState(
  storagePath: string,
  options: LoadTelemetryStateOptions = {},
): Promise<LoadedTelemetryState> {
  const existing = await readTelemetryState(storagePath);
  if (existing) return { state: existing, created: false };

  const state: TelemetryState = {
    schemaVersion: TELEMETRY_STATE_SCHEMA_VERSION,
    userId: options.userIdFactory?.() ?? randomUUID(),
    optedOut: false,
    lastVersion: options.lastVersion ?? "",
  };
  await writeTelemetryState(storagePath, state);
  return { state, created: true };
}

export async function deriveBootTelemetry(
  storagePath: string,
  runningVersion: string,
  options: DeriveBootTelemetryOptions,
): Promise<BootTelemetryDerivation> {
  const loaded = await loadOrMintTelemetryState(storagePath, {
    lastVersion: "",
    userIdFactory: options.userIdFactory,
  });

  const previousVersion = loaded.state.lastVersion.trim() || null;
  const installed = options.dataDirCreated;
  const upgraded = !installed && (previousVersion === null || isTelemetryVersionOlder(previousVersion, runningVersion));
  const events: TelemetryEvent[] = [];

  if (installed) events.push({ name: "server_installed", personProperties: { pre_telemetry: false } });
  if (upgraded) {
    const preTelemetryAdoption = previousVersion === null;
    events.push({
      name: "server_upgraded",
      properties: {
        ...(preTelemetryAdoption ? { pre_telemetry: true } : { old_version: telemetryVersion(previousVersion) }),
        new_version: telemetryVersion(runningVersion),
      },
      ...(preTelemetryAdoption ? { personProperties: { pre_telemetry: true } } : {}),
    });
  }
  events.push({ name: "server_started" });

  const nextState = { ...loaded.state, lastVersion: runningVersion };
  if (nextState.lastVersion !== loaded.state.lastVersion) {
    await writeTelemetryState(storagePath, nextState);
  }

  return {
    state: nextState,
    events,
    installed,
    upgraded,
    previousVersion,
  };
}

export async function setTelemetryOptedOut(
  storagePath: string,
  state: TelemetryState,
  optedOut: boolean,
): Promise<TelemetryState> {
  const nextState = { ...state, optedOut };
  await writeTelemetryState(storagePath, nextState);
  return nextState;
}

// Implements specs/product/telemetry.md#^telemetry-rules for capture, routing and status.
function telemetryDecision(env: TelemetryEnv, state: Pick<TelemetryState, "optedOut">, developerHost: boolean): {
  state: "active" | "opted-out" | "suppressed";
  reason: TelemetrySuppressionReason | null;
  destination: "production" | "test" | null;
} {
  if (isEnabledEnvFlag(env.DO_NOT_TRACK)) return { state: "suppressed", reason: "do-not-track", destination: null };
  if (isEnabledEnvFlag(env.CI)) return { state: "suppressed", reason: "ci", destination: null };
  if (!isTelemetryTestMode(env)) {
    if (telemetryBuildMarker() !== "production") return { state: "suppressed", reason: "development", destination: null };
    if (developerHost) return { state: "suppressed", reason: "developer-host", destination: null };
  }
  if (state.optedOut) return { state: "opted-out", reason: null, destination: null };
  return { state: "active", reason: null, destination: isTelemetryTestMode(env) ? "test" : "production" };
}

export function telemetryDestination(env: TelemetryEnv, state: Pick<TelemetryState, "optedOut">, developerHost: boolean): "production" | "test" | null {
  return telemetryDecision(env, state, developerHost).destination;
}

export function telemetryEnabled(env: TelemetryEnv, state: Pick<TelemetryState, "optedOut">, developerHost: boolean): boolean {
  return telemetryDestination(env, state, developerHost) !== null;
}

export function telemetryEnvironmentSuppressionReason(env: TelemetryEnv, developerHost = false): TelemetrySuppressionReason | null {
  return telemetryDecision(env, { optedOut: false }, developerHost).reason;
}

export function telemetryStatus(env: TelemetryEnv, state: TelemetryState | null, developerHost = false): TelemetryStatus {
  if (!state) return { state: "unavailable", reason: null, guidPresent: false, region: "us" };
  const decision = telemetryDecision(env, state, developerHost);
  return { state: decision.state, reason: decision.reason, guidPresent: true, region: "us" };
}

export function isDoNotTrackEnabled(value: string | undefined): boolean {
  return isEnabledEnvFlag(value);
}

export function isTelemetryTestMode(env: Pick<TelemetryEnv, "TV_TELEMETRY_TEST">): boolean {
  return isEnabledEnvFlag(env.TV_TELEMETRY_TEST);
}

export function telemetryBuildMarker(): string | null {
  return bundledTelemetryBuildMarker() ?? null;
}

function isTelemetryVersionOlder(previousVersion: string, runningVersion: string): boolean {
  const previous = parseSemanticVersion(previousVersion);
  const running = parseSemanticVersion(runningVersion);
  if (!previous || !running) return false;
  return compareSemanticVersions(previous, running) < 0;
}

interface ParsedSemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemanticVersion(value: string): ParsedSemanticVersion | null {
  const match = value.trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  if (!match) return null;
  return {
    major: Number(match[SEMVER_MAJOR_CAPTURE_INDEX]),
    minor: Number(match[SEMVER_MINOR_CAPTURE_INDEX]),
    patch: Number(match[SEMVER_PATCH_CAPTURE_INDEX]),
    prerelease: match[SEMVER_PRERELEASE_CAPTURE_INDEX]?.split(".") ?? [],
  };
}

function compareSemanticVersions(left: ParsedSemanticVersion, right: ParsedSemanticVersion): number {
  const core = compareNumbers(left.major, right.major) || compareNumbers(left.minor, right.minor) || compareNumbers(left.patch, right.patch);
  if (core !== 0) return core;
  return comparePrerelease(left.prerelease, right.prerelease);
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const comparison = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return compareNumbers(Number(left), Number(right));
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bundledTelemetryBuildMarker(): string | undefined {
  return typeof __TV_TELEMETRY_BUILD__ === "string" ? __TV_TELEMETRY_BUILD__ : undefined;
}

function isEnabledEnvFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return false;
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeTelemetryState(value: unknown): TelemetryState {
  if (!value || typeof value !== "object") throw new InvalidTelemetryStateError("Invalid telemetry state file.");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== TELEMETRY_STATE_SCHEMA_VERSION) throw new InvalidTelemetryStateError("Unsupported telemetry state schema version.");
  if (typeof record.userId !== "string" || record.userId.length === 0) throw new InvalidTelemetryStateError("Telemetry state is missing userId.");
  return {
    schemaVersion: TELEMETRY_STATE_SCHEMA_VERSION,
    userId: record.userId,
    optedOut: record.optedOut === true,
    lastVersion: typeof record.lastVersion === "string" ? record.lastVersion : "",
  };
}

class InvalidTelemetryStateError extends Error {}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

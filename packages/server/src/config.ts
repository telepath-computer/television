import { accessSync, constants, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isIPv4 } from "node:net";
import os from "node:os";
import path from "node:path";
import type { ACPBridgeSessionIdStrategy } from "@telepath-computer/television-shared";

const TRUE_ENV_VALUE = "true";
const APP_HIDDEN_DIRECTORY = ".television";
const HOME_POINTER_FILE = ".tv-home";
const CONFIG_FILE = "config.json";
const CONFIG_KEYS = ["port", "listen", "auth", "installedByAgent"] as const;
const TELEVISION_ACP_AGENT_ENV = "TELEVISION_ACP_AGENT";
const TELEVISION_DEVELOPER_HOME_ENV = "TELEVISION_DEVELOPER_HOME";
const MAX_PORT = 65_535;
const TELEMETRY_CONTROL_ENV_VARS = [
  "DO_NOT_TRACK",
  "CI",
  "TV_TELEMETRY_TEST",
] as const;
// The operational update-channel overrides a persisted daemon carries from
// the installing shell (specs/arch/updates/update-channel.md
// ^hook-persist-capture) — kept in lockstep with the spec's two-var list.
const UPDATE_CHANNEL_ENV_VARS = [
  "TV_UPDATE_CHANNEL_URL",
  "TV_UPDATE_CHANNEL_POLL_INTERVAL_MS",
] as const;

export type ACPAgentName = "openclaw" | "hermes";

export interface ACPAgentProfile {
  agent: ACPAgentName;
  command: string;
  args: readonly string[];
  envPrefix: string;
  sessionIdStrategy: ACPBridgeSessionIdStrategy;
}

export interface PersistedEnvironmentOptions {
  developerHome?: string;
}

const ACP_AGENT_PROFILES: Record<ACPAgentName, ACPAgentProfile> = {
  openclaw: {
    agent: "openclaw",
    command: "openclaw",
    args: ["acp"],
    envPrefix: "OPENCLAW_",
    sessionIdStrategy: "deterministic",
  },
  hermes: {
    agent: "hermes",
    command: "hermes",
    args: ["acp"],
    envPrefix: "HERMES_",
    sessionIdStrategy: "mapped",
  },
};

export const DEFAULT_SERVER_HOST = "localhost";
export const DEFAULT_SERVER_PORT = 32848;
export const DEFAULT_SERVER_URL = buildServerURL(DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT);

export function buildServerURL(host: string, port: number): string {
  return `http://${host}:${port}`;
}

/** The object stored in `<home>/config.json`. Every key is optional. */
export interface TelevisionConfigFile {
  port?: number;
  listen?: string[];
  auth?: boolean;
  installedByAgent?: string;
}

/** The file's values, with absent keys filled from the code defaults. */
export interface TelevisionSettings {
  port: number;
  listen: string[];
  auth: boolean;
  installedByAgent?: string;
}

export interface TelevisionConfig {
  home: string;
  configPath: string;
  configFileExists: boolean;
  settings: TelevisionSettings;
}

/** An unreadable, malformed, or invalid config file, or an invalid update. */
export class TelevisionConfigError extends Error {
  readonly configPath: string;

  constructor(configPath: string, message: string) {
    super(message);
    this.name = "TelevisionConfigError";
    this.configPath = configPath;
  }
}

/**
 * Selects the Television home: `--home` resolved against `cwd`, otherwise the
 * path in `<operatingSystemHomeDir>/.tv-home`, otherwise
 * `<operatingSystemHomeDir>/.television`. Symbolic links are not resolved.
 */
export function resolveTelevisionHome(input: {
  homeOption: string | undefined;
  operatingSystemHomeDir: string;
  cwd: string;
}): string {
  const { homeOption, operatingSystemHomeDir, cwd } = input;
  if (homeOption !== undefined) {
    if (homeOption.trim() === "") {
      throw new Error("--home requires a path; an empty value does not select the default home.");
    }
    return path.resolve(cwd, homeOption);
  }

  const pointerPath = path.join(operatingSystemHomeDir, HOME_POINTER_FILE);
  const builtInHome = path.join(operatingSystemHomeDir, APP_HIDDEN_DIRECTORY);
  let contents: string;
  try {
    contents = readFileSync(pointerPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return builtInHome;
    throw new Error(`${pointerPath} cannot be read: ${errorMessage(error)}`);
  }

  const pointer = contents.trim();
  if (pointer === "") {
    throw new Error(`${pointerPath} holds no path. Write the Television home's path in it, or delete it to use ${builtInHome}.`);
  }
  if (/[\r\n]/.test(pointer)) {
    throw new Error(`${pointerPath} holds more than one line. It must hold only the Television home's path.`);
  }
  if (pointer === "~" || pointer.startsWith("~/")) {
    // Join rather than resolve, so extra slashes after `~` cannot make the
    // rest of the path absolute.
    return path.resolve(path.join(operatingSystemHomeDir, pointer.slice(1)));
  }
  if (pointer.startsWith("~")) {
    throw new Error(`${pointerPath} holds ${pointer}, but ~ followed by a user name is not supported. Use an absolute path instead.`);
  }
  return path.resolve(operatingSystemHomeDir, pointer);
}

/**
 * Reads `<home>/config.json`. A missing file yields the defaults; anything
 * else that is not a valid config file throws `TelevisionConfigError`.
 */
export function readTelevisionConfig(home: string): TelevisionConfig {
  const configPath = getConfigPath(home);
  const stored = readStoredConfig(configPath);
  if (stored === undefined) return buildConfig(configPath, false, {});
  return buildConfig(configPath, true, validateConfigFile(configPath, stored));
}

/**
 * Implements `tv config set`: replaces the keys in `changes`, validates the
 * complete result, and atomically replaces `<home>/config.json`, creating the
 * home when it is missing.
 */
export function updateTelevisionConfig(home: string, changes: TelevisionConfigFile): TelevisionConfig {
  const configPath = getConfigPath(home);
  const merged: Record<string, unknown> = { ...readStoredConfig(configPath) };
  for (const [key, value] of Object.entries(changes)) {
    if (value !== undefined) merged[key] = value;
  }
  const file = validateConfigFile(configPath, merged);

  const resolvedHome = path.dirname(configPath);
  mkdirSync(resolvedHome, { recursive: true });
  const temporaryPath = path.join(resolvedHome, `.${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`, { flag: "wx" });
    renameSync(temporaryPath, configPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  return buildConfig(configPath, true, file);
}

function getConfigPath(home: string): string {
  return path.join(path.resolve(home), CONFIG_FILE);
}

/** The parsed top-level object, or undefined when the file is missing. */
function readStoredConfig(configPath: string): Record<string, unknown> | undefined {
  let contents: string;
  try {
    contents = readFileSync(configPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw new TelevisionConfigError(configPath, `Config file ${configPath} cannot be read: ${errorMessage(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new TelevisionConfigError(configPath, `Config file ${configPath} is not valid JSON: ${errorMessage(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    const found = Array.isArray(parsed) ? "an array" : parsed === null ? "null" : `a ${typeof parsed}`;
    throw new TelevisionConfigError(configPath, `Config file ${configPath} must hold a JSON object, not ${found}.`);
  }
  return parsed as Record<string, unknown>;
}

function validateConfigFile(configPath: string, stored: Record<string, unknown>): TelevisionConfigFile {
  const invalid = (problem: string) => new TelevisionConfigError(configPath, `Config file ${configPath}: ${problem}`);
  const file: TelevisionConfigFile = {};

  for (const [key, value] of Object.entries(stored)) {
    const found = `got ${JSON.stringify(value)}`;
    switch (key) {
      case "port":
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_PORT) {
          throw invalid(`"port" must be a whole number from 0 through ${MAX_PORT}; ${found}.`);
        }
        file.port = value;
        break;
      case "listen":
        if (!Array.isArray(value)) {
          throw invalid(`"listen" must be an array of IPv4 address strings; ${found}.`);
        }
        for (const item of value) {
          if (typeof item !== "string" || !isIPv4(item)) {
            throw invalid(`each "listen" item must be an IPv4 address string; got ${JSON.stringify(item)}.`);
          }
        }
        file.listen = [...(value as string[])];
        break;
      case "auth":
        if (typeof value !== "boolean") {
          throw invalid(`"auth" must be true or false; ${found}.`);
        }
        file.auth = value;
        break;
      case "installedByAgent":
        if (typeof value !== "string") {
          throw invalid(`"installedByAgent" must be a string; ${found}.`);
        }
        file.installedByAgent = value;
        break;
      default:
        throw invalid(`unknown key ${JSON.stringify(key)}. Valid keys are ${CONFIG_KEYS.join(", ")}.`);
    }
  }
  return file;
}

function buildConfig(configPath: string, configFileExists: boolean, file: TelevisionConfigFile): TelevisionConfig {
  const settings: TelevisionSettings = {
    port: file.port ?? DEFAULT_SERVER_PORT,
    listen: file.listen ?? [],
    auth: file.auth ?? true,
  };
  if (file.installedByAgent !== undefined) settings.installedByAgent = file.installedByAgent;
  return { home: path.dirname(configPath), configPath, configFileExists, settings };
}

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getDefaultTelevisionStoragePath(): string {
  return path.join(os.homedir(), APP_HIDDEN_DIRECTORY);
}

export function getTelevisionRendererUrlEnv(): string | undefined {
  return process.env.TELEVISION_RENDERER_URL;
}

export function resolveACPAgentProfile(env: NodeJS.ProcessEnv & { TELEVISION_ACP_AGENT: string }): ACPAgentProfile;
export function resolveACPAgentProfile(env?: NodeJS.ProcessEnv): ACPAgentProfile | null;
export function resolveACPAgentProfile(env: NodeJS.ProcessEnv = process.env): ACPAgentProfile | null {
  const rawAgent = env[TELEVISION_ACP_AGENT_ENV];
  if (rawAgent === undefined) {
    return null;
  }

  const agent = rawAgent.trim().toLowerCase();
  if (agent === "openclaw" || agent === "hermes") {
    return ACP_AGENT_PROFILES[agent];
  }

  throw new Error(
    `Unsupported TELEVISION_ACP_AGENT "${rawAgent}". Supported values: openclaw, hermes.`,
  );
}

export function buildPersistedACPEnvironment(env: NodeJS.ProcessEnv, options: PersistedEnvironmentOptions = {}): Record<string, string> {
  const pathValue = env.PATH;
  if (pathValue === undefined) {
    throw new Error("PATH is required to build the persisted ACP environment.");
  }

  const snapshot: Record<string, string> = { PATH: pathValue };
  const developerHome = options.developerHome ?? os.homedir();
  if (developerHome !== "") snapshot[TELEVISION_DEVELOPER_HOME_ENV] = developerHome;
  copyEnvironmentAllowlist(env, snapshot, TELEMETRY_CONTROL_ENV_VARS);
  copyEnvironmentAllowlist(env, snapshot, UPDATE_CHANNEL_ENV_VARS);

  const profile = resolveACPAgentProfile(env);
  if (!profile) {
    return snapshot;
  }

  snapshot[TELEVISION_ACP_AGENT_ENV] = profile.agent;

  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(profile.envPrefix) && value !== undefined) {
      snapshot[key] = value;
    }
  }

  return snapshot;
}

function copyEnvironmentAllowlist(env: NodeJS.ProcessEnv, snapshot: Record<string, string>, keys: readonly string[]): void {
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined && value !== "") snapshot[key] = value;
  }
}

function canExecuteFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile() && accessSync(filePath, constants.X_OK) === undefined;
  } catch {
    return false;
  }
}

export function isACPCommandResolvable(command: string, envSnapshot: NodeJS.ProcessEnv): boolean {
  if (command.includes(path.sep)) {
    return canExecuteFile(command);
  }

  const pathValue = envSnapshot.PATH;
  if (!pathValue) {
    return false;
  }

  return pathValue
    .split(path.delimiter)
    .filter((entry) => entry.length > 0)
    .some((entry) => canExecuteFile(path.join(entry, command)));
}

export function isVitestRuntime(): boolean {
  return process.env.VITEST === TRUE_ENV_VALUE;
}

export function isDevMode(): boolean {
  return process.env.NODE_ENV !== "production";
}

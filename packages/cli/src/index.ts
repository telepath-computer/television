import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { Daemon } from "@rupertsworld/daemon";
import {
  DEFAULT_SERVER_HOST,
  buildPersistedACPEnvironment,
  buildServerURL,
  isACPCommandResolvable,
  isVitestRuntime,
  readTelevisionConfig,
  resolveACPAgentProfile,
  resolveBindAddresses,
  resolveTelevisionHome,
  deriveAgentTypeFromPath,
  emitSkillInstalledTelemetry,
  log,
  resolvePostHogProject,
  getTelemetryStatePath,
  telemetryDestination,
  telemetryEnvironmentSuppressionReason,
  telemetryVersion,
  TelevisionConfigError,
  updateTelevisionConfig,
  type ACPAgentProfile,
  type AgentType,
  type LaunchMode,
  type SkillInstalledTelemetryOptions,
  type TelemetryEnv,
  type TelevisionConfig,
  type TelevisionConfigFile,
  type TelevisionSettings,
} from "@telepath-computer/television-server";
import { Server, ServerStore } from "@telepath-computer/television-server";
import type {
  ArtifactRemovalResult,
  DeleteArtifactResult,
  ChannelRemovalResult,
} from "@telepath-computer/television-shared";
import { TelevisionClient, ValidationError, buildConnectURL, type TelemetryStatus } from "@telepath-computer/television-shared";
import {
  ACCESS_LEVELS,
  RESOURCE_BINDINGS_ENABLED,
  generatePushKey,
  isResourceRefusal,
  type AccessLevel,
  type JSONValue,
  type ResourceBinding,
  type StoreAddress,
} from "@telepath-computer/television-shared/resources";

export type Writable = {
  write(chunk: string | Uint8Array): unknown;
  /** True when the stream is an interactive terminal; decides link formatting. */
  isTTY?: boolean;
};

export type CLIServer = Pick<Server, "start" | "dispose" | "getAuthToken" | "getOrigins" | "getListeningPort">;
export type CLIServerOptions = {
  home: string; // absolute Television home
  listen: string[];
  port: number;
  auth: boolean;
  installedByAgent?: string;
  staticDir?: string;
  /** Root containing built canonical version directories (`v1/`, `v2/`, …). */
  canonicalDir?: string;
  bundledViewsPath?: string;
  onboardingContentPath?: string;
  bundledThemesPath?: string;
  sdkDir?: string;
  acpProfile?: ACPAgentProfile;
  launchMode: LaunchMode;
  resourceBindings: boolean; // the bindings flag (specs/arch/resources/index.md)
};

export type CLIDaemonOptions = {
  home: string; // absolute Television home, passed to the service as --home
  env: Record<string, string>;
};

export type CLIDaemon = Pick<Daemon, "install" | "uninstall" | "status">;

export interface CLIEnvironment {
  stdout: Writable;
  stderr: Writable;
  createClient: (serverURL: string, token?: string) => TelevisionClient;
  createServer: (options: CLIServerOptions) => CLIServer;
  createDaemon: (options?: CLIDaemonOptions) => CLIDaemon;
  resolveStaticDir: () => string | undefined;
  resolveCanonicalDir: () => string | undefined;
  resolveBundledViewsPath: () => string | undefined;
  resolveOnboardingContentPath: () => string | undefined;
  resolveBundledThemesPath: () => string | undefined;
  resolveBundledSkillsRoot: () => string | undefined;
  resolveSdkDir: () => string | undefined;
  /** The bindings flag; RESOURCE_BINDINGS_ENABLED by default, and only tests replace it. */
  resourceBindings: boolean;
  resolveHomeDir: () => string;
  runSkillsInstaller: (args: string[]) => Promise<void>;
  emitSkillInstalledTelemetry: (options: SkillInstalledTelemetryOptions) => Promise<void>;
  onSignal: (signal: NodeJS.Signals, handler: () => void) => void;
}

const DAEMON_NAME = "com.television.server";
const TELEMETRY_LAUNCH_MODE_ENV = "TELEVISION_LAUNCH_MODE";
const DEVELOPER_MARKER = ".tv-developer";
const SKILL_INSTALL_TELEMETRY_TIMEOUT_MS = 1_000;
// Long enough for one service-manager restart after a startup failure that
// clears on its own (specs/arch/cli/index.md#^cli-persist-health-check).
const PERSISTED_HEALTH_TIMEOUT_MS = 15_000;
const PERSISTED_HEALTH_RETRY_MS = 250;
const MIN_CLIENT_PORT = 1;
const MAX_PORT = 65_535;
const MAX_PROCESS_EXIT_STATUS = 255;
const LOOPBACK_IPV4 = "127.0.0.1";
const CONFIG_KEYS = ["port", "listen", "auth", "installedByAgent"] as const;
const HTTP_UNAUTHORIZED_STATUS = 401;
const HELP_POINTER = "Television ships bundled skills. The main skill is `television` — keep its guidance available for channels, lifecycle, the `tv` CLI, artifact workflow, and theming. Re-read it only if it is not already in context or you know the installed skill changed. Additional `tv-*` skills cover specialized artifact types. Install all bundled skills with `tv skills install <path>` (e.g. ~/.openclaw/skills) or `tv skills install -i`.";
export const PORT_ZERO_WARNING = "WARNING: config port 0 lets the operating system choose this server's port. Commands that contact this server must pass --port <port>, using the port in the startup output.";
const TELEMETRY_NOTICE = "Fully anonymized telemetry is enabled by default. Opt out: tv telemetry disable.";
const TOKENLESS_WARNING_OPENING = "WARNING: running without an auth token. Tokenless mode is insecure for typical setups — be sure you mean to run without authentication.";
const TOKENLESS_WARNING_CLOSING = "Run `tv config set auth true` and restart to require the bearer token.";
// The tokenless warning carries this sentence only with the bindings flag on (specs/product/cli.md#^cli-tokenless-bindings-sentence).
const TOKENLESS_BINDINGS_SENTENCE = "Any client that can reach this server can also change which artifacts may use which resources.";
// Written by `tv resource bind` when the server requires no token (specs/product/resources/resources.md#^rs-cli-bind).
const TOKENLESS_BIND_WARNING = "WARNING: this Television server runs without an auth token, so any client that can reach it can change resource bindings.";
const SAFE_ARG_PATTERN = /^[A-Za-z0-9_./:@%+=,-]+$/;
// Options earlier releases took (specs/product/cli.md#^cli-retired-options):
// the settings options of `tv serve`, and `--storage-path` on every command.
const RETIRED_SERVE_OPTIONS = ["--port", "--listen", "--auth", "--no-auth", "--installed-by-agent"];
const RETIRED_VALUE_OPTIONS = ["--port", "--listen", "--installed-by-agent", "--storage-path"];
const ADMIN_GUIDE_URL = "https://television.run/install.md";
// The guidance after its first sentence, which names the options given.
const RETIRED_OPTIONS_GUIDANCE = [
  "Server settings and the storage directory are no longer command options:",
  "",
  "  --port <number>              ->  tv config set port <number>",
  "  --listen <ipv4>[,<ipv4>...]  ->  tv config set listen <ipv4>[,<ipv4>...]",
  "  --auth                       ->  tv config set auth true (the default)",
  "  --no-auth                    ->  tv config set auth false",
  "  --installed-by-agent <name>  ->  tv config set installedByAgent <name>",
  "  --storage-path <path>        ->  tv --home <path> <command>, or write <path> into ~/.tv-home",
  "",
  "tv config set writes the config file in the Television home. For a home other than the default, put --home <path> before the command name, as in tv --home <path> config set port <number>.",
  "After changing settings, rerun tv serve --persist to update an installed service.",
  `The administrator guide covers the full upgrade and is written for your agent to carry out: ${ADMIN_GUIDE_URL}`,
].join("\n");
const RETIRED_SERVICE_RECORD = "service runs from a retired service definition";
// Written when either variable is set, outside the daemon launch mode
// (specs/product/cli.md#^cli-legacy-selectors).
const LEGACY_VARIABLES_WARNING = "WARNING: TELEVISION_PORT or TELEVISION_STORAGE_PATH is set in this environment, and Television no longer uses either. Set the server's port with tv config set port <number>. Television uses the home given with tv --home <path> <command>, otherwise the path written in ~/.tv-home, otherwise ~/.television.";

declare const __TV_STATIC_DIR__: string | undefined;
declare const __TV_VIEWS_DIR__: string | undefined;
declare const __TV_CANONICAL_DIR__: string | undefined;
declare const __TV_ONBOARDING_CONTENT_DIR__: string | undefined;
declare const __TV_BUNDLED_THEMES_DIR__: string | undefined;
declare const __TV_SDK_DIR__: string | undefined;
declare const __TV_TELEMETRY_BUILD__: string | undefined;
declare const __TV_VERSION__: string | undefined;
declare const __TV_DEVELOPER_COMMIT__: string | undefined;

class CLIDirectiveError extends Error {
  name = "CLIDirectiveError";
}

function writeJSON(output: Writable, value: unknown): void {
  output.write(`${JSON.stringify(value)}\n`);
}

function writeLine(output: Writable, line: string): void {
  output.write(`${line}\n`);
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

/** A link as `tv links` prints it: an OSC-8 hyperlink when the output is a terminal. */
function formatLink(output: Writable, url: string): string {
  return output.isTTY === true ? `\u001B]8;;${url}\u001B\\${url}\u001B]8;;\u001B\\` : url;
}

function formatConnectURL(output: Writable, serverURL: string, token?: string | null): string {
  return formatLink(output, buildConnectURL(serverURL, token));
}

/** A value as a POSIX shell reads it back: single-quoted unless it holds only letters, digits and `_@%+=:,./-`. */
function shellWord(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Startup output (specs/product/cli.md#^cli-startup-links): `heading`, then
 * the connect links when there are any to print, and otherwise the `tv links`
 * command that prints them, so that no token lands in a log.
 */
function writeStartup(output: Writable, heading: string, links: string[] | null, linksCommand: { home?: string; port?: number }): void {
  writeLine(output, heading);
  if (links === null) {
    const command = [
      "tv",
      ...(linksCommand.home === undefined ? [] : ["--home", shellWord(linksCommand.home)]),
      "links",
      ...(linksCommand.port === undefined ? [] : ["--port", String(linksCommand.port)]),
    ].join(" ");
    writeLine(output, `Run \`${command}\` to print the links that open Television.`);
    return;
  }
  writeLine(output, "Open Television:");
  for (const link of links) writeLine(output, `  ${link}`);
}

/**
 * Calls `health()` until a call resolves or the deadline passes, and returns
 * the reply of the call that resolved, or null when none did. The deadline
 * also ends a call that never settles.
 */
async function waitForHealth(client: TelevisionClient, timeoutMs: number): Promise<Awaited<ReturnType<TelevisionClient["health"]>> | null> {
  let expired = false;
  let deadlineTimer: NodeJS.Timeout | undefined;
  const deadline = new Promise<null>((resolve) => {
    deadlineTimer = setTimeout(() => {
      expired = true;
      resolve(null);
    }, timeoutMs);
  });
  try {
    while (!expired) {
      const answered = await Promise.race([client.health().catch(() => null), deadline]);
      if (answered !== null) return answered;
      if (expired) break;
      await Promise.race([new Promise<void>((resolve) => setTimeout(resolve, PERSISTED_HEALTH_RETRY_MS)), deadline]);
    }
    return null;
  } finally {
    clearTimeout(deadlineTimer);
  }
}

async function bestEffortWithinTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T | null> {
  void operation.catch(() => {});
  return await new Promise<T | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      () => {
        clearTimeout(timeout);
        resolve(null);
      },
    );
  });
}

function ensureHelpPointer(message: string): string {
  return message.includes(HELP_POINTER) ? message : `${message}\n${HELP_POINTER}`;
}

function createDirectiveError(message: string): CLIDirectiveError {
  return new CLIDirectiveError(ensureHelpPointer(message));
}

// Dev-mode paths are resolved relative to this source file so they are
// cwd-independent. The built CLI never hits these branches; esbuild inlines
// the relevant constants via `define`. `import.meta.url` is wrapped in a
// lazy getter so esbuild's cjs transform doesn't warn about it.
function getDevPackageDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

// "skills" here means the external Vercel skills installer package. This is
// intentionally distinct from Television's own bundled skill-content workspace
// (`packages/skills/`), which builds the files that the installer
// later copies into agent skill directories.
function resolveVercelSkillsInstallerBin(): string {
  if (typeof require === "function" && typeof require.resolve === "function") {
    return require.resolve("skills/bin/cli.mjs");
  }
  const localRequire = createRequire(path.join(getDevPackageDir(), "package.json"));
  return localRequire.resolve("skills/bin/cli.mjs");
}

function readCLIVersion(): string {
  // Built CLI: esbuild injects the package version.
  if (typeof __TV_VERSION__ === "string" && __TV_VERSION__.length > 0) {
    return __TV_VERSION__;
  }

  const devPackageJsonPath = path.join(getDevPackageDir(), "package.json");
  if (!existsSync(devPackageJsonPath)) {
    throw new Error("Could not resolve package.json for repo-local CLI version.");
  }
  return JSON.parse(readFileSync(devPackageJsonPath, "utf8")).version;
}

function readCLIVersionOutput(resolveHomeDir: () => string): string {
  const releaseVersion = readCLIVersion();
  if (
    typeof __TV_DEVELOPER_COMMIT__ === "string"
    && __TV_DEVELOPER_COMMIT__.length > 0
    && existsSync(path.join(resolveHomeDir(), DEVELOPER_MARKER))
  ) {
    return `${releaseVersion} (commit ${__TV_DEVELOPER_COMMIT__})`;
  }
  return releaseVersion;
}

export function inspectTelemetryBuildConfig(env: TelemetryEnv = {}, options: { developerHost?: boolean } = {}): {
  telemetryBuild: string | null;
  telemetrySuppressionReason: ReturnType<typeof telemetryEnvironmentSuppressionReason>;
  posthogProject: { projectId: number; projectToken: string; ingestionHost: string } | null;
} {
  const project = resolvePostHogProject(env, options);
  return {
    telemetryBuild: typeof __TV_TELEMETRY_BUILD__ === "string" ? __TV_TELEMETRY_BUILD__ : null,
    telemetrySuppressionReason: telemetryEnvironmentSuppressionReason(env, options.developerHost ?? false),
    posthogProject: project ? {
      projectId: project.projectId,
      projectToken: project.projectToken,
      ingestionHost: project.ingestionHost,
    } : null,
  };
}

const FRONTMATTER_DELIMITER = "---\n";
const FRONTMATTER_DELIMITER_LENGTH = FRONTMATTER_DELIMITER.length;

function splitFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
  if (!text.startsWith(FRONTMATTER_DELIMITER)) {
    return { frontmatter: {}, body: text };
  }

  const closing = text.indexOf("\n---", FRONTMATTER_DELIMITER_LENGTH);
  if (closing === -1) {
    return { frontmatter: {}, body: text };
  }

  const block = text.slice(FRONTMATTER_DELIMITER_LENGTH, closing);
  const after = text.slice(closing + FRONTMATTER_DELIMITER_LENGTH);
  const body = after.startsWith("\n") ? after.slice(1) : after;
  const frontmatter: Record<string, string> = {};
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

function buildAgentHelpNote(): string {
  return [
    "",
    "Agent workflow note:",
    "  The main skill is `television` — keep its guidance available for channels, lifecycle, the `tv` CLI, artifact workflow, and theming.",
    "  Re-read it only if it is not already in context or you know the installed skill changed.",
    "  Additional `tv-*` skills cover specialized artifact types.",
    "  Install all bundled skills: `tv skills install <path>` (e.g. ~/.openclaw/skills) or `tv skills install -i`.",
  ].join("\n");
}

function buildArtifactWorkflowHelpNote(includeHTMLNote: boolean): string {
  const lines = [
    "",
    "Agent note:",
    "  The main skill is `television` — keep its guidance available for channels, lifecycle, the `tv` CLI, artifact workflow, and theming.",
    "  Re-read it only if it is not already in context or you know the installed skill changed.",
  ];
  if (includeHTMLNote) {
    lines.push("  Additional `tv-*` skills cover specialized artifact types.");
    lines.push("  Install all bundled skills: `tv skills install <path>` (e.g. ~/.openclaw/skills) or `tv skills install -i`.");
  }
  return lines.join("\n");
}

function formatArgvToken(value: string): string {
  return SAFE_ARG_PATTERN.test(value) ? value : JSON.stringify(value);
}

function formatEnteredInvocation(argv: string[]): string {
  return ["tv", ...argv.map(formatArgvToken)].join(" ");
}

function formatEnteredCommand(argv: string[]): string {
  return argv.length > 0 ? argv.map(formatArgvToken).join(" ") : "tv";
}

// Structural contract: any error may claim a valid nonzero process status; see startup-bind-failure.md ^exit-69.
function exitStatusFromError(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("exitStatus" in error)) return undefined;
  const exitStatus = (error as { exitStatus?: unknown }).exitStatus;
  return typeof exitStatus === "number" &&
    Number.isInteger(exitStatus) &&
    exitStatus > 0 &&
    exitStatus <= MAX_PROCESS_EXIT_STATUS
    ? exitStatus
    : undefined;
}

/** State one invocation's actions share with the error formatter. */
interface CLIInvocation {
  argv: string[];
  /** The home this invocation resolved, once a command action has resolved it. */
  home?: string;
  /** Set when an earlier release's installed service runs `tv serve`. */
  retiredService?: RetiredServiceDefinition;
}

interface RetiredOption {
  name: string;
  value?: string;
}

/**
 * Transitional: what an earlier release's service definition passed to
 * `tv serve` (specs/product/cli.md#^cli-retired-service-compat). Linear TV-871
 * tracks removing this path.
 */
interface RetiredServiceDefinition {
  /** The home named by `--storage-path`, when given. */
  storagePath?: string;
  /** The settings to write when the home has no config file. */
  settings: TelevisionConfigFile;
}

// Splits `--option=value` into its name and value.
function splitOptionToken(token: string): [string, string | undefined] {
  const equals = token.indexOf("=");
  return token.startsWith("--") && equals !== -1 ? [token.slice(0, equals), token.slice(equals + 1)] : [token, undefined];
}

// The command is the first token that is neither an option nor the value of
// `--home` or of a retired option.
function findCommandName(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--") return undefined;
    if (!token.startsWith("-")) return token;
    if (token === "--home" || RETIRED_VALUE_OPTIONS.includes(token)) index += 1;
  }
  return undefined;
}

/**
 * Removes the retired options, with their values, from the arguments before
 * Commander parses them (specs/arch/cli/index.md, Command parser and error
 * normalization). Tokens after `--` are operands and stay.
 */
function extractRetiredOptions(argv: readonly string[]): { command?: string; retired: RetiredOption[]; remaining: string[] } {
  const command = findCommandName(argv);
  const retired: RetiredOption[] = [];
  const remaining: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--") {
      remaining.push(...argv.slice(index));
      break;
    }
    const [name, inlineValue] = splitOptionToken(token);
    const isRetired = name === "--storage-path" || (command === "serve" && RETIRED_SERVE_OPTIONS.includes(name));
    if (!isRetired) {
      remaining.push(token);
    } else if (inlineValue !== undefined || !RETIRED_VALUE_OPTIONS.includes(name)) {
      retired.push({ name, value: inlineValue });
    } else {
      retired.push({ name, value: argv[index + 1] });
      index += 1;
    }
  }
  return { command, retired, remaining };
}

/**
 * The transitional path applies to a foreground `tv serve` in the daemon launch
 * mode with no `--home`, which is how an earlier release's installed service
 * starts. Its settings come from the retired options, with the port from
 * `TELEVISION_PORT` when no `--port` is given, and `auth` false unless `--auth`
 * is given. The config writer validates every value, so an invalid one stops
 * the start as an invalid config file does.
 */
function readRetiredServiceDefinition(
  command: string | undefined,
  retired: readonly RetiredOption[],
  remaining: readonly string[],
  processEnv: NodeJS.ProcessEnv,
): RetiredServiceDefinition | undefined {
  const options = remaining.slice(0, remaining.includes("--") ? remaining.indexOf("--") : undefined);
  const otherForm = options.some((token) => ["--persist", "--persist-uninstall", "--home"].includes(splitOptionToken(token)[0]));
  if (resolveTelemetryLaunchMode(processEnv) !== "daemon" || command !== "serve" || otherForm) return undefined;

  const values = (name: string) => retired.filter((option) => option.name === name).map((option) => option.value ?? "");
  const settings: Record<string, unknown> = { auth: values("--auth").length > 0 };
  const port = values("--port").at(-1);
  if (port !== undefined) {
    settings.port = parseWholePort(port, 0) ?? port;
  } else {
    const environmentPort = parseWholePort(processEnv.TELEVISION_PORT ?? "", 0);
    if (environmentPort !== undefined) settings.port = environmentPort;
  }
  const listen = values("--listen");
  if (listen.length > 0) settings.listen = listen.flatMap((value) => value.split(",").map((address) => address.trim()).filter(Boolean));
  const installedByAgent = values("--installed-by-agent").at(-1);
  if (installedByAgent !== undefined) settings.installedByAgent = installedByAgent;
  const storagePath = values("--storage-path").at(-1);
  return { ...(storagePath === undefined ? {} : { storagePath }), settings: settings as TelevisionConfigFile };
}

function formatCLIError(error: unknown, invocation: CLIInvocation): string {
  if (error instanceof CLIDirectiveError) {
    return error.message;
  }

  if (error instanceof ValidationError || error instanceof TelevisionConfigError) {
    return ensureHelpPointer(error.message);
  }

  // A resource refusal the shared client makes itself, before sending a write
  // or when a watched store is destroyed, prints as HTTP status errors do.
  if (isResourceRefusal(error)) {
    return ensureHelpPointer(error.message);
  }

  if (typeof error === "object" && error !== null && "serverURL" in error && "message" in error) {
    const serverURL = String((error as { serverURL?: string }).serverURL);
    const message = String((error as { message?: string }).message);
    const status = typeof (error as { status?: unknown }).status === "number"
      ? Number((error as { status?: unknown }).status)
      : undefined;
    if (status === HTTP_UNAUTHORIZED_STATUS) {
      return ensureHelpPointer(
        `Television server at ${serverURL} rejected the request as unauthorized. ` +
          `Check the token in ${path.join(invocation.home ?? "<home>", "state", "token")}.`,
      );
    }
    if (status !== undefined) {
      return ensureHelpPointer(message);
    }
    return `Could not reach Television server at ${serverURL}: ${message}`;
  }

  return error instanceof Error ? error.message : String(error);
}

/** A whole decimal port from `minimum` through 65535, or undefined for any other text. */
function parseWholePort(value: string, minimum: number): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= minimum && port <= MAX_PORT ? port : undefined;
}

function parseClientPortOption(value: string): number {
  const port = parseWholePort(value, MIN_CLIENT_PORT);
  if (port === undefined) {
    throw new InvalidArgumentError(`port must be a whole decimal integer from ${MIN_CLIENT_PORT} through ${MAX_PORT}`);
  }
  return port;
}

/** Parses `tv config set` pairs into config-file changes, in the order given. */
function parseConfigSetPairs(pairs: string[], invocation: string): { keys: string[]; changes: TelevisionConfigFile } {
  const keyList = CONFIG_KEYS.join(", ");
  if (pairs.length === 0) {
    throw createDirectiveError(`${invocation} requires at least one <key> <value> pair. Keys: ${keyList}.`);
  }
  if (pairs.length % 2 !== 0) {
    throw createDirectiveError(`${invocation} requires a value for ${formatArgvToken(pairs[pairs.length - 1]!)}.`);
  }

  const keys: string[] = [];
  const changes: TelevisionConfigFile = {};
  for (let index = 0; index < pairs.length; index += 2) {
    const key = pairs[index]!;
    const value = pairs[index + 1]!;
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
      throw createDirectiveError(`${invocation} does not support config key ${formatArgvToken(key)}. Keys: ${keyList}.`);
    }
    if (keys.includes(key)) {
      throw createDirectiveError(`${invocation} sets ${key} more than once.`);
    }
    keys.push(key);
    if (key === "port") {
      const port = parseWholePort(value, 0);
      if (port === undefined) {
        throw createDirectiveError(`${invocation} received an invalid port value ${formatArgvToken(value)}: use a whole decimal integer from 0 through ${MAX_PORT}.`);
      }
      changes.port = port;
    } else if (key === "listen") {
      changes.listen = value.split(",").map((address) => address.trim()).filter((address) => address.length > 0);
    } else if (key === "auth") {
      if (value !== "true" && value !== "false") {
        throw createDirectiveError(`${invocation} received an invalid auth value ${formatArgvToken(value)}: use true or false.`);
      }
      changes.auth = value === "true";
    } else {
      changes.installedByAgent = value;
    }
  }
  return { keys, changes };
}

/**
 * Resolve the directory containing the built renderer that the server serves
 * over HTTP. A packaged CLI uses its `./web` sibling; source execution uses
 * the web workspace's current `dist/` output.
 */
export function resolveStaticDir(): string | undefined {
  if (typeof __TV_STATIC_DIR__ === "string" && process.argv[1]) {
    const entryDir = path.dirname(realpathSync(process.argv[1]));
    const resolved = path.resolve(entryDir, __TV_STATIC_DIR__);
    return existsSync(path.join(resolved, "index.html")) ? resolved : undefined;
  }
  const devStaticPath = path.resolve(getDevPackageDir(), "../web/dist");
  return existsSync(path.join(devStaticPath, "index.html")) ? devStaticPath : undefined;
}

/**
 * Resolve the directory containing bundled views (`dist/views/<id>/…`).
 * In the built CLI, views sit next to the binary. In dev, they're built
 * into `packages/cli/dist/views/` by `npm run build:views`.
 */
export function resolveBundledViewsPath(): string | undefined {
  if (typeof __TV_VIEWS_DIR__ === "string" && process.argv[1]) {
    const entryDir = path.dirname(realpathSync(process.argv[1]));
    const resolved = path.resolve(entryDir, __TV_VIEWS_DIR__);
    return existsSync(resolved) ? resolved : undefined;
  }
  const devViewsPath = path.join(getDevPackageDir(), "dist/views");
  return existsSync(devViewsPath) ? devViewsPath : undefined;
}

/**
 * Resolve the root containing canonical artifact version directories
 * (`dist/canonical/v<n>/styles.css` plus each version's supporting files).
 * The server mounts each version at `/canonical/v<n>/*`. The built CLI keeps
 * the canonical root next to the binary; the server build populates the
 * development root at `packages/server/dist/canonical/`.
 */
export function resolveCanonicalDir(): string | undefined {
  if (typeof __TV_CANONICAL_DIR__ === "string" && process.argv[1]) {
    const entryDir = path.dirname(realpathSync(process.argv[1]));
    const resolved = path.resolve(entryDir, __TV_CANONICAL_DIR__);
    return existsSync(resolved) ? resolved : undefined;
  }
  const devCanonicalPath = path.resolve(
    getDevPackageDir(),
    "../server/dist/canonical",
  );
  return existsSync(devCanonicalPath) ? devCanonicalPath : undefined;
}

/**
 * Resolve the bundled onboarding-channels content root
 * (specs/arch/cli/index.md, build and packaged asset layout). Built CLI:
 * `__TV_ONBOARDING_CONTENT_DIR__` relative to the real path of the executing
 * binary. Dev mode: the server package's source asset tree. An unresolvable
 * root is not an error — the server starts and there is simply nothing to
 * install (missing bundle).
 */
export function resolveOnboardingContentPath(): string | undefined {
  if (typeof __TV_ONBOARDING_CONTENT_DIR__ === "string" && process.argv[1]) {
    const entryDir = path.dirname(realpathSync(process.argv[1]));
    const resolved = path.resolve(entryDir, __TV_ONBOARDING_CONTENT_DIR__);
    return existsSync(resolved) ? resolved : undefined;
  }
  const devPath = path.resolve(
    getDevPackageDir(),
    "../server/assets/onboarding-channels",
  );
  return existsSync(devPath) ? devPath : undefined;
}

/** Resolve optional bundled installed-theme packages for serving bootstrap. */
export function resolveBundledThemesPath(): string | undefined {
  if (typeof __TV_BUNDLED_THEMES_DIR__ === "string" && process.argv[1]) {
    const entryDir = path.dirname(realpathSync(process.argv[1]));
    const resolved = path.resolve(entryDir, __TV_BUNDLED_THEMES_DIR__);
    return existsSync(resolved) ? resolved : undefined;
  }
  const devPath = path.resolve(getDevPackageDir(), "../server/assets/themes");
  return existsSync(devPath) ? devPath : undefined;
}

/**
 * Resolve the resource SDK tree (`sdk/v1/resources.js`) that the server serves
 * (specs/arch/cli/index.md, build and packaged asset layout). Built CLI:
 * `__TV_SDK_DIR__` beside the binary. Dev mode: the server build's output.
 */
export function resolveSdkDir(): string | undefined {
  if (typeof __TV_SDK_DIR__ === "string" && process.argv[1]) {
    const entryDir = path.dirname(realpathSync(process.argv[1]));
    const resolved = path.resolve(entryDir, __TV_SDK_DIR__);
    return existsSync(resolved) ? resolved : undefined;
  }
  const devPath = path.resolve(getDevPackageDir(), "../server/dist/sdk");
  return existsSync(devPath) ? devPath : undefined;
}

// This resolves Television's own bundled skill-content collection root, not
// the external Vercel skills installer package.
export function resolveBundledSkillsRoot(): string | undefined {
  const builtPath = typeof process.argv[1] === "string"
    ? path.resolve(path.dirname(realpathSync(process.argv[1])), "./skills")
    : undefined;
  if (builtPath && existsSync(builtPath)) {
    return builtPath;
  }

  const devPath = path.resolve(getDevPackageDir(), "../skills/dist");
  return existsSync(devPath) ? devPath : undefined;
}

function copyBundledSkillsToDestination(bundledSkillsRoot: string, destinationRoot: string): Array<{ name: string; sourcePath: string; destinationPath: string }> {
  if (existsSync(destinationRoot) && !statSync(destinationRoot).isDirectory()) {
    throw new Error(`Skills destination is not a directory: ${destinationRoot}`);
  }

  mkdirSync(destinationRoot, { recursive: true });
  rmSync(path.join(destinationRoot, "tv-theme"), { recursive: true, force: true });

  const copied: Array<{ name: string; sourcePath: string; destinationPath: string }> = [];
  const entries = readdirSync(bundledSkillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const sourcePath = path.join(bundledSkillsRoot, entry.name);
    const destinationPath = path.join(destinationRoot, entry.name);
    rmSync(destinationPath, { recursive: true, force: true });
    cpSync(sourcePath, destinationPath, { recursive: true });
    copied.push({ name: entry.name, sourcePath, destinationPath });
  }

  return copied;
}

function resolveFocusDirective(
  argv: string[],
  commandName: string,
  focusFlag: "--focus-channel" | "--focus-artifact",
): boolean {
  const shouldFocus = argv.includes(focusFlag);
  const shouldNotFocus = argv.includes("--no-focus");
  if (shouldFocus === shouldNotFocus) {
    throw createDirectiveError(
      `tv ${commandName} requires exactly one of ${focusFlag} or --no-focus. ` +
        "Television separates state changes from focus; choose whether to show the result now or keep focus unchanged.",
    );
  }
  return shouldFocus;
}

function formatArtifactRemovalResult(result: ArtifactRemovalResult): string[] {
  switch (result.outcome) {
    case "deleted": {
      const pointer = result.kind === "path" ? result.path : result.url;
      return [
        `  ${result.artifactID}: deleted`,
        `    ${result.kind}: ${pointer}`,
        `    ${result.kind} target was not touched.`,
      ];
    }
  }
}

function formatDeleteArtifactResult(result: DeleteArtifactResult): string[] {
  switch (result.outcome) {
    case "deleted": {
      const pointer = result.kind === "path" ? result.path : result.url;
      return [
        `${result.kind} artifact ${result.artifactID} deleted from the registry.`,
        `  ${result.kind}: ${pointer}`,
        `  ${result.kind} target was not touched.`,
      ];
    }
  }
}

function formatChannelRemovalResult(result: ChannelRemovalResult): string[] {
  const header = [
    `Channel ${result.channelID} deleted:`,
    `  metadata removed: ${result.metadataPath}`,
  ];
  if (result.artifactResults.length === 0) {
    header.push("No artifacts referenced by this channel.");
    return header;
  }
  header.push(`${result.artifactResults.length} referenced artifact(s):`);
  for (const artifactResult of result.artifactResults) {
    header.push(...formatArtifactRemovalResult(artifactResult));
  }
  return header;
}

function assertNever(value: never, context: string): never {
  throw new Error(`Unexpected ${context}: ${JSON.stringify(value)}`);
}

function formatCommanderError(argv: string[], error: Error & { code?: string; message: string }): CLIDirectiveError | null {
  const enteredInvocation = formatEnteredInvocation(argv);
  const enteredCommand = formatEnteredCommand(argv);
  const optionMatch = /option '([^']+)'/.exec(error.message);
  const argumentMatch = /missing required argument '([^']+)'/.exec(error.message);

  if (error.code === "commander.unknownCommand") {
    return createDirectiveError(`Unknown tv command: ${enteredCommand}.`);
  }

  if (argv[0] === "help" && error.code === "commander.excessArguments") {
    return createDirectiveError(`${enteredInvocation} does not accept additional arguments.`);
  }

  if (error.code === "commander.unknownOption") {
    const optionText = optionMatch?.[1] ?? "that option";
    return createDirectiveError(`${enteredInvocation} does not support ${optionText}.`);
  }

  if (error.code === "commander.missingMandatoryOptionValue") {
    const optionText = optionMatch?.[1] ?? "the required option";
    return createDirectiveError(`${enteredInvocation} requires ${optionText}.`);
  }

  if (error.code === "commander.missingArgument") {
    const argumentText = argumentMatch ? `<${argumentMatch[1]}>` : "the required argument";
    return createDirectiveError(`${enteredInvocation} requires ${argumentText}.`);
  }

  if (error.code === "commander.invalidArgument") {
    return createDirectiveError(`${enteredInvocation} received an invalid argument: ${error.message.replace(/^error:\s*/, "")}`);
  }

  return null;
}

function readAuthToken(home: string): string | undefined {
  const tokenPath = path.join(home, "state", "token");
  if (!existsSync(tokenPath)) {
    return undefined;
  }

  const token = readFileSync(tokenPath, "utf8").trim();
  return token.length > 0 ? token : undefined;
}

function readOrCreateAuthToken(home: string): string {
  // Token-only (non-serving) construction: creates the directory structure
  // and token but no channels, display state, or onboarding install
  // (specs/arch/onboarding/installer.md#^token-only-boot).
  return new ServerStore({
    storagePath: home,
    installOnboardingChannels: false,
  }).authToken;
}

// The service carries no settings: each boot reads the home's config file.
function buildDaemonServeArgs(home: string): string[] {
  return [process.argv[1] ?? "tv", "--home", home, "serve"];
}

function redactSensitiveEnv(env: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    redacted[key] = isSensitiveEnvKey(key) ? "[redacted]" : value;
  }
  return redacted;
}

function resolveTelemetryLaunchMode(env: NodeJS.ProcessEnv): LaunchMode {
  return env[TELEMETRY_LAUNCH_MODE_ENV] === "daemon" ? "daemon" : "cli";
}

function isSensitiveEnvKey(key: string): boolean {
  const normalized = key.toUpperCase();
  return normalized.startsWith("OPENCLAW_") ||
    normalized.startsWith("HERMES_") ||
    normalized.endsWith("_API_KEY") ||
    normalized.endsWith("_TOKEN") ||
    normalized.endsWith("_SECRET") ||
    normalized.endsWith("_PASSWORD");
}

function createEnvironment(environment: Partial<CLIEnvironment>): CLIEnvironment {
  return {
    stdout: environment.stdout ?? process.stdout,
    stderr: environment.stderr ?? process.stderr,
    createClient: environment.createClient ?? ((serverURL, token) => new TelevisionClient(serverURL, { token })),
    createServer:
      environment.createServer ??
      ((options) =>
        new Server({
          // `tv serve` always enables the onboarding installer, passing the
          // resolved content root when one resolved
          // (specs/arch/cli/index.md, build and packaged asset layout).
          store: new ServerStore({
            storagePath: options.home,
            ...(options.bundledViewsPath ? { bundledViewsPath: options.bundledViewsPath } : {}),
            ...(options.onboardingContentPath ? { onboardingContentPath: options.onboardingContentPath } : {}),
            ...(options.bundledThemesPath ? { bundledThemesPath: options.bundledThemesPath } : {}),
            installOnboardingChannels: true,
          }),
          listen: options.listen,
          port: options.port,
          // Always explicit: the Server constructor's own default is tokenless.
          auth: options.auth,
          staticDir: options.staticDir,
          canonicalDir: options.canonicalDir,
          ...(options.sdkDir ? { sdkDir: options.sdkDir } : {}),
          resourceBindings: options.resourceBindings,
          acpProfile: options.acpProfile,
          telemetry: {
            launchMode: options.launchMode,
            installedByAgent: options.installedByAgent ?? null,
          },
        })),
    createDaemon:
      environment.createDaemon ??
      ((options) => {
        // Stop and status construct the daemon without options; only
        // installation uses the service's arguments.
        const args = options ? buildDaemonServeArgs(options.home) : [process.argv[1] ?? "tv", "serve"];

        return new Daemon({
          name: DAEMON_NAME,
          description: "Television server — virtual display for agents",
          // Persist the exact Node used at install time because a service does
          // not boot through the operator's interactive nvm shell. Reinstalling
          // the service is how a later Node selection takes effect.
          command: process.execPath,
          args,
          env: options?.env,
        });
      }),
    resolveStaticDir: environment.resolveStaticDir ?? (() => resolveStaticDir()),
    resolveCanonicalDir: environment.resolveCanonicalDir ?? (() => resolveCanonicalDir()),
    resolveBundledViewsPath:
      environment.resolveBundledViewsPath ?? (() => resolveBundledViewsPath()),
    resolveOnboardingContentPath:
      environment.resolveOnboardingContentPath ?? (() => resolveOnboardingContentPath()),
    resolveBundledThemesPath:
      environment.resolveBundledThemesPath ?? (() => resolveBundledThemesPath()),
    resolveBundledSkillsRoot:
      environment.resolveBundledSkillsRoot ?? (() => resolveBundledSkillsRoot()),
    resolveSdkDir: environment.resolveSdkDir ?? (() => resolveSdkDir()),
    resourceBindings: environment.resourceBindings ?? RESOURCE_BINDINGS_ENABLED,
    resolveHomeDir: environment.resolveHomeDir ?? (() => os.homedir()),
    runSkillsInstaller:
      environment.runSkillsInstaller ?? (async (args: string[]) => {
        const vercelSkillsInstallerBin = resolveVercelSkillsInstallerBin();
        const result = spawnSync(process.execPath, [vercelSkillsInstallerBin, ...args], { stdio: "inherit" });
        if (result.status !== 0) {
          throw new Error(`skills ${args.join(" ")} failed (exit ${result.status ?? "signal"})`);
        }
      }),
    emitSkillInstalledTelemetry:
      environment.emitSkillInstalledTelemetry ?? ((options) => emitSkillInstalledTelemetry(options)),
    onSignal: environment.onSignal ?? ((signal, handler) => process.on(signal, handler)),
  };
}

// Transitional (Linear TV-871): writes the retired options into a home that
// has no config file, so a later `tv config set` survives every boot, and
// records that the service should be reinstalled.
function startRetiredService(home: string, definition: RetiredServiceDefinition): void {
  const wroteConfig = !existsSync(path.join(home, "config.json"));
  if (wroteConfig) updateTelevisionConfig(home, definition.settings);
  log(home, RETIRED_SERVICE_RECORD, {
    wroteConfig,
    guidance: `Reinstall the service with \`tv serve --persist\`, adding \`--home ${home}\` before \`serve\` unless this is the default home, so it runs from the home and its config file. The administrator guide describes the upgrade and is written for an agent to carry out: ${ADMIN_GUIDE_URL}`,
  });
}

function createProgram(env: CLIEnvironment, invocation: CLIInvocation = { argv: [] }): Command {
  const { argv } = invocation;
  const program = new Command();
  // Resolves the home once per invocation, for the commands that use one.
  const resolveHome = (): string => {
    if (invocation.home !== undefined) return invocation.home;
    try {
      invocation.home = resolveTelevisionHome({
        homeOption: invocation.retiredService?.storagePath ?? program.opts<{ home?: string }>().home,
        operatingSystemHomeDir: env.resolveHomeDir(),
        cwd: process.cwd(),
      });
    } catch (error) {
      throw createDirectiveError(error instanceof Error ? error.message : String(error));
    }
    return invocation.home;
  };
  // The config file is the one source of the port, except that config port 0
  // requires the running server's port on the command line.
  const resolveClientPort = (config: TelevisionConfig, portOption: number | undefined): number => {
    const enteredInvocation = formatEnteredInvocation(argv);
    if (config.settings.port === 0) {
      if (portOption === undefined) {
        throw createDirectiveError(
          `${enteredInvocation} requires --port because ${config.configPath} sets port 0. Pass the port from the Television server's startup output.`,
        );
      }
      return portOption;
    }
    if (portOption !== undefined) {
      throw createDirectiveError(
        `${enteredInvocation} does not accept --port because ${config.configPath} sets port ${config.settings.port}. Omit --port to use the configured port.`,
      );
    }
    return config.settings.port;
  };
  const resolveServerURL = (portOption: number | undefined): string => {
    const port = resolveClientPort(readTelevisionConfig(resolveHome()), portOption);
    return buildServerURL(DEFAULT_SERVER_HOST, port);
  };
  const createAuthenticatedClient = (options: { port?: number }): TelevisionClient => {
    const serverURL = resolveServerURL(options.port);
    return env.createClient(serverURL, readAuthToken(resolveHome()));
  };
  const shouldDiscloseTelemetry = (home: string, telemetryEnv: TelemetryEnv): boolean => {
    if (existsSync(getTelemetryStatePath(home))) return false;
    const developerHome = telemetryEnv.TELEVISION_DEVELOPER_HOME || env.resolveHomeDir();
    const developerHost = existsSync(path.join(developerHome, DEVELOPER_MARKER));
    return telemetryDestination(telemetryEnv, { optedOut: false }, developerHost) === "production";
  };
  const emitSkillInstallTelemetry = async (input: { home: string; agentType: AgentType; installedByAgent?: string }): Promise<void> => {
    const disclose = shouldDiscloseTelemetry(input.home, process.env);
    await bestEffortWithinTimeout(env.emitSkillInstalledTelemetry({
      storagePath: input.home,
      version: telemetryVersion(readCLIVersion()),
      agentType: input.agentType,
      ...(input.installedByAgent === undefined ? {} : { installedByAgent: input.installedByAgent }),
      env: process.env,
    }), SKILL_INSTALL_TELEMETRY_TIMEOUT_MS);
    if (disclose) writeLine(env.stderr, TELEMETRY_NOTICE);
  };
  const uninstallPersistedService = async (home: string): Promise<void> => {
    const daemon = env.createDaemon();
    let outcome = "uninstalled";
    try {
      await daemon.uninstall();
    } catch (error) {
      outcome = "error";
      log(home, "persisted service uninstall failed", { daemonName: DAEMON_NAME, outcome, error });
      throw error;
    }
    log(home, "persisted service uninstalled", { daemonName: DAEMON_NAME, outcome });
    writeJSON(env.stdout, { status: "stopped" });
  };
  /**
   * The connect links `tv links` prints for the server at `serverURL`, from
   * its health reply: one for each origin the server reports, carrying the
   * token only when the running server requires it.
   */
  const connectLinks = async (serverURL: string, token: string | undefined, client: TelevisionClient, health: Awaited<ReturnType<TelevisionClient["health"]>>): Promise<string[]> => {
    await client.display.get();
    // Authentication is a startup setting: the file may have changed since
    // this server started. Only an unauthenticated 401 requires the token.
    let requiresToken = false;
    try {
      await env.createClient(serverURL, undefined).display.get();
    } catch (error) {
      if (typeof error !== "object" || error === null || !("status" in error) || error.status !== HTTP_UNAUTHORIZED_STATUS) throw error;
      requiresToken = true;
    }
    return health.origins.map((origin) => formatConnectURL(env.stdout, origin, requiresToken ? token : null));
  };

  /**
   * The links of the service `tv serve --persist` installed, from the health
   * reply that answered (specs/product/cli.md#^cli-persist-links); null when
   * they cannot be read before the health-check deadline.
   */
  const persistedLinks = async (
    serverURL: string,
    token: string | undefined,
    client: TelevisionClient,
    health: Awaited<ReturnType<TelevisionClient["health"]>>,
    deadline: number,
  ): Promise<string[] | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
    });
    try {
      return await Promise.race([connectLinks(serverURL, token, client, health), expired]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const installPersistedService = async (home: string, config: TelevisionConfig, startup: { printLinks: boolean; homeGiven: boolean }): Promise<void> => {
    const { settings, configPath } = config;
    if (settings.port === 0) {
      throw createDirectiveError(
        `${formatEnteredInvocation(argv)} requires a stable port, but ${configPath} sets port 0. Choose one with \`tv config set port <number>\`.`,
      );
    }
    const profile = resolveACPAgentProfile(process.env);
    const daemonEnv = buildPersistedACPEnvironment(process.env, { developerHome: env.resolveHomeDir() });
    daemonEnv[TELEMETRY_LAUNCH_MODE_ENV] = "daemon";
    if (profile && !isACPCommandResolvable(profile.command, daemonEnv)) {
      const error = createDirectiveError(
        `Could not find ACP agent command \`${profile.command}\` for \`TELEVISION_ACP_AGENT=${profile.agent}\` on the persisted PATH. ` +
          "Set TELEVISION_ACP_AGENT to `openclaw` or `hermes`, and ensure the selected agent binary is available on PATH before running `tv serve --persist`.",
      );
      log(home, "server startup refused before binding", { argv, error });
      throw error;
    }

    const disclose = shouldDiscloseTelemetry(home, daemonEnv);
    // Create the token before the service's first boot can create one.
    if (settings.auth) readOrCreateAuthToken(home);
    const daemonOptions: CLIDaemonOptions = { home, env: daemonEnv };
    const execStart = [process.execPath, ...buildDaemonServeArgs(home)];
    const daemon = env.createDaemon(daemonOptions);
    const daemonStatus = await daemon.status();
    if (daemonStatus.installed || daemonStatus.running) {
      await daemon.uninstall();
    }
    try {
      await daemon.install();
      log(home, "persisted service installed", {
        daemonName: DAEMON_NAME,
        execStart,
        env: redactSensitiveEnv(daemonEnv),
        replacedExisting: daemonStatus.installed || daemonStatus.running,
        outcome: "installed",
      });
    } catch (error) {
      log(home, "persisted service install failed", {
        daemonName: DAEMON_NAME,
        execStart,
        env: redactSensitiveEnv(daemonEnv),
        outcome: "error",
        error,
      });
      throw error;
    }
    const healthServerURL = buildServerURL(DEFAULT_SERVER_HOST, settings.port);
    const token = readAuthToken(home);
    const client = env.createClient(healthServerURL, token);
    const deadline = Date.now() + PERSISTED_HEALTH_TIMEOUT_MS;
    const health = await waitForHealth(client, PERSISTED_HEALTH_TIMEOUT_MS);
    if (health === null) {
      log(home, "persisted service did not respond", {
        daemonName: DAEMON_NAME,
        healthURL: `${healthServerURL}/health`,
        timeoutMs: PERSISTED_HEALTH_TIMEOUT_MS,
      });
      // The service is installed, so the notice rule still applies.
      if (disclose) writeLine(env.stderr, TELEMETRY_NOTICE);
      throw new Error(
        `Television service installed, but the server did not respond at ${healthServerURL} within ${PERSISTED_HEALTH_TIMEOUT_MS / 1_000} seconds. ` +
          `The service remains installed. See ${path.join(home, "logs", "tv.log")} for the cause.`,
      );
    }
    // Links only to a terminal, or when asked for, so that no token lands in a log.
    const links = startup.printLinks || env.stdout.isTTY === true ? await persistedLinks(healthServerURL, token, client, health, deadline) : null;
    writeStartup(env.stdout, "Television service installed.", links, startup.homeGiven ? { home } : {});
    if (disclose) writeLine(env.stderr, TELEMETRY_NOTICE);
  };
  const serveInForeground = async (home: string, settings: TelevisionSettings, startup: { printLinks: boolean; homeGiven: boolean }): Promise<void> => {
    const profile = resolveACPAgentProfile(process.env);
    if (profile && !isACPCommandResolvable(profile.command, process.env)) {
      const error = createDirectiveError(
        `Could not find ACP agent command \`${profile.command}\` for \`TELEVISION_ACP_AGENT=${profile.agent}\` on PATH. ` +
          "Set TELEVISION_ACP_AGENT to `openclaw` or `hermes`, and ensure the selected agent binary is available on PATH before running `tv serve`.",
      );
      log(home, "server startup refused before binding", { argv, error });
      throw error;
    }
    if (settings.port === 0) {
      writeLine(env.stderr, PORT_ZERO_WARNING);
    }

    const disclose = resolveTelemetryLaunchMode(process.env) !== "daemon" && shouldDiscloseTelemetry(home, process.env);
    const onboardingContentPath = env.resolveOnboardingContentPath();
    const bundledThemesPath = env.resolveBundledThemesPath();
    const sdkDir = env.resolveSdkDir();
    const server = env.createServer({
      home,
      listen: settings.listen,
      port: settings.port,
      auth: settings.auth,
      ...(settings.installedByAgent === undefined ? {} : { installedByAgent: settings.installedByAgent }),
      staticDir: env.resolveStaticDir(),
      canonicalDir: env.resolveCanonicalDir(),
      bundledViewsPath: env.resolveBundledViewsPath(),
      ...(onboardingContentPath !== undefined ? { onboardingContentPath } : {}),
      ...(bundledThemesPath !== undefined ? { bundledThemesPath } : {}),
      ...(sdkDir !== undefined ? { sdkDir } : {}),
      launchMode: resolveTelemetryLaunchMode(process.env),
      ...(profile ? { acpProfile: profile } : {}),
      resourceBindings: env.resourceBindings,
    });
    await server.start();
    if (!settings.auth) {
      writeLine(env.stderr, [TOKENLESS_WARNING_OPENING, ...(env.resourceBindings ? [TOKENLESS_BINDINGS_SENTENCE] : []), TOKENLESS_WARNING_CLOSING].join(" "));
      const nonLoopbackAddresses = resolveBindAddresses(settings.listen).filter((address) => address !== LOOPBACK_IPV4);
      if (nonLoopbackAddresses.length > 0) {
        writeLine(env.stderr, `Non-loopback listeners without auth: ${nonLoopbackAddresses.join(", ")}`);
      }
    }
    // Links only to a terminal, or when asked for, so that no token lands in a log (specs/product/cli.md#^cli-startup-links).
    const links = startup.printLinks || env.stdout.isTTY === true
      ? server.getOrigins().map((origin) => formatConnectURL(env.stdout, origin, settings.auth ? server.getAuthToken() : null))
      : null;
    writeStartup(env.stdout, "Television server running.", links, {
      ...(startup.homeGiven ? { home } : {}),
      ...(settings.port === 0 ? { port: server.getListeningPort() } : {}),
    });
    if (disclose) writeLine(env.stderr, TELEMETRY_NOTICE);
    await new Promise<void>((resolve, reject) => {
      let shuttingDown = false;

      const shutdown = async (signal: NodeJS.Signals) => {
        if (shuttingDown) return;
        shuttingDown = true;
        try {
          await server.dispose(signal);
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      env.onSignal("SIGINT", () => { void shutdown("SIGINT"); });
      env.onSignal("SIGTERM", () => { void shutdown("SIGTERM"); });
    });
  };
  const versionOutput = readCLIVersionOutput(env.resolveHomeDir);
  program
    .name("tv")
    .description("Television — virtual display for agents")
    .version(versionOutput)
    .option("-v", "Output the version number")
    .option("--home <path>", "Television home directory (default: the path in ~/.tv-home, otherwise ~/.television)")
    .showSuggestionAfterError(false)
    .addHelpText("after", buildAgentHelpNote())
    .configureOutput({
      writeOut: (str) => env.stdout.write(str),
      writeErr: (str) => env.stderr.write(str),
      outputError: () => {},
    })
    .exitOverride();
  // Commander's own --version handling, repeated for the -v alias.
  program.on("option:v", () => {
    env.stdout.write(`${versionOutput}\n`);
    throw new CommanderError(0, "commander.version", versionOutput);
  });

  program
    .command("serve")
    .description("Start the Television server with the selected home's settings")
    .option("--persist", "Install as a persistent system service")
    .option("--persist-uninstall", "Uninstall the persistent system service")
    // Prints the links whatever stdout is; the repository's tests use it to find a server they start (specs/arch/cli/index.md, server process boundary).
    .addOption(new Option("--print-links").hideHelp())
    .action(async (opts: { persist?: boolean; persistUninstall?: boolean; printLinks?: boolean }) => {
      if (opts.persist && opts.persistUninstall) {
        throw createDirectiveError("Use either `--persist` or `--persist-uninstall`, not both.");
      }

      const home = resolveHome();
      if (opts.persistUninstall) {
        await uninstallPersistedService(home);
        return;
      }

      let config: TelevisionConfig;
      try {
        if (invocation.retiredService) startRetiredService(home, invocation.retiredService);
        config = readTelevisionConfig(home);
      } catch (error) {
        log(home, "server startup refused before binding", { argv, error });
        throw error;
      }

      // The printed `tv links` command names the home only when the invocation chose it.
      const startup = {
        printLinks: opts.printLinks === true,
        homeGiven: invocation.retiredService?.storagePath !== undefined || program.opts<{ home?: string }>().home !== undefined,
      };
      if (opts.persist) {
        await installPersistedService(home, config, startup);
        return;
      }
      await serveInForeground(home, config.settings, startup);
    });

  const configCommand = program
    .command("config")
    .description("Show the effective settings of the selected home, or change settings in its config file");

  configCommand
    .command("set")
    .description("Change settings in the selected home's config file")
    .argument("[pairs...]", `<key> <value> pairs; keys: ${CONFIG_KEYS.join(", ")}`)
    .action((pairs: string[]) => {
      const { keys, changes } = parseConfigSetPairs(pairs, formatEnteredInvocation(argv));
      const config = updateTelevisionConfig(resolveHome(), changes);
      writeLine(env.stdout, `Updated ${config.configPath}: ${keys.join(", ")}.`);
      writeLine(env.stdout, "Restart foreground `tv serve`, or rerun `tv serve --persist`, for a running server to use the new settings.");
    });

  configCommand
    .command("show")
    .description("Print the selected home, its config file, and the effective settings as JSON")
    .action(() => {
      const config = readTelevisionConfig(resolveHome());
      writeJSON(env.stdout, {
        home: config.home,
        configPath: config.configPath,
        configFileExists: config.configFileExists,
        settings: { ...config.settings, installedByAgent: config.settings.installedByAgent ?? null },
      });
    });

  program
    .command("create-path-artifact")
    .description(
      "Create a path artifact that points at an existing absolute markdown or HTML file, or at a directory with a root index.html/index.htm (trailing separator optional; the server detects file vs directory on disk). Television records the pointer only; HTML and directory targets are read-only, and markdown targets are written through only by in-UI editor saves via PUT /markdown/<id>.",
    )
    .requiredOption("--channel <id>", "Target channel ID")
    .requiredOption("--title <title>", "Artifact title")
    .requiredOption("--path <path>", "Absolute path to an existing markdown/HTML file or indexed directory (trailing separator optional)")
    .option("--focus-artifact", "Focus the new artifact after creation")
    .option("--no-focus", "Create the artifact in the background without changing focus")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .addHelpText("after", buildArtifactWorkflowHelpNote(true))
    .action(async (opts: { channel: string; title: string; path: string; port?: number }) => {
      const shouldFocus = resolveFocusDirective(argv, "create-path-artifact", "--focus-artifact");
      const artifactPath = opts.path.trim();
      const client = createAuthenticatedClient(opts);
      const { artifact } = await client.artifacts.create({
        kind: "path",
        path: artifactPath,
        title: opts.title,
        channelID: opts.channel,
      });
      if (shouldFocus) {
        await client.display.focus({ artifactID: artifact.id });
      }

      writeLine(env.stdout, `Path artifact ${artifact.id} created.`);
      writeLine(env.stdout, `Television registered ${artifactPath}.`);
    });

  program
    .command("create-url-artifact")
    .description(
      "Create a URL artifact that points at an absolute http(s) URL. Television records the pointer only and does not own or modify the remote page.",
    )
    .requiredOption("--channel <id>", "Target channel ID")
    .requiredOption("--title <title>", "Artifact title")
    .requiredOption("--url <url>", "http(s) URL")
    .option("--focus-artifact", "Focus the new artifact after creation")
    .option("--no-focus", "Create the artifact in the background without changing focus")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .addHelpText("after", buildArtifactWorkflowHelpNote(true))
    .action(async (opts: { channel: string; title: string; url: string; port?: number }) => {
      const shouldFocus = resolveFocusDirective(argv, "create-url-artifact", "--focus-artifact");
      const artifactURL = opts.url.trim();
      const client = createAuthenticatedClient(opts);
      const { artifact } = await client.artifacts.create({
        kind: "url",
        url: artifactURL,
        title: opts.title,
        channelID: opts.channel,
      });
      if (shouldFocus) {
        await client.display.focus({ artifactID: artifact.id });
      }

      writeLine(env.stdout, `URL artifact ${artifact.id} created.`);
      writeLine(env.stdout, `Television registered ${artifactURL}.`);
    });

  program
    .command("update-artifact")
    .description(
      "Update artifact metadata in place: --title on any artifact, --path to repoint a path artifact, --url to repoint a URL artifact. ID and kind are immutable. The server validates the new pointer; for path artifacts the target must exist (trailing separator optional) and the content watcher follows it.",
    )
    .requiredOption("--id <id>", "Artifact ID")
    .option("--title <title>", "New title")
    .option("--path <path>", "New absolute path for a path artifact: markdown/HTML file or indexed directory (trailing separator optional)")
    .option("--url <url>", "New http(s) URL for a URL artifact")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { id: string; title?: string; path?: string; url?: string; port?: number }) => {
      if (opts.title === undefined && opts.path === undefined && opts.url === undefined) {
        throw createDirectiveError("tv update-artifact requires at least one of --title, --path, or --url.");
      }
      if (opts.path !== undefined && opts.url !== undefined) {
        throw createDirectiveError("tv update-artifact accepts --path or --url, not both; an artifact's kind is immutable.");
      }
      const client = createAuthenticatedClient(opts);
      await client.artifacts.update({
        artifactID: opts.id,
        ...(opts.title !== undefined ? { title: opts.title } : {}),
        ...(opts.path !== undefined ? { path: opts.path.trim() } : {}),
        ...(opts.url !== undefined ? { url: opts.url.trim() } : {}),
      });
      writeLine(env.stdout, `Artifact ${opts.id} updated.`);
    });

  program
    .command("delete-artifact")
    .description(
      "Delete an artifact registry record, remove its card from its owning channel, and delete its metadata. Television never removes or mutates the pointed-to path or URL.",
    )
    .requiredOption("--id <id>", "Artifact ID")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { id: string; port?: number }) => {
      const client = createAuthenticatedClient(opts);
      const result: DeleteArtifactResult = await client.artifacts.delete({ artifactID: opts.id });
      for (const line of formatDeleteArtifactResult(result)) {
        writeLine(env.stdout, line);
      }
    });

  program
    .command("get-artifact")
    .description("Fetch an artifact's metadata as JSON")
    .requiredOption("--id <id>", "Artifact ID")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { id: string; port?: number }) => {
      const client = createAuthenticatedClient(opts);
      writeJSON(env.stdout, await client.artifacts.get({ artifactID: opts.id }));
    });

  program
    .command("list-artifacts")
    .description(
      "List artifacts as JSON. With no filter, every artifact is returned. --channel <id> filters to artifacts on that channel.",
    )
    .option("--channel <id>", "Filter to artifacts on this channel")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { channel?: string; port?: number }) => {
      const client = createAuthenticatedClient(opts);
      const filter: { channelID?: string } = {};
      if (opts.channel !== undefined) filter.channelID = opts.channel;
      writeJSON(env.stdout, await client.artifacts.list(filter));
    });

  // The share commands (specs/arch/resources/index.md#^rs-share-cli-integration).
  program
    .command("share-artifact")
    .description("Create or change an artifact's share link, and print it")
    .requiredOption("--id <id>", "Artifact ID")
    .addOption(new Option("--access <level>", "Access the link gives; read when left out, which refuses an existing read-write link").choices(ACCESS_LEVELS))
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { id: string; access?: AccessLevel; port?: number }) => {
      const client = createAuthenticatedClient(opts);
      // Without --access the server applies the default (specs/product/resources/resources.md#^rs-share-cli).
      const shared = await client.resources.share({ artifactID: opts.id, ...(opts.access === undefined ? {} : { access: opts.access }) });
      // The server gives the link's path apart from its origins; the CLI only joins them.
      for (const origin of shared.origins) writeLine(env.stdout, formatLink(env.stdout, `${origin}${shared.path}`));
    });

  program
    .command("unshare-artifact")
    .description("Revoke an artifact's share link")
    .requiredOption("--id <id>", "Artifact ID")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { id: string; port?: number }) => {
      const client = createAuthenticatedClient(opts);
      await client.resources.unshare({ artifactID: opts.id });
      writeLine(env.stdout, `Artifact ${opts.id} is no longer shared.`);
    });

  program
    .command("create-channel")
    .description(
      "Create a new channel. Pick --focus-channel when the user should be taken to the new channel immediately (creating a workspace they're about to use), or --no-focus to create it in the background without disturbing their current view. A new channel starts empty; create new path or URL artifacts on it with the create-*-artifact commands using --channel.",
    )
    .requiredOption("--name <name>", "Channel name")
    .option("--focus-channel", "Focus the new channel after creating it")
    .option("--no-focus", "Create the channel in the background without changing focus")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { name: string; port?: number }) => {
      const shouldFocus = resolveFocusDirective(argv, "create-channel", "--focus-channel");
      const client = createAuthenticatedClient(opts);
      const { channel } = await client.channels.create({ name: opts.name });
      if (shouldFocus) {
        await client.display.patch({ focusedChannelId: channel.id });
      }
      writeLine(env.stdout, `Channel created: ${channel.id} (${channel.name})`);
    });

  program
    .command("update-channel")
    .description("Rename a channel in place")
    .requiredOption("--channel <id>", "Channel ID")
    .requiredOption("--name <name>", "New channel name")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { channel: string; name: string; port?: number }) => {
      const client = createAuthenticatedClient(opts);
      const { channel } = await client.channels.update({
        channelID: opts.channel,
        name: opts.name,
      });
      writeLine(env.stdout, `Channel updated: ${channel.id} (${channel.name})`);
    });

  program
    .command("remove-channel")
    .description(
      "Delete a channel. Artifacts on the channel are permanently deleted from the Television registry; their pointed-to path or URL targets are not touched.",
    )
    .requiredOption("--channel <id>", "Channel ID")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { channel: string; port?: number }) => {
      const client = createAuthenticatedClient(opts);
      const result = await client.channels.remove({ channelID: opts.channel });
      for (const line of formatChannelRemovalResult(result)) {
        writeLine(env.stdout, line);
      }
    });

  program
    .command("list-channels")
    .description("List all channels")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { port?: number }) => {
      const client = createAuthenticatedClient(opts);
      writeJSON(env.stdout, await client.channels.list());
    });

  program
    .command("get-channel")
    .description(
      "Get a channel and its path/url artifact records as JSON. With no --channel, auto-selects when exactly one channel exists; otherwise --channel is required.",
    )
    .option("--channel <id>", "Channel ID (auto-selects if only one exists)")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { channel?: string; port?: number }) => {
      const client = createAuthenticatedClient(opts);
      writeJSON(env.stdout, await client.channels.get({ channelID: opts.channel }));
    });

  program
    .command("focus-status")
    .description(
      "Print display state as JSON: the active (persistently focused) channel ID and the active theme ID.",
    )
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { port?: number }) => {
      const client = createAuthenticatedClient(opts);
      const display = await client.display.get();
      writeJSON(env.stdout, {
        activeChannelID: display.focusedChannelId,
        activeThemeName: display.activeThemeName,
        acpEnabled: display.acpEnabled,
      });
    });

  program
    .command("focus-channel")
    .description(
      "Set persistent channel focus. The change is broadcast to every connected GUI client and survives reconnects. This is the right command when the user wants to switch to a different channel and stay there. For just nudging attention to a specific artifact (which may live on the current channel), prefer `tv focus-artifact`.",
    )
    .requiredOption("--channel <id>", "Channel ID")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { channel: string; port?: number }) => {
      const client = createAuthenticatedClient(opts);
      await client.display.patch({ focusedChannelId: opts.channel });
      writeLine(env.stdout, `Focused channel ${opts.channel}.`);
    });

  program
    .command("set-theme")
    .description(
      "Activate an installed display theme by its exact theme ID, or use `none` to run without a theme.",
    )
    .argument("<theme>", "Exact theme ID to activate, or `none` to use no theme")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .addHelpText("after", [
      "",
      "Examples:",
      "  tv set-theme paperlike    Activate the `paperlike` theme.",
      "  tv set-theme none         Use no theme (case-insensitive).",
      "",
      "Note:",
      "  `none` means no theme."
    ].join("\n"))
    .action(async (theme: string, opts: { port?: number }) => {
      const client = createAuthenticatedClient(opts);
      let previousSelection: string | null = null;
      let previousSelectionAvailable = false;
      try {
        previousSelection = (await client.display.get()).activeThemeName;
        previousSelectionAvailable = true;
      } catch {
        // Selection context is optional; activation remains the command's operation.
      }

      const nextSelection = theme.toLowerCase() === "none" ? null : theme;
      if (nextSelection !== null) {
        const registry = await client.themes.refresh();
        const validationError = registry.errors.find((entry) => entry.folder === theme);
        if (validationError !== undefined) {
          throw new ValidationError(`Theme folder ${theme} is invalid: ${validationError.error}`);
        }
      }
      await client.display.patch({ activeThemeName: nextSelection });

      const nextLabel = nextSelection ?? "None";
      if (!previousSelectionAvailable) {
        writeLine(env.stdout, `Active theme: '${nextLabel}'.`);
        return;
      }
      const previousLabel = previousSelection ?? "None";
      if (previousSelection === nextSelection) {
        writeLine(env.stdout, `Active theme unchanged: '${nextLabel}'.`);
        return;
      }
      writeLine(env.stdout, `Active theme changed from '${previousLabel}' to '${nextLabel}'.`);
    });

  program
    .command("themes-path")
    .description("Print the themes directory of the selected home as JSON")
    .action(() => {
      writeJSON(env.stdout, { themesPath: path.join(resolveHome(), "themes") });
    });

  program
    .command("focus-artifact")
    .description(
      "Send a transient focus nudge for a specific artifact. Connected clients select the artifact's tab page and switch to its channel when needed. This is NOT persisted as state — there is no concept of a 'focused artifact' that survives reconnects (the focused channel is persistent, but artifact focus is a one-shot event).",
    )
    .requiredOption("--id <id>", "Artifact ID")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { id: string; port?: number }) => {
      const client = createAuthenticatedClient(opts);
      const result = await client.display.focus({ artifactID: opts.id });
      writeLine(env.stdout, `Focused artifact ${result.artifactID} on channel ${result.channelID}.`);
    });

  const skillsCommand = program
    .command("skills")
    .description("Manage the bundled Television skills")
    .addHelpText("after", [
      "",
      "This command group manages the bundled Television skill collection.",
      "`tv skills install <path>` copies the bundled Television skills into the destination agent skills folder.",
      "Examples: ~/.openclaw/skills, ~/.hermes/skills, ~/.agents/skills.",
      "`tv skills install -i` runs the external skills installer against Television's bundled skills root.",
    ].join("\n"));

  skillsCommand
    .command("install")
    .description("Copy bundled Television skills into an agent harness skills folder, or run the external installer against the bundled skills root")
    .argument("[path]", "Destination agent skills folder (for example: ~/.openclaw/skills, ~/.hermes/skills, ~/.agents/skills)")
    .option("-i, --interactive", "Run the external skills installer against the bundled Television skills root")
    .option("--installed-by-agent <agent-runtime-harness-name>", "Agent runtime harness name performing this install")
    .action(async function (inputPath: string | undefined, opts: { interactive?: boolean; installedByAgent?: string }) {
      const home = resolveHome();
      const bundledTelevisionSkillsCollectionRoot = env.resolveBundledSkillsRoot();
      if (opts.interactive) {
        if (inputPath) {
          throw createDirectiveError("tv skills install -i does not take a destination path.");
        }
        if (!bundledTelevisionSkillsCollectionRoot) {
          throw new Error("Could not resolve the bundled Television skills root.");
        }
        const args = ["add", bundledTelevisionSkillsCollectionRoot];
        await env.runSkillsInstaller(args);
        await emitSkillInstallTelemetry({
          home,
          agentType: "interactive-install",
          ...(opts.installedByAgent === undefined ? {} : { installedByAgent: opts.installedByAgent }),
        });
        return;
      }
      if (!inputPath) {
        throw createDirectiveError(
          "tv skills install requires a destination agent skills folder, or -i for interactive.",
        );
      }
      if (!bundledTelevisionSkillsCollectionRoot) {
        throw new Error("Could not resolve the bundled Television skills root.");
      }
      const destinationRoot = path.resolve(inputPath);
      const copied = copyBundledSkillsToDestination(bundledTelevisionSkillsCollectionRoot, destinationRoot);
      writeLine(env.stdout, `Copied ${copied.length} bundled Television skill(s):`);
      for (const skill of copied) {
        writeLine(env.stdout, `- ${skill.name}`);
        writeLine(env.stdout, `  from: ${skill.sourcePath}`);
        writeLine(env.stdout, `  to:   ${skill.destinationPath}`);
      }
      await emitSkillInstallTelemetry({
        home,
        agentType: deriveAgentTypeFromPath(destinationRoot).agent_type,
        ...(opts.installedByAgent === undefined ? {} : { installedByAgent: opts.installedByAgent }),
      });
    });

  const telemetryCommand = program
    .command("telemetry")
    .description("Control telemetry for the running Television server");

  telemetryCommand
    .command("disable")
    .description("Disable telemetry for the running Television server")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { port?: number }) => {
      const client = createAuthenticatedClient(opts);
      writeJSON(env.stdout, await client.telemetry.disable());
    });

  telemetryCommand
    .command("enable")
    .description("Enable telemetry for the running Television server")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { port?: number }) => {
      const client = createAuthenticatedClient(opts);
      writeJSON(env.stdout, await client.telemetry.enable());
    });

  program
    .command("stop")
    .description("Stop the Television system service")
    .action(async () => {
      await uninstallPersistedService(resolveHome());
    });

  program
    .command("links")
    .description("Print connect links for the running Television server")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { port?: number }) => {
      const serverURL = resolveServerURL(opts.port);
      const token = readAuthToken(resolveHome());
      const client = env.createClient(serverURL, token);
      for (const link of await connectLinks(serverURL, token, client, await client.health())) writeLine(env.stdout, link);
    });

  program
    .command("status")
    .description("Print the selected home, server health, version, telemetry state, and service status as JSON")
    .option("--port <number>", "Server port; required when the config file sets port 0", parseClientPortOption)
    .action(async (opts: { port?: number }) => {
      const home = resolveHome();
      // Config and client-port failures are command errors, not an unhealthy server.
      const serverURL = resolveServerURL(opts.port);
      const result: {
        home: string;
        serverURL: string;
        healthy: boolean;
        version?: string;
        bindAddresses?: string[];
        port?: number;
        daemon?: { installed: boolean; running: boolean };
        telemetry?: TelemetryStatus;
      } = {
        home,
        serverURL,
        healthy: false,
      };

      try {
        const client = env.createClient(serverURL, readAuthToken(home));
        const health = await client.health();
        result.healthy = true;
        if (health.version !== undefined) result.version = health.version;
        result.bindAddresses = health.bindAddresses;
        result.port = health.port;
        result.telemetry = await client.telemetry.status();
      } catch {
        // server not reachable
      }

      try {
        const daemon = env.createDaemon();
        result.daemon = await daemon.status();
      } catch {
        // daemon check not supported on this platform
      }

      writeJSON(env.stdout, result);
    });

  registerResourceCommands(program);

  return program;

  /**
   * The `tv resource` family (specs/product/resources/resources.md#^rs-cli) and
   * its `json` commands (specs/product/resources/json-store.md#^js-cli). Each
   * calls the shared client's resource methods
   * (specs/arch/resources/index.md#^rs-cli-integration).
   */
  function registerResourceCommands(parent: Command): void {
    const portOption = () => new Option("--port <number>", "Server port; required when the config file sets port 0").argParser(parseClientPortOption);
    // Runs until SIGINT or SIGTERM, which end the command with status 0.
    const untilSignal = (): AbortSignal => {
      const controller = new AbortController();
      env.onSignal("SIGINT", () => controller.abort());
      env.onSignal("SIGTERM", () => controller.abort());
      return controller.signal;
    };
    // A path of `/` addresses the whole value, as an omitted optional path does.
    const storePath = (jsonPath: string | undefined): string => (jsonPath === undefined || jsonPath === "/" ? "" : jsonPath);
    // A value is JSON text given as one argument, or read from the file `--file`
    // names, where `-` means standard input. The CLI parses it before calling.
    const readValue = async (text: string | undefined, file: string | undefined, required: boolean): Promise<JSONValue | undefined> => {
      const invocation = formatEnteredInvocation(argv);
      if (text !== undefined && file !== undefined) {
        throw createDirectiveError(`${invocation} takes a value or --file <path>, not both.`);
      }
      let source = text;
      if (file === "-") {
        source = await readStandardInput();
      } else if (file !== undefined) {
        try {
          source = readFileSync(file, "utf8");
        } catch (error) {
          throw createDirectiveError(`${invocation} could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (source === undefined) {
        if (required) throw createDirectiveError(`${invocation} requires <value> or --file <path>.`);
        return undefined;
      }
      try {
        return JSON.parse(source) as JSONValue;
      } catch (error) {
        throw createDirectiveError(`${invocation} received a value that is not JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    // `set` and `update` take one argument after the store, with no --file, as the value for the whole value.
    const pathAndValue = (first: string | undefined, second: string | undefined, file: string | undefined): [string | undefined, string | undefined] =>
      second === undefined && file === undefined ? [undefined, first] : [first, second];

    const resource = parent
      .command("resource")
      .description("Read, write and watch the data that artifacts and agents share");

    resource
      .command("list")
      .description("Print every resource, or the resources an artifact is bound to with its access, as JSON")
      .option("--artifact <artifact-id>", "List the resources this artifact is bound to, its own store included once written")
      .addOption(portOption())
      .action(async (opts: { artifact?: string; port?: number }) => {
        const client = createAuthenticatedClient(opts);
        const resources = await client.resources.list(opts.artifact === undefined ? {} : { artifactID: opts.artifact });
        writeJSON(env.stdout, { resources });
      });

    resource
      .command("info")
      .description("Print a resource's metadata and bindings as JSON")
      .argument("<resource-id>", "Resource ID")
      .addOption(portOption())
      .action(async (resourceID: string, opts: { port?: number }) => {
        const client = createAuthenticatedClient(opts);
        writeJSON(env.stdout, { resource: await client.resources.info({ resourceID }) });
      });

    resource
      .command("describe")
      .description("Change a resource's description, its usage, or both")
      .argument("<resource-id>", "Resource ID")
      .argument("[description]", "The whole description, as one argument on one line")
      .option("--usage <text>", "The whole usage: how the content is structured and the rules its readers and writers follow; may span several lines")
      .addOption(portOption())
      .action(async (resourceID: string, description: string | undefined, opts: { usage?: string; port?: number }) => {
        if (description === undefined && opts.usage === undefined) {
          throw createDirectiveError("tv resource describe needs a description, --usage <text>, or both.");
        }
        const client = createAuthenticatedClient(opts);
        await client.resources.describe({
          resourceID,
          ...(description === undefined ? {} : { description }),
          ...(opts.usage === undefined ? {} : { usage: opts.usage }),
        });
        const changed = description === undefined ? "usage" : opts.usage === undefined ? "description" : "description and usage";
        writeLine(env.stdout, `Resource ${resourceID} ${changed} updated.`);
      });

    resource
      .command("destroy")
      .description("Destroy a resource; refused while any artifact is bound to it, unless --force")
      .argument("<resource-id>", "Resource ID")
      .option("--force", "Destroy the resource and remove its bindings")
      .addOption(portOption())
      .action(async (resourceID: string, opts: { force?: boolean; port?: number }) => {
        const client = createAuthenticatedClient(opts);
        const { removedBindings } = await client.resources.destroy(opts.force ? { resourceID, force: true } : { resourceID });
        writeLine(
          env.stdout,
          removedBindings.length > 0
            ? `Resource ${resourceID} destroyed; removed bindings for ${removedBindings.map((binding: ResourceBinding) => binding.artifactID).join(", ")}.`
            : `Resource ${resourceID} destroyed.`,
        );
      });

    resource
      .command("events")
      .description("Print each resource event as it happens, one JSON line each, until interrupted")
      .addOption(portOption())
      .action(async (opts: { port?: number }) => {
        const client = createAuthenticatedClient(opts);
        await client.resources.events({ onEvent: (event) => writeJSON(env.stdout, event), signal: untilSignal() });
      });

    // With the bindings flag off, as shipped, neither binding command nor `json create` exists (specs/arch/resources/index.md#^rs-cli-integration).
    if (env.resourceBindings) {
      resource
        .command("bind")
        .description("Let an artifact's page use a resource, or change its access")
        .argument("<resource-id>", "Resource ID")
        .argument("<artifact-id>", "Artifact ID")
        .addOption(new Option("--access <level>", "Access the artifact's page gets").choices(ACCESS_LEVELS).makeOptionMandatory())
        .addOption(portOption())
        .action(async (resourceID: string, artifactID: string, opts: { access: AccessLevel; port?: number }) => {
          const client = createAuthenticatedClient(opts);
          const { authRequired } = await client.resources.bind({ resourceID, artifactID, access: opts.access });
          writeLine(env.stdout, `Artifact ${artifactID} bound to resource ${resourceID} with ${opts.access} access.`);
          if (!authRequired) writeLine(env.stderr, TOKENLESS_BIND_WARNING);
        });

      resource
        .command("unbind")
        .description("Remove an artifact's binding to a resource")
        .argument("<resource-id>", "Resource ID")
        .argument("<artifact-id>", "Artifact ID")
        .addOption(portOption())
        .action(async (resourceID: string, artifactID: string, opts: { port?: number }) => {
          const client = createAuthenticatedClient(opts);
          await client.resources.unbind({ resourceID, artifactID });
          writeLine(env.stdout, `Artifact ${artifactID} unbound from resource ${resourceID}.`);
        });
    }

    const json = resource.command("json").description("Read, write and watch JSON stores");

    // A JSON verb's store is exactly one of --artifact and --resource (specs/product/resources/json-store.md#^js-cli-store).
    const storeCommand = (name: string): Command =>
      json
        .command(name)
        .option("--artifact <artifact-id>", "Use this artifact's own store")
        .option("--resource <resource-id>", "Use the store with this resource ID");
    const storeAddress = (opts: { artifact?: string; resource?: string }): StoreAddress => {
      if ((opts.artifact === undefined) === (opts.resource === undefined)) {
        throw createDirectiveError(`${formatEnteredInvocation(argv)} needs exactly one of --artifact <artifact-id> and --resource <resource-id>.`);
      }
      return opts.artifact === undefined ? { resourceID: opts.resource! } : { artifactID: opts.artifact };
    };
    // How a confirmation line names the store: as the command addressed it.
    const updatedLine = (store: StoreAddress): string => `JSON store ${"artifactID" in store ? `of artifact ${store.artifactID}` : store.resourceID} updated.`;
    type StoreOptions = { artifact?: string; resource?: string; port?: number };

    if (env.resourceBindings) {
      json
        .command("create")
        .description("Create a JSON store, empty or holding a value, and print its resource ID")
        .argument("[value]", "The store's value as JSON text")
        .addOption(new Option("--description <text>", "The store's description, on one line").makeOptionMandatory())
        .option("--usage <text>", "The store's usage: how its content is structured and the rules its readers and writers follow; may span several lines")
        .option("--file <path>", "Read the value from a file; - reads standard input")
        .addOption(portOption())
        .action(async (text: string | undefined, opts: { description: string; usage?: string; file?: string; port?: number }) => {
          const value = await readValue(text, opts.file, false);
          const client = createAuthenticatedClient(opts);
          const { resourceID } = await client.resources.json.create({
            description: opts.description,
            ...(opts.usage === undefined ? {} : { usage: opts.usage }),
            ...(value === undefined ? {} : { value }),
          });
          writeJSON(env.stdout, { resourceID });
        });
    }

    storeCommand("get")
      .description("Print the value at a path as JSON, saying whether it exists")
      .argument("[path]", "Path within the store; / or none for the whole value")
      .addOption(portOption())
      .action(async (jsonPath: string | undefined, opts: StoreOptions) => {
        const store = storeAddress(opts);
        const client = createAuthenticatedClient(opts);
        writeJSON(env.stdout, await client.resources.json.get({ store, path: storePath(jsonPath) }));
      });

    storeCommand("set")
      .description("Replace the value at a path")
      .argument("[path]", "Path within the store; / or none for the whole value")
      .argument("[value]", "The value as JSON text")
      .option("--file <path>", "Read the value from a file; - reads standard input")
      .addOption(portOption())
      .action(async (first: string | undefined, second: string | undefined, opts: StoreOptions & { file?: string }) => {
        const store = storeAddress(opts);
        const [jsonPath, text] = pathAndValue(first, second, opts.file);
        const value = (await readValue(text, opts.file, true))!;
        const client = createAuthenticatedClient(opts);
        await client.resources.json.set({ store, path: storePath(jsonPath), value });
        writeLine(env.stdout, updatedLine(store));
      });

    storeCommand("update")
      .description("Write several paths at once, from a JSON object of paths relative to <path> and their values")
      .argument("[path]", "Path within the store; / or none for the whole value")
      .argument("[values]", "A JSON object of relative paths and values")
      .option("--file <path>", "Read the values from a file; - reads standard input")
      .addOption(portOption())
      .action(async (first: string | undefined, second: string | undefined, opts: StoreOptions & { file?: string }) => {
        const store = storeAddress(opts);
        const [jsonPath, text] = pathAndValue(first, second, opts.file);
        const values = await readValue(text, opts.file, true);
        if (typeof values !== "object" || values === null || Array.isArray(values)) {
          throw createDirectiveError(`${formatEnteredInvocation(argv)} requires a JSON object of paths and values.`);
        }
        const client = createAuthenticatedClient(opts);
        await client.resources.json.update({ store, path: storePath(jsonPath), values });
        writeLine(env.stdout, updatedLine(store));
      });

    storeCommand("push")
      .description("Add a value under a new generated key at a path, and print the key")
      .argument("<path>", "Path within the store")
      .argument("[value]", "The value as JSON text")
      .option("--file <path>", "Read the value from a file; - reads standard input")
      .addOption(portOption())
      .action(async (jsonPath: string, text: string | undefined, opts: StoreOptions & { file?: string }) => {
        const store = storeAddress(opts);
        const value = (await readValue(text, opts.file, true))!;
        const client = createAuthenticatedClient(opts);
        const key = generatePushKey();
        await client.resources.json.push({ store, path: storePath(jsonPath), key, value });
        writeJSON(env.stdout, { key });
      });

    storeCommand("remove")
      .description("Delete the value at a path")
      .argument("<path>", "Path within the store")
      .addOption(portOption())
      .action(async (jsonPath: string, opts: StoreOptions) => {
        const store = storeAddress(opts);
        const client = createAuthenticatedClient(opts);
        await client.resources.json.remove({ store, path: storePath(jsonPath) });
        writeLine(env.stdout, updatedLine(store));
      });

    storeCommand("watch")
      .description("Print the value at a path as JSON, then the latest value whenever it changes, until interrupted")
      .argument("[path]", "Path within the store; / or none for the whole value")
      .addOption(portOption())
      .action(async (jsonPath: string | undefined, opts: StoreOptions) => {
        const store = storeAddress(opts);
        const client = createAuthenticatedClient(opts);
        await client.resources.json.watch({
          store,
          path: storePath(jsonPath),
          onValue: (result) => writeJSON(env.stdout, result),
          signal: untilSignal(),
        });
      });
  }
}

export function listVisibleCLICommandNames(): string[] {
  const sink: Writable = { write: () => true };
  const program = createProgram(createEnvironment({ stdout: sink, stderr: sink }));
  return program.commands
    .filter((command) => !(command as unknown as { _hidden?: boolean })._hidden)
    .map((command) => command.name());
}

export async function runCLI(argv: string[], environment: Partial<CLIEnvironment> = {}): Promise<number> {
  const env = createEnvironment(environment);
  const { command, retired, remaining } = extractRetiredOptions(argv);
  const retiredService = retired.length > 0 ? readRetiredServiceDefinition(command, retired, remaining, process.env) : undefined;
  if (retired.length > 0 && !retiredService) {
    // Each retired option given, once, in the order it first appears.
    const named = [...new Set(retired.map((option) => option.name))].join(", ");
    env.stderr.write(`${ensureHelpPointer(`This version of Television does not accept ${named}. ${RETIRED_OPTIONS_GUIDANCE}`)}\n`);
    return 1;
  }
  if (process.env[TELEMETRY_LAUNCH_MODE_ENV] !== "daemon" && (process.env.TELEVISION_PORT || process.env.TELEVISION_STORAGE_PATH)) {
    writeLine(env.stderr, LEGACY_VARIABLES_WARNING);
  }
  const invocation: CLIInvocation = { argv, ...(retiredService ? { retiredService } : {}) };

  try {
    const program = createProgram(env, invocation);
    if (argv.length === 0) {
      program.outputHelp();
      return 0;
    }

    await program.parseAsync(remaining, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof Error && "exitCode" in error) {
      const commanderError = error as Error & { exitCode: number };
      if (commanderError.exitCode === 0) return 0;
      const formattedCommanderError = formatCommanderError(argv, commanderError);
      if (formattedCommanderError) {
        env.stderr.write(`${formattedCommanderError.message}\n`);
        return 1;
      }
      return 1;
    }

    env.stderr.write(`${formatCLIError(error, invocation)}\n`);
    return exitStatusFromError(error) ?? 1;
  }
}

/**
 * Resolves once everything written to `stream` so far has been handed to the
 * operating system. A write to a pipe waits in the process while the reader
 * catches up, and exiting at once would drop it.
 */
function finishWriting(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    stream.write("", () => resolve());
  });
}

if (!isVitestRuntime()) {
  const ARGV_SKIP = 2;
  void runCLI(process.argv.slice(ARGV_SKIP)).then(async (exitCode) => {
    await Promise.all([finishWriting(process.stdout), finishWriting(process.stderr)]);
    process.exit(exitCode);
  });
}

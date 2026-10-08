*The `packages/cli` module and packaged `tv` binary: source-module contracts, home and config resolution, command runtime boundaries, build assets, and service integration.*

# CLI architecture

The CLI turns `tv` arguments into requests to a Television server and packages the files that a standalone installation needs. It finds the folder that holds an installation's settings and data, and reads the same settings whether it starts the server or talks to one. This document defines the code boundaries that keep command parsing, settings, server startup, service installation, and packaged assets connected correctly.

This spec owns the architecture of `packages/cli`: the source-module surface used by tests and development tooling, dependency-injection boundary used by tests, packaged binary layout, command-to-client contracts, server and daemon integration, path resolution for bundled assets, and setup procedures. It also owns the contract of the [Television home](../../product/cli.md#^cli-home) resolver and config-file reader and writer that the CLI imports from the server package, and one buffer on the otherwise code-authoritative ACP bridge and web chat: the [home context](#^cli-acp-home-context) a server gives the ACP agents it launches. User-facing behavior is owned by [product/cli.md](../../product/cli.md).

This spec does not own the shared HTTP client, server REST API, the storage layout inside a home beyond the config file, daemon library behavior, artifact model, or renderer internals. It references those boundaries only where the CLI constructs or calls them.

The standalone [administrator guide](admin-guide.md) has its own procedural-authority and publication contract.

## Module boundary and published surface

The npm package `@telepath-computer/television` is executable-only. Its published surface is the `tv` binary declared at `bin.tv`, which points at `dist/cli.cjs`. The package metadata does not declare a `main` module or an `exports` map. Published consumers should invoke `tv`; they should not import `@telepath-computer/television` as a module.

`packages/cli/src/index.ts` is the source executable entrypoint and the source module used by tests. The runtime executable calls `runCLI(process.argv.slice(2))` and exits the process with the returned code when the `isVitestRuntime()` check says the process is not running under Vitest. Tests call `runCLI` directly with an injected `CLIEnvironment`. Command construction, helper functions, formatter functions, and per-command action functions are internal implementation details.

The source module's exported surface is:

```ts
export interface CLIEnvironment { /* full shape defined under Contract surface */ }

// Type-only adapter declarations; full shapes are under Contract surface.
export type { Writable, CLIServer, CLIServerOptions, CLIDaemonOptions, CLIDaemon };

export const PORT_ZERO_WARNING: string;

export function inspectTelemetryBuildConfig(
  env?: TelemetryEnv,
  options?: { developerHost?: boolean },
): {
  telemetryBuild: string | null;
  telemetrySuppressionReason: "do-not-track" | "ci" | "development" | "developer-host" | null;
  posthogProject: {
    projectId: number;
    projectToken: string;
    ingestionHost: string;
  } | null;
};
export function resolveStaticDir(): string | undefined;
export function resolveBundledViewsPath(): string | undefined;
export function resolveCanonicalDir(): string | undefined;
export function resolveOnboardingContentPath(): string | undefined;
export function resolveBundledThemesPath(): string | undefined;
export function resolveBundledSkillsRoot(): string | undefined;
export function resolveSdkDir(): string | undefined;

export function listVisibleCLICommandNames(): string[];
export function runCLI(
  argv: string[],
  environment?: Partial<CLIEnvironment>,
): Promise<number>;
```

## Contract surface

The CLI's dependency boundary is `CLIEnvironment`. Tests and other programmatic callers may replace any subset of the environment; missing fields are filled with production defaults before command execution. The contract types are:

```ts
import type { Daemon } from "@rupertsworld/daemon";
import type {
  ACPAgentProfile,
  LaunchMode,
  Server,
  SkillInstalledTelemetryOptions,
} from "@telepath-computer/television-server";
import type { TelevisionClient } from "@telepath-computer/television-shared";

export type Writable = {
  write(chunk: string | Uint8Array): unknown;
  /** True when the stream is an interactive terminal; decides link formatting. */
  isTTY?: boolean;
};

export type CLIServer = Pick<
  Server,
  "start" | "dispose" | "getAuthToken" | "getOrigins" | "getListeningPort"
>;

export type CLIServerOptions = {
  home: string; // absolute Television home
  listen: string[];
  port: number;
  auth: boolean;
  installedByAgent?: string;
  staticDir?: string;
  canonicalDir?: string;
  bundledViewsPath?: string;
  onboardingContentPath?: string;
  bundledThemesPath?: string;
  sdkDir?: string;
  acpProfile?: ACPAgentProfile;
  launchMode: LaunchMode;
  resourceBindings: boolean; // the bindings flag (resources/index.md)
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
  resolveHomeDir: () => string; // the operating-system home directory, not the Television home
  runSkillsInstaller: (args: string[]) => Promise<void>;
  emitSkillInstalledTelemetry: (
    options: SkillInstalledTelemetryOptions,
  ) => Promise<void>;
  onSignal: (signal: NodeJS.Signals, handler: () => void) => void;
}
```

`CLIDaemon.status()` must resolve to an object with `installed: boolean` and `running: boolean`; those fields are read by `tv status` and `tv serve --persist`.

## Home and config resolution

The [Television home](../../product/cli.md#^cli-home) and its [config file](../../product/cli.md#^cli-config-file) are product concepts. The server package's config module, `packages/server/src/config.ts`, implements their resolver, reader, and writer, and `@telepath-computer/television-server` exports them for the CLI:

```ts
/** The object stored in `<home>/config.json`. Every key is optional. */
export interface TelevisionConfigFile {
  port?: number;
  listen?: string[];
  auth?: boolean;
  installedByAgent?: string;
}

/** The file's values, with absent keys filled from the code defaults. */
export interface TelevisionSettings {
  port: number; // default DEFAULT_SERVER_PORT (32848)
  listen: string[]; // default []
  auth: boolean; // default true
  installedByAgent?: string; // default absent
}

export interface TelevisionConfig {
  home: string; // absolute
  configPath: string; // <home>/config.json
  configFileExists: boolean;
  settings: TelevisionSettings;
}

/** An unreadable, malformed, or invalid config file, or an invalid update. */
export class TelevisionConfigError extends Error {
  readonly configPath: string;
}

export function resolveTelevisionHome(input: {
  homeOption: string | undefined; // the global --home value
  operatingSystemHomeDir: string; // holds .tv-home and the built-in default .television
  cwd: string;
}): string;

export function readTelevisionConfig(home: string): TelevisionConfig;

export function updateTelevisionConfig(
  home: string,
  changes: TelevisionConfigFile,
): TelevisionConfig;
```

`resolveTelevisionHome` applies the product's [selection order](../../product/cli.md#^cli-home-selection): `homeOption`, then the default home. Only when `homeOption` is absent does it read `.tv-home` in `operatingSystemHomeDir`. A missing file selects `.television` in `operatingSystemHomeDir`. Otherwise it trims the file's contents and applies the product's [pointer-file rules](../../product/cli.md#^cli-home-pointer): it replaces a leading `~` or `~/` with `operatingSystemHomeDir` and resolves any other relative path against `operatingSystemHomeDir`. It resolves a relative `homeOption` against `cwd`, and returns an absolute path without resolving symbolic links. An empty or whitespace-only `homeOption` throws an `Error` that names `--home`. A `.tv-home` read failure other than a missing file, or contents the product rules reject, throw an `Error` that names the file's path and the problem. The CLI supplies `CLIEnvironment.resolveHomeDir()` as `operatingSystemHomeDir`, so tests can exercise the default home and `.tv-home` without touching the real ones.

`readTelevisionConfig` reads `<home>/config.json`. A missing file yields `configFileExists: false` and the default settings. Any other read failure, malformed JSON, a top level that is not an object, an unknown key, or an invalid value throws `TelevisionConfigError` with a message that names `configPath` and the problem. `port` is valid when it is an integer from `0` through `65535`, and each `listen` item when it is a string holding one IPv4 address as Node's `net.isIPv4` defines it. The reader returns no partial result and consults no environment variable. ^cli-config-reader

`updateTelevisionConfig` implements `tv config set`. It reads the stored object without validating its values, treating a missing file as `{}`; an unreadable file, malformed JSON, or a top level that is not an object throws `TelevisionConfigError`. It replaces the keys present in `changes` and validates the complete result by the reader's rules. It then creates `home` and its parents when missing, writes the result as JSON with two-space indentation and a trailing newline to a temporary file in `home`, and renames that file over `config.json`. A failure before the rename removes the temporary file and leaves `config.json` unchanged. It returns the new config as `readTelevisionConfig` would read it. ^cli-config-writer

The CLI parses each `tv config set` value from its string form before calling `updateTelevisionConfig`: `port` with the whole-decimal parser in `0..65535`, `auth` from exactly `true` or `false`, `listen` by splitting on commas, trimming, and dropping empty entries, and `installedByAgent` unchanged. An invocation with no pairs, an odd number of arguments, an unknown or repeated key, or a value that does not parse is a directive error raised before the call.

The server package reads no port or storage-path environment variable. `TELEVISION_RENDERER_URL`, ACP profile resolution, developer-home handling, telemetry controls, and update-channel overrides remain process environment and are unrelated to the home.

## Command parser and error normalization

The command tree is built with Commander. `runCLI` creates a fresh program for each invocation, configures stdout/stderr to use `CLIEnvironment`, disables Commander suggestions, registers `-v`, `-V`, and `--version` for version output, registers the global `--home <path>` program option, adds the help notes defined by the product spec, and calls `program.parseAsync(argv, { from: "user" })`. A command that uses the home resolves it once, by calling `resolveTelevisionHome` with the parsed `--home` value, `CLIEnvironment.resolveHomeDir()`, and `process.cwd()`. No environment variable selects the home. Help and version output resolve no home. Version output starts with the CLI package's exact release version and follows the conditional developer-commit format defined in [the product CLI](../../product/cli.md#^cli-developer-version). Runtime [developer-host marker](../../product/telemetry.md#^developer-host-project-guard) detection checks for `.tv-developer` under `CLIEnvironment.resolveHomeDir()`; it does not invoke Git.

`runCLI` returns an exit code instead of throwing or calling `process.exit`:

- `0` when help/version output or a command action succeeds;
- `1` when Commander rejects arguments/options or any action throws, unless the thrown error carries a valid process exit status (an integer `exitStatus` from `1` through `255`), in which case `runCLI` returns that status.

There is no distinct usage-error exit code in `tv`. The only current carrier of a distinct status is listener-bind failure, which exits `69`; that contract is owned by [the startup bind-failure spec](./startup-bind-failure.md#^exit-69).

Argument and option errors are converted into Television's CLI error wording when Commander throws an error carrying `exitCode`:

| Commander code | CLI formatting rule |
|---|---|
| `commander.unknownCommand` | `Unknown tv command: <entered command tokens without tv>.` plus the help pointer. |
| `commander.excessArguments` | For `tv help ...`, `tv <entered argv tokens> does not accept additional arguments.` plus the help pointer. |
| `commander.unknownOption` | `tv <entered argv tokens> does not support <option>.` plus the help pointer. |
| `commander.missingMandatoryOptionValue` | `tv <entered argv tokens> requires <option>.` plus the help pointer. |
| `commander.missingArgument` | `tv <entered argv tokens> requires <argument>.` plus the help pointer. |
| `commander.invalidArgument` | `tv <entered argv tokens> received an invalid argument: <commander message without error prefix>` plus the help pointer. |

`<entered argv tokens>` preserves every argv token the CLI received after `tv`, in order, including option names and option values. The formatter may quote a token only to keep whitespace or shell-significant characters readable. It must not drop option values or rebuild the command name from only non-option tokens.

`runCLI` checks the argument tokens for the [retired options](../../product/cli.md#^cli-retired-options) before Commander parses them, so their refusal comes before help, version, every other argument error, and home resolution. The check matches each retired option alone and in `--option=value` form: `--storage-path` in any invocation, and `--port`, `--listen`, `--auth`, `--no-auth`, and `--installed-by-agent` when the command is `serve`. Tokens after a `--` terminator are operands, not options. A match writes the product's guidance and the help pointer to stderr and returns `1`. `serve` registers none of its retired options and no command registers `--storage-path`, so their help does not list them, and the check neither validates nor uses the values given with them. Client commands keep their `--port`, and `tv skills install` keeps `--installed-by-agent`.

The check does not refuse on the [transitional path for services installed by earlier releases](../../product/cli.md#^cli-retired-service-compat): when `TELEVISION_LAUNCH_MODE=daemon`, the command is `serve` with neither `--persist` nor `--persist-uninstall`, and no `--home` is given. The CLI then selects the home from the `--storage-path` value, when there is one, as it would from `--home`. When `<home>/config.json` does not exist, it writes the settings with `updateTelevisionConfig`, so they are validated and the file is replaced atomically. `TELEVISION_PORT` is parsed as a `tv config set port` value and ignored when it does not parse, and each `--listen` value is split on commas as `tv config set listen` values are. The CLI then records the log entry and serves as foreground `tv serve` does for that home. Linear TV-871 tracks removing this path.

When the check does not refuse, and `TELEVISION_LAUNCH_MODE` is not `daemon`, `runCLI` writes the product's [legacy-variable warning](../../product/cli.md#^cli-legacy-selectors) to stderr if `TELEVISION_PORT` or `TELEVISION_STORAGE_PATH` is non-empty, before Commander parses the arguments.

Errors thrown by command actions are formatted by shape:

- CLI directive errors print their message; the message already contains the product help pointer.
- Shared-client local validation errors print their message plus the product help pointer.
- Home-resolution errors and `TelevisionConfigError` print their message plus the product help pointer.
- Request errors with `serverURL`, `message`, and numeric `status: 401` print the unauthorized token-file hint naming `<home>/state/token` for the invocation's resolved home.
- Request errors with `serverURL`, `message`, and another numeric `status` print `message` plus the help pointer.
- Request errors with `serverURL` and `message` but no numeric `status` print `Could not reach Television server at <serverURL>: <message>`.
- Any other `Error` prints `error.message`; non-`Error` values are stringified.

The shared client uses a local validation error, not a no-status request error, when `get-channel` cannot auto-select a channel. The CLI therefore reports the channel-selection problem directly instead of formatting it as a reachability failure.

Client `--port` values are parsed as whole decimal integer strings and range-checked against `1..65535`; `tv config set port` values use the same parser against `0..65535`. Values with trailing text, no digits, signs, decimals, or values outside the range are rejected. When a client command accepts `--port` is owned by [the product's client-port rule](../../product/cli.md#^cli-client-port).

## Client boundary

Commands that contact the server construct clients with:

```ts
const { settings, configPath } = readTelevisionConfig(home);
// port is settings.port, or the required --port value when settings.port is 0
const client = env.createClient(buildServerURL("localhost", port), readAuthToken(home));
```

The config is read before the client is constructed, so an invalid config fails before any request. When `settings.port` is `0`, a missing `--port` is a directive error naming `configPath`; when `settings.port` is nonzero, a supplied `--port` is a directive error naming `configPath` and the configured port ([product client-port rule](../../product/cli.md#^cli-client-port)). Token lookup reads `<home>/state/token`, trims it, and passes `undefined` when the file is missing or trims to an empty string.

The CLI contract with `TelevisionClient` is the exact set of client calls each command makes:

| Command | Client call(s) |
|---|---|
| `create-path-artifact` | `client.artifacts.create({ kind: "path", path: opts.path.trim(), title, channelID })`; if focused, `client.display.focus({ artifactID })`. |
| `create-url-artifact` | `client.artifacts.create({ kind: "url", url: opts.url.trim(), title, channelID })`; if focused, `client.display.focus({ artifactID })`. |
| `update-artifact` | `client.artifacts.update({ artifactID, title?, path?: opts.path.trim(), url?: opts.url.trim() })`. |
| `delete-artifact` | `client.artifacts.delete({ artifactID })`. |
| `get-artifact` | `client.artifacts.get({ artifactID })`. |
| `list-artifacts` | `client.artifacts.list({})` or `client.artifacts.list({ channelID })`. |
| `create-channel` | `client.channels.create({ name })`; if focused, `client.display.patch({ focusedChannelId: channel.id })`. |
| `update-channel` | `client.channels.update({ channelID, name })`. The command passes both values unchanged and formats the returned channel's id and name in its success output. |
| `remove-channel` | `client.channels.remove({ channelID })`. |
| `list-channels` | `client.channels.list()`. |
| `get-channel` | `client.channels.get({ channelID: opts.channel })`. |
| `focus-status` | `client.display.get()`, projected to the public `activeChannelID`, `activeThemeName`, and `acpEnabled` fields. |
| `focus-channel` | `client.display.patch({ focusedChannelId: channelID })`. |
| `set-theme` | First attempt `client.display.get()` to capture the selection in effect when the command began; a failure marks the previous selection unavailable and does not abort. For any case-insensitive spelling of `none`, call `client.display.patch({ activeThemeName: null })` without refreshing. Otherwise preserve the theme ID argument exactly, call `client.themes.refresh()`, report an error when the refreshed registry contains one for that exact theme ID, then call `client.display.patch({ activeThemeName: themeID })`. After a successful patch, print the applicable success form below. |
| `focus-artifact` | `client.display.focus({ artifactID })`. |
| `status` | `client.health()`, then `client.telemetry.status()`, inside a health check that catches all errors. Health fields are assigned before the telemetry call, so a telemetry failure preserves `healthy: true`, `version`, `bindAddresses`, and `port` while omitting `telemetry`. `home` comes from the invocation's resolved home, and the config read and client-port rule run before the health check, so their failures are command errors rather than `healthy: false`. |
| `links` | `client.health()`, then an authenticated request through the client to learn whether the running server accepts the home's token, and an unauthenticated one to learn whether it requires a token at all. Each origin in the health response's `origins` ([the server's origins](#^cli-server-origins)) becomes `buildConnectURL(origin, token)`, in the order the response gives them, where `token` is the `readAuthToken(home)` value when the server requires a token and `null` otherwise. A failed health request, or a `401` for the home's token, is a command error. The config file's `auth` setting does not decide token inclusion, because the server reads it only at startup. |
| `serve --persist` | After `daemon.install()` resolves, `client.health()` until a call resolves or the [health-check deadline](#^cli-persist-health-check) passes; then, when it [prints links](#^cli-persist-links-calls), the calls `links` makes. |
| `telemetry enable` | `client.telemetry.enable()`. |
| `telemetry disable` | `client.telemetry.disable()`. |
| `resource` and its subcommands | The calls the [resource architecture](../resources/index.md#^rs-cli-integration) and the [JSON store architecture](../resources/json-store.md#^js-arch-cli) define. |
| `share-artifact`, `unshare-artifact` | The calls the [resource architecture](../resources/index.md#^rs-share-cli-integration) defines. |

Every link the CLI prints — the connect links `tv serve` and `tv serve --persist` print, `tv links` output and the share links `tv share-artifact` prints — passes through one formatter that wraps it as an OSC-8 hyperlink only when the output stream it writes to reports `isTTY` as `true`, and writes the plain URL otherwise ([product link output](../../product/cli.md#^cli-link-output)).

The health response may supply an exact release version. `tv status` copies that value unchanged, including the `0.0.0` development sentinel, and omits `version` when the health response does not supply the field. Other health fields pass through unchanged.

**Buffer: the server's origins.** After `start()`, `Server.getOrigins()` returns the origins the server can be reached at ([connect links](../../product/cli.md#^cli-connect-link)): for each resolved bind address in order, `http://<address>:<port>` with the port it bound, except that `0.0.0.0` becomes one origin for each IPv4 address that `os.networkInterfaces()` reports when it is called, in that order, loopback included. An origin that would repeat appears once. `GET /health` carries the list as `origins`, beside `bindAddresses` and `port`, and the share reply carries it with the link's path ([resources](../resources/index.md#^rs-share-cli-integration)). `/health` answers without the token, so anyone who can reach the server can read the machine's IPv4 addresses when it listens on `0.0.0.0`; serving the list from a response that requires the token is [TV-952](https://linear.app/telepath-computer/issue/TV-952). The server's other routes stay code-authoritative. ^cli-server-origins

Help and user-facing command documentation describe `none` as using no theme, without the internal term `null theme`. Successful `set-theme` output renders non-null selections as exact theme IDs and `null` as the product's user-facing `None` label. A known changed selection prints exactly `Active theme changed from '<previous>' to '<new>'.`; a known unchanged selection prints exactly `Active theme unchanged: '<selection>'.`; and an unavailable previous selection prints only `Active theme: '<new>'.`. The opening display read's failure is suppressed. A refresh, registry error, or display write failure produces no success output.

## Server process boundary

`tv serve` composes the server but does not reimplement server behavior. Before constructing a server, the CLI:

1. rejects `--persist` together with `--persist-uninstall`;
2. resolves the home, which locates `<home>/logs/tv.log` for records written when startup is refused before binding;
3. handles `--persist-uninstall` through the daemon boundary;
4. reads the config with `readTelevisionConfig(home)`, recording a `TelevisionConfigError` as a refused startup before rethrowing it;
5. resolves the optional ACP agent profile and checks that its command is available before starting the server;
6. prints `PORT_ZERO_WARNING` to stderr when foreground `tv serve` reads config port `0`.

Foreground `tv serve` calls `env.createServer` with a `CLIServerOptions` value: `home`; the settings' `listen`, `port`, `auth`, and `installedByAgent`; the resolved static, canonical, bundled-view, onboarding, bundled-theme, and [resource SDK](../resources/sdk.md#^sdk-packaging) paths; the optional ACP profile; `launchMode`; and the environment's `resourceBindings`. `launchMode` is `"daemon"` only when `TELEVISION_LAUNCH_MODE=daemon`; every other value resolves to `"cli"`. The production `createServer` constructs a `ServerStore` whose `storagePath` is `home`, passes bundled view, onboarding, and bundled-theme paths when present, and always sets `installOnboardingChannels: true`. It passes `sdkDir` to `Server` when present, and `resourceBindings` always. It passes `auth` to `Server` explicitly, including the config default `true`, because the `Server` constructor's own default is tokenless. It passes the launch mode and optional installed-by agent value into the server's telemetry options. `Server` and `ServerStore` keep their constructor options, so package tests and embedders construct isolated servers directly without a home or config file. ^cli-serve-adapter

After `server.start()` succeeds, `tv serve` prints its [startup output](../../product/cli.md#^cli-startup-links). When `env.stdout.isTTY` is `true`, it prints a connect link for each of `server.getOrigins()`, carrying `server.getAuthToken()` only when `auth === true`. Under config port `0`, `Server.start()` binds the first listener to an operating-system-chosen port and reuses that port for every other listener, so the origins carry the acquired port. Otherwise it prints the `tv links` line, whose command carries `--home <home>` with the absolute home when the invocation chose the home, with `--home` or with the storage path of the [transitional service path](../../product/cli.md#^cli-retired-service-compat), and `--port <server.getListeningPort()>` when config port is `0`; a home whose path holds a character outside letters, digits and `_@%+=:,./-` is single-quoted for a POSIX shell. A hidden `--print-links` flag, which help does not list, makes `tv serve` and `tv serve --persist` print the links whatever stdout is. The repository's tests pass it to find a server they start ([test-runner recipe](../test-runner/test-runner.md#^test-dynamic-ports)); it is not a product option. The command then registers `SIGINT` and `SIGTERM` handlers via `env.onSignal`; the first signal calls `server.dispose(signal)`, and later signals during shutdown are ignored.

If `TELEVISION_ACP_AGENT` resolves to `openclaw` or `hermes`, the CLI requires the selected command to be executable on `PATH` before constructing the server. Unsupported `TELEVISION_ACP_AGENT` values throw from the server config helper before binding. The ACP bridge itself is outside this CLI spec.

**Buffer: ACP agent home context.** A server that launches an ACP agent tells the agent how its `tv` commands reach this server. In the Television context block the agent receives alongside its prompts, whenever that block is sent and whether or not a channel is attached, the server supplies `--home <absolute-home>` for the home it serves, and adds `--port <port>` with its acquired port only when config port is `0`. No environment variable carries these values. The agent's `tv` commands then reach this server whether it serves the default home, a home given with `--home`, or a development server's own home. This requirement binds the server's ACP bridge (`packages/server/src/acp-bridge.ts`) and the web client's ACP client (`packages/web/src/services/acp-client.ts`), which assembles the context; under the [migration map's buffer rule](../../spec-migration.md), their other behavior stays code-authoritative. ^cli-acp-home-context

## Daemon boundary

The daemon name is `com.television.server`; the daemon description is `Television server — virtual display for agents`.

Persisted service creation passes a `CLIDaemonOptions` value: the absolute home and the persisted environment. Before calling `env.createDaemon`, `tv serve --persist` reads the config, refuses an effective port `0`, builds the persisted environment, and runs the ACP command check below, so none of those failures inspects, uninstalls, or replaces an existing service ([product persisted validation](../../product/cli.md#^cli-persist-config-validation)). The daemon command is `process.execPath`, and daemon args are built as:

```ts
[process.argv[1] ?? "tv", "--home", home, "serve"]
```

`home` is the absolute path from `resolveTelevisionHome`, so a service whose working directory differs from the installing shell's still reads the same home. The arguments carry no settings; each boot reads the home's config file. ^cli-daemon-home-args

`tv serve --persist` calls `buildPersistedACPEnvironment(process.env, { developerHome: env.resolveHomeDir() })`, then adds `TELEVISION_LAUNCH_MODE=daemon`. The persisted environment contains:

- the exact `PATH`, which is required;
- non-empty telemetry-control values `DO_NOT_TRACK`, `CI`, and `TV_TELEMETRY_TEST` ([product/telemetry.md](../../product/telemetry.md));
- non-empty update-channel values `TV_UPDATE_CHANNEL_URL` and `TV_UPDATE_CHANNEL_POLL_INTERVAL_MS` ([update-channel capture](../updates/update-channel.md#^hook-persist-capture));
- `TELEVISION_DEVELOPER_HOME`, set from `env.resolveHomeDir()` so daemon boots resolve the installing user's `.tv-developer` marker;
- `TELEVISION_LAUNCH_MODE=daemon`;
- `TELEVISION_ACP_AGENT` and matching `OPENCLAW_*` or `HERMES_*` variables when an ACP agent is configured.

Exact empty telemetry-control and update-channel values are omitted. `HOME` is not captured; the service's home is an argument. Sensitive env values are redacted in logs when their keys start with `OPENCLAW_` or `HERMES_`, or end with `_API_KEY`, `_TOKEN`, `_SECRET`, or `_PASSWORD`. ^ac-persist-telemetry-env

When an ACP agent is configured for persistence, `tv serve --persist` checks the agent command against the environment that will be stored for the service before creating a daemon. If the command is not resolvable, install aborts before touching an existing service.

Install refresh is deliberately simple: `daemon.status()` runs first; if `installed` or `running` is true, the CLI calls `daemon.uninstall()`; then it calls `daemon.install()`. Install success and failure are logged with the command, arguments, and redacted environment. If uninstall succeeds and install fails, the service remains down.

When `settings.auth` is true, `tv serve --persist` first makes the home's token through a [token-only `ServerStore` construction](../onboarding/installer.md#^token-only-boot) for `home`, which creates `<home>/state/token` when it is missing and does not create `config.json`, so the service starts with it.

After `daemon.install()` resolves, the CLI performs the [product health wait](../../product/cli.md#^cli-persist-health-wait). It constructs a client as the [client boundary](#Client boundary) describes, with `settings.port`, and calls its `health()` until a call resolves, pausing briefly after each rejected call. The 15-second deadline starts when `install()` resolves and bounds every call: a call still pending at the deadline counts as no answer, so a peer that accepts the connection and never responds cannot hold the command open. A resolved `health()` is the whole test. The CLI does not compare the response with the installation, so any server that answers the health request on that port, such as a foreground `tv serve` already using it, satisfies it. ^cli-persist-health-check

The deadline allows for one restart by the service manager. A startup that fails for a reason that clears on its own, such as the reinstall race against a terminating prior instance or a listener address that appears moments later, makes the server exit; the service manager relaunches it after its [restart cadence](./startup-bind-failure.md#Generated service definitions), at most about 10 seconds on macOS, and the relaunched server still has time to answer before the deadline.

When the deadline passes without an answer, the CLI writes a `persisted service did not respond` record to `<home>/logs/tv.log` with the daemon name, the health URL, and the deadline in milliseconds. It then writes the telemetry notice when [the notice rule](../../product/telemetry.md#^disclose-cli) calls for one, because the service is installed, and throws the [product error](../../product/cli.md#^cli-persist-health-timeout), which `runCLI` writes to stderr with exit status `1`. It does not call the daemon again. When the server answers, the CLI writes its startup output, below, and then the notice.

Once a server answers, the CLI prints `Television service installed.` and then, when `env.stdout.isTTY` is `true` or `--print-links` is given, `Open Television:` and the links that `links` prints, through the same calls, from the health response that answered ([persisted links](../../product/cli.md#^cli-persist-links)). The health-check deadline also bounds those calls, so one still pending when it passes ends them. When stdout is not a terminal and the flag is absent, or when those calls fail or have not finished by the deadline, it prints the `tv links` line instead, carrying `--home` as foreground startup's does. ^cli-persist-links-calls

`tv stop` and `tv serve --persist-uninstall` both call `env.createDaemon()` with no options, call `daemon.uninstall()`, log to `<home>/logs/tv.log` for the resolved home, and print `{ "status": "stopped" }`. Neither reads the config file.

## Commands that do not contact the server

`tv themes-path` resolves the home and prints `{ "themesPath": path.join(home, "themes") }`. `tv config show` prints the `readTelevisionConfig(home)` result with an absent `installedByAgent` rendered as `null`. `tv config set` parses its pairs and calls `updateTelevisionConfig(home, changes)`, then prints the product's confirmation with the returned `configPath`. None of these commands, `tv stop`, `tv serve --persist-uninstall`, or `tv skills install` constructs a client or accepts a client `--port`; of them, only `tv config show` and `tv config set` read the config file. ^cli-home-only-commands

## Bundled skills boundary

`resolveBundledSkillsRoot()` finds Television's bundled skill collection, not the external installer covered by the product spec's [interactive external installer exception](../../product/cli.md#^cli-installer-exception). In a built CLI, it resolves `./skills` relative to the real path of `process.argv[1]`. In development, it resolves `packages/skills/dist` relative to the CLI package.

`tv skills install <path>` copies only child directories of the bundled skill root, sorted by directory name. It creates the destination root, removes any existing destination directory for each skill with `rmSync(..., { recursive: true, force: true })`, and copies the bundled directory recursively. Before reporting success it also removes `<path>/tv-theme` recursively when present, as required by the product's [bundled-skill install contract](../../product/cli.md#bundled-skill-commands); that path is the migration target for the standalone theming bundle, not a member of the current skills manifest. If the destination root exists and is not a directory, the command throws.

`tv skills install -i` resolves the external Vercel `skills` package binary (`skills/bin/cli.mjs`) and spawns:

```ts
process.execPath, [skillsInstallerBin, "add", bundledSkillsRoot]
```

with stdio inherited. A non-zero child status throws `skills add <bundled-root> failed (exit <status-or-signal>)`.

`tv skills install` rejects unknown options with the normal Commander unknown-option path, which the CLI formats as a directive error with the bundled-skills recovery pointer.

After a successful direct copy, the CLI derives `agentType` with `deriveAgentTypeFromPath(destinationRoot)`; interactive mode uses `"interactive-install"`. It calls `env.emitSkillInstalledTelemetry` with the resolved home as `storagePath`, CLI version, agent type, optional installed-by agent value, and current environment. The call is best-effort and bounded to one second: rejection or timeout prints nothing and cannot fail the completed install. Failed copy or installer paths do not emit. Event meaning and content constraints are owned by the telemetry product spec's [event list](../../product/telemetry.md#What we measure) and [property definitions](../../product/telemetry.md#What we record about each event).

The skills workspace build reads the explicit manifest `packages/skills/skills.json`, builds or copies only the listed skills into `packages/skills/dist/<name>/`, validates each emitted `SKILL.md`, and reports but ignores unlisted source directories. The CLI package build copies that manifest-produced `dist/` tree, so packaged skill membership is controlled by the manifest rather than directory discovery.

## Experimental ACP agent wiring

The ACP bridge is development-facing, opt-in behavior, not part of the public CLI product surface. The CLI owns the startup and persisted-service wiring needed to pass an ACP profile into the server, and the [home-context buffer](#^cli-acp-home-context). Apart from that buffer, the `/acp` WebSocket endpoint and chat UI behavior are server and web concerns outside this CLI architecture spec.

The foreground startup mechanics are defined in [#Server process boundary](#Server process boundary). The persisted-service environment and command-resolution mechanics are defined in [#Daemon boundary](#Daemon boundary). Keep ACP behavior changes in those boundary sections so this unsupported-feature note does not become a separate source of truth.

## Build and packaged asset layout

`packages/cli/package.json` publishes package `@telepath-computer/television`, with `bin.tv: "dist/cli.cjs"` and `files: ["dist/**"]`. It intentionally does not declare `main` or `exports`, because the published package surface is the `tv` executable rather than an importable module. The package root also carries the canonical Television `LICENSE`, which npm includes automatically, while `dist/THIRD-PARTY-NOTICES.txt` covers redistributed dependencies; their generation and packed-artifact enforcement are owned by [arch/licensing.md](../licensing.md).

`packages/cli/build.mjs` builds the publishable CLI. A full build:

1. removes `packages/cli/dist/`;
2. builds `@telepath-computer/television-web`;
3. builds `@telepath-computer/television-server`;
4. builds `@telepath-computer/television-skills`;
5. runs `packages/cli/build-views.mjs`;
6. bundles `packages/cli/src/index.ts` with esbuild into `packages/cli/dist/cli.cjs` as a Node CJS executable with a shebang and requests its licensing metafile;
7. marks `dist/cli.cjs` executable;
8. persists the CLI surface inventory and writes the preliminary CLI-only `dist/THIRD-PARTY-NOTICES.txt`;
9. copies renderer output to `dist/web/`;
10. copies the missing-artifact view to `dist/views/artifact-missing/`;
11. copies every canonical artifact version to `dist/canonical/`, and the server's built [resource SDK](../resources/sdk.md#^sdk-build) tree, `packages/server/dist/sdk/`, to `dist/sdk/`;
12. verifies that `packages/server/dist/onboarding/onboarding-channels.json` exists, then copies the whole server onboarding content tree to `dist/onboarding/`;
13. copies the validated server bundled-theme tree to `dist/themes/`;
14. copies the manifest-produced skill bundles to `dist/skills/`;
15. replaces the preliminary notices with the aggregate generated from the CLI, web, bundled-view, and skill inventories while preserving the per-directory notices inside copied outputs;
16. copies the repository-root `LICENSE` to `packages/cli/LICENSE`, byte-identically.

The licensing inventory, notice aggregation, and license propagation mechanics are owned by [arch/licensing.md](../licensing.md). This section records their placement in the CLI build so the package-layout contract remains complete.

The esbuild define values are part of the contract for the packaged runtime:

```ts
__TV_STATIC_DIR__ = "./web";
__TV_VIEWS_DIR__ = "./views";
__TV_CANONICAL_DIR__ = "./canonical";
__TV_ONBOARDING_CONTENT_DIR__ = "./onboarding";
__TV_BUNDLED_THEMES_DIR__ = "./themes";
__TV_SDK_DIR__ = "./sdk";
__TV_TELEMETRY_BUILD__ = process.env.TV_NPM_RELEASE === "1" ? "production" : "development";
__TV_VERSION__ = packageJson.version;
__TV_DEVELOPER_COMMIT__ = developerCommitSha;
```

Every `build.mjs` mode, including `--outfile`, determines `developerCommitSha` before bundling. The build checks for `.tv-developer` under `os.homedir()`. Without the marker, `developerCommitSha` is `undefined` and the build does not require Git commit provenance. With the marker, the build resolves the repository's full `HEAD` commit SHA from Git and bakes it as a string; failure to resolve a commit fails the build rather than producing an unstamped executable. The stamp records the checked-out commit and does not claim that the worktree has no uncommitted changes. ^cli-developer-build-stamp

The version flags append the baked commit only when it is a non-empty string and `.tv-developer` exists under `CLIEnvironment.resolveHomeDir()` at invocation time. Direct source execution has no baked commit. This annotation changes only the version flags' display: `__TV_VERSION__`, package metadata, server construction, health advertisement, and status output continue to use the exact release version. Telemetry applies its [privacy-preserving version classification](../telemetry/derivation.md#Behavior).

`inspectTelemetryBuildConfig(env, options)` exposes the baked telemetry-build marker, the current environment suppression reason, and the selected PostHog project as a build diagnostic. Build-marker selection follows [telemetry release build configuration](../telemetry/sink.md#Behavior and operations); direct source execution has no baked telemetry marker and reports `null`.

The onboarding content schema, source tree, and server build validation remain owned by [arch/onboarding/content.md](../onboarding/content.md). This spec owns the CLI build's copy into `dist/onboarding/`, the build-time path constant, and the runtime resolver that hands that directory to the serving store. [Bundled theme installation](../themes/bundled-installation.md) owns the corresponding theme source, package copies, resolver, and store handoff. The [resource SDK spec](../resources/sdk.md) owns the SDK's source, its build into the server package, and how the server serves it; this spec owns the CLI build's copy into `dist/sdk/`, its path constant, and the resolver that hands the directory to the server.

The external Vercel `skills` package is not bundled; it remains a runtime dependency so the packaged CLI can resolve its executable.

`build.mjs --outfile <path>` builds only a standalone executable bundle at the requested path. It does not copy renderer, view, canonical, SDK, onboarding, theme, or skill assets, and it does not claim a shipped-surface inventory, notices tree, or package-root license copy. Tests use this mode when they need a binary outside the repository tree.

`build-views.mjs` reads `packages/cli/bundled-views.json`, builds each declared view workspace, copies the workspace `dist/` to `packages/cli/dist/views/<view-id>/`, and fails unless `manifest.json` exists at the destination. The current bundled view manifest maps `markdown` to `packages/view-markdown`.

The exported asset resolvers follow this contract:

| Resolver | Built CLI | Development fallback |
|---|---|---|
| `resolveStaticDir()` | `realpath(dirname(process.argv[1]))/web` when it contains `index.html`; otherwise `undefined`. | `packages/web/dist` when it contains `index.html`. |
| `resolveBundledViewsPath()` | `realpath(dirname(process.argv[1]))/views` when it exists. | `packages/cli/dist/views` when it exists. |
| `resolveCanonicalDir()` | `realpath(dirname(process.argv[1]))/canonical` when it exists. | `packages/server/dist/canonical` when it exists. |
| `resolveOnboardingContentPath()` | `realpath(dirname(process.argv[1]))/onboarding` when it exists. | `packages/server/assets/onboarding-channels` when it exists. |
| `resolveBundledThemesPath()` | `realpath(dirname(process.argv[1]))/themes` when it exists. | `packages/server/assets/themes` when it exists. |
| `resolveBundledSkillsRoot()` | `realpath(dirname(process.argv[1]))/skills` when it exists. | `packages/skills/dist` when it exists. |
| `resolveSdkDir()` | `realpath(dirname(process.argv[1]))/sdk` when it exists. | `packages/server/dist/sdk` when it exists. |

Resolver behavior against corrupted or partially populated build directories is deliberately untested. Full-build verification owns catching incomplete asset trees before a package ships; resolver tests cover successful lookup in the two supported layouts and do not restate build validation as missing-directory cases.

## Operations

Install workspace dependencies from the repository root:

```bash
npm install
```

Build the packaged CLI and its assets from the repository root:

```bash
npm --workspace @telepath-computer/television run build
# equivalent root shortcut:
npm run build:cli
```

Run the source CLI during development:

```bash
npx tsx packages/cli/src/index.ts <command> [options]
```

Run the built CLI:

```bash
packages/cli/dist/cli.cjs <command> [options]
# or
node packages/cli/dist/cli.cjs <command> [options]
```

Link the built CLI globally for local manual use:

```bash
npm run link
```

`npm run link` runs the full build first, then `npm link`, making `tv` resolve to `packages/cli/dist/cli.cjs`. `npm run unlink` removes that global link.

When testing or manually exercising server-backed commands, pass `--home <temp-dir>` to every command to keep the operator's default home, config file, and token out of the run. Persisted-service commands (`tv serve --persist`, `tv serve --persist-uninstall`, `tv stop`) mutate the host's user service state. Normal verification uses the fake `CLIEnvironment.createDaemon` contract boundary. The opt-in `daemon-acceptance` suite is the production exception: on an explicitly acknowledged designated host it invokes the packed, globally installed CLI against the literal production service and leaves that service absent afterward.

## Testing

The persisted-service paths — install, reinstall, an install whose server does not answer, stop, and uninstall — are proven by the `daemon-acceptance` suite, which [arch/test-runner/test-runner.md](../test-runner/test-runner.md) owns (Production daemon acceptance suite). That suite is not part of `verify` or CI: a developer runs it by hand, on a designated developer host. ^cli-persist-suite-note

Help is proven for top-level help and the `create-path-artifact`, `list-artifacts`, `update-channel`, and `set-theme` pages: those checks pin where the agent routing note appears ([product/cli.md](../../product/cli.md), Command model, help, version, and recovery text) and the option text those checks name. Checking every other subcommand's page would repeat them without catching another plausible, consequential failure.

No spawned CLI test covers a wildcard `listen` address. The config reader validates each `listen` item as an IPv4 address, and the CLI hands the same values, unchanged, to the server constructor, which resolves them with `resolveBindAddresses`; wildcard resolution, the wildcard listener and the expansion of `0.0.0.0` into origins are therefore proven on the server side and compose across that handoff ([arch/testing-policy.md#Compositional coverage across clean seams](../testing-policy.md#Compositional coverage across clean seams)). The product CLI proof's multi-listener acceptance ([proofs/product/cli.md#^cli-ac-multi-listener-success](../../../proofs/product/cli.md#^cli-ac-multi-listener-success)) covers foreground serve with several specific addresses.

The ACP wiring is experimental ([Experimental ACP agent wiring](#Experimental ACP agent wiring)), so the CLI suite proves only the missing-command startup failure and includes no ACP success test; the bridge, protocol, and agent behavior past the CLI handoff are governed by code rather than by a spec. The exception is the [home-context buffer](#^cli-acp-home-context): its proof shows that the context a launched agent receives carries `--home` with the served home, and `--port` only under config port `0`. A CLI-side success test becomes warranted only if ACP enters the supported product surface.

Interactive skills installation follows the product CLI's owned testing exception ([product/cli.md#^cli-installer-exception](../../product/cli.md#^cli-installer-exception)): for this spec, tests stop at the injected `runSkillsInstaller` boundary, and nothing runs the installer's terminal interface.

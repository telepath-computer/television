*The `packages/cli` module and packaged `tv` binary: source-module contracts, home and config resolution, command runtime boundaries, build assets, and service integration.*

# CLI architecture

The CLI turns `tv` arguments into requests to a Television server and packages the files that a standalone installation needs. It finds the folder that holds an installation's settings and data, and reads the same settings whether it starts the server or talks to one. This document defines the code boundaries that keep command parsing, settings, server startup, service installation, and packaged assets connected correctly.

This spec owns the architecture of `packages/cli`: the source-module surface used by tests and development tooling, dependency-injection boundary used by tests, packaged binary layout, server and daemon integration, path resolution for bundled assets, and setup procedures. It also owns the contract of the [Television home](../../product/cli.md#^cli-home) resolver and config-file reader and writer that the CLI imports from the server package, and one buffer on the otherwise code-authoritative ACP bridge and web chat: the [home context](#^cli-acp-home-context) a server gives the ACP agents it launches. User-facing behavior is owned by [product/cli.md](../../product/cli.md).

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
  "start" | "dispose" | "getBaseURL" | "getAuthToken"
> & {
  getBaseURLs?: () => string[];
};

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
  acpProfile?: ACPAgentProfile;
  launchMode: LaunchMode;
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

`resolveTelevisionHome` applies the product's [selection order](../../product/cli.md#^cli-home-selection) and [pointer-file rules](../../product/cli.md#^cli-home-pointer), reading `.tv-home` and placing the built-in `.television` in `operatingSystemHomeDir`. It resolves a relative `homeOption` against `cwd`, and returns an absolute path without resolving symbolic links. It throws an `Error` naming `--home` for an empty `homeOption`, and one naming the file's path and the problem for a `.tv-home` the product rules reject. The CLI supplies `CLIEnvironment.resolveHomeDir()` as `operatingSystemHomeDir`, so tests can exercise the default home and `.tv-home` without touching the real ones.

`readTelevisionConfig` reads `<home>/config.json` under the product's [config-file rules](../../product/cli.md#^cli-config-file). A missing file yields `configFileExists: false` and the default settings. A file the product rules reject throws `TelevisionConfigError` with a message that names `configPath` and the problem. Each `listen` item is valid when it is a string holding one IPv4 address as Node's `net.isIPv4` defines it. ^cli-config-reader

`updateTelevisionConfig` implements `tv config set`. It reads the stored object without validating its values, treating a missing file as `{}`; an unreadable file, malformed JSON, or a top level that is not an object throws `TelevisionConfigError`. It replaces the keys present in `changes` and validates the complete result by the reader's rules. It then creates `home` and its parents when missing, writes the result to a temporary file in `home`, and renames that file over `config.json`. A failure before the rename removes the temporary file and leaves `config.json` unchanged. It returns the new config as `readTelevisionConfig` would read it. ^cli-config-writer

The CLI parses each `tv config set` value from its string form under the product's [`tv config set` rules](../../product/cli.md#^cli-config-set) before calling `updateTelevisionConfig`. An invocation with no pairs, an odd number of arguments, an unknown or repeated key, or a value that does not parse is a directive error raised before the call.

`TELEVISION_RENDERER_URL`, ACP profile resolution, developer-home handling, telemetry controls, and update-channel overrides remain process environment and are unrelated to the home.

## Command parser and error normalization

The command tree is built with Commander. `runCLI` creates a fresh program for each invocation, writes through `CLIEnvironment`'s stdout and stderr, and disables Commander's suggestions. A command that uses the home resolves it once, by calling `resolveTelevisionHome` with the parsed `--home` value, `CLIEnvironment.resolveHomeDir()`, and `process.cwd()`. Runtime [developer-host marker](../../product/telemetry.md#^developer-host-project-guard) detection for the version output checks for `.tv-developer` under `CLIEnvironment.resolveHomeDir()`; it does not invoke Git.

`runCLI` returns an exit code instead of throwing or calling `process.exit`: `0` on success, and `1` when Commander rejects arguments or options or an action throws, unless the thrown error carries a valid process exit status (an integer `exitStatus` from `1` through `255`), in which case `runCLI` returns that status. Listener-bind failure is the one error that carries one ([startup bind failure](./startup-bind-failure.md#^exit-69)).

Argument and option errors are converted into Television's CLI error wording when Commander throws an error carrying `exitCode`:

| Commander code | CLI formatting rule |
|---|---|
| `commander.unknownCommand` | `Unknown tv command: <entered command tokens without tv>.` plus the help pointer. |
| `commander.excessArguments` | For `tv help ...`, `tv <entered argv tokens> does not accept additional arguments.` plus the help pointer. |
| `commander.unknownOption` | `tv <entered argv tokens> does not support <option>.` plus the help pointer. |
| `commander.missingMandatoryOptionValue` | `tv <entered argv tokens> requires <option>.` plus the help pointer. |
| `commander.missingArgument` | `tv <entered argv tokens> requires <argument>.` plus the help pointer. |
| `commander.invalidArgument` | `tv <entered argv tokens> received an invalid argument: <commander message without error prefix>` plus the help pointer. |

`<entered argv tokens>` follows the product's [directive-error rule](../../product/cli.md#Command model, help, version, and recovery text) for repeating the invocation.

`runCLI` checks the argument tokens for the [retired options](../../product/cli.md#^cli-retired-options) before Commander parses them. The check matches each retired option alone and in `--option=value` form: `--storage-path` in any invocation, and `--port`, `--listen`, `--auth`, `--no-auth`, and `--installed-by-agent` when the command is `serve`. Tokens after a `--` terminator are operands, not options. `serve` registers none of its retired options and no command registers `--storage-path`, so their help does not list them, and the check neither validates nor uses the values given with them. Client commands keep their `--port`, and `tv skills install` keeps `--installed-by-agent`.

On the [transitional path for services installed by earlier releases](../../product/cli.md#^cli-retired-service-compat), the CLI writes the settings with `updateTelevisionConfig`, so they are validated and the file is replaced atomically. `TELEVISION_PORT` is parsed as a `tv config set port` value, and each `--listen` value is split on commas as `tv config set listen` values are.

Errors thrown by command actions are formatted by shape:

- CLI directive errors print their message; the message already contains the product help pointer.
- Shared-client local validation errors print their message plus the product help pointer.
- Home-resolution errors and `TelevisionConfigError` print their message plus the product help pointer.
- Request errors with `serverURL`, `message`, and numeric `status: 401` print the unauthorized token-file hint naming `<home>/state/token` for the invocation's resolved home.
- Request errors with `serverURL`, `message`, and another numeric `status` print `message` plus the help pointer.
- Request errors with `serverURL` and `message` but no numeric `status` print `Could not reach Television server at <serverURL>: <message>`.
- Any other `Error` prints `error.message`; non-`Error` values are stringified.

The shared client uses a local validation error, not a no-status request error, when `get-channel` cannot auto-select a channel. The CLI therefore reports the channel-selection problem directly instead of formatting it as a reachability failure.

Client `--port` values and `tv config set port` values share one whole-decimal parser, which rejects trailing text, missing digits, signs, and decimals as well as values outside the range.

## Client boundary

Commands that contact the server construct a `TelevisionClient` for `http://localhost:<port>` under the product's [client-port rule](../../product/cli.md#^cli-client-port), with the home's token, after reading the config, so an invalid config or a refused `--port` fails before any request. Each command makes the shared-client calls its product behavior needs. Where the product behavior leaves the call sequence open, it is:

- `tv links` learns whether the running server requires a token from the server itself: after `client.health()`, it makes one request with the home's token, where a `401` is a command error, and one without a token, where a `401` means the server requires one. Each address in the health response's `bindAddresses`, with its `port`, becomes a connect link.
- `tv set-theme` with a theme ID other than `none` patches the display only after its theme-registry refresh succeeds and reports no validation error for that exact theme ID. `none` patches without refreshing. A refresh, registry error, or display write failure produces no success output.

## Server process boundary

`tv serve` composes the server but does not reimplement server behavior. Before constructing a server, the CLI:

1. rejects `--persist` together with `--persist-uninstall`;
2. resolves the home, which locates `<home>/logs/tv.log` for records written when startup is refused before binding;
3. handles `--persist-uninstall` through the daemon boundary;
4. reads the config with `readTelevisionConfig(home)`, recording a `TelevisionConfigError` as a refused startup before rethrowing it;
5. resolves the optional ACP agent profile and checks that its command is available before starting the server;
6. prints `PORT_ZERO_WARNING` to stderr when foreground `tv serve` reads config port `0`.

Foreground `tv serve` calls `env.createServer` with a `CLIServerOptions` value: `home`; the settings' `listen`, `port`, `auth`, and `installedByAgent`; the resolved static, canonical, bundled-view, onboarding, and bundled-theme paths; the optional ACP profile; and `launchMode`. `launchMode` is `"daemon"` only when `TELEVISION_LAUNCH_MODE=daemon`; every other value resolves to `"cli"`. The production `createServer` constructs a `ServerStore` whose `storagePath` is `home`, passes bundled view, onboarding, and bundled-theme paths when present, and always sets `installOnboardingChannels: true`. It passes `auth` to `Server` explicitly, including the config default `true`, because the `Server` constructor's own default is tokenless. It passes the launch mode and optional installed-by agent value into the server's telemetry options. `Server` and `ServerStore` keep their constructor options, so package tests and embedders construct isolated servers directly without a home or config file. ^cli-serve-adapter

After `server.start()` succeeds and the startup URLs are printed, the command registers `SIGINT` and `SIGTERM` handlers through `env.onSignal`; the first signal calls `server.dispose(signal)`, and later signals during shutdown are ignored.

If `TELEVISION_ACP_AGENT` resolves to `openclaw` or `hermes`, the CLI requires the selected command to be executable on `PATH` before constructing the server. Unsupported `TELEVISION_ACP_AGENT` values throw from the server config helper before binding. The ACP bridge itself is outside this CLI spec.

**Buffer: ACP agent home context.** A server that launches an ACP agent tells the agent how its `tv` commands reach this server. In the Television context block the agent receives alongside its prompts, whenever that block is sent and whether or not a channel is attached, the server supplies `--home <absolute-home>` for the home it serves, and adds `--port <port>` with its acquired port only when config port is `0`. No environment variable carries these values. The agent's `tv` commands then reach this server whether it serves the default home, a home given with `--home`, or a development server's own home. This requirement binds the server's ACP bridge (`packages/server/src/acp-bridge.ts`) and the web client's ACP client (`packages/web/src/services/acp-client.ts`), which assembles the context; under the [migration map's buffer rule](../../spec-migration.md), their other behavior stays code-authoritative. ^cli-acp-home-context

## Daemon boundary

The daemon name is `com.television.server`; the daemon description is `Television server — virtual display for agents`.

Persisted service creation passes a `CLIDaemonOptions` value: the absolute home and the persisted environment. `tv serve --persist` reads the config, refuses an effective port `0`, builds the persisted environment, and runs the ACP command check before calling `env.createDaemon`, so none of those failures touches an existing service ([product persisted validation](../../product/cli.md#^cli-persist-config-validation)). The daemon command is `process.execPath`, and daemon args are built as:

```ts
[process.argv[1] ?? "tv", "--home", home, "serve"]
```

`home` is the absolute path from `resolveTelevisionHome`, so a service whose working directory differs from the installing shell's still reads the same home. The arguments carry no settings; each boot reads the home's config file. ^cli-daemon-home-args

The persisted environment is the one the [product spec](../../product/cli.md#Server lifecycle commands) lists, captured from the installing process at install time, with `TELEVISION_DEVELOPER_HOME` taken from `env.resolveHomeDir()`. When an ACP agent is configured, its agent variables are `TELEVISION_ACP_AGENT` and every variable whose name starts with the selected agent's prefix, `OPENCLAW_` or `HERMES_`. Sensitive values are redacted in logs when their keys start with `OPENCLAW_` or `HERMES_`, or end with `_API_KEY`, `_TOKEN`, `_SECRET`, or `_PASSWORD`. ^ac-persist-telemetry-env

Install refresh is deliberately simple: `daemon.status()` runs first; if `installed` or `running` is true, the CLI calls `daemon.uninstall()`; then it calls `daemon.install()`. Install success and failure are logged with the command, arguments, and redacted environment. If uninstall succeeds and install fails, the service remains down.

After `daemon.install()` resolves, the CLI performs the [product health wait](../../product/cli.md#^cli-persist-health-wait). It constructs a client as the [client boundary](#Client boundary) describes, with `settings.port`, and calls its `health()` until a call resolves, pausing briefly after each rejected call. The 15-second deadline starts when `install()` resolves and bounds every call: a call still pending at the deadline counts as no answer, so a peer that accepts the connection and never responds cannot hold the command open. ^cli-persist-health-check

The deadline allows for one restart by the service manager. A startup that fails for a reason that clears on its own, such as the reinstall race against a terminating prior instance or a listener address that appears moments later, makes the server exit; the service manager relaunches it after its [restart cadence](./startup-bind-failure.md#Generated service definitions), at most about 10 seconds on macOS, and the relaunched server still has time to answer before the deadline.

When the deadline passes without an answer, the CLI writes a `persisted service did not respond` record to `<home>/logs/tv.log` with the daemon name, the health URL, and the deadline in milliseconds. It then writes the telemetry notice when [the notice rule](../../product/telemetry.md#^disclose-cli) calls for one, because the service is installed, and throws the [product error](../../product/cli.md#^cli-persist-health-timeout), which `runCLI` writes to stderr with exit status `1`. It does not call the daemon again. When the server answers, the CLI writes the connect URLs and then the notice.

`tv serve --persist` derives output addresses with `resolveBindAddresses(settings.listen)` and prints one connect URL for every resolved bind address with `settings.port`; it does not use the addresses in the health response. When `settings.auth` is true, the URLs carry the token from a [token-only `ServerStore` construction](../onboarding/installer.md#^token-only-boot) for `home`, which creates `<home>/state/token` when it is missing and does not create `config.json`.

`tv stop` and `tv serve --persist-uninstall` call `daemon.uninstall()` and log the removal to `<home>/logs/tv.log` for the resolved home.

## Bundled skills boundary

`tv skills install <path>` copies the child directories of the bundled skill root, sorted by directory name, replacing any existing destination directory of the same name and removing `<path>/tv-theme` as the product's [bundled-skill install contract](../../product/cli.md#bundled-skill-commands) requires. If the destination root exists and is not a directory, the command throws.

`tv skills install -i` runs the external installer through `CLIEnvironment.runSkillsInstaller`, whose production form spawns the external Vercel `skills` package binary (`skills/bin/cli.mjs`) with the current Node executable and stdio inherited. A non-zero child status throws `skills add <bundled-root> failed (exit <status-or-signal>)`.

After a successful install, the CLI emits the *skill installed* event through `env.emitSkillInstalledTelemetry`, passing the resolved home as `storagePath`; the [CLI emitter](../telemetry/emitters.md) owns what it sends, and the telemetry product spec's [event list](../../product/telemetry.md#What we measure) and [property definitions](../../product/telemetry.md#What we record about each event) own the event's meaning and content.

The CLI package build copies the skills workspace's built `dist/` tree, whose membership [arch/making-skills.md](../making-skills.md) owns, so packaged skill membership comes from the manifest rather than from directory discovery.

## Experimental ACP agent wiring

The ACP bridge is development-facing, opt-in behavior, not part of the public CLI product surface. The CLI owns the startup and persisted-service wiring needed to pass an ACP profile into the server, and the [home-context buffer](#^cli-acp-home-context). Apart from that buffer, the `/acp` WebSocket endpoint and chat UI behavior are server and web concerns outside this CLI architecture spec.

The foreground startup mechanics are defined in [#Server process boundary](#Server process boundary), and the persisted-service mechanics in [#Daemon boundary](#Daemon boundary).

## Build and packaged asset layout

`packages/cli/package.json` publishes package `@telepath-computer/television`, with `bin.tv: "dist/cli.cjs"` and `files: ["dist/**"]`, and no `main` or `exports` ([published surface](#Module boundary and published surface)). The package root also carries the canonical Television `LICENSE`, which npm includes automatically, while `dist/THIRD-PARTY-NOTICES.txt` covers redistributed dependencies; their generation and packed-artifact enforcement are owned by [arch/licensing.md](../licensing.md).

`packages/cli/build.mjs` builds the publishable CLI. A full build starts from an empty `packages/cli/dist/`, builds the web, server, and skills workspaces and the bundled views, and bundles `packages/cli/src/index.ts` with esbuild into the executable Node CJS file `dist/cli.cjs`. It then copies the packaged assets beside it:

- renderer output to `dist/web/`;
- the bundled views, and the missing-artifact view as `dist/views/artifact-missing/`, to `dist/views/`;
- every canonical artifact version to `dist/canonical/`;
- the server onboarding content tree to `dist/onboarding/`, after verifying that `packages/server/dist/onboarding/onboarding-channels.json` exists;
- the validated server bundled-theme tree to `dist/themes/`;
- the skill bundles to `dist/skills/`.

The build also writes the package's third-party notices and copies the repository-root `LICENSE` to `packages/cli/LICENSE`; [arch/licensing.md](../licensing.md) owns those mechanics.

The esbuild define values are part of the contract for the packaged runtime:

```ts
__TV_STATIC_DIR__ = "./web";
__TV_VIEWS_DIR__ = "./views";
__TV_CANONICAL_DIR__ = "./canonical";
__TV_ONBOARDING_CONTENT_DIR__ = "./onboarding";
__TV_BUNDLED_THEMES_DIR__ = "./themes";
__TV_TELEMETRY_BUILD__ = process.env.TV_NPM_RELEASE === "1" ? "production" : "development";
__TV_VERSION__ = packageJson.version;
__TV_DEVELOPER_COMMIT__ = developerCommitSha;
```

Every `build.mjs` mode, including `--outfile`, determines `developerCommitSha` before bundling. The build checks for `.tv-developer` under `os.homedir()`. Without the marker, `developerCommitSha` is `undefined` and the build does not require Git commit provenance. With the marker, the build resolves the repository's full `HEAD` commit SHA from Git and bakes it as a string; failure to resolve a commit fails the build rather than producing an unstamped executable. The stamp records the checked-out commit and does not claim that the worktree has no uncommitted changes. ^cli-developer-build-stamp

Direct source execution has no baked commit. Only the version flags' display uses the commit ([developer version](../../product/cli.md#^cli-developer-version)). Telemetry applies its [privacy-preserving version classification](../telemetry/derivation.md#Behavior).

`inspectTelemetryBuildConfig(env, options)` exposes the baked telemetry-build marker, the current environment suppression reason, and the selected PostHog project as a build diagnostic. Build-marker selection follows [telemetry release build configuration](../telemetry/sink.md#Behavior and operations); direct source execution has no baked telemetry marker and reports `null`.

The onboarding content schema, source tree, and server build validation remain owned by [arch/onboarding/content.md](../onboarding/content.md). This spec owns the CLI build's copy into `dist/onboarding/`, the build-time path constant, and the runtime resolver that hands that directory to the serving store. [Bundled theme installation](../themes/bundled-installation.md) owns the corresponding theme source, package copies, resolver, and store handoff.

The external Vercel `skills` package is not bundled; it remains a runtime dependency so the packaged CLI can resolve its executable.

`build.mjs --outfile <path>` builds only a standalone executable bundle at the requested path. It does not copy renderer, view, canonical, onboarding, theme, or skill assets, and it does not claim a shipped-surface inventory, notices tree, or package-root license copy. Tests use this mode when they need a binary outside the repository tree.

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

No spawned CLI test covers a wildcard `listen` address. The config reader validates each `listen` item as an IPv4 address, and the CLI hands the same values, unchanged, to the server constructor, which resolves them with `resolveBindAddresses`; wildcard resolution and the wildcard listener are therefore proven on the server side and compose across that handoff ([arch/testing-policy.md#Compositional coverage across clean seams](../testing-policy.md#Compositional coverage across clean seams)). The product CLI proof's multi-listener acceptance ([proofs/product/cli.md#^cli-ac-multi-listener-success](../../../proofs/product/cli.md#^cli-ac-multi-listener-success)) covers foreground serve with several specific addresses.

The ACP wiring is experimental ([Experimental ACP agent wiring](#Experimental ACP agent wiring)), so the CLI suite proves only the missing-command startup failure and includes no ACP success test; the bridge, protocol, and agent behavior past the CLI handoff are governed by code rather than by a spec. The exception is the [home-context buffer](#^cli-acp-home-context): its proof shows that the context a launched agent receives carries `--home` with the served home, and `--port` only under config port `0`. A CLI-side success test becomes warranted only if ACP enters the supported product surface.

Interactive skills installation follows the product CLI's owned testing exception ([product/cli.md#^cli-installer-exception](../../product/cli.md#^cli-installer-exception)): for this spec, tests stop at the injected `runSkillsInstaller` boundary, and nothing runs the installer's terminal interface.

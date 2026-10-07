*The `packages/cli` module and the published `tv` package: package contents and asset lookup, build stamping, where home and config handling sits, the persisted service definition, and the ACP agent home context.*

# CLI architecture

The `tv` command is a single bundled executable that ships with the files a Television server needs: the web renderer, bundled views, the canonical bundle, onboarding content, bundled themes and bundled skills. It reads an installation's settings, starts the server or talks to a running one, and can install the server as a user service.

What a person or agent sees when they run `tv` — commands, output, errors, the Television home, the config file, and the persisted service's observable behaviour — is owned by [product/cli.md](../../product/cli.md). This spec holds what sits behind that: how the package is laid out and built, how the code is layered, and the parts of the persisted service that outlive the release that installed them. Listener bind failure, its exit status and the service manager's restart settings are owned by [startup-bind-failure.md](./startup-bind-failure.md).

## Build and packaged asset layout

The npm package `@telepath-computer/television` publishes the `tv` executable and nothing importable. Its package metadata declares the binary and no `main` or `exports` entry, so the code inside it has no outside callers and can be reorganised freely. People install and upgrade Television by this package name.

The executable is one CommonJS file, `dist/cli.cjs`, built from `packages/cli/src/index.ts`. Every asset it serves or installs ships beside it in `dist/`: the renderer in `web/`, bundled views in `views/`, every canonical bundle version in `canonical/`, onboarding content in `onboarding/`, bundled themes in `themes/` and bundled skills in `skills/`. The package's license and third-party notices are owned by [arch/licensing.md](../licensing.md).

At run time the executable finds these directories relative to the real path of its own script, after following symbolic links. A global npm install and `npm run link` both put `tv` on the user's `PATH` as a symbolic link, so a lookup relative to the link would find nothing. When the CLI runs from source rather than from a build, it looks in the workspace build outputs instead.

A directory that cannot be found is passed to the server as absent, and the server runs without it; a server with no onboarding content, for example, installs no onboarding channels. Because the runtime tolerates a missing tree, the full build is what keeps a package complete: it fails when any asset tree it should copy is missing, rather than producing a package that runs without it. Tests of the lookup cover the built and source layouts, not damaged or half-built ones.

The external `skills` package that `tv skills install -i` launches stays an ordinary runtime dependency and is not bundled into `cli.cjs`. The CLI starts that package's own executable file, which only exists when the package is installed as a dependency. No test runs the interactive installer ([product exception](../../product/cli.md#^cli-installer-exception)), so a bundling mistake here would surface only for users.

The build has two modes. The full build, `npm run build:cli`, builds the workspaces the package draws on and produces the complete `dist/`. `node packages/cli/build.mjs --outfile <path>` produces only the executable, at the given path, with no assets; tests use it when they need an executable outside the repository, including release-configured ones that must not overwrite the shared `dist/`.

The build bakes three values into the executable. The release version is governed by [arch/updates/index.md](../updates/index.md#^updates-dev-version), and the telemetry build marker by [arch/telemetry/sink.md](../telemetry/sink.md#Behavior and operations). The third is the developer commit that [`tv --version`](../../product/cli.md#^cli-developer-version) may show: when the user running the build has a `~/.tv-developer` marker, every build mode bakes the full commit ID of the repository's `HEAD`, and if Git cannot supply one the build fails instead of producing an executable without it. The stamp records which commit was checked out; it does not claim that the working tree was clean. ^cli-developer-build-stamp

## Layering

The server package's `Server` and `ServerStore` do not select a Television home or read a config file. They take a storage directory and settings as constructor options, so package tests and other callers can construct a server directly. Choosing the home and reading its config happen in the CLI, which hands the results to the server. This is why the server and every command agree on the home and settings: there is one place that decides them.

`runCLI(argv, environment)` is the CLI's entry point. It returns an exit status instead of exiting the process. Everything that reaches outside the process — standard output and error, construction of the server, the service-manager handle and the server client, the operating-system home directory, the external skills installer, skill-install telemetry and signal handling — can be supplied by the caller, and production versions fill in anything not supplied. Ordinary tests run commands in-process this way, so they never touch the host's real service or read the user's own home directory, `~/.tv-home` or `~/.tv-developer` marker.

## Daemon boundary

`tv serve --persist` installs a user service through the operating system's service manager. The service definition is written once and then keeps running across later upgrades of the package, so parts of it are read by releases other than the one that wrote it.

The service is named `com.television.server` in every release. A newer CLI finds, replaces and removes a service an older release installed by this name, and the test runner's production-service suite and the administrator guide refer to it.

The service runs the Node executable that performed the install, given the CLI's entry script, then `--home <absolute home>`, then `serve`. The Node path is fixed at install time because a service does not start through the user's interactive shell, where tools such as nvm choose a Node version; using a different Node takes another `tv serve --persist`. The definition carries no settings, so each boot reads the home's config file.

The service's environment is likewise fixed at install time ([what is captured](../../product/cli.md#Server lifecycle commands)). A server from a later release boots with variables an earlier CLI wrote, so the variable names the CLI writes and the server reads are a contract across releases: `TELEVISION_LAUNCH_MODE=daemon`, which marks a service boot; `TELEVISION_DEVELOPER_HOME`, the installing user's home directory, where the developer marker is checked; the telemetry-control and update-channel variables; and the ACP agent variables. Renaming one has to account for services still installed with the old name. ^ac-persist-telemetry-env

The install is recorded in `<home>/logs/tv.log` with the service's command and environment. Values of the ACP agent variables, and of any variable whose name ends in `_API_KEY`, `_TOKEN`, `_SECRET` or `_PASSWORD`, are replaced with a placeholder there, so credentials never reach the log.

After installing, the CLI waits for a server to answer on the configured port ([product health wait](../../product/cli.md#^cli-persist-health-wait)). No health request runs past the deadline, so a process that accepts the connection and never replies cannot hold the command open. The 15 seconds leave room for the service manager to restart a server once at the cadences in [startup-bind-failure.md](./startup-bind-failure.md#Generated service definitions); a startup that fails for a reason that clears on its own, such as the previous instance still releasing the port, still answers in time. Lengthening those cadences means revisiting this deadline. ^cli-persist-health-check

## ACP agents

Launching an ACP agent from the server, chosen with `TELEVISION_ACP_AGENT`, is an experimental, development-facing feature and not part of the supported product. Its behaviour is governed by code, with one exception.

A server that launches an ACP agent tells the agent how its own `tv` commands reach that server. The Television context block the agent receives with its prompts always carries `--home` with the absolute path of the home the server serves, and adds `--port` with the port the server actually bound only when the configured port is `0`. This holds whether or not a channel is attached, and no environment variable carries these values. An agent's `tv` commands therefore reach the server that launched it, whether that server serves the default home, a home given with `--home`, or a development home. The requirement binds the server's ACP bridge (`packages/server/src/acp-bridge.ts`) and the web chat's ACP client (`packages/web/src/services/acp-client.ts`), which assembles the context; their other behaviour stays governed by code, as the [migration map](../../spec-migration.md) allows for such a buffer. ^cli-acp-home-context

## Operations

From the repository root:

```bash
npm install                                         # workspace dependencies
npm run build:cli                                   # full package build into packages/cli/dist/
npx tsx packages/cli/src/index.ts <command> ...     # run from source
packages/cli/dist/cli.cjs <command> ...             # run the build
npm run link                                        # build, then link tv globally to the build
npm run unlink                                      # remove the global link
```

When trying commands by hand, pass `--home <temporary directory>` so the run stays out of your own installation. `tv serve --persist`, `tv serve --persist-uninstall` and `tv stop` act on your user account's one real Television service whatever home you pass: installing replaces it, and the other two remove it.

## Inputs to proof derivation that the spec does not otherwise show

### Directives from the designer or architect

While ACP stays experimental, prove only that a missing agent command stops startup and that the [home context](#^cli-acp-home-context) carries `--home`, and `--port` only under config port `0`. Do not add tests of a successful ACP session.

### Facts a test author would likely miss

`Server` treats an unspecified `auth` option as no authentication. `tv serve` therefore always passes the config's `auth` value explicitly, including the default `true`; a test of the default must start a server with no `auth` key in the config and check that it requires the token.

### Coverage owned by another spec

Installing, reinstalling, the unanswered install, stopping and uninstalling the real service are proven by the hand-run production service suite owned by [arch/test-runner/test-runner.md](../test-runner/test-runner.md), not by `verify` or CI. The bind-failure exit is proven by the product CLI proof, as [startup-bind-failure.md](./startup-bind-failure.md#Testing) records.

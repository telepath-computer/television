*The user-facing `tv` command surface: help, the installation home and its config file, connection, server lifecycle, channels, artifacts, display focus, themes, bundled skills, and output.*

# CLI

People and agents use the `tv` command to start Television, inspect and change its state, and install its packaged skills. Each installation keeps its settings and data in one folder. The server and every command choose that folder by the same rule and read their settings from it. The command explains recoverable mistakes and prints results that scripts and agents can act on.

This product spec owns what a person or agent invokes as `tv`, what it prints, the Television home and config file that the server and commands share, which same-host server a command talks to, and how it reports recoverable mistakes. [Product versioning](./versioning.md) owns the representation of Television release numbers within that output.

## Terms and scope

The standalone [administrator guide](../arch/cli/admin-guide.md) governs administration procedures and agent guidance; this spec governs command behavior.

The `tv` CLI is designed to be invoked on the same host as the Television server it controls. Commands that contact a server use a local port and do not accept a remote server URL. The home, its config file, and the connection they determine are defined in [#Television home and configuration](#Television home and configuration).

This spec defines the CLI spelling of focus requests; product channels and tab pages own their effects.

A *focus directive* is one of the mutually exclusive flags that tells a creation command whether the result should be shown immediately: `--focus-channel` / `--no-focus` for `create-channel`, and `--focus-artifact` / `--no-focus` for artifact creation.

*Channel focus* is the persisted active channel owned by [channels.md](./channels.md). *Artifact focus* is a transient one-shot signal: clients select the artifact's tab page and switch to its channel when needed, without scrolling-to-card or highlight/glow behavior ([tab-pages.md#^tp-focus-selects](./tab-pages.md#^tp-focus-selects)). It is not persisted.

The *bundled skill collection* is the set of Television agent skills shipped beside the built CLI under `dist/skills/<name>/`.

## CLI as agent teacher and guardrails

The primary consumer of the CLI is the user's agent. The human user is the secondary consumer. Agents do not reliably load or follow the relevant skills, so CLI output is designed to help an agent take the next correct action. Error messages in particular remind agents which Television skills they should have in context, explain invalid usage, and point to recovery steps when the CLI can identify them.

## Command model, help, version, and recovery text

The visible command surface is:

| Command | Purpose |
|---|---|
| `tv serve` | Start the server in the foreground, install it as a persisted service, or uninstall that service. |
| `tv config` | Show the effective settings of the selected home, or change settings in its config file. |
| `tv create-path-artifact` | Register an existing local markdown/HTML file or indexed directory on a channel. |
| `tv create-url-artifact` | Register an `http(s)` URL on a channel. |
| `tv update-artifact` | Update an artifact title or repoint its path/URL. |
| `tv delete-artifact` | Delete an artifact registry record and remove its tab page. |
| `tv get-artifact` | Print one artifact's metadata as JSON. |
| `tv list-artifacts` | Print artifacts as JSON, optionally filtered by channel. |
| `tv create-channel` | Create an empty channel. |
| `tv update-channel` | Rename a channel. |
| `tv remove-channel` | Delete a channel and its referenced artifact records. |
| `tv list-channels` | Print all channels as JSON. |
| `tv get-channel` | Print one channel and its artifacts as JSON. |
| `tv focus-status` | Print display state as JSON. |
| `tv focus-channel` | Persistently set the active channel. |
| `tv set-theme` | Persistently activate an installed theme, or use `none` to run without a theme. |
| `tv themes-path` | Print the themes directory of the selected home as JSON. |
| `tv focus-artifact` | Send a transient artifact-focus nudge. |
| `tv skills` | Manage the bundled skill collection. |
| `tv stop` | Uninstall/stop the persisted Television service. |
| `tv status` | Print the selected home, server health, version, telemetry state, and service status as JSON. |
| `tv links` | Print the running server's connect links, one per line. |
| `tv telemetry` | Enable or disable telemetry for the running server. |

The canonical help flag is `--help`, with `-h` as its alias. The canonical version flag is `--version`, with `-V` and `-v` as its aliases.

Bare `tv`, `tv help`, and `tv --help` print the same top-level help and exit `0`. Top-level help begins `Usage: tv [options] [command]`, shows the `--home <path>`, help, and version options, lists every visible command above, and ends with the `Agent workflow note:` that points agents to `tv skills install <path>` or `tv skills install -i`.

`tv --version` reports the package's exact [release version](./versioning.md#^pv-exact-version). It normally prints that version unchanged — for example, package version `1.3.1` prints `1.3.1`. It prints `1.3.1 (commit <full-commit-sha>)` when the [`~/.tv-developer` developer-host marker](./telemetry.md#^developer-host-project-guard) existed in the build user's operating-system home directory when the executable was built, the build captured its Git `HEAD` commit, and the marker also exists in the runtime user's operating-system home directory when the version command runs. If either marker check is false or the executable has no captured commit, the annotation is absent. `-V` and `-v` produce the same output as `--version`. Version output goes to stdout and exits `0`. ^cli-developer-version

`tv help <command>` and `tv <command> --help` print command-local help and exit `0`. Top-level help carries the full agent routing note. Subcommands do not need to repeat that note on every help page because the agent is expected to read top-level help first. Artifact creation help ends with an `Agent note:` for artifact workflow and skill installation. `tv skills` help and `tv set-theme` help append command-specific notes. Many other subcommands have only usage, description, arguments, and options.

A *directive error* is a usage error that the CLI itself detects while parsing arguments or validating whether a command and its options can be dispatched. Directive errors print to stderr and return exit code `1`. When one repeats the invocation that failed, it preserves the argument tokens the CLI received after `tv`, in order, including option values. The CLI may quote a token only to keep whitespace or shell-significant characters readable. This makes the error point back to what the user or agent actually entered, not to a reconstructed command name.

The CLI appends this recovery pointer to mistakes detected by CLI parsing or CLI validation, to shared-client local validation errors, and to HTTP status errors, unless the message already contains it:

```text
Television ships bundled skills. The main skill is `television` — keep its guidance available for channels, lifecycle, the `tv` CLI, artifact workflow, and theming. Re-read it only if it is not already in context or you know the installed skill changed. Additional `tv-*` skills cover specialized artifact types. Install all bundled skills with `tv skills install <path>` (e.g. ~/.openclaw/skills) or `tv skills install -i`.
```

Examples of directive errors include:

```text
Unknown tv command: data-dir.
tv list-artifacts --bogus does not support --bogus.
tv set-theme requires <theme>.
tv update-artifact requires at least one of --title, --path, or --url.
tv update-artifact accepts --path or --url, not both; an artifact's kind is immutable.
```

Focus-directive errors explain the required choice and append the bundled-skills recovery pointer. They do not point to `tv help` as a separate recovery path. For example:

```text
tv create-path-artifact requires exactly one of --focus-artifact or --no-focus. Television separates state changes from focus; choose whether to show the result now or keep focus unchanged.
```

Connection failures do not append the recovery pointer. They print:

```text
Could not reach Television server at http://localhost:<port>: <message>
```

Detailed error wording and recovery-pointer placement are not yet normalized across every argument and validation path. This spec pins only the cases its prose states explicitly; making the remaining paths consistent is known future work.

## Output conventions

Output formatting is currently inconsistent and depends on the command. Successful commands that read state or report status usually print compact one-line JSON to stdout:

| Command | JSON envelope |
|---|---|
| `tv config show` | `{ "home": string, "configPath": string, "configFileExists": boolean, "settings": { "port": number, "listen": string[], "auth": boolean, "installedByAgent": string \| null } }` |
| `tv themes-path` | `{ "themesPath": string }` |
| `tv list-channels` | `{ "channels": [...] }` |
| `tv get-channel` | `{ "channel": ..., "artifacts": [...] }` |
| `tv get-artifact` | `{ "artifact": ... }` |
| `tv list-artifacts` | `{ "artifacts": [...] }` |
| `tv focus-status` | `{ "activeChannelID": string \| null, "activeThemeName": string \| null, "acpEnabled": boolean }` |
| `tv status` | `{ "home": string, "serverURL": string, "healthy": boolean, "version"?: string, "bindAddresses"?: string[], "port"?: number, "telemetry"?: { "state": "active" \| "opted-out" \| "suppressed" \| "unavailable", "reason": "do-not-track" \| "ci" \| "development" \| "developer-host" \| null, "guidPresent": boolean, "region": "us" }, "daemon"?: { "installed": boolean, "running": boolean } }` |
| `tv telemetry enable` and `tv telemetry disable` | `{ "state": "active" \| "opted-out" \| "suppressed" \| "unavailable", "reason": "do-not-track" \| "ci" \| "development" \| "developer-host" \| null, "guidPresent": boolean, "region": "us" }` |
| `tv stop` and `tv serve --persist-uninstall` | `{ "status": "stopped" }` |

Successful commands that change state or run against the server usually print human-readable text. `tv set-theme` reports its successful selection transition as described under [Display focus and themes](#display-focus-and-themes). `tv config set` confirms the file it wrote. `tv serve` and `tv serve --persist` print human-readable startup text, and `tv links` prints one connect link per line. Errors print to stderr and return `1`; there is no separate usage-error exit code in `tv`. The one distinguishable nonzero status is listener-bind failure: `tv serve` exits with status `69` when a required listener cannot bind, as owned by [arch/cli/startup-bind-failure.md](../arch/cli/startup-bind-failure.md).

When a command's stdout is an interactive terminal, each link it prints is a terminal hyperlink using OSC-8 escape sequences, with the visible URL as the link text; a terminal that does not render OSC-8 hyperlinks still shows the URL text. When stdout is anything else, such as a pipe, a file, or an agent's shell tool, each link is the plain URL with no escape sequences, because some tools that capture output strip escape sequences in a way that removes the URL with them. This applies to the startup URLs of `tv serve` and `tv serve --persist` and to `tv links`. ^cli-link-output

## Television home and configuration

### The Television home

A *Television home* is the directory that holds one Television installation: its optional config file and all the state and content the server keeps, including the bearer token, channels, artifacts, installed themes, onboarding and telemetry state, and logs. The server and every `tv` command that works with an installation resolve its home by the same rule and read the same config file. A command that selects the same home as a running server therefore uses that server's settings, provided the server started after the config file last changed ([startup snapshot](#^cli-config-snapshot)). ^cli-home

Each invocation selects one home: the global `--home <path>` option when it is supplied, otherwise the *default home*. The default home is the directory that `~/.tv-home` names when that file exists, and otherwise `.television` in the operating-system home directory of the user running `tv`. ^cli-home-selection

`--home` is a global option that every command accepts. Documentation writes it before the command name, as in `tv --home /srv/television status`; the CLI also accepts it after the command name. A relative `--home` resolves against the current working directory, and the command uses the resulting absolute path throughout. `tv` gives `~` no special meaning in `--home`; a shell may expand it before `tv` runs. An empty or whitespace-only `--home` value is an error rather than a request for the default home. Help and version output use no home, so an invalid `--home` value or `~/.tv-home` file does not affect them.

`~/.tv-home` lets a user keep the default home somewhere else, for example in a folder that Dropbox keeps in sync, without passing `--home` to every command. It is a text file in the operating-system home directory that holds one path: ^cli-home-pointer

- A path that begins with `/` is absolute, as in `/var/tv`.
- `~` alone, or a path that begins with `~/`, starts at the operating-system home directory, as in `~/Dropbox/television`.
- Any other path is relative to the operating-system home directory, as in `.television` or `Dropbox/television`.

No shell reads this file, so `tv` expands its leading `~` itself, as Git and OpenSSH do for their configuration files. A trailing `/` is optional, and whitespace around the path, including a final newline, is ignored. The file is an error when it cannot be read, holds no path, or holds more than one line. A path that begins with `~` followed by anything other than `/`, such as `~otheruser/television`, names another user's home directory and is also an error; its message says that `~` followed by a user name is not supported and suggests an absolute path instead. A command reads `~/.tv-home` only when it is given no `--home`, and an error in the file stops only those commands; its message names the file and the problem. Television never writes `~/.tv-home`. A user creates it with any editor, or with a shell command such as `echo Dropbox/television > ~/.tv-home`.

Each command resolves its home separately. A later command, including one an agent runs in a new session, reaches the same installation only when its selection resolves to the same directory, whether through `--home`, `~/.tv-home`, or the built-in default. A `--home` value applies only to the command that receives it, so later commands must pass it again. A default home chosen with `~/.tv-home` applies to every later command the same user runs without `--home`. A persisted service records its own absolute home ([Server lifecycle commands](#Server lifecycle commands)); that record does not select the home for other commands, and the service keeps it when `~/.tv-home` changes until `tv serve --persist` is rerun.

The Television home is separate from the operating-system home directory. `~/.tv-home` and the [`~/.tv-developer` developer-host marker](./telemetry.md#^developer-host-project-guard) stay in the operating-system home directory whichever Television home is selected.

**Upgrading an existing installation.** Before homes existed, an installation kept the same data in its storage directory: `~/.television` by default, or the directory named by `--storage-path` or `TELEVISION_STORAGE_PATH`. That directory already has the home's layout, so selecting it as the home reuses its token, channels, artifacts, themes, onboarding state, telemetry identity, and logs in place, without moving files. `TELEVISION_PORT` and `TELEVISION_STORAGE_PATH` no longer select the port or the home of any command or persisted service; a value in either variable, valid or not, is ignored. The one exception is the [transitional path for services installed by earlier releases](#^cli-retired-service-compat), which can take the port from `TELEVISION_PORT` once. When either variable has a non-empty value, every `tv` invocation outside the daemon launch mode writes this warning to stderr before the command runs, and the command then runs as usual. An invocation refused for [retired options](#^cli-retired-options) writes only that refusal. The [administrator guide](../arch/cli/admin-guide.md) owns the upgrade procedure. ^cli-legacy-selectors

```text
WARNING: TELEVISION_PORT or TELEVISION_STORAGE_PATH is set in this environment, and Television no longer uses either. Set the server's port with tv config set port <number>. Television uses the home given with tv --home <path> <command>, otherwise the path written in ~/.tv-home, otherwise ~/.television.
```

**Retired options.** Earlier releases took the server's settings and the storage directory as command options. `tv serve`, in each of its forms, refuses `--port`, `--listen`, `--auth`, `--no-auth`, and `--installed-by-agent`, and every command refuses `--storage-path`. A client command's `--port` is unaffected ([Connecting to the server](#Connecting to the server)). Apart from the [transitional path for services installed by earlier releases](#^cli-retired-service-compat), an invocation that contains one of these options, with or without a value, is a directive error. The CLI prints the guidance below to stderr, followed by the standard recovery pointer, and exits `1`. Its first sentence names the retired options the invocation gave, without their values, each once, in the order they first appear, separated by `, `; the block shows it for `tv serve --port 43123 --no-auth --port 43124`. The rest of the guidance is fixed. The check comes before anything else the CLI does with the invocation, including help, version, other argument errors, and home selection, so the command does nothing else. The refusal is not recorded in any log. ^cli-retired-options

```text
This version of Television does not accept --port, --no-auth. Server settings and the storage directory are no longer command options:

  --port <number>              ->  tv config set port <number>
  --listen <ipv4>[,<ipv4>...]  ->  tv config set listen <ipv4>[,<ipv4>...]
  --auth                       ->  tv config set auth true (the default)
  --no-auth                    ->  tv config set auth false
  --installed-by-agent <name>  ->  tv config set installedByAgent <name>
  --storage-path <path>        ->  tv --home <path> <command>, or write <path> into ~/.tv-home

tv config set writes the config file in the Television home. For a home other than the default, put --home <path> before the command name, as in tv --home <path> config set port <number>.
After changing settings, rerun tv serve --persist to update an installed service.
The administrator guide covers the full upgrade and is written for your agent to carry out: https://television.run/install.md
```

**Services installed by earlier releases (transitional).** A service installed by an earlier release runs a foreground `tv serve` with retired options, in the daemon launch mode (`TELEVISION_LAUNCH_MODE=daemon`) that its service definition sets. So that such a service keeps running after an update, a foreground `tv serve` in the daemon launch mode that is given retired options and no `--home` starts the server instead of refusing: ^cli-retired-service-compat

- `--storage-path <path>` selects the home, as `--home <path>` would. Without it, the home is selected as usual.
- When the selected home has no config file, the CLI writes one from the retired options:
  - `port` from `--port`, otherwise from `TELEVISION_PORT` in the process environment when that value is a valid config port;
  - `listen` from the `--listen` values;
  - `auth` true when `--auth` is given, and false otherwise, which keeps the earlier release's tokenless behaviour for a service installed with `--no-auth` or with neither option;
  - `installedByAgent` from `--installed-by-agent`.

  A setting with no source keeps its default. The written settings follow the config file's rules, so a value those rules reject stops the start as an invalid config file does.
- When the selected home already has a config file, the CLI writes nothing and ignores the retired options. Settings changed later with `tv config set` therefore survive every boot.
- The server then starts from the config file, as for any foreground `tv serve`.
- Each start on this path records in `<home>/logs/tv.log` that the service runs from a retired service definition, with the guidance to reinstall it with `tv serve --persist` and the administrator guide's address, `https://television.run/install.md`.

This path is transitional. Linear TV-871 tracks its removal, after which these invocations get the refusal above.

### The config file

A home's *config file* is `<home>/config.json`. It is optional and holds only the settings that the server and local commands must share: ^cli-config-file

```json
{
  "port": 32848,
  "listen": ["100.64.0.7"],
  "auth": true,
  "installedByAgent": "Claude Code"
}
```

| Key | Valid value | Default when absent | Meaning |
|---|---|---|---|
| `port` | JSON integer from `0` through `65535` | `32848` | The port the server binds and local commands connect to. |
| `listen` | JSON array of IPv4 address strings | `[]` | Addresses the server binds in addition to loopback ([Server lifecycle commands](#Server lifecycle commands)). |
| `auth` | JSON boolean | `true` | Whether the server requires the bearer token. |
| `installedByAgent` | JSON string | absent | The [agent runtime harness name](./telemetry.md#^installed-by-agent) of the agent operating the server, reported by server telemetry. |

A missing file and `{}` both leave every setting at its default, so an ordinary installation — loopback only, port `32848`, bearer-token authentication — needs no config file. ^cli-config-defaults

A present config file must be readable JSON whose top level is an object containing only the four keys above, each with a valid value. A command that reads an invalid file fails before it starts a server or contacts one. Its error names the config file's path and the specific problem; it is a CLI validation error, so it carries the recovery pointer described under [Command model, help, version, and recovery text](#Command model, help, version, and recovery text). Television never falls back to defaults, environment variables, or the valid part of the file after finding the file invalid. ^cli-config-invalid

`tv serve`, `tv serve --persist`, `tv config set`, `tv config show`, and every command that contacts the server read the config file. `tv themes-path`, `tv stop`, `tv serve --persist-uninstall`, and `tv skills install` use the home without reading its config file, so they keep working while the file is invalid.

A server reads the config file once, when it starts, and never writes it. Editing the file does not change a running server: rerun foreground `tv serve`, or rerun `tv serve --persist` for the installed service, to apply the change. Each local command reads the file when it runs, so between an edit and that restart a command can use settings the running server has not adopted. ^cli-config-snapshot

Apart from the [transitional path for services installed by earlier releases](#^cli-retired-service-compat), `tv config set` is the only Television command that writes the config file. People and agents may also edit the file directly.

### Changing and showing settings

```bash
tv config set <key> <value> [<key> <value> ...]
tv config show
```

`tv config set` reads the existing config file, or starts from `{}` when there is none, replaces only the named keys, and validates the complete result. It then creates the Television home if needed and replaces the file atomically, so a reader sees either the previous file or the complete new one. It parses each value according to its key:

- `port` takes a whole decimal integer from `0` through `65535`.
- `listen` takes one argument of comma-separated IPv4 addresses. Entries are trimmed, empty entries are dropped, and the result is stored as an array; an empty argument stores `[]`.
- `auth` takes `true` or `false`.
- `installedByAgent` stores the argument as given; telemetry applies its own normalization when it reports the value ([telemetry](./telemetry.md#^installed-by-agent)).

```bash
tv config set installedByAgent "Claude Code"
tv config set port 43123 listen "100.64.0.7,192.168.1.42"
tv config set auth false
tv config set listen ""
```

An invocation with no pairs, an unknown key, a key named twice, a key without a value, an invalid value, an unreadable or malformed existing file, or an invalid complete result fails and leaves the existing file unchanged. Because the command validates the complete result, it can replace an invalid value of a known key; an unknown key or malformed JSON must be repaired by editing the file. On success it prints: ^cli-config-set

```text
Updated <config-path>: <key>[, <key>...].
Restart foreground `tv serve`, or rerun `tv serve --persist`, for a running server to use the new settings.
```

`tv config show` prints the absolute home, the config file's path, whether that file exists, and the effective settings with defaults filled in. It reports an invalid file as an error. A missing file and an existing `{}` print the same settings and differ only in `configFileExists`. `installedByAgent` prints as `null` when absent; `null` is not a valid value in the file. For example, with no config file: ^cli-config-show

```json
{"home":"/home/me/.television","configPath":"/home/me/.television/config.json","configFileExists":false,"settings":{"port":32848,"listen":[],"auth":true,"installedByAgent":null}}
```

Neither command contacts a server.

### Connecting to the server

Commands that contact a server — the artifact, channel, focus, and theme-selection commands, `tv telemetry enable` and `tv telemetry disable`, `tv status`, and `tv links` — connect only to `http://localhost:<port>`, where `<port>` is the config file's effective `port`. There is no `--server <url>` override. Passing `--server` to a command that contacts the server is an unsupported-option error.

These commands read the bearer token from `<home>/state/token`, trimming surrounding whitespace. A missing or empty token file means the command sends no bearer token. If a token-protected server returns `401`, the CLI prints:

```text
Television server at http://localhost:<port> rejected the request as unauthorized. Check the token in <home>/state/token.
```

A config port of `0` asks the operating system to choose the server's port when the server starts, so the config file cannot tell a command where that server is listening. Port `0` is for foreground and development use, and the repository test runner relies on it to allocate real listeners without fixed ports ([dynamic test ports](../arch/test-runner/test-runner.md#^test-dynamic-ports)). While the effective config port is `0`, each command that contacts the server must pass `--port <number>` with the nonzero port from that server's startup URL; `--port` takes a whole decimal integer from `1` through `65535`. While the config port is nonzero, these commands refuse `--port`, so the config file remains the one source of the port. No environment variable supplies a port, and commands that do not contact a server have no `--port` option. ^cli-client-port

Both refusals are directive errors. For example:

```text
tv list-channels requires --port because <config-path> sets port 0. Pass the port from the Television server's startup URL.
tv list-channels --port 43123 does not accept --port because <config-path> sets port 32848. Omit --port to use the configured port.
```

### Connect links

A *connect link* is the URL a person opens to use Television, in a browser or in the desktop app. It is the server's origin for one listening address, followed by `/?token=<token>` when the server requires the bearer token; a tokenless server's connect link is the plain origin. A server listening on several addresses has one connect link per address. The startup URLs that `tv serve` and `tv serve --persist` print are connect links. ^cli-connect-link

`tv links` prints the running server's connect links, one per line, with no other output:

```bash
tv [--home <path>] links [--port <number>]
```

The links cover every address the server reports it is listening on, with the port it bound. They follow the running server, not the config file, which the server reads only when it starts: when the server requires the bearer token they carry the token from `<home>/state/token`, and when it does not they are plain origins. If the server requires a token and rejects that one, the command prints the unauthorized message under [Connecting to the server](#Connecting to the server) to stderr, prints no links, and exits `1`. When the server cannot be reached, the command prints `Could not reach Television server at http://localhost:<port>: <message>` to stderr, prints no links, and exits `1`. Links follow the [link output rule](#^cli-link-output). ^cli-links

## Server lifecycle commands

The foreground form of `tv serve` starts the server in the current process. This synopsis is complete for foreground operation; the persisted-service forms have separate synopses below.

```bash
tv [--home <path>] serve
```

`tv serve` starts the server with the settings in the selected home's config file ([The config file](#The config file)). It accepts no settings options, [refusing the retired ones](#^cli-retired-options), and it writes the config file only on the [transitional path for services installed by earlier releases](#^cli-retired-service-compat).

Authentication is on by default. The server runs without bearer-token checks only when the config file sets `"auth": false`. Every tokenless start prints this warning to stderr:

```text
WARNING: running without an auth token. Tokenless mode is insecure for typical setups — be sure you mean to run without authentication. Run `tv config set auth true` and restart to require the bearer token.
```

When tokenless mode includes a non-loopback listener, stderr also prints:

```text
Non-loopback listeners without auth: <address-list>
```

The config file's `listen` values are IPv4 addresses. The server resolves the bind list so local loopback is satisfied. `127.0.0.1` satisfies loopback. `0.0.0.0` also satisfies loopback because it binds all IPv4 interfaces, so a list containing `0.0.0.0` resolves to only `0.0.0.0`. Other IPv4 addresses do not satisfy loopback, so `127.0.0.1` is added alongside them. A repeated address is bound once. Listener startup is all-or-nothing: every resolved address must bind, and if any bind fails the server records the failure, closes every listener it opened, and exits with status `69` instead of running on a subset. The detailed bind-failure contract — the fatal log record, the exit status, and the persisted service's restart-until-bound behavior — is owned by [arch/cli/startup-bind-failure.md](../arch/cli/startup-bind-failure.md).

When the effective config port is `0`, foreground `tv serve` prints this warning to stderr before it starts the server:

```text
WARNING: config port 0 lets the operating system choose this server's port. Commands that contact this server must pass --port <port>, using the port from the startup URL.
```

Foreground startup prints:

```text
Television server running.
Open Television:
  <startup URL>
```

One startup URL is printed per bound listener, using the port the server actually bound; under config port `0` that is the port the operating system chose. Authenticated startup URLs include `?token=<token>`; tokenless startup URLs are plain origins. The command runs until it receives `SIGINT` or `SIGTERM`, then disposes the server and exits.

`tv serve --persist` installs Television as a user system service instead of running a foreground server:

```bash
tv [--home <path>] serve --persist
tv [--home <path>] serve --persist-uninstall
```

`tv serve --persist` validates the config file and refuses an effective port `0`, both before it inspects, uninstalls, or replaces an existing service. A persisted service needs a port that stays the same across boots so that local commands can find it. The port refusal is a directive error: ^cli-persist-config-validation

```text
tv serve --persist requires a stable port, but <config-path> sets port 0. Choose one with `tv config set port <number>`.
```

The installed service runs `tv --home <absolute-home> serve` on every boot, so each boot reads the selected home's current config file. The service definition carries no port, listener, authentication, installed-by, or storage setting. Television installs one persisted service per operating-system user: installing from another home replaces the service for the previous home. ^cli-persist-home-service

A persisted install also stores the environment captured at install time. It always captures the exact `PATH`. It also captures non-empty telemetry-control variables (`DO_NOT_TRACK`, `CI`, `TV_TELEMETRY_TEST`) and update-channel overrides (`TV_UPDATE_CHANNEL_URL`, `TV_UPDATE_CHANNEL_POLL_INTERVAL_MS`). [Product telemetry](./telemetry.md) owns the telemetry controls; capture of the update-channel overrides is stated by [the update-channel spec](../arch/updates/update-channel.md#^hook-persist-capture).

The persisted environment sets `TELEVISION_DEVELOPER_HOME` to the installing user's operating-system home directory so every daemon boot can check that user's `.tv-developer` marker, and sets `TELEVISION_LAUNCH_MODE=daemon` so telemetry records the launch mode. It does not capture `HOME`; the service receives its Television home as an argument. When an ACP agent is configured, the matching agent variables are captured and the install validates that the agent command is resolvable from the persisted environment before modifying the service. Rerun `tv serve --persist` after changing the config file or a captured environment value so that the service restarts with the change.

If a service already exists, `--persist` uninstalls it and then installs the new definition. That refresh is not atomic: if uninstall succeeds and install fails, the service is left down until `tv serve --persist` succeeds.

Successful persisted install prints one startup URL for each configured bind address after listener resolution, using the config port. `127.0.0.1` appears alongside specific additional listeners, while a `listen` value containing `0.0.0.0` resolves to the all-interfaces URL alone. With authentication on, the URLs include the bearer token; the install creates the home's token first when the home has none yet.

```text
Television service installed.
Open Television:
  <startup URL for each configured bind address>
```

`tv serve --persist-uninstall` and `tv stop` uninstall the persisted service and print:

```json
{"status":"stopped"}
```

They remove the user's one Television service whichever home is selected; the selected home determines only where they log the removal. They are idempotent from the caller's perspective: a successful uninstall path prints the same JSON whether or not a service was already installed.

`tv status` prints the selected home, server health, and service status. It always includes `home`, `serverURL`, and `healthy`. `home` is the absolute home this invocation resolved; the server's unauthenticated health response carries no home or other filesystem path. If the health request succeeds, the output includes `bindAddresses` and `port`, and copies the server's exact `version` unchanged when `/health` supplies one. A CLI and server from the same release therefore report the same release version. The developer commit annotation belongs only to the CLI's version-flag output and does not change the server version or `tv status`; an unstamped development server's `0.0.0` sentinel also passes through unchanged. The command then asks the server for the telemetry status defined by [the telemetry spec](./telemetry.md#^status-visible). If that follow-up request fails, the command keeps `healthy: true` and the health fields but omits `telemetry`. If service status is supported on the platform, it includes `daemon`; if the service-status check is unsupported, `daemon` is omitted. A failed health request is not a command failure; `healthy` is `false` and the command still exits `0`.

### Telemetry controls

`tv telemetry enable` and `tv telemetry disable` ask the running server to change its persisted telemetry setting and print the resulting telemetry-status JSON. The command group has no `status` subcommand because `tv status` already reports that state. The control semantics, including opt-out and re-enable behavior, are owned by [the telemetry spec](./telemetry.md#^cli-control). These commands require a running server and use the same connection-error behavior as other server-dependent commands.

The first-initialization notice and its eligibility are owned by [the telemetry disclosure contract](./telemetry.md#^disclose-cli). It goes to stderr; status and control commands print only the JSON defined here.

## Channel commands

`tv list-channels` prints `{ "channels": [...] }`.

`tv get-channel [--channel <id>]` prints `{ "channel": ..., "artifacts": [...] }`. With no `--channel`, the command auto-selects when exactly one channel exists. With zero or multiple channels and no `--channel`, the command reports the channel-selection problem directly. With multiple channels, the error says that `channelID` is required and lists the available channels by name and ID. With zero channels, the error says that `channelID` is required and that there are no available channels. The error does not say the server could not be reached.

`tv create-channel --name <name> (--focus-channel|--no-focus)` creates an empty channel. Exactly one focus directive is required. `--focus-channel` sets persistent channel focus to the new channel; `--no-focus` leaves focus unchanged. Success prints:

```text
Channel created: <channel-id> (<name>)
```

`tv update-channel --channel <id> --name <name>` renames a channel in place. Both `--channel` and `--name` are required. The supplied name is sent unchanged, with no trimming or normalization by the CLI. The resulting state change follows [the channel rename contract](./channels.md#^ch-rename), which owns its cross-client effects and preserved state. Command-local help describes the rename and identifies both required options. Success prints: ^cli-update-channel

```text
Channel updated: <channel-id> (<name>)
```

When `<id>` does not name a channel, the command exits `1` and prints this error before the standard bundled-skills recovery pointer:

```text
Channel not found: <channel-id>
```

`tv remove-channel --channel <id>` deletes the channel and deletes the artifact registry records referenced by that channel. It does not touch the files, directories, or URLs those artifacts pointed at. With no referenced artifacts, success prints:

```text
Channel <channel-id> deleted:
  metadata removed: <metadata-path>
No artifacts referenced by this channel.
```

With referenced artifacts, it prints a cascade summary:

```text
Channel <channel-id> deleted:
  metadata removed: <metadata-path>
<N> referenced artifact(s):
  <artifact-id>: deleted
    path: <path>
    path target was not touched.
  <artifact-id>: deleted
    url: <url>
    url target was not touched.
```

## Artifact commands

Television artifacts are registry records that point at external content. The CLI and server store pointer metadata; they do not copy, own, delete, or mutate the file, directory, or URL target. Deleting an artifact registry record never removes or mutates the path or URL target. ^e5b85571

### Path artifact creation

`tv create-path-artifact` creates a path artifact on a channel:

```bash
tv create-path-artifact --channel <id> --title <title> --path <path> (--focus-artifact|--no-focus)
```

The CLI trims surrounding whitespace from `--path` before sending it to the server. The server accepts absolute markdown files ending in `.md` or `.markdown`, absolute HTML files ending in `.htm` or `.html`, and absolute directories with a root `index.html` or `index.htm`. A trailing separator on a directory path is optional. The server validates that the target exists and is readable from the server host. Stored directory paths end with a trailing separator; stored file paths do not.

Exactly one focus directive is required. `--focus-artifact` creates the artifact and sends a transient artifact-focus nudge for it. `--no-focus` creates the artifact without changing focus. Success prints:

```text
Path artifact <artifact-id> created.
Television registered <trimmed-path>.
```

### URL artifact creation

`tv create-url-artifact` creates a URL artifact on a channel:

```bash
tv create-url-artifact --channel <id> --title <title> --url <url> (--focus-artifact|--no-focus)
```

The CLI trims surrounding whitespace from `--url` before sending it to the server and before printing the confirmation. The URL must be `http://` or `https://` after trimming and server validation.

Exactly one focus directive is required. `--focus-artifact` creates the artifact and sends a transient artifact-focus nudge for it. `--no-focus` creates the artifact without changing focus. Success prints:

```text
URL artifact <artifact-id> created.
Television registered <trimmed-url>.
```

### Metadata, listing, and deletion

`tv update-artifact --id <id> [--title <title>] [--path <path>] [--url <url>]` updates an artifact in place. At least one of `--title`, `--path`, or `--url` is required. `--path` and `--url` are mutually exclusive because an artifact's kind is immutable. `--path` repoints a path artifact and follows the same target rules as path creation. `--url` repoints a URL artifact to an `http(s)` URL. The CLI trims `--path` and `--url` before sending the update. Success prints:

```text
Artifact <artifact-id> updated.
```

`tv get-artifact --id <id>` prints `{ "artifact": ... }`.

`tv list-artifacts [--channel <id>]` prints `{ "artifacts": [...] }`. With no `--channel`, it lists every artifact. With `--channel`, it filters to artifacts on that channel.

The CLI does not have a command that reorders an artifact's tab page on its current channel. Reordering is a layout change made through the UI or the channel PATCH API. To show the same file, directory, or URL on another channel, create a second artifact on that channel with the same `--path` or `--url`.

`tv delete-artifact --id <id>` deletes an artifact registry record and removes its tab page from its channel. A path artifact deletion prints:

```text
path artifact <artifact-id> deleted from the registry.
  path: <path>
  path target was not touched.
```

A URL artifact deletion uses `url` in the same shape:

```text
url artifact <artifact-id> deleted from the registry.
  url: <url>
  url target was not touched.
```

## Display focus and themes

`tv focus-status` prints display state as compact JSON with `activeChannelID`, `activeThemeName`, and `acpEnabled` fields.

`tv focus-channel --channel <id>` sets persistent channel focus and prints:

```text
Focused channel <channel-id>.
```

`tv focus-artifact --id <id>` sends a transient artifact-focus nudge and prints:

```text
Focused artifact <artifact-id> on channel <channel-id>.
```

`tv set-theme <theme-id>` first attempts to read the current selection, then refreshes the server's theme registry, preserves the supplied theme ID exactly, and activates the valid installed theme with that exact ID. A failed opening selection read is nonfatal: the command continues with refresh and activation. When a discovered folder with that exact name is invalid, it prints that folder's validation error; when no discovered folder matches, it reports that the theme was not found. The case-insensitive token `none` skips refresh and writes `activeThemeName: null`; command help describes this as using no theme and does not expose the internal term `null theme`.

Successful output labels installed themes by exact theme ID and the null theme as `None`. When the opening read succeeded and the selection changed from `foo` to `bar`, the command prints exactly:

```text
Active theme changed from 'foo' to 'bar'.
```

When the opening read succeeded and the selection was already `foo`, it prints exactly:

```text
Active theme unchanged: 'foo'.
```

When the opening read failed and activation of `bar` succeeded, it prints only:

```text
Active theme: 'bar'.
```

The opening read failure itself produces no error. When available, the transition supplies the prior-selection context used by [the theme-authoring workflow](../arch/themes/authoring.md#theme-selection).

The selected theme applies to connected clients under [themes and appearance](themes-and-appearance.md); [theme delivery](../arch/themes/delivery.md) owns how its resources reach their documents.

`tv themes-path` prints the themes directory of the selected home, the directory in which the server discovers installed themes. The path is always `<home>/themes`, printed as compact JSON:

```json
{"themesPath":"/home/me/.television/themes"}
```

The command reads neither the config file nor a server, so its answer does not depend on whether a server is running. An agent that authors a theme passes the same home selection to `tv themes-path` and `tv set-theme`, as the [theme-authoring workflow](../arch/themes/authoring.md#authoring-workflow) describes. ^cli-themes-path

## Bundled skill commands

`tv skills` manages the bundled skill collection. `tv skills --help` lists the `install` subcommand and gives destination examples: `~/.openclaw/skills`, `~/.hermes/skills`, and `~/.agents/skills`.

`tv skills install <path> [--installed-by-agent <agent-runtime-harness-name>]` copies every bundled Television skill directory into the destination agent skills folder. The destination folder is created if needed. For each bundled skill, an existing destination directory with the same name is removed before the current bundled copy is written. The direct installation also removes `<path>/tv-theme` when present, so a standalone theming skill from an earlier bundle cannot remain beside the `television` skill that carries current theming guidance. Success prints:

```text
Copied <N> bundled Television skill(s):
- <skill-name>
  from: <bundled-source-path>
  to:   <destination-path>
```

The bundled skill collection is defined by the skills build manifest at `packages/skills/skills.json`. The CLI ships and installs exactly the skill directories listed there. The manifest always includes `television`, the primary skill named by the CLI's recovery guidance.

The *external skills installer* is Vercel's third-party `skills` package, whose terminal interface Television neither designs nor controls. Television uses it only as a convenience for browsing and installing the bundled collection interactively. `tv skills install -i [--installed-by-agent <agent-runtime-harness-name>]` launches the current Node executable with `skills/bin/cli.mjs add <bundled-skills-root>`. Passing both `-i` and a destination path is refused with:

```text
tv skills install -i does not take a destination path.
```

Calling `tv skills install` with neither a destination path nor `-i` is refused with:

```text
tv skills install requires a destination agent skills folder, or -i for interactive.
```

Passing an unknown option to `tv skills install` is refused with the normal directive-error shape and the bundled-skills recovery pointer.

After a direct or interactive install succeeds, the CLI makes a content-free, best-effort attempt to emit the *skill installed* event defined by [the telemetry spec](./telemetry.md#^agent-type), under the telemetry identity stored in the selected home. It waits no more than about one second for this attempt, never turns telemetry failure into install failure, and follows the [first-initialization notice](./telemetry.md#^disclose-cli). A failed skills install emits no event. When `--installed-by-agent` is present, the CLI forwards the agent runtime harness name under the value rules owned by [the telemetry spec](./telemetry.md#^installed-by-agent); the config file's `installedByAgent` setting describes the server and does not apply to skill installs. Destination paths and external-installer arguments are never recorded.

## Non-goals and unsupported surfaces

`tv` does not run repository tests. Use the canonical runner from [test-runner.md](../arch/test-runner/test-runner.md) for test execution.

The CLI does not expose these historical command names: `create-artifact`, `create-markdown-artifact`, `create-web-bundle-artifact`, `edit-artifact`, `commit-artifact`, `abandon-artifact`, `attach-artifact`, `detach-artifact`, `restore-artifact`, `list-pending-artifacts`, `make-attestation-nonce`, `data-dir`, or `storage-path`. These are retired or legacy names from earlier implementations and documentation; pinning their absence prevents them from silently returning. Each fails with `Unknown tv command: <name>.`

Commands that contact the server do not accept `--server`. `list-artifacts` does not accept `--unplaced`. `focus-channel`, `update-channel`, and `remove-channel` use `--channel`, not `--id`. `focus-artifact` uses `--id` and does not accept `--channel`.

## Packaged startup behavior

A built CLI ships the onboarding content tree and passes it into every serving store when the tree can be resolved. The user-visible installation behavior, including fresh installs, upgrades, and a missing bundle, is owned and acceptance-tested by [product/onboarding/onboarding-channels.md](./onboarding/onboarding-channels.md). The CLI packaging and resolver contract is owned by [arch/cli/index.md#Build and packaged asset layout](../arch/cli/index.md#Build and packaged asset layout).

## Testing

CLI acceptance must invoke `tv` as a person or agent would. A representative workflow command must run against a real server. Version acceptance must read the expected exact release version independently from the actual built package manifest and the expected commit independently from Git. It must invoke executables built with and without the developer marker, then invoke each with and without the runtime marker, without removing or changing the operator's real marker. A healthy status path must use a real server from that build and prove its version equals the release-version portion of `tv --version`.

Acceptance for `update-channel` must invoke the built CLI against a real server for both a successful rename and an unknown-channel error.

Tests never read or write the default home of the user running them, or read that user's `~/.tv-home`. They use temporary homes, and they exercise default-home selection, including `~/.tv-home`, with a substitute operating-system home directory.

This spec declares `tv skills install -i` an exception to the testing policy. No test runs the external installer, because it can prompt and write to agent skill directories outside Television's control. ^cli-installer-exception

*Server startup and shutdown: the two ways a store is constructed, the order of a serving start, listening on every requested address or none with one fatal log record, the origins a started server reports, and what stopping does.*

# Server lifecycle

A Television server starts in two stages. First the store is constructed, which migrates and loads the home and runs every installation step. Then the server binds its listeners. This document defines the order of the first stage, because several features depend on what has and has not happened before their step, and the rule for the second: the server listens on every address it was asked to, or it does not run.

`tv serve` supplies the home, the settings from its config file and the bundled asset paths ([CLI architecture](../cli/index.md#Server process boundary)). The server reads no config file and no port or home environment variable itself, so tests and other callers construct one directly with whatever options they need.

## Constructing the store

A store is constructed in one of two ways.

A *serving construction* prepares a home to be served, in [the order below](#The order of a serving start). `tv serve` always constructs this way.

A *token-only construction* exists so that `tv serve --persist` can read or create the token before it installs the service, and it suits any other caller that will not serve. It notes whether the home has [served before](../telemetry/identity.md), creates the home's directories, loads or creates the token, and loads the channel and artifact records. It runs no migration and creates no channel, no display state and no onboarding content, so the first serving start still finds a home that has never served. In particular it never creates the "Default" channel, which belongs to [the default-channel rule](../onboarding/installer.md#^default-screen) of a serving start. ^token-only-boot

The store resolves the home's path to an absolute path when it is constructed, so every path it derives from the home is independent of the process's working directory. ^storage-path-absolute

## The order of a serving start

A serving construction runs these steps in order, and finishes all of them before the server binds a listener: ^bootstrap-sequence

1. Note whether the home has served before, as [telemetry identity](../telemetry/identity.md) defines it. This comes first because every later step writes files that would make a fresh home look used.
2. Run [the server migration](../layout/migration.md#^one-migration), which must see the home as the previous release left it. Then create the home's directories, load or create the token, load the channel and artifact records, and load the [resource layer](../resources/index.md#^rs-bootstrap).
3. Note whether the home has any content yet, for the [onboarding focus rule](../onboarding/installer.md#^onboarding-focus-rule).
4. Migrate the onboarding state, then [install onboarding channels](../onboarding/installer.md#Install loop).
5. Apply the [default-channel rule](../onboarding/installer.md#^default-screen).
6. [Install bundled themes](../themes/bundled-installation.md#serving-boot-installation), then scan the theme registry.
7. Load the display state, or create it when the home has none. Make the [one-time default-theme decision](../themes/bundled-installation.md#default-theme-selection), then clear an active theme that the registry does not hold, then apply the onboarding focus rule.
8. Start watching artifact content and the active theme.

A migration that fails stops the start ([record rewrites](../layout/migration.md#^mig-record-atomic)). The feature specs say which of their own failures stop a start and which are logged and passed over; onboarding, for example, [never prevents a server from starting](../onboarding/installer.md#^failure-containment).

Telemetry attaches to the store only after construction, when the server starts listening, so nothing the steps above create is reported as a user's action ([onboarding](../onboarding/installer.md#^telemetry-silence)). The server then reports its start to telemetry and begins polling the [update channel](../updates/update-channel.md#Server-side polling).

## Listening

The server binds one listener for each address in its resolved bind list, which always includes loopback ([product CLI](../../product/cli.md#Server lifecycle commands)). Every address in that list is required. A Television server is either listening on all of them or it is not running. ^all-or-nothing

Exiting is what gets a late address bound. The common failure is a Tailscale address at system boot: the service manager starts Television and Tailscale in no particular order, so the address often does not exist yet when Television first tries it. The service manager restarts a process only when it exits. A server that carried on with the addresses it could bind would look healthy, would never be restarted, and would never try the missing address again. By exiting, the server hands the retry to the service manager, which relaunches it until every address binds ([service definitions](../cli/index.md#Generated service definitions)). The rule also keeps the server honest: an address in the config file is something the person asked for, and the [health response](./http.md#The health response) reports only addresses that are bound.

When the server starts listening, it:

1. Attempts every address once, and does not stop at the first failure, so one start reports every address that failed. ^attempt-all
2. On any failure, writes exactly one *fatal record*, [described below](#The fatal record), to the home's log, synchronously, before the start is reported as failed. ^one-record
3. Closes every listener that did bind, so none outlives the failed start. ^socket-cleanup
4. Fails with an error that carries the [bind-failure exit status](../cli/index.md#^exit-69).

The server never waits, polls, watches interfaces or tries an address again. The service manager's restart is the only retry. ^no-wait

Every kind of bind error is fatal in the same way: an address on no interface, a port in use, a port the process may not bind, or anything else. The kinds differ only in how likely they are to clear, which the server cannot know from one attempt, so the difference appears in the record's hint and never in behavior. ^all-errors-fatal

The first listener binds the configured port, and every other listener binds the port the first one got. Under config port `0` the operating system chooses that port. If a later listener then fails, the first is closed with the rest. ^port-zero

### The fatal record

A failed start writes one record to [the home's log](./storage.md#The log). It carries:

- **Every address in the bind list, the port used for it, and its outcome**, `bound` or `failed`. A failure also carries the error's `code` and `syscall`. An address that bound and was then closed is recorded as `bound`, so the record shows what happened to every address in that attempt. ^record-outcomes
- **The exit status** the process will exit with.
- **A cause and a hint.** When the address is not on any interface, lies in the range Tailscale assigns from, `100.64.0.0/10`, and the server runs as the installed service, the hint says that the address is not assigned to any interface; that if it is a Tailscale address, Tailscale may not be up yet, or the address may have changed and the config file's `listen` setting needs correcting; and that the service manager will retry. A foreground `tv serve` gets no Tailscale hint. Every other case gets a plain one-line cause. The range and the launch mode choose wording only, so a wrong guess can only mislabel a log line. ^record-hint

Each restart appends its own record, so how long a server has been failing can be read from the sequence. The log's rotation bounds what a long failure costs in disk space.

The record in the log is the only durable account of the failure. The server may also write to standard error, but whether that survives depends on the service manager, and nothing may rely on it. ^log-authority

## Origins

A started server reports its *origins*, the addresses it can be reached at, which are what [connect links](../../product/cli.md#^cli-connect-link) and share links are built from: for each address in the bind list, in order, `http://<address>:<port>` with the port it bound. A listener on `0.0.0.0` is reported as one origin for each IPv4 address the machine's network interfaces have when the server is asked, loopback included, and never as `0.0.0.0`. An origin that would repeat appears once. The [health response](./http.md#The health response) and the [share reply](../resources/index.md#^rs-share-cli-integration) carry the list. ^cli-server-origins

## Stopping

Stopping the server closes every listener and open connection and ends every timer, watcher and child process the server started, so the process can exit. It saves nothing, because every change was saved when it was made. A stop is safe to request more than once.

## Testing guidance

No automated test makes an address unavailable, lets a real service manager restart the server after it exits, and then makes the address available. That recovery is verified by hand; the [daemon acceptance suite](../cli/index.md#^cli-persist-suite-note) covers the installed service definition and an ordinary start under the service manager.

The process exit on a bind failure is proven once, by the product CLI proof's [bind-failure acceptance](../../../proofs/product/cli.md#^cli-ac-bind-failure). This spec's proof needs no second spawned-process test for it.

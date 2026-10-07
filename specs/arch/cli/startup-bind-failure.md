*All-or-nothing listener startup: any requested address that cannot bind is fatal — one structured log record, sockets closed, exit 69 — with the service manager's restart cadence as the sole retry loop.*

# Startup bind failure

When Television is asked to listen on a set of addresses and any one of them cannot be bound, most commonly a Tailscale IP that is not up yet at boot or one that no longer exists, the server refuses to run at all rather than serving only some of them. It writes one log entry saying which addresses failed and why, closes any sockets it did open, and exits with a recognizable status. The installed system service then tries again every few seconds, indefinitely, so the server comes up whole once the address appears. If the address never appears, the server never runs, and the log says why.

## What this owns

This spec owns the behavior of `Server.start()` when any resolved listener fails to bind; the fatal log record; the bind-failure exit status and its propagation through `runCLI`; the restart-related content of the generated service definitions (systemd user unit, launchd plist); and the foreground `tv serve` semantics of the same contract. It lives in `specs/arch/cli/` because no server architecture spec tree exists yet, and it is the authority for that server behavior until one does. The [CLI product spec's server lifecycle section](../../product/cli.md#Server lifecycle commands) owns the user-facing all-or-nothing rule.

Listener resolution (`resolveBindAddresses` in `packages/server/src/bind-addresses.ts`: adding loopback, removing duplicates, and collapsing to the `0.0.0.0` wildcard), auth resolution, and the install and uninstall flow are owned elsewhere.

## The contract: all-or-nothing startup

The **effective resolved listener set** — everything `resolveBindAddresses` returns, including the implicit `127.0.0.1` and after wildcard collapse — is *required*. There is no partial service: a Television server is either listening on every resolved address or it is not running.

**Why: exiting is what makes a late address eventually get bound.** The main case is **system boot**. The service manager launches the persisted Television service and tailscaled in parallel, with no ordering between them: the user unit cannot order itself against the system-level tailscaled, and launchd has no ordering between jobs. The tailnet IP is routinely assigned after Television has already tried to bind. The service manager's restart loop ([#Generated service definitions](#Generated service definitions)) is the only retry mechanism, and it acts only on a process that exits. A server that tolerated a partial bind would stay alive, look healthy to systemd or launchd, never be restarted, and never get the missing listener. By exiting, the server hands the retry to the service manager, which relaunches it on a fixed cadence until the bind succeeds. Secondarily, an address in the config file's `listen` setting is principal functionality, not an optional extra, and a process serving a subset while reporting itself healthy is a failure nothing would detect. All-or-nothing also makes the `bindAddresses` field of `/health` accurate: whenever the server answers, every requested address is bound. ^all-or-nothing

On startup, `start()`:

1. **Attempts every bind once per process** — it does not stop at the first failure — so that a single startup produces one complete picture of every address that failed simultaneously. ^attempt-all
2. On any failure: **writes exactly one fatal record** to `<home>/logs/tv.log` in the [Television home](../../product/cli.md#^cli-home) the server serves ([#The fatal record](#The fatal record)), synchronously, before any exit path runs. ^one-record
3. **Closes every socket that did bind** during the attempt, so no listener outlives the failed startup. ^socket-cleanup
4. Rejects with an error carrying the bind-failure exit status ([#Exit status](#Exit status)); the process exits nonzero.

**No in-process wait or retry of any kind.** The server never sleeps, polls, watches interfaces, or re-attempts a bind. The service manager's restart cadence is the sole retry loop ([#Generated service definitions](#Generated service definitions)). ^no-wait

**Every bind-error class is fatal.** `EADDRNOTAVAIL` (address not on any interface — the Tailscale boot race, or a stale tailnet IP), `EADDRINUSE` (port conflict, including the transient reinstall race against a terminating prior instance), `EACCES`/`EPERM` (privileged port, sandbox), and anything else: same behavior. Error classes differ only in *prognosis*, and prognosis lives in the fatal record's hint text, never in differing behavior — permanence is not knowable from inside one attempt, and the outer restart loop is cheap and unconditional. ^all-errors-fatal

Under the multi-listener port rule, the first listener binds the configured port (which may be `0`), and the resolved port is reused for the remaining listeners (`packages/server/src/server.ts`). All-or-nothing applies identically under config port `0`: if a later listener fails, the earlier ephemeral-port listener is closed with the rest. ^port-zero

## The fatal record

One structured record per failed startup attempt, written through the server's `log()` mechanism (`packages/server/src/logger.ts`: synchronous append, daily rotation, 14-day retention), which supplies the timestamp and process ID. The record carries:

- **Every resolved address, the port used in its bind attempt, and its outcome.** The outcome is `bound` or `failed`. A failure also records the errno `code` and `syscall`, as `serializeError` already preserves them. An address that bound and was then closed is recorded as `bound`, so the record shows the result for every address in that startup attempt. ^record-outcomes
- **The exit status** the process will exit with (`69`).
- **A cause and hint**, selected by error class. For `EADDRNOTAVAIL` on an address in the CGNAT range `100.64.0.0/10`, when the server runs as the installed service (launch mode `daemon`), the hint is tailscale-aware — it must state that the address is not assigned to any interface, that if it is a Tailscale IP then tailscaled may not be up yet (transient at boot) or the tailnet IP may have changed (permanent until the config file's `listen` setting is corrected), and that the service manager will retry. Foreground `tv serve` (launch mode `cli`) records no Tailscale hint. Every other case records a plain one-line cause. CGNAT detection and launch mode select *hint text only* — never behavior — so a wrong CGNAT guess can only mislabel a log line. ^record-hint

First-failure visibility relies on repeated records: each restart cycle appends one record with its own timestamp, so "failing since 03:12" is readable from the sequence; no attempt counter is required. Log rotation bounds a long-lived crash loop's disk cost.

**The tv.log record is the sole durable authority for diagnosis.** A copy of the failure may go to stderr as a best-effort courtesy, but stderr survival is platform-dependent (the launchd plist captures no stderr; the systemd user unit's stderr lands in the user journal) and nothing may depend on it. ^log-authority

## Exit status

Bind failure exits with **69** (`EX_UNAVAILABLE`). The status is carried on the error thrown from `start()` and honored by `runCLI` ([exit codes](./index.md#Command parser and error normalization)). The value is stable: service managers record it (`status=69` in `systemctl --user status`; `LastExitStatus` in `launchctl list`), giving an agent a bind-failure diagnosis without opening tv.log. ^exit-69

## Generated service definitions

The persisted service installed by `tv serve --persist` is rendered by `@rupertsworld/daemon@0.2.1`. Its current output contains:

**Linux user unit** (`~/.config/systemd/user/com.television.server.service`):

- `Restart=always` and `RestartSec=5`.
- `WantedBy=default.target`.
- **No backoff**: `RestartSteps=`/`RestartMaxDelaySec=` are not used. Backoff trades recovery latency for a log-volume saving that rotation already bounds, and has no macOS analogue. ^no-backoff

The package does not render an explicit systemd start-limit setting. The user-manager default allows five starts per 10-second window; exceeding it parks the unit in a permanent `start-limit-hit` failed state that does not retry automatically. The current retry-forever behavior holds because `RestartSec=5` permits at most about three starts in any 10-second window, below that limit. While the unit carries no explicit start-limit setting, `RestartSec` must remain at least approximately three seconds so a fast bind-failure loop cannot exhaust the default burst. Linear TV-507 tracks making retry-forever explicit. ^unit-start-limit

**macOS LaunchAgent** (`~/Library/LaunchAgents/com.television.server.plist`):

- `KeepAlive=true` and `RunAtLoad=true`, emitted as plist booleans. launchd throttles a fast-crashing job to one launch per `ThrottleInterval` (default 10 s) and never abandons it; the default cadence is acceptable and no throttle key is required.
- **No `StandardErrorPath` is required.** The fatal record in tv.log is the sole durable diagnostic authority ([#^log-authority](#^log-authority)); launchd discarding stderr is accepted.

Resulting recovery cadence once a missing address appears: bounded by `RestartSec` (~5–6 s) on Linux and `ThrottleInterval` (~10 s) on macOS. The [post-install health check](./index.md#^cli-persist-health-check) waits long enough for one restart at these cadences, so lengthening either requires revisiting its deadline.

## Foreground semantics

Foreground `tv serve` uses the same `start()` contract — all-or-nothing, the same fatal record apart from the [Tailscale hint](#^record-hint), same exit 69. There is no retry loop in the foreground: the process exits and the operator (or wrapping script) reruns it. This is intended: a foreground serve that silently dropped a requested listener would be the same undetected failure. ^foreground

## Testing

The bind-failure process exit is owned by the product CLI proof's [bind-failure acceptance assertion](../../../proofs/product/cli.md#^cli-ac-bind-failure). This spec requires no second spawned-process test for that path; its proof composes the product acceptance path with server contract tests for the detailed bind-failure behavior.

Generated service definitions are proven through the `daemon-acceptance` suite, which [arch/test-runner/test-runner.md](../test-runner/test-runner.md) owns (Production daemon acceptance suite). The suite runs outside `verify` and CI on a designated host. A change to the Linux user unit's or the macOS LaunchAgent's retry fields requires running it on that platform.

No automated test makes a bind address unavailable, lets the real service manager restart the process after it exits with status 69, and then makes the address available again. The installed definition and ordinary service-manager startup are automated; restart cadence and recovery after an address appears are verified by hand.


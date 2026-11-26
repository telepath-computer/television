*The CLI's side of startup bind failure: the exit status a failed bind carries, the persisted service definitions whose restart loop retries until every address binds, and foreground `tv serve` exiting without a retry.*

# Startup bind failure (CLI)

A Television server whose listener addresses cannot all be bound does not run: it records why and fails its start ([the server's all-or-nothing startup](../server/lifecycle.md#^all-or-nothing)). Most often the missing address is a Tailscale address that is not assigned yet when the machine boots. This spec owns what the CLI does with that failure: the exit status it exits with, and the service definitions whose restarts are the only retry, so that the server comes up whole once the address exists. The [product CLI](../../product/cli.md#Server lifecycle commands) owns the user-facing rule.

## Exit status

Bind failure exits with **69** (`EX_UNAVAILABLE`). The status is carried on the error that `Server.start()` rejects with and honored structurally by `runCLI` (`packages/cli/src/index.ts`); bind failure is the one exception to the ordinary exit-1 error path. Service managers record the status (`status=69` in `systemctl --user status`; `LastExitStatus` in `launchctl list`), which gives an agent the diagnosis without opening the log. ^exit-69

## Generated service definitions

The persisted service installed by `tv serve --persist` is rendered by `@rupertsworld/daemon@0.2.1`. Its output contains:

**Linux user unit** (`~/.config/systemd/user/com.television.server.service`):

- `Restart=always` and `RestartSec=5`.
- `WantedBy=default.target`.
- **No backoff**: `RestartSteps=` and `RestartMaxDelaySec=` are not used. Backoff would trade recovery time for a smaller log, which [log rotation](../server/lifecycle.md#^srv-log) already bounds, and macOS has nothing equivalent. ^no-backoff

The package renders no explicit systemd start limit. The user manager's default allows five starts in any 10-second window; exceeding it leaves the unit in a `start-limit-hit` failed state that is never retried. `RestartSec=5` permits about three starts in such a window, so the service retries forever as long as `RestartSec` stays at about three seconds or more. [TV-507](https://linear.app/telepath-computer/issue/TV-507) tracks rendering `StartLimitIntervalSec=0`, which makes retrying forever explicit. ^unit-start-limit

**macOS LaunchAgent** (`~/Library/LaunchAgents/com.television.server.plist`):

- `KeepAlive=true` and `RunAtLoad=true`, as plist booleans. launchd starts a job that keeps exiting at most once per `ThrottleInterval`, 10 seconds by default, and never gives up on it, so no throttle key is needed.
- No `StandardErrorPath`: the [fatal record](../server/lifecycle.md#^log-authority) in the log is the diagnosis, and launchd discarding stderr is accepted.

Once a missing address appears, the server is therefore up within about 5–6 seconds on Linux and about 10 seconds on macOS. The [post-install health check](./index.md#^cli-persist-health-check) waits long enough for one restart at these cadences, so lengthening either means revisiting its deadline.

## Foreground semantics

Foreground `tv serve` fails its start the same way and exits with 69; its fatal record has no [Tailscale hint](../server/lifecycle.md#^record-hint). Nothing retries in the foreground: the operator, or a wrapping script, runs the command again. A foreground serve that dropped a requested listener would be the same silent failure as a persisted one. ^foreground

## Testing

The bind-failure process exit is covered by the product CLI proof's [bind-failure acceptance assertion](../../../proofs/product/cli.md#^cli-ac-bind-failure); this spec orders no second spawned-process test for it.

Generated service definitions are proven through the `daemon-acceptance` suite, which [arch/test-runner/test-runner.md](../test-runner/test-runner.md) owns (Production daemon acceptance suite). The suite runs outside `verify` and CI on a designated host. A change to the Linux user unit's or the macOS LaunchAgent's retry fields requires running it on that platform.

No automated test makes a bind address unavailable, lets the real service manager restart the process after it exits with status 69, and then makes the address available again. The installed definition and ordinary service-manager startup are automated; restart cadence and recovery after an address appears are verified by hand.

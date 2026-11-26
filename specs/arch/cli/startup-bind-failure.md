*How foreground and installed Television services recover when the server cannot bind its listeners.*

# CLI recovery from bind failure

A machine can start Television before its configured interface comes up. The [server](../server/index.md#^all-or-nothing) reports the bind failure and releases its sockets. A foreground `tv serve` propagates the server's exit status without retrying. An installed service lets the service manager relaunch it until its addresses become available. ^foreground

## Generated service definitions

On Linux the user unit starts at `default.target` and uses `Restart=always` with `RestartSec=5`. The cadence stays below the user manager's default start-rate limit, so repeated failures do not park the unit. On macOS the LaunchAgent uses `RunAtLoad` and `KeepAlive` with launchd's ordinary throttling (about ten seconds). Both retry indefinitely at a fixed cadence. The [post-install health wait](index.md#^cli-persist-health-check) allows time for a restart. Operators can diagnose failures from the [server log](../server/index.md#^record-outcomes).

## Testing guidance

The bind-failure process exit is owned by the product CLI proof's [bind-failure acceptance assertion](../../../proofs/product/cli.md#^cli-ac-bind-failure). Reuse that acceptance for process exit.

Generated service definitions are proven through the `daemon-acceptance` suite, which [arch/test-runner/test-runner.md](../test-runner/test-runner.md) owns (Production daemon acceptance suite). The suite runs outside `verify` and CI on a designated host. A change to the Linux user unit's or the macOS LaunchAgent's retry fields requires running it on that platform.

No automated test makes a bind address unavailable, lets the real service manager restart the process after it exits with status 69, and then makes the address available again. The installed definition and ordinary service-manager startup are automated; restart cadence and recovery after an address appears are verified by hand.


*The canonical `npm test` and `npm run verify` command surface: how a caller selects tests, picks where they run, and runs them, with the guardrails that keep broad runs honest.*

# Test Runner

This spec is authoritative for Television's one canonical test command surface and its behavior: the commands, the selectors, provider selection, the broad-run guardrail, retry conditions, `verify` orchestration, exit codes, local execution, and the Cursor-agent environment workaround. It is the boundary spec for the testing area and delegates to its companions: the surface registry it selects from is [test-registry.md](./test-registry.md); the preflight checks it runs are [preflight.md](./preflight.md); the normalized results and run directory it writes are [reporting.md](./reporting.md); remote execution is [sharded-execution.md](./sharded-execution.md), realized by [blaxel-testshards.md](./blaxel-testshards.md); the GitHub Actions CI workflow's setup and execution contract is [github-ci.md](./github-ci.md). The discipline every test is held to is [testing-policy.md](../testing-policy.md).

This spec is also authoritative for test-service address allocation, the responses of registry-declared services, and process lifecycle. Service declarations are owned by [test-registry.md](./test-registry.md).

## Why this exists

Television has one test runner so that anyone — and especially a coding agent — has a single, reliable way to run tests in whatever form a task needs: one case, one file, one suite, one package, a whole surface, locally or on a remote provider. The command grammar below is the contract: it is the one documented way to select and run tests, so callers stop improvising per-package invocations.

Without a single runner, package areas accumulate separate invocations, the permutations drift apart, and a caller cannot trust that a given flag is even respected. That unreliability falls hardest on agents, which readily emit plausible-looking test commands whose arguments are silently ignored or mean something other than intended. Consolidating invocation into one canonical surface is what makes running tests trustworthy.

The consolidation pays off three ways:

- **Operationally, for agents and people** — one predictable, documented grammar to learn and use, rather than a different ad-hoc invocation per package.
- **Operationally, across runners** — a normalized way to route the same run to different underlying runners and providers and collect results in one shape.
- **Architecturally** — a single place that knows where all the tests are and holds the knobs for managing them: suites, surfaces, sharding, and selection.

A *provider* is where tests run:

- `local` — the current checkout, including uncommitted edits.
- `blaxel` — a persistent remote sandbox pool, running a committed revision.

GitHub Actions runs tests as the CI workflow ([github-ci.md](./github-ci.md)), not as a runner-selectable provider.

There is no default provider for direct test execution: a provider shortcut names it explicitly, and remote providers run a committed revision fetched from `origin` rather than local edits. `verify` is the one command that may resolve a provider automatically.

## Commands

```
npm test -- <command> [options]
npm run verify                  # broad verification; auto-resolves a provider
npm run verify -- local         # explicit provider (also: blaxel)
npm run verify -- --no-publish  # run the gate without publishing its attestation
npm run verify -- --plan        # print the resolved provider and phase commands, run nothing
```

`npm run verify -- <args>` forwards to the `verify` command; `npm test -- verify <args>` is equivalent.

| Command | Purpose |
|---|---|
| `local` \| `blaxel` | Provider shortcut: run a selection on that provider. With no selector it defaults to the `all` suite, which is a *broad run* and is refused without `--force`. |
| `verify` | Run lint, type-check, package-manifests, and the `all` suite (preflight too, locally), resolving a provider. The broad-verification entrypoint. |
| `list` | Print the surfaces a selection resolves to. |
| `preflight --provider <p>` | Run only the preflight checks for a provider and selection. See [preflight.md](./preflight.md). |
| `pool blaxel <list\|ensure\|delete>` | Manage the Blaxel sandbox pool. See [blaxel-testshards.md](./blaxel-testshards.md). |
| `baseline update [--dry-run]` | Recompute the committed duration baseline from the checkout's Blaxel run directories. See [sharded-execution.md](./sharded-execution.md). |
| `testpass prune <--older-than <days>d\|--dead-version <n>\|--delete-ref <ref>> [--apply]` | Inspect or apply attestation-ref retention, version sweeps, and exact-ref revocation. See [attestation.md](./attestation.md). |
| `help` | Print usage. |

Package-level `test` / `test:e2e` scripts are not supported entrypoints; the root runner invokes each surface's config directly. This command surface is the only supported way to run tests.

## Selectors

A *selector* chooses which tests run; the runner resolves selectors against [test-registry.md](./test-registry.md) and translates them to the underlying runner's flags.

| Selector | Meaning |
|---|---|
| `--suite <unit\|e2e\|e2e-ci\|agent\|experiment\|telemetry-posthog-roundtrip\|daemon-acceptance\|all>` | A named suite. `e2e-ci` is the registry-owned non-Electron CI shard selection; desktop runs in its dedicated job. |
| `--all` | Alias for `--suite all`. |
| `--surface <id>` | One or more registered surfaces (comma-separated). |
| `--package <name>` | Surfaces associated with a workspace package. |
| `--file <path>` | The surface that owns a test file, running that file. |
| `--grep <pattern>` | Test-title filter, translated to `-t` for Vitest and `-g` for Playwright. |
| `--runner <vitest\|playwright>` | Surfaces using a runner. |
| `--tag <tag>` | Surfaces carrying a registry tag, such as `browser` or `electron`. |

The local provider accepts every registered suite. A Blaxel suite selection accepts only `all`, `unit`, or `e2e`; narrower remote work uses surface, file, or grep selection through the target path.

`--file` must resolve to exactly one owning surface: if no surface owns the file the runner fails; if several do, it fails and asks for `--surface` to disambiguate. On the local execution path, a `--file` or `--grep` selection against a surface that does not declare support for it is rejected while building that surface's command. The targeted Blaxel path does not currently apply this `supports` check. The runner parses these selectors itself and rejects unknown positional arguments; the sole positional accepted is the `verify` provider.

## Publication qualification

A *publication-qualifying test execution* uses the `blaxel` provider for the complete `all` suite with no narrowing selector and no shard subset. Precisely, its effective suite is `all`; `--surface`, `--package`, `--file`, `--grep`, `--runner`, and `--tag` are all absent; and `--shard-indices` is absent. An explicit `--suite all` or `--all` remains complete. `--shards <n>` changes how the complete suite is partitioned, so it does not narrow the run when every index executes. A local-provider execution never qualifies, even when it runs `all`, because a developer host does not provide the controlled execution environment required for durable pass evidence. ^test-publication-qualifying

A *publication-qualifying verify* is a `verify` whose test phase is a publication-qualifying test execution. The normal `npm run verify -- blaxel` command has this shape. Selection options supplied to `verify` are part of the qualification decision even when verify's phase construction would otherwise force `all`; a caller cannot attach a narrowing option and receive publication credit for the resulting run.

Publication requires no opt-in. A passing publication-qualifying verify is eligible for its `refs/testpass/*` attestation under [attestation.md](./attestation.md). `--no-publish` is an opt-out that suppresses that write. It does not alter which phases or tests execute. There is no publication opt-in flag: narrowed and local runs never publish regardless of caller intent, and passing `--publish` is a usage error.

Production attestations have exactly two source classes: a publication-qualifying Blaxel verify and the complete GitHub Actions CI workflow. The workflow's `attest-write` job is a CI-only writer after the strict join; individual GitHub-hosted commands that use `provider=local` are not attestation writers. A developer-host local verify cannot publish an attestation under any scope or result. [attestation.md](./attestation.md) owns the complete source predicate.

## Run-directory identity output

`--run-dir-output <file>` asks a local or Blaxel provider invocation to atomically write the absolute path of the run directory it owns. The write happens immediately after run-directory creation, before local preflight and test execution, so the identity remains available when either of those phases fails. The option is per invocation rather than inherited through the environment: a test that spawns another canonical runner cannot replace its parent's identity unless it explicitly passes the same option. Workflow orchestration reads this file and validates that the path is a direct child of the expected `.test-runs/` root; it never discovers ownership by enumerating that root.

## Broad-run guardrail

A *broad run* is a provider shortcut that runs the full `all` set with no narrowing selector. A broad run skips lint and type-check, so the provider shortcuts refuse it with a message directing the caller to `npm run verify`.

The `telemetry-posthog-roundtrip` and `daemon-acceptance` suites are not broad verification. They are specialized, opt-in local suites and are excluded from `all`. The first crosses the live telemetry ↔ PostHog boundary; the second replaces the active global `tv` package and the literal `com.television.server` user service on a designated developer host. Build-config-integrity tests are not part of either suite: `unit:build-config` is a normal unit surface in `all` and uses no secrets, network, or host service mutation.

The guardrail trips only on the effective `all` suite with nothing narrowing it: a bare provider (which defaults to `--suite all`), an explicit `--suite all` or `--all`, or a bare `--grep` with no other selector. Everything else passes through:

- any narrowing selector — `--file`, `--surface`, `--package`, `--runner`, or `--tag`;
- a non-`all` suite — for example `--suite unit`, `--suite e2e`, `--suite telemetry-posthog-roundtrip`, or `--suite daemon-acceptance`.

`--grep` does not narrow on its own: a bare `--grep` defaults to the `all` suite and is refused, but `--grep` rides along with any of the selections above, including `--suite unit --grep ...`. To run a genuinely broad provider shortcut anyway, pass `--force`; `verify` passes `--force` internally to its own broad test phase.

## Verify orchestration

`verify` runs the broad verification that the guardrail steers callers toward. It resolves a provider, then runs phases in order, stopping at the first failure.

The presence of `.tvdev-use-blaxel` in the invoking user’s home directory (`os.homedir()`) makes Blaxel the verification default and enables the local-verification guardrail across checkouts and sessions; its contents are ignored. The marker affects only `verify` provider selection, not targeted local test commands. The runner consults the home-directory marker, with no dedicated environment-variable switch. ^blaxel-host-marker

**Provider resolution.** The provider comes from `--provider`, or a single positional (`local` | `blaxel`), or defaults to `auto`. Passing both a positional and `--provider` is an error, as is an invalid positional.

- An explicit provider (`local` or `blaxel`) is used as given; resolution itself runs no preflight. An explicit `local` when `~/.tvdev-use-blaxel` exists is refused unless `--allow-extreme-inefficiency` is passed, to keep broad verification on the chosen remote path. Explicit Blaxel commands remain available regardless of the marker.
- Without `~/.tvdev-use-blaxel`, `auto` (the default) selects `local` without remote preflight, Blaxel access attempts, or Blaxel warnings. Local verification requires no bypass flag.
- With the marker, `auto` runs the Blaxel remote preflight ([preflight.md](./preflight.md)): if it passes, the provider is `blaxel`; if it fails, verification is refused with exit `2`, remediation and the explicit `local --allow-extreme-inefficiency` escape hatch. There is no automatic local fallback on a marked host.

**Phases.** Local verify runs six phases: local preflight (`all`), lint, type-check, package-manifests, the `all` suite locally with `--force`, then the vibe-mode check. Remote verify runs five: lint, type-check, package-manifests, the `all` suite on the chosen provider against the committed revision (`--commit HEAD` by default) with `--force`, then the vibe-mode check. There is no separate remote-preflight phase in the list; the remote preflight runs inside the provider's own test phase, before it dispatches. So an explicit remote provider runs the remote preflight once, in the test phase, while `auto` that resolved to `blaxel` runs the Blaxel preflight twice — once during resolution, once inside the test phase. Non-unit surfaces retry twice by default in the test phase; `--retries <n>` overrides that count. On success verify prints `verify passed (<provider>)`. A passing publication-qualifying verify automatically publishes a tree-hash attestation when the attestation eligibility predicate and activation policy permit; `--no-publish` suppresses that write ([attestation.md](./attestation.md)). Local and narrowed verifies do not publish attestations.

The *vibe-mode check*, `scripts/test/vibe-mode-check.mjs`, is the last phase for both providers. It fails when `specs/vibe-waiver.md` exists in the checkout, because a branch in vibe mode is never merged into `main`; verify then reports failure and publishes no attestation. It runs after every other phase has run and reported normally, so the lint, type-check, and test results on a vibe branch are real, and its message names vibe mode as the reason. ^verify-vibe-mode

`--plan` prints the resolved provider and the phase commands without running them. A `--plan` exit of 0 is not a verification — it reports what would run, nothing more. Verify has no path that reports a pass without running its phases.

## Build-config integrity surface

`unit:build-config` runs in `all` and CI. It runs the real CLI build script and inspects the default output for the ordinary configuration and an isolated `--outfile` bundle for the release configuration to verify the [ordinary and npm-release telemetry build configurations](../telemetry/sink.md#Behavior and operations). It is separate from `telemetry-posthog-roundtrip:integration`: it does not contact PostHog, does not require `TV_POSTHOG_TEST_READ_KEY`, and is safe for Blaxel and GitHub Actions.

## Telemetry PostHog roundtrip suite

`--suite telemetry-posthog-roundtrip` selects the live telemetry ↔ PostHog integration surface, currently `telemetry-posthog-roundtrip:integration`. The canonical invocation is:

```bash
npm test -- local --suite telemetry-posthog-roundtrip
```

The suite is excluded from `all`, so `npm run verify`, CI, and Blaxel `--suite all` do not run it. It is intentionally local-only because it requires the secret PostHog test read key; remote providers do not receive that key. The selected surface declares the `posthog-test-key` preflight, so a missing key fails before Vitest starts. The PostHog key setup and the test project safety guard are specified in [../telemetry/sink.md#real-posthog-integration-test-surface](../telemetry/sink.md#real-posthog-integration-test-surface).

## Production daemon acceptance suite

`--suite daemon-acceptance` selects `daemon-acceptance:cli`, the packed-and-installed CLI acceptance surface for persisted service installation and removal. The canonical invocation is:

```bash
TV_DAEMON_TEST_HOST=1 npm test -- local --suite daemon-acceptance
```

The suite is excluded from `all`, ordinary `verify`, CI, and Blaxel broad verification. It is manually run only on a designated developer host that is not intended to run a normal Television server. The `daemon-test-host` preflight requires the exact acknowledgement `TV_DAEMON_TEST_HOST=1` before the surface's build pre-command or test process starts; the test file repeats that check if invoked outside the canonical runner. The acknowledgement is an accidental-execution guard, not an authorization boundary.

The surface builds the publishable CLI, packs it, and force-installs that tarball into the active npm global prefix. Its bulldozer first removes any existing `com.television.server` user service through the real `Daemon`, logs the service and PATH-visible `tv` state it found, and always replaces the global package with the freshly packed build. The asserted path then invokes the installed `tv` symlink, production `createDaemon`, literal service identity and arguments, and the host service manager. It proves daemon boot through `/health`, removes the service through `tv stop`, installs a service whose server cannot bind its listener and observes the command fail with the service left installed, repeats installation over that service for `tv serve --persist-uninstall`, and verifies no service definition or active registration remains. The final bulldozer observes that successful CLI removal left no service, invokes idempotent real cleanup, and removes residue if an earlier assertion failed. The freshly packed global `tv` package remains installed after the suite.

Persisted serve rejects port `0`, so the surface cannot keep a kernel-owned port reservation while handing a stable number to the service's config file. For each installation it creates a temporary [Television home](../../product/cli.md#^cli-home), binds loopback port `0`, reads the assigned nonzero port, closes the reservation, writes that port with `tv --home <temporary-home> config set port <port>`, and immediately installs with `tv --home <temporary-home> serve --persist` and probes the daemon on that number. This is a narrow declared exception to [the normal continuous-reservation rule](#^test-dynamic-ports). `TV_DAEMON_TEST_DIRTY_START=1` asks the surface to create a production-identity installation before its foundation bulldozer; this is a test-harness mode for proving convergence from prior service residue, and it remains protected by `TV_DAEMON_TEST_HOST=1`.

## Retries

Non-unit Vitest and Playwright surfaces retry twice at the runner level by default, including targeted file/grep/surface runs; unit surfaces receive no runner-level retries. `--retries <n>` overrides the non-unit count and is ignored (with a notice) for a unit-only selection. This is the runner's blanket retry budget; the per-test flaky annotation that opts a single case into retries is owned by [flaky-tests.md](./flaky-tests.md).

The canonical runner does not impose an automatic cap on observed failure counts through Playwright `maxFailures` or an equivalent mechanism. Tests are typically sharded across independent processes, so such a cap does not meaningfully bound a complete run; it only leaves assigned tests unexecuted and reduces the diagnostic evidence available from that run.

Blaxel infrastructure retries are separate from this per-test budget. Infrastructure failure is the only condition that causes a shard to run again. A completed rerun supersedes the prior infrastructure-failed result. The canonical Blaxel command permits two such retries and reuses the shard's unchanged assignment, including for unit work and when the incomplete attempt retained failed task observations. Retry eligibility is independent per shard, so a completed test failure elsewhere does not suppress it. `stale-owner` is the sandbox-safety exception defined by [blaxel-testshards.md](./blaxel-testshards.md): the contaminated sandbox runs no selected test and is excluded from later attempts, while a configured retry may run the unchanged shard assignment on a distinct sandbox only after that sandbox acquires its own lease and passes its owner audit. Without an exact contaminated-sandbox identity or distinct clean capacity, the shard remains infrastructure-failed. If the retry budget ends without a complete result, the normalized run remains incomplete and the command fails.

The GitHub Actions CI workflow at .github/workflows/ci.yml is part of the runner-retry contract. Its browser and Node end-to-end shard job calls scripts/run-test-shard.mjs directly instead of entering through npm test, so that job must pass --test-retries 2. The desktop end-to-end job enters through npm test -- local --surface e2e:desktop, so it receives the same default retry count from the runner. If the default retry count for non-unit surfaces changes, this workflow must change in the same update.

## Local execution

A local run writes a run directory and normalized reports ([reporting.md](./reporting.md)) and exits 0 when the run passed, 1 otherwise.

- A suite or broad local selection with no `--file` / `--grep` runs surfaces grouped by execution group, in group order ([test-registry.md](./test-registry.md)). The group whose id is `unit:workspaces` runs as one Vitest process when all of its members use Vitest and declare no services. The combined native result is split back to per-surface results by file ownership. Other groups run surface by surface, even when every member uses Vitest.
- A `--file` or `--grep` selection runs the selected surfaces one at a time.
- Each independently spawned surface task runs inside the owned process scope defined below. The runner starts its declared services, publishes their URLs, and completes teardown and leak detection before the next task starts.
- A surface may declare a build to run first, services to run alongside it, or a command that overrides the default runner invocation; these declarations are registry-owned ([test-registry.md](./test-registry.md)).
- When `SKIP_ELECTRON_E2E=1`, the desktop command still starts through the normal surface path. If it exits cleanly without leaks or cleanup failure, the runner reclassifies that result as `skipped` with `SKIP_ELECTRON_E2E=1` as its reason.

## Test infrastructure addresses

A *test infrastructure listener* is a network listener created to support a canonical test run: an application server, development server, proxy, fixture server, or other harness service. Every such listener asks the operating system for an available port by binding port `0` (or the runtime's equivalent) and reads back the assigned address after the bind succeeds. Test infrastructure has no fixed port, planned port range, adjacent-port convention, or reserve-then-release allocator. This is required because only the successful bind reserves a port; selecting a number before binding has a time-of-check/time-of-use race with every other process on the host. ^test-dynamic-ports

A consumer receives a full URL from the component that owns the successful bind. This applies to runner configs, helpers, test cases, browser navigation, and URLs embedded in served fixtures; none may use a numeric test-infrastructure URL literal or a fallback to one.

- For a registry-declared service, the runner creates an HTTP listener, mounts Vite's Node-API middleware on it, connects Vite HMR to that same listener, disables speculative request pretransforms, binds the listener to loopback port `0`, and reads its address after `listen()`. Vite treats `server.port: 0` as a falsy value and substitutes its default port, so Vite does not own this bind. Its speculative pretransforms can also retain pending transform promises after the public idle barrier; on-demand transforms remain enabled while the runner disables that optimization so bounded teardown can complete. The runner writes the full bound URL to the service's `publishUrlEnv` variable ([test-registry.md](./test-registry.md)). Services start in declaration order, and each published URL is present while later services load their config and while the test command loads its config. A missing required variable is a configuration failure before tests start.
- A test helper that starts its own listener returns the bound URL directly. A subprocess that implements the listener may publish it through a machine-readable readiness message; the helper waits for that message before returning.
- A test that spawns the product's `tv serve` gives it a temporary [Television home](../../product/cli.md#^cli-home) whose config file sets port `0`, passes that home with `--home` to the server and to every client command it spawns, and passes the server [the hidden `--print-links` flag](../cli/index.md#Server process boundary), so that it prints its connect links even though its output is a pipe. The test reads the acquired URL from those links. Spawned client commands also pass that URL's port with `--port`, as the [client-port rule](../../product/cli.md#^cli-client-port) requires for config port `0`.
- A Playwright config reads its base URL from the published environment. It does not start a second copy through Playwright's `webServer` option and does not fall back to a numeric localhost URL. A test whose framework `baseURL` type is optional asserts that it is present before use.
- A committed static fixture uses relative `src` and `href` values for dependencies served by its own origin. If it needs another independently published service, the serving Vite config uses `define` injection to supply that service's named URL to the consuming module. If a fixture needs a second origin on the same service, it derives the alternate hostname from `location` at runtime while preserving the published port. The committed fixture never contains a numeric live-service origin.

Each URL is independent. A harness with two origins receives two published URLs and never derives one by adding to another port. The artifact host and artifact view are two independently bound services under this rule; their addresses are not allocated from a precomputed range.

A test may contain a numeric port as inert input or expected output only when the value is never dereferenced as the address of a live test-infrastructure listener. This permits parser/serialization fixtures and a deliberate unreachable target to which no test process binds. It does not permit a URL used by navigation, `fetch`, a socket client, `src`, or `href` to identify a running test service.

When a browser origin must remain stable while its backend restarts, one front listener binds port `0` for the whole test and updates its forwarding target after each independently bound backend starts. The test never closes a reservation and asks a replacement server to rebind its number.

## Vite service responses

A registry-declared service answers every request in full and never with `304 Not Modified`: its listener removes the `If-None-Match` and `If-Modified-Since` headers from each request before Vite handles it. ^test-service-full-responses

The reason is a Chromium behavior, observed on Linux in the Chromium 145 build that Playwright 1.58.2 installs, both its headless shell and full Chromium. There, each script, module, stylesheet, or image response with status 304 left the page's renderer holding a 2 MB shared-memory buffer until the page's browser context closed, even after the page navigated elsewhere. Vite serves the application's development build as hundreds of separate modules that the browser revalidates on every load, so in that build each further load of the application in one page held about 465 MB more. Other Chromium versions may differ. Playwright launches Chromium with `--disable-dev-shm-usage`, which places those buffers in the temporary directory. Where that directory is kept in memory, as on [Blaxel workers](./blaxel-testshards.md), a test that loads the application several times in one page can run out of memory and crash the page.

## Destructive fixture placement

A surface tagged `isolated-github-only` is refused with usage exit `2` before local preflight, Blaxel preflight, dispatch, or lease acquisition. It is never eligible for developer-host local execution or any Blaxel path. The only accepted placement is `provider=local` inside an operator-authorized, branch-only GitHub workflow named `Process Lifecycle Fault Injection`, with `GITHUB_ACTIONS=true` and `TV_TEST_ISOLATED_GITHUB=1`. The repository does not commit this fault-injection workflow. Its exact identity and explicit opt-in prevent accidental execution in trusted automation, but they are not a security boundary because callers can set the same environment values. Any authorized workflow must use an isolated ephemeral runner, an independent timeout, owner-token cleanup, and complete hidden run-artifact upload. Repository workflow controls, registry exclusion, provider refusal, host isolation, and independent cleanup provide the protection. This execution restriction is permanent.

## Surface process lifecycle

```ts
const TEST_SURFACE_OWNER_ENV: "TV_TEST_SURFACE_OWNER";
const TEST_PROCESS_TERM_GRACE_MS: 2_000;
```

A *surface process scope* is the complete set of operating-system processes started for one independently spawned surface task: its `preCommand`, declared services, test command, runner workers, browsers, Electron applications, and subprocesses started by tests. The local runner owns local scopes; the shared shard worker owns remote scopes ([sharded-execution.md](./sharded-execution.md)). A worker process and a test callback may perform prompt cleanup, but the outer scope owner is the final reaper because it remains alive when a worker crashes or a test callback is interrupted. ^test-surface-owner

Before starting a scope, its owner creates a unique owner token whose encoding contains the run ID, surface identity, supervisor PID, and supervisor process start time. The token is opaque to tests and child consumers; the scope owner and preflight scanner decode it. The owner exports it to every child and launches each root command in a POSIX process group. Repository test helpers preserve the token in child environments. Declared services and helpers that create detached children give those children their own process groups so the owner can signal each tree. Descendants that create another process group remain discoverable through the inherited token.

A surface scope proceeds in this order:

1. Run `preCommand`, if declared. It must exit without a live descendant before service startup.
2. Start declared services in declaration order and wait for each bound URL.
3. Run the test command and wait for its exit.
4. Stop declared services in reverse order and allow a bounded graceful-exit interval.
5. Run the leak check below, reap any survivors, and only then complete the surface result or start another task.

The same teardown runs after a non-zero child exit, thrown runner error, timeout, `SIGINT`, or `SIGTERM`. It sends `SIGTERM` to registered process groups and token-matched processes, waits up to `TEST_PROCESS_TERM_GRACE_MS`, then sends `SIGKILL` to survivors. Two seconds lets a test server close sockets and flush output without allowing a leaked process to consume a material share of the run. Cleanup functions are idempotent. No test-owned process may transfer out of the scope or survive it.

`SIGKILL` of the scope owner itself cannot execute teardown. On an ephemeral GitHub host, job disposal removes its processes. A persistent or local execution host finds the abandoned token during its next preflight and reaps it before running a surface. The lifecycle guarantee is that no subsequent surface starts alongside an abandoned process; it does not claim that a killed supervisor can execute code.

A combined Vitest run uses a generated config with one `test.projects` entry per member surface. Each entry extends the surface's Vitest config and uses that config file's directory as its root. Attempt recording follows [reporting.md](./reporting.md#^vitest-attempt-recording). This structure applies to local and sharded execution. The command is one process scope whose token names every member surface. It may contain only surfaces with no declared services and no test that intentionally leaves a long-running subprocess alive while another surface executes. A leak fails every member because the shared process boundary cannot attribute the spawn more narrowly. A surface that needs services or long-running subprocesses runs as an independent task.

Persistent workers inspect Television owner tokens before accepting a new scope. A token is stale only when its recorded supervisor PID and process start time no longer identify a live supervisor; a concurrent run with a live supervisor is left untouched. A stale process is captured and reaped, and the worker reports an infrastructure preflight failure naming the token and process; it does not run a new surface in contaminated state. An ephemeral provider still performs the check so its correctness does not depend on host disposal.

## End-of-surface leak detection

After registered teardown and its graceful interval, the scope owner enumerates every live process carrying the owner token. Each candidate is revalidated immediately before cleanup. A candidate that exits naturally before any cleanup signal is sent is not a *process leak* and is omitted; this closes the normal child-exit race where a runner exits just before one of its helper processes. A process that requires `SIGTERM` or `SIGKILL` remains a leak even if a later revalidation finds that it has exited. For every actual leak, the owner captures its identity and listening sockets before sending `SIGTERM`, escalates to `SIGKILL` after the bounded interval, and scans once more to confirm that no survivor remains. Before each signal it confirms that the PID still has the same process start time and owner token, preventing PID reuse from targeting another process. The diagnostic identifies at least the surface owner, PID, parent PID, process group, process start time, executable command, and every attributable listening TCP socket. [reporting.md](./reporting.md) owns the normalized record that carries this attribution. ^test-process-leak

Linux discovery reads process identity and inherited owner tokens from `/proc` and attributes listening sockets with `ss`. macOS discovery reads process identity and inherited owner tokens with `ps` and attributes sockets with `lsof`. The required backend is checked before execution ([preflight.md](./preflight.md)). Port-based process killing and executable-name matching are not lifecycle mechanisms: they cannot establish which surface owns a process and can kill an unrelated concurrent run.

A leak makes its owning surface fail even when all native test results passed or a retry recovered. Native failures and recovered-flake records remain visible alongside the lifecycle failure. [reporting.md](./reporting.md) owns the normalized field names and run-status classification for this concept. In a combined Vitest run scope, each member surface receives the lifecycle failure and the report names the shared owner token.

## Exit codes

- `0` — the run passed, or an informational command completed (`list`, `help`, `verify --plan`).
- `1` — a test run failed, or a preflight/run-time failure during execution.
- `2` — a usage error or a guardrail refusal (unknown command, invalid or conflicting provider argument, a refused broad run, a refused local verify).
- `130` — a delegated Blaxel coordinator handled `SIGINT` or `SIGTERM`, finalized an interrupted provider report, and completed cleanup. When the canonical provider command receives this coordinator exit, it finalizes the normalized incomplete run and preserves `130`; `verify` likewise propagates that status from its test phase.

A remote provider command exits `0` only when both the delegated coordinator exits successfully and the normalized run report is `passed`; missing, contradictory, or infrastructure-incomplete report evidence cannot produce a successful command through a zero delegated exit. A nonzero delegated exit remains nonzero even if retained report evidence appears passed.

## Cursor-agent environment workaround

```ts
const CURSOR_AGENT_ENV_FLAG: string;          // "CURSOR_AGENT"
const CURSOR_AGENT_ENV_VARS: readonly string[]; // "ELECTRON_RUN_AS_NODE", "PLAYWRIGHT_BROWSERS_PATH"
```

When `CURSOR_AGENT=1`, the Cursor environment injects variables that break local Electron and Playwright tests. The runner strips those variables for its own process and child test processes. Without the flag it is a no-op. The flag is set only inside the Cursor agent environment; terminals, the remote providers, and CI never set it.

## Testing

Proof of guardrail decisions, provider resolution, and `verify` orchestration must spawn the canonical CLI. The proof must exercise the CLI's real argument parsing and observe its exit status, standard output, and standard error. Under the testing policy's [mocking policy](../testing-policy.md#Mocking policy), self-test seams may replace only downstream work that is not part of the decision being proven.

Under the testing policy's [acceptance-test rule](../testing-policy.md#^shape-acceptance), coverage of local execution must include a real suite in which a nonzero exit from the child test process makes the canonical CLI exit with status `1`.

Coverage for surface services must begin with a `TestService` declaration. It must use the service manager and process environment to pass the service's URL to a real Playwright configuration. It must use real Vite listeners and real HTTP requests. Coverage must also show that, after successful execution and after a service fails to start, services stop in reverse order and the parent environment is restored.

Under the testing policy's [mocking policy](../testing-policy.md#Mocking policy), claims about surface cleanup and process leaks must be proven through real subprocesses, process groups, inherited owner tokens, signals, process inspection, and listening sockets.

Under the testing policy's [compositional coverage rule](../testing-policy.md#Compositional coverage across clean seams), this spec owns the decision that selects a provider automatically from the home marker and, on marked hosts, a remote preflight result. [Preflight's Testing section](./preflight.md#Testing) requires a real Git process to run the production git-safety sequence in a repository with an `origin` remote. It also requires live evidence for the Blaxel capability checks. The live planned run required by [sharded execution's Testing section](./sharded-execution.md#Testing) supplies the real provider report for the remote run.

Reading `.github/workflows/ci.yml` proves only which command the file contains. The isolated live run required by [GitHub CI's Testing section](./github-ci.md#Testing) establishes that GitHub starts the job and that the job invokes the test runner.


*Television's one test command: how callers select and run tests, the guardrails that protect shared development hosts, retries, verification, the test registry, and the rules for processes and network addresses that tests create.*

# Test runner

Television has one way to run its tests: `npm test -- <command>` and `npm run verify`, implemented by `scripts/test/cli.mjs`. People and coding agents use it for anything from one test case to the full gate, locally or on Blaxel, and get results in one shape. Agents readily write plausible test commands whose arguments are quietly ignored; a single documented command that honors its options is what makes a test result trustworthy. Package-level `test` scripts and direct `vitest` or `playwright` invocations are not supported ways to run the suite.

This spec owns the command, its guardrails, retries, `verify`, the test registry, and the rules for processes and addresses that tests create. Blaxel is owned by [blaxel-testshards.md](./blaxel-testshards.md), dividing runs across machines by [sharded-execution.md](./sharded-execution.md), run output by [reporting.md](./reporting.md), the CI workflow by [github-ci.md](./github-ci.md), and tree attestations by [attestation.md](./attestation.md). How tests are written, when to run what, and what agents may do without asking belong to the [testing policy](../testing-policy.md).

## Guidance, not enforcement

The runner steers callers towards fast feedback and a usable shared host. Its checks recognize departures at the ordinary entrypoints, and every refusal says what to run instead. Where a departure from the shared-host or retry guardrails below is sometimes the right call, a deliberately named override permits it. Each of those overrides has `against-test-guidance` in its name, so using one reads as a considered choice. None of this is a security boundary. Anyone can run other commands, and the runner does not try to police the host.

## Providers

A *provider* is where tests run:

- `local` runs the current checkout, including uncommitted and untracked files.
- `blaxel` runs a committed revision on a pool of remote workers that fetch it from GitHub ([blaxel-testshards.md](./blaxel-testshards.md)).

GitHub CI runs the same tests through its own workflow; it is not a provider a caller selects. `npm test -- local` and `npm test -- blaxel` name their provider; only `verify` chooses one automatically.

Because workers fetch the revision from GitHub, a Blaxel run first checks that the working tree is clean and that the commit under test is on a branch on `origin`. Contributors commit and push before using Blaxel. `--ignore-uncommitted` lets a run start from a dirty tree; it still tests only the committed revision. `--commit <rev>` tests a revision other than `HEAD`. ^remote-revision

## Commands

| Command | Purpose |
|---|---|
| `npm test -- local [selectors]`, `npm test -- blaxel [selectors]` | Run a selection on that provider. |
| `npm run verify [-- local\|blaxel]` | The full gate, described under [Verify](#verify). |
| `npm test -- list [selectors]` | Print the surfaces a selection resolves to. |
| `npm test -- preflight --provider <local\|blaxel> [selectors]` | Run only the checks that precede tests for a selection, such as `--suite all`. |
| `npm test -- pool blaxel <list\|ensure\|delete>` | Manage the Blaxel pool ([blaxel-testshards.md](./blaxel-testshards.md)). |
| `npm test -- baseline update` | Refresh the durations used to plan shards ([sharded-execution.md](./sharded-execution.md)). |
| `npm test -- testpass prune` | Remove attestations ([attestation.md](./attestation.md)). |
| `npm test -- help` | Usage, including the guardrails and overrides below. |

Selectors choose what runs:

- `--suite <name>`, or `--all` for `--suite all`;
- `--surface <id>[,<id>…]`, `--package <workspace>`, `--runner <vitest|playwright>`, `--tag <tag>`;
- `--file <path>`: an exact path selects that test file; any other value selects every test file whose path contains it. The matched files must belong to one selected surface; `--surface` or another selector narrows a match that spans surfaces or a file that several surfaces own;
- `--grep <pattern>`: a test-title filter within the rest of the selection. On its own it narrows nothing.

With no selector, `npm test -- local` and `npm test -- blaxel` select the `all` suite, while `list` and `preflight` start from every registered surface, including those outside `all`.

The runner resolves `--file` to actual files itself and hands the native tool exactly those files. Vitest treats a file argument as a substring and Playwright as a regular expression, so passing the user's string through would also run sibling files.

Exit codes:

- `0`: the run passed, or an informational command completed. `verify --plan` exits `0` without verifying anything.
- `1`: tests failed, or the run failed while executing.
- `2`: a usage error or a guardrail refusal.
- `130`: `SIGINT` cancelled a wait for the local-test mutex, or a Blaxel run was interrupted by `SIGINT` or `SIGTERM` and finished its cleanup.
- `143`: `SIGTERM` cancelled a wait for the local-test mutex.

A Blaxel command exits `0` only when its coordinator succeeded and the normalized report passed. Missing or contradictory evidence cannot turn a zero exit into a pass, and a nonzero coordinator exit is never reported as success.

## The test registry

`test.config.mjs` declares every *test surface*: an independently runnable test area, usually one Vitest or Playwright config and the files it covers. A surface declares its id, runner, config, the paths it owns, its kind and tags, and anything it needs: a build step, Vite services, a wrapper command, or checks that must pass before it runs. Facts such as unit or end-to-end, browser or Electron, are declared there and never inferred from file or package names.

Every test file under `packages/` and `test/` belongs to exactly one surface, and a `vitest.config.ts`, `vitest.e2e.config.ts` or `playwright.config.ts` there that no surface declares is a registry error. A test therefore cannot silently drop out of every run.

A *suite* is a named selection over kinds, tags and runners. `all` is the unit and end-to-end surfaces; it is what verification, CI and attestation mean by the full suite. Some surfaces stay out of `all` and run only when selected:

- agent surfaces, which need a local agent setup and a live inference service;
- the PostHog roundtrip suite, which needs a secret read key and runs only locally; its setup is owned by the [telemetry sink](../telemetry/sink.md#real-posthog-integration-test-surface);
- daemon acceptance, which installs a freshly packed `tv` into the global npm prefix and replaces the real `com.television.server` user service. It runs only on a designated host that is not meant to run a normal Television server, and it refuses to start unless `TV_DAEMON_TEST_HOST=1` is set;
- experiment surfaces: fixtures for testing the runner itself, and live qualifications.

Some browser surfaces have Firefox projects. Outside GitHub Actions, their configs omit those projects with a warning when Playwright's Firefox is not installed. GitHub CI installs Firefox, and its configs fail when it is missing. Blaxel workers have no Firefox, so a Blaxel run, including a Blaxel verify, covers Chromium only.

Surfaces tagged `isolated-github-only` deliberately leak, orphan or kill processes to test cleanup. The runner refuses them before any work, on developer hosts and on every Blaxel path. They run only inside an operator-run GitHub workflow named `Process Lifecycle Fault Injection`, with `GITHUB_ACTIONS=true` and `TV_TEST_ISOLATED_GITHUB=1`. That workflow is not committed. It must run only on branches, on an ephemeral runner, with its own timeout, cleanup by owner token, and upload of the complete run directory. The workflow name and variable prevent accidents in trusted automation; they do not stop someone who sets them on purpose.

## Shared development hosts

Several agents often share one development host. Concurrent test runs compete for memory and CPU, push the host into swap and get processes killed by the kernel's out-of-memory killer, which disrupts every agent on it. Keeping the host usable comes first. The guardrails in this section keep local runs small and one at a time, and send broader work to Blaxel. The [testing policy](../testing-policy.md#verification-provider-and-completion) says when agents may use the overrides.

### Marked hosts

A *marked host* has the file `~/.tvdev-use-blaxel`, in the home directory that `HOME` names. Team development hosts carry it; public contributors' and fork hosts normally do not, and keep full local use without any Blaxel access. The file's contents are ignored. On a marked host, verify uses Blaxel by default and local runs are limited to one file. ^blaxel-host-marker

### One local file on marked hosts

On a marked host, a local test run, including local verify, must select exactly one test file with `--file`, optionally narrowed by `--grep`. Other selectors may accompany `--file` to choose its surface. Anything broader is refused with exit `2` before any test work. Uncommitted and untracked files count; the limit applies to the files that will actually run, not to the filter string. `--force` does not lift it. ^local-one-file

The refusal explains the limit. When Blaxel can run the same selection, the refusal prints the equivalent `npm test -- blaxel` command and the reminder to commit and push first; otherwise it names the selections Blaxel supports. Agent, PostHog and daemon surfaces and the Blaxel harness driver cannot run on Blaxel, so their refusal gives the one-file local command instead. The runner never commits, pushes or dispatches on the caller's behalf.

`--against-test-guidance-broad-local-run` lifts the limit.

### One local run at a time

Every local test run and local verify holds a mutex shared by all checkouts of the same operating-system user on the host. It is taken before preflight and held until the run's test processes have exited and cleanup has finished, including after failures and handled interruptions. Verify takes it before its first phase, and the test phase it starts shares that hold. Blaxel runs, `list`, `help`, `preflight` and `verify --plan` do not take it. Different operating-system users are not coordinated. ^local-test-mutex

While the mutex is held, another local run is refused at once with exit `2`. The refusal identifies the holder's process, command and checkout, explains the contention risk, advises against stopping another agent's run to free the lock, and offers these choices:

- try again after that run finishes;
- pass `--wait-for-local-test-mutex` to wait. The wait has no time limit, and `SIGINT` or `SIGTERM` cancels it without affecting the holder;
- use Blaxel;
- pass `--against-test-guidance-major-host-contention-and-oom-killed-processes` to run alongside the holder.

The wait option and the contention bypass cannot be combined. The bypass leaves the one-file limit in place, and the broad-local override leaves the mutex in place; `--force` lifts neither.

A holder is stale only when none of its recorded processes is still alive, judged by PID and start time. The next run then takes over the mutex. If the stale run left test processes behind, the new run reaps them and fails, as any run does that finds stale processes ([Processes started by tests](#processes-started-by-tests)); otherwise it proceeds. Elapsed time never makes a holder stale, because a long run is not a dead one.

Checkouts on one host can run different revisions of the runner, so the mutex's location and record are a compatibility contract between revisions: a change must keep coordinating with checkouts still using the current form. The mutex is a SQLite database at `.cache/television/local-test-mutex.sqlite3` under the operating-system account's home directory. The path is read from the account, not from `$HOME`, so test environments that override `HOME` still share it. The database holds a single row. Acquisition is atomic, every change to the row checks the recorded identity first, and no transaction stays open while tests run.

```ts
// CREATE TABLE local_test_mutex (slot INTEGER PRIMARY KEY CHECK(slot = 1), record TEXT NOT NULL)
// `record` holds this value as JSON.
interface LocalTestMutexRecord {
  version: 1;
  id: string; // unique per acquisition
  participants: Array<{
    pid: number;
    startTime: string; // process start time as the host's process table reports it
    command: string;
    checkout: string;
    role: "run" | "verify";
  }>;
}
```

### Native test entrypoints

Registered Vitest and Playwright configs refuse to load when started directly rather than by the runner, on every host. The refusal gives the canonical command and, on marked hosts, the Blaxel route for broader work. For deliberate native use, such as watch mode, a debugger or an editor's test explorer, `TV_TEST_AGAINST_TEST_GUIDANCE_DIRECT_NATIVE_RUN=1` (exactly `1`) lets the config load. Such a run is outside the mutex and the one-file limit, and native setup such as required services remains the caller's job. Every way the runner itself starts a native tool, locally, on Blaxel and in CI, marks its environment so that its own runs load.

## The full-suite shortcut

`npm test -- local` or `npm test -- blaxel` with the whole `all` suite is refused with exit `2` and directed to `npm run verify`. That covers no selector, `--suite all`, `--all`, and `--grep` alone. The full suite without lint and type-check is not a verification. `--force` permits it deliberately, and verify passes `--force` to its own test phase. On a marked host, a full local shortcut also needs the broad-local override.

## Retries

Flaky tests are a fact of end-to-end testing, so failed tests are retried, and every recovery is reported rather than hidden ([reporting.md](./reporting.md)).

- **Runner budget.** On surfaces other than unit surfaces, a failed test is retried up to twice by default, whatever the selection. Unit surfaces get no runner retries. A positive `--retries <n>` sets the count for the non-unit surfaces. A test that fails and then passes counts as passed and is reported as a *recovered flake*.
- **Zero retries.** Plain `--retries 0` is for running a new or changed test once. It is accepted when `--file` selects exactly one test file, optionally narrowed by `--grep`, with either provider. For any broader selection, including verify, it is refused with exit `2` unless `--against-test-guidance-turn-flakes-into-failures-on-broad-runs` is passed, which sets the runner budget to zero on purpose. Neither zero form changes unit surfaces, per-test annotations or Blaxel's infrastructure retries.
- **Per-test annotation.** One known-flaky case may get more retries from `FLAKY_TEST_RETRIES` in `test/flaky-retries.ts`, with a title that starts with `flaky:`. Runner and CI runs give it 5 unless the `FLAKY_TEST_RETRIES` environment variable is set. Reports use that prefix to mark the recovery as annotated. An annotation is for investigated flakiness in the harness or environment, on the one offending case and never on a whole file or suite. A real failure is fixed instead.
- **Infrastructure retries.** Blaxel reruns a shard whose infrastructure failed, up to twice, with the same assignment. A completed shard with a failed test is never rerun ([sharded-execution.md](./sharded-execution.md)).

No retry clears a process leak: a surface that leaves a process running fails even when every test passed or recovered ([Processes started by tests](#processes-started-by-tests)).

Ordinary runs impose no automatic cap on failures, so independent work continues after a test fails. Tests run in many independent processes, so a cap would only leave assigned tests unrun and the evidence incomplete.

## Verify

`npm run verify` is the full gate. It stops at the first failing phase:

- locally: preflight for the `all` suite, lint, type-check, package manifest checks, the `all` suite, then the vibe-mode check;
- on Blaxel: lint, type-check and package manifest checks in the checkout, the `all` suite on Blaxel at the selected committed revision (`HEAD` by default), then the vibe-mode check.

On success it prints `verify passed (<provider>)`. A passing complete Blaxel verify publishes an attestation for its tree unless `--no-publish` is passed ([attestation.md](./attestation.md)). A local verify never publishes. `--plan` prints the chosen provider and the phase commands without running the phases; choosing the provider on a marked host still runs its Blaxel checks.

`npm run verify -- local` or `npm run verify -- blaxel` chooses the provider explicitly. Otherwise an unmarked host verifies locally without contacting Blaxel. A marked host runs the Blaxel checks first: credentials, a clean tree and a pushed commit. When they pass it uses Blaxel; when they fail it refuses with exit `2` and the remediation, and never silently falls back to local. An explicit local verify on a marked host also needs `--against-test-guidance-broad-local-run`.

The *vibe-mode check* fails when `specs/vibe-waiver.md` exists. That file marks a branch in vibe mode, an experiment branch with the spec-driven process switched off, which must never merge into `main`. The check runs last, so the lint, type-check and test results on such a branch are still real, and its failure names vibe mode as the reason. CI applies the same check ([github-ci.md](./github-ci.md)). ^verify-vibe-mode

## Processes started by tests

Developer machines and Blaxel workers run many test runs over time, often concurrently. A process a test leaves behind can hold ports, memory and files that break later runs, so the runner owns every process a surface starts.

A *surface process scope* is everything started for one surface run: its build step, services, the test runner and its workers, browsers, Electron, and anything tests spawn. Its owner is the local runner, or the shard worker on Blaxel and in CI. The owner stays alive when a test worker crashes, so it is the final reaper. ^test-surface-owner

- The owner puts a token in `TV_TEST_SURFACE_OWNER`, and every child inherits it. Test helpers that build child environments must preserve it.
- After the tests exit, whether normally, by failure, timeout or interruption, the owner stops the scope's services and any of its commands still running, then finds every live process still carrying the token. It sends each `SIGTERM`, then `SIGKILL` after a short interval, and confirms none survived. Before each signal it rechecks the process's start time and token, so a reused PID is never hit. A process that needed a signal is a *process leak*. It fails the surface even when every test passed, and the report identifies it by PID, command and listening sockets ([reporting.md](./reporting.md)). ^test-process-leak
- Processes are found only through the inherited token, using `/proc` and `ss` on Linux, or `ps` and `lsof` on macOS. Killing by port or process name is not used: on a shared host it can kill another run's processes. Canonical local runs and planned shard workers check that the host's process backend works before tests, and fail rather than run without cleanup. Other paths, such as targeted Blaxel runs, skip that check; on Blaxel, worker setup installs the tools.
- When an owner is itself killed, nothing can clean up at that moment. Before running tests, the runner and each shard worker look for tokens whose supervisor is gone. They reap those processes and fail that run as an infrastructure problem instead of running beside them. Tokens whose supervisor is alive belong to a concurrent run and are left alone.

Hosts inspect tokens left by runs of other runner revisions, so the token format is shared across revisions. A token is `tv1.` followed by the base64url encoding of the JSON object below. It is stale when no live process has that PID and start time.

```ts
interface SurfaceOwner {
  runId: string;
  surfaceId: string; // comma-separated when one scope runs several surfaces
  supervisorPid: number;
  supervisorStartTime: string; // as the host's process table reports it
}
```

## Network addresses in tests

Test infrastructure, such as application and development servers, proxies and fixture servers, binds port `0` and reads back the port the kernel assigned. There are no fixed ports, port ranges or reserve-then-release allocators. Choosing a number before binding races every other process on the host, and concurrent runs on shared hosts make that race real. The component that bound a listener hands consumers its full URL: as a return value, through a readiness message, or, for a registry-declared service, in the environment variable the registry names. Nothing derives one service's address from another's port, and no test uses a numeric URL literal for a live test service. A port number may still appear as inert test data that nothing connects to. ^test-dynamic-ports

Persisted `tv serve` rejects port `0`, so the daemon acceptance suite takes a kernel-assigned port, releases it and immediately configures the installed service with it. This is the one exception.

Registry-declared services are Vite middleware on a listener the runner binds itself, because Vite treats `server.port: 0` as unset and falls back to its default port. The runner also turns off Vite's speculative pre-transforms, which can leave transform work pending after the server reports idle and stall teardown.

Registry-declared Vite services always answer in full and never with `304 Not Modified`: the listener strips `If-None-Match` and `If-Modified-Since` from every request. In the Chromium 145 build that Playwright 1.58.2 installs, each 304 response to a script, stylesheet or image left the renderer holding a 2 MB shared-memory buffer until the browser context closed. The development build is hundreds of modules, so every reload of the application in one page held about 465 MB more. On Blaxel workers, where Chromium's shared memory lives in memory-backed temporary storage, tests that reloaded the application several times crashed. ^test-service-full-responses

## Cursor agent environment

When `CURSOR_AGENT=1`, the runner removes `ELECTRON_RUN_AS_NODE` and `PLAYWRIGHT_BROWSERS_PATH` from its own environment and its children's. The Cursor agent environment sets both, and they break Electron and Playwright tests.

## Testing guidance

Tests that deliberately leak, orphan or kill processes, or kill a supervisor, belong in `isolated-github-only` surfaces. On a shared host they could disturb other runs or leave residue for them.

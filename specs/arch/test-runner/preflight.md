*The checks the test runner runs before tests: local capability checks for the selected surfaces, and the git-safety and provider-auth checks that gate a committed-revision remote run.*

# Preflight

This spec is authoritative for *preflight*: the checks the runner runs before executing tests, how the required set is chosen per provider, what each check verifies, and the process-inspection capabilities required on an execution host. The runner that invokes preflight is [test-runner.md](./test-runner.md); the per-surface list of required local checks is declared in the registry ([test-registry.md](./test-registry.md)); the repository Node/npm values come from [arch/node-versions.md](../node-versions.md); the remote provider that depends on the git-safety and auth checks is [blaxel-testshards.md](./blaxel-testshards.md). Plain GitHub CI executes the checked-out revision directly and performs execution-host preflight before tests.

A *preflight* is a single named check that must pass before tests run. Each check produces a `PreflightResult`. Checks run in order and the runner stops at the first failure.

## Required checks per provider

`node` is always required. Canonical local execution and the planned-shard worker run `process-lifecycle` before their first selected task. Local execution additionally runs the union of the `preflight` names declared by the selected surfaces ([test-registry.md](./test-registry.md)), e.g. `playwright-chromium`, `playwright-firefox`, `electron`. Unit-only local selections are not exempt: runner and harness unit tests can spawn real subprocesses, and basing ownership safety on today's surface contents would let a future subprocess bypass the check. Blaxel target dispatch uses `supervised-command.mjs`, and the legacy non-plan branch of `run-test-shard.mjs` does not invoke `process-lifecycle`; these diagnostic paths are exceptions to the canonical planned-worker preflight.

A Blaxel coordinator runs `blaxel-github-token` and `blaxel-auth`; each planned suite worker independently runs the execution-host check. Target dispatch follows the exception above. Selected-surface capability checks apply only to local execution because Blaxel workers prepare browser and system dependencies through provider setup. The coordinator result covers dispatch capabilities and git safety, not worker capability.

Plain GitHub CI invokes the local or planned-shard entrypoint on its checked-out revision, so its test jobs receive the execution-host check without introducing a `ci` provider or dispatch-auth preflight.

## Execution-host capability checks

- `node` — delegates toolchain validity to the checker owned by [arch/node-versions.md](../node-versions.md). The machine-readable name remains `node` because preflight names are stable identities in provider results and normalized reports; the result reports both selected versions.
- `process-lifecycle` — the host is POSIX and provides a working inspection backend for the ownership and leak-detection contract in [test-runner.md](./test-runner.md):
  - on Linux, `/proc` exposes process identity and the environment of a disposable child owned by the current user, and `ss -H -ltnp` executes successfully;
  - on macOS, `ps` can read a disposable child's process group and inherited owner token, and `lsof` can inspect its TCP descriptors;
  - another platform, an unreadable process table, or a missing command fails with an installation message. The check never silently degrades to process-name matching or a known-port list.
- `playwright-chromium` — the Playwright Chromium dependency is present.
- `playwright-firefox` — the Playwright Firefox executable exists at Playwright's configured path. The preflight and Playwright config share that predicate. When it is unavailable outside GitHub Actions the check passes as skipped with the missing path as its reason and the Firefox project is omitted; GitHub Actions fails configuration because its setup step is required to install Firefox.
- `electron` — unless `SKIP_ELECTRON_E2E=1` makes the check pass as skipped, the installed Electron npm package must resolve. The check consumes the pre-setup result of the [shared environment planner](../desktop/e2e-harness.md#shared-environment-plan): it accepts the planner's absent or valid runtime result when the plan has no failures and rejects its invalid result. Preflight never invokes Electron's installer, downloads an archive, or changes runtime files. ^preflight-electron-runtime
- `daemon-test-host` — the operator has set `TV_DAEMON_TEST_HOST=1` to acknowledge that the selected surface installs or replaces the active global `tv` package and literal `com.television.server` user service. Any other value fails before the surface build pre-command or Vitest process starts and explains that the suite belongs only on a designated developer host not intended to run a normal Television server. The test file repeats the exact-value check as a direct-run backstop. This acknowledgement prevents accidental invocation; it is not a security or authorization boundary.
- `posthog-test-key` — the PostHog test project read key is available as `TV_POSTHOG_TEST_READ_KEY` in the environment or in the repository-root `.env` file and begins with `phx_`. This local-provider check gates the `telemetry-posthog-roundtrip:integration` surface before Vitest starts; missing keys fail with a message that names both accepted sources, while a key with another prefix fails as the wrong key format. The telemetry PostHog roundtrip suite is local-only through the central runner, and the test file retains a direct-run backstop that throws if someone bypasses the runner. The secret key must never be committed.
- `blaxel-github-token` — a Blaxel GitHub token is available (see [blaxel-testshards.md](./blaxel-testshards.md) for sourcing).
- `blaxel-auth` — `@blaxel/core` can list sandboxes with the current credentials.

`fuser` and its `psmisc` package are not dependencies of `process-lifecycle`. The runner establishes ownership when it spawns a process and discovers descendants by owner token, then uses `/proc`/`ss` or `ps`/`lsof` for attribution. Provider images must include the matching backend explicitly: Linux GitHub Actions and Blaxel workers must provide `iproute2` (`ss`) and readable procfs; a Linux local host must install `iproute2`; macOS local execution uses the operating system's `ps` and `lsof`. Any missing requirement is a failed preflight, not a skipped cleanup step.

## Blaxel remote preflight

A Blaxel run additionally requires that the commit under test is safe to dispatch. Its remote preflight runs the provider capability checks first; if they all pass it runs the git-safety sequence, short-circuiting at the first failure.

The git-safety checks, in order:

1. `working-tree` — `git status --short`. A dirty tree fails unless `--ignore-uncommitted` is passed; remote runs test a committed revision from origin and do not include local edits. With the flag, the check passes and records `workingTreeDirty: true`.
2. `commit-resolves` — `git rev-parse --verify <commit>^{commit}` resolves the target (default `HEAD`).
3. `origin-fetch` — `git fetch origin --prune` succeeds.
4. `origin-reachable` — `git branch -r --contains <commit>` includes at least one `origin/*` ref.

Only when every git-safety check passes does the result carry a non-null `git` summary.

After Blaxel suite dispatch, each planned shard worker runs its execution-host `process-lifecycle` check before the first surface. It then records `stale-owner-cleanup`, which leaves live supervised owners alone and blocks execution after stale-owner contamination. Plain GitHub CI also uses the planned worker. A failed planned-worker check is represented as a pre-test infrastructure failure and no assigned test command starts on that shard. Blaxel target dispatch and the non-plan shard path remain the exceptions described above. Provider setup must supply the capability consistently.

## Contributor branches and remote revisions

Contributors work on their own development branches. Before a Blaxel run, commit the intended changes and push the branch to `origin` so workers can fetch that revision. Use a development branch for unfinished checkpoints; see the [shared-branch workflow](../../spec-workflow.md#^shared-branch-workflow).

The checks above enforce remote reachability, not branch naming or ownership: any containing `origin/*` branch satisfies the check. `--ignore-uncommitted` tests only the selected committed revision and gives no evidence for local edits. The same rules apply to macOS and Linux contributors; execution-host differences are stated above.

## Contract surface

```ts
interface PreflightResult {
  name: string;
  provider: string;
  status: "passed" | "failed";
  message?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  [key: string]: unknown; // per-check detail, e.g. version, commit, containingRemotes
}

interface RemoteGitPreflight {
  commit: string;
  reachableFromOrigin: true;
  workingTreeDirty: boolean;
  containingRemotes: string[];
}

interface RemotePreflightResult {
  provider: string;
  results: PreflightResult[];
  git: RemoteGitPreflight | null;
}
```

## Testing

Under the testing policy's [rule for platform-dependent behavior](../testing-policy.md#^platform-breadth), cases where a required host capability is missing or the platform is unsupported use contract coverage. A seam on the CI host must prove that `process-lifecycle` uses the host's real process-inspection backend. On Linux, that seam must use `/proc` and `ss` to attribute a real, disposable child process and its listener, then clean up both. This Linux evidence does not prove the macOS backend, which uses `ps` and `lsof`. Proving the macOS backend requires the same seam on a macOS host.

Injected `ElectronE2EPlan` values may cover how the Electron check handles each planner state. The suite must also exercise the real handoff from that check to the shared environment planner. It must use the repository's installed Electron package and that package's real files on disk. It must prove that preflight leaves the Electron runtime tree unchanged.

A seam must invoke the real Git process to run the production git-safety sequence in an actual repository with an `origin` remote. Once that seam exists, the failing case for each git-safety check may use contract coverage under the testing policy's [compositional coverage rule](../testing-policy.md#Compositional coverage across clean seams).

A change that could affect the Blaxel provider capability checks requires live evidence. That evidence is governed by the testing policy's [rule for integration against paid services or complex host dependencies](../testing-policy.md#Integration against paid services or complex host dependencies is important) and the [Blaxel test-shard testing directive](./blaxel-testshards.md#Testing).


*How the promises in Preflight are proven.*

# Preflight — proof

Proves [specs/arch/test-runner/preflight.md](../../../specs/arch/test-runner/preflight.md).

## Coverage model

Contributor branch ownership and commit/push practice are reviewed as development procedure. The existing assertions below cover runtime preflight; the branch guidance changes no runtime check and orders no additional tests.

Coverage declarations are carried inside the migrated assertion blocks below.

## Test hooks


`TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT` supplies one failed local result as `<name>:<message>`. `TV_TEST_RUNNER_FAKE_REMOTE_PREFLIGHT` supplies one failed remote result as `<provider>:<name>:<message>`, or a passing result as `<provider>:passed`. Passing results are permitted only for automatic provider resolution in `verify --plan`; other callers refuse them before dispatch. `runRemotePreflight` accepts `allowPassingSelftest` for that diagnostic caller, defaulting to false. Both environment controls require `TV_TEST_RUNNER_SELFTEST=1`, as defined by [test-runner.md's Test hooks](./test-runner.md#Test hooks); otherwise the runner rejects them. These controls replace check execution, so they prove only how the runner handles preflight outcomes. Production sets none of them.

The `electron` option to `runPreflights` accepts `root` to select the package and planner workspace and `plan` to supply an `ElectronE2EPlan`. The `plan` override replaces the shared environment planner, so it covers only how the Electron check handles planner results. Production supplies neither override and uses the current workspace and the real planner. `readPostHogTestReadKey` accepts `env` to supply the environment source and `root` to select the `.env` lookup directory; production calls it without either override.

`validateProcessLifecycleHost` accepts `platform` to select the host contract, `procfsReadable` to state whether Linux process identity is readable, and `commandAvailable` to report the required command capabilities. `runProcessLifecycleProbe` accepts `platform` to select the backend and `runCommand` to supply its command runner. The `runCommand` override replaces command execution, so it covers probe-result handling rather than host capability. Production calls both functions with the detected platform and the host's actual process-inspection capabilities.

## Assertions

### Test assertions

Coverage spans `test/repo/node-toolchain.test.ts`, `test/repo/test-runner-preflight.test.ts`, `test/repo/process-lifecycle.test.ts`, and `test/repo/test-runner-shard-worker.test.ts`. The successful `process-lifecycle` assertion is a seam test against a real disposable child and the host process/socket tables; injected missing-capability cases are contract tests of host validation.

- `requiredPreflights` supports local execution with `["node", "process-lifecycle", ...selected surface checks]` and the Blaxel coordinator with `["node", "blaxel-github-token", "blaxel-auth"]`.
- The `node` check retains that name, reports the running Node/npm versions when they satisfy repository policy, and returns the shared toolchain diagnostic when either version is unsupported; canonical local execution stops before a selected test after this failure. That short-circuit assertion invokes its nested canonical CLI with `--no-publish`, keeping optional ref transport outside the preflight boundary under test.
- The planned shard worker records successful `process-lifecycle` and `stale-owner-cleanup` entries before its selected tasks.
- The Linux `process-lifecycle` check uses a real disposable child and the host's real `/proc` and `ss` boundaries; it passes only when the child can be attributed. Failure fixtures cover a missing `ss`, unreadable procfs, and unsupported platform without replacing the successful real-host seam test.
- The daemon-host acknowledgement check fails unless `TV_DAEMON_TEST_HOST` is exactly `1`, names the required value in its diagnostic, and records the environment-variable name when it passes.
- PostHog key-source tests cover environment and repository-root `.env` lookup plus the missing-key result from the reader.
- **Contract — Electron pre-setup states** (planner results and a temporary resolvable-package fixture; planner behavior is a declared mock forfeited to the seam below): with skip unset, a missing Electron package fails, an absent or valid result with no planner failures passes, and an invalid result fails. The preflight path invokes no installer and performs no runtime mutation. With `SKIP_ELECTRON_E2E=1`, it reports skipped. — *(covered by test: `test/repo/test-runner-preflight.test.ts` “checks Electron package presence and consumes every planner state without installing”)*. ^preflight-t-electron-states
- **Seam — Electron preflight-to-planner handoff** (the real `runPreflights` dispatcher, Electron check, shared environment planner, installed declared Electron package, package filesystem, and Linux host; no mocks): selecting the Electron check against the package's actual acceptable pre-setup state consumes the real planner result, passes, and leaves the runtime tree unchanged. The contract assertion carries the other planner-result permutations. — *(covered by test: `test/repo/test-runner-preflight.test.ts` “hands the real installed Electron package to the shared planner without mutation”)*. ^preflight-t-electron-planner-handoff
- **Contract — Weather artwork browser preflight and CI configuration** (real registry selection, preflight dispatcher and Playwright configuration loader; the host installation and temporary browser roots supply availability states): the Weather-artwork surface adds `playwright-webkit` to the local preflight union, the dispatcher runs the WebKit check script, and the script uses the same installed-executable predicate as its Playwright configuration. The assertion compares the real host result with the executable's existence: an installed WebKit passes without `skipped`, while an absent one reports the missing path and passes as skipped. It then points `PLAYWRIGHT_BROWSERS_PATH` at an empty temporary directory and requires that same skipped result and exact missing root. Separate configuration-load passes set `CI=1` and make neither browser, only Firefox, only WebKit, or both browsers appear present. The first three fail with the required-browser diagnostic; only the complete case loads. Placeholder executable files test configuration predicates and do not claim a browser launch. — *(covered by tests in `test/repo/test-runner-preflight.test.ts`: “selects WebKit for Weather artwork and dispatches its preflight” and “fails the Weather artwork configuration under CI when Firefox or WebKit is absent”)*. ^preflight-t-playwright-webkit

**Boundary gaps — stated honestly per [testing-policy.md](../../../specs/arch/testing-policy.md):**

- Apart from the `node` toolchain and Linux `process-lifecycle` seams above, browser check *launch execution* — `playwright-chromium`/`playwright-firefox`/`playwright-webkit` — the git-safety sequence, and the provider-auth checks have no committed boundary test here. The Weather artwork test supplies real three-browser launch and painting evidence. In the guardrail tests ([test-runner.md](../../../specs/arch/test-runner/test-runner.md)) remote preflight is replaced by a self-test seam, so the real `git status` / `git rev-parse` / `git fetch` / `git branch -r --contains` chain and the `@blaxel/core` calls are not exercised here. The git-safety checks are reachable with a real temporary git repository and no external credentials; the provider-auth checks require real Blaxel credentials.
- No committed test forces the planned worker's `process-lifecycle` preflight to fail and proves the resulting infrastructure summary, and no test invokes `posthog-test-key` through `runPreflights` to assert the missing-key or invalid-`phx_` diagnostic. The current tests cover the successful worker record, key lookup, and missing reader result.
- The macOS `process-lifecycle` backend requires a real macOS host for its `ps` environment/identity and `lsof` boundary test and is not proven by the Linux gate.

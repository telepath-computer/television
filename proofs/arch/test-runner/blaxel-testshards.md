*How the promises in Blaxel Test Shards are proven.*

# Blaxel Test Shards — proof

Proves [specs/arch/test-runner/blaxel-testshards.md](../../../specs/arch/test-runner/blaxel-testshards.md).

## Coverage model

The host marker’s provider-selection behavior is covered by [the runner proof](test-runner.md#^t-blaxel-host-marker). The corporate credential location is setup information checked by human review, not a new token-source mechanism. The existing token-source assertions remain unchanged; no test reads the vault or asserts its item name.

Coverage declarations are carried inside the migrated assertion blocks below.

`test/repo/blaxel-stale-owner-audit.test.ts` checks diagnostic construction and coordinator ordering on every host. Its live diagnostic cases require Linux procfs and run only on Linux; they establish no macOS backend coverage. `test/repo/test-runner-provider.test.ts` exercises shell activation ordering with an authored nvm replacement in a shell isolated from host startup files. That contract check does not install nvm or establish real worker activation.

Pool discovery also has a contract test that runs the shared discovery helper used by the pool manager and coordinator with the installed Blaxel SDK against a loopback HTTP server returning authored paginated sandbox responses. The SDK builds requests and handles pages through its native-fetch path over loopback HTTP. This proves page traversal, label filtering and deployed-only filtering; production HTTP/2 transport, real authentication and service compatibility are covered by live evidence: a read-only multi-page listing and the required live Blaxel run.

## Test hooks


`readBlaxelGithubToken` accepts `cwd` (the directory containing `.blaxel-gh-token`) and `env` (the environment source), so tests can control token precedence without changing process-wide state. The coordinator uses the process defaults.

`acquireShardLeases` accepts `acquire` (one lease attempt), `transferShardInputs` accepts `write` (one sandbox-file upload), and `finishInterruptedRun` accepts `preserveReport` (the initial interrupted report write), `releaseLeases` (remote process and lease cleanup), and `finalizeReport` (the final interrupted report write). Tests may supply recording or failing callbacks to isolate scheduling, ordering, and failure handling. Under the testing policy's [mocking policy](../../../specs/arch/testing-policy.md#Mocking policy), these replacements earn no coverage of the Blaxel API, sandbox file upload, or remote cleanup.

The SDK reads `BL_API_URL`, `BL_API_KEY`, and `BL_WORKSPACE`; the discovery contract test supplies a loopback API and fixture credentials in an isolated working directory and home, with an explicit child environment that preserves the test owner token and disables SDK telemetry and HTTP/2. Production uses the configured Blaxel API and credentials.

## Assertions

### Test assertions

- Pool discovery includes matching workers on later API pages and excludes workers with other project, purpose, pool, or architecture labels, as required by the spec's [Pool](../../../specs/arch/test-runner/blaxel-testshards.md#Pool) contract. **Contract:** the consumer is the shared discovery helper and installed SDK, called in a child process; the service is the HTTP mock described above. The helper collects the unfiltered listing before filtering locally. Both the manager mode (all matching workers) and coordinator mode (only matching `DEPLOYED` workers) must traverse all pages, including an earlier page containing no matching workers. A page-fetch failure rejects discovery rather than returning a partial pool. Fixture sandbox records omit a region so discovery needs no data-plane connection. (policy-grade test: `test/repo/blaxel-pool-discovery.test.ts`) ^blaxel-pool-pagination

The remaining coverage lives in `test/repo/test-runner-provider.test.ts`.

- The canonical recommended shard count is 36, and the pool default remains 72 workers using `blaxel/playwright-chromium:latest`, 8192 MB, and the existing labels and naming scheme.
- Pool-manager source assertions require pinned nvm `v0.40.3`, `.nvmrc` selection, fresh-worker provisioning before architecture verification, and no alternate image or size defaults.
- Coordinator source assertions require nvm activation after checkout and before dependency/test work, plus `.nvmrc` and the root manifest in dependency cache identity.
- The `electron-repair` source assertion requires Electron's own installer with the worker-local archive cache and rejects a separate `@electron/get`, unzip, or runtime-deletion path.
- `classifyBlaxelShardStatus` returns `infra-failed` for a setup-step failure before `test-run`, an absent summary, an unconfirmed worker exit, or a summary that declares `infra-failed`; it returns `failed` for a failed summary or a passed summary contradicted by a known nonzero exit, and `passed` only for a passing summary with exit `0`.
- `normalizeBlaxelSurfaces` normalizes a passing Blaxel report into the surface's `NormalizedSurfaceResult` ([sharded-execution.md](../../../specs/arch/test-runner/sharded-execution.md)), including repository-relative conversion of absolute worker-native paths.
- A targeted command runs under the generic surface supervisor with the selected surface owner token, and a failed target still writes a shard summary instead of being retried as infrastructure.
- Provider summaries and normalized run events preserve each shard's restore/wake, checkout, dependency cache outcome, readiness, surface compute, and report-download phases without parsing human logs.
- The normal-lease acquisition scheduler never exceeds its concurrency bound, attempts each requested shard exactly once, and preserves input order in its outcomes. A partial batch writes a provider report containing acquired-but-not-run, unavailable, and thrown-error shard outcomes before releasing every partial success.
- Signal shutdown writes completed, running, and pending shard outcomes before lease cleanup; a report-write failure does not suppress cleanup.
- Unconfirmed ordinary execution cleanup orders named stop, owner-token reaping, confirmed zero-owner state, then lock release; failed owner confirmation retains the lease until TTL. Completed and undispatched paths do not run descendant cleanup.
- A stale-owner setup failure records the contaminated sandbox and its lifecycle evidence, excludes that sandbox from subsequent attempts, and permits a configured infrastructure retry only on a distinct sandbox that independently passes lease acquisition and owner audit.

**Boundary gaps — stated honestly per [testing-policy.md](../../../specs/arch/testing-policy.md):** the classifier, normalization, bounded acquisition scheduler, and provisioning/activation/cache command shapes are covered without calling Blaxel. The scheduler test uses an injected acquisition callback and therefore does not cross the Blaxel API boundary. The code-only checks cannot prove nvm installation, selected Node/npm versions, or cache behavior inside the base image. After review, deleting and recreating `poc` and running an operator-approved targeted shard provide that seam evidence along with the real coordinator path: leasing sandboxes, lock protocol, architecture validation, checkout/runtime/dependency setup, streaming logs, and result download. There is no recorded-fixture stand-in for that external boundary today.

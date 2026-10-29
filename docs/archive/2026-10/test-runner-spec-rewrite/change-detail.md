> **Archived 2026-10 from PR #53.** This is the detailed description of PR #53, written when the pull request was ready for review and moved out of its description, which keeps only an orientation; the merged change is the one it describes. It holds how the guardrails, worker leases, cleanup and diagnostics work, the judgment calls in the spec rewrite, how the proofs and tests were brought into line with the rewritten specs, and the validation evidence, including the live Blaxel probes and the evidence carried over from #49 and #12, which the description only summarizes. The body below is unchanged since it was written and is a clue to the change, not a record of it.

# PR #53 in detail

PR #53 carries #49's local guardrails and #12's Blaxel worker leases, cleanup and diagnostics, integrated with each other, together with a rewrite of the specs under `specs/arch/test-runner/` and the repairs that bring the proofs, references and tests into line with it. The ledger (`ledger.md`) and removal account (`removal-account.md`) in this folder cover the spec rewrite statement by statement; this document covers the whole change.

## Local runs on shared hosts

Each guardrail refuses with exit `2`, says what to run instead, and has a deliberately named override containing `against-test-guidance`. They steer ordinary use and are not a security boundary.

- **One local run per operating-system user.** `npm test -- local` and local verify take a mutex shared by every checkout of that user on the host. They take it before preflight and hold it until the test processes have exited and cleanup has finished; verify's test phase shares verify's hold. A second run is refused at once with the holder's process, command and checkout. `--wait-for-local-test-mutex` waits instead, without a time limit, and `SIGINT` or `SIGTERM` cancels the wait with exit `130` or `143`. The mutex is a single row in a SQLite database at `~/.cache/television/local-test-mutex.sqlite3`, using Node's built-in SQLite (`scripts/test/local-test-mutex.mjs`). The home directory comes from the operating-system account, so tests that override `HOME` still share it. A holder is stale only when none of its recorded processes is alive by PID and start time; elapsed time never releases it.
- **One explicit file on marked hosts.** On a host with `~/.tvdev-use-blaxel`, a local run must resolve `--file` to exactly one actual test file, optionally narrowed with `--grep`. Untracked files count. A broader selection is refused with the equivalent `npm test -- blaxel` command and a reminder to commit and push first. Agent, PostHog and daemon surfaces and the Blaxel harness driver cannot run on Blaxel, so their refusal gives the one-file local command. Hosts without the marker, such as public contributors' machines, keep full local breadth and need no Blaxel access.
- **Exact files to the native tool.** The runner resolves `--file` itself and hands Vitest or Playwright exactly those files (`scripts/test/target-native.mjs`), because Vitest treats a file argument as a substring and Playwright as a regular expression. The fixtures in `test/runner-fixtures/guidance/` include a sibling named `one.test.ts.test.ts` that a substring match would collect.
- **Retries follow the same boundary.** Defaults stay at two runner retries for non-unit surfaces and none for unit surfaces. Plain `--retries 0` is accepted for one explicit file on either provider. A broader zero-retry run, including verify, needs `--against-test-guidance-turn-flakes-into-failures-on-broad-runs`. Per-test `flaky:` annotations and Blaxel's infrastructure retries keep their own budgets.
- **Direct native entrypoints refuse.** All 38 registered Vitest and Playwright configs import `scripts/test/native-entrypoint.mjs`, which refuses a direct `vitest` or `playwright` invocation and names the canonical command. Every path by which the runner starts a native tool (local runs, planned and targeted shards, diagnostics and Electron launch) marks its environment so that its own runs load.

| Override | What it permits |
| --- | --- |
| `--against-test-guidance-broad-local-run` | Broader local runs, including local verify, on a marked host. The testing policy requires explicit human permission for agents. The mutex still applies. |
| `--against-test-guidance-major-host-contention-and-oom-killed-processes` | Running alongside the mutex holder. It cannot be combined with waiting, and the file limit still applies. |
| `TV_TEST_AGAINST_TEST_GUIDANCE_DIRECT_NATIVE_RUN=1` | Loading a registered config directly, for watch mode, a debugger or an editor. Such a run is outside the mutex and the file limit, and native setup is the caller's job. |
| `--against-test-guidance-turn-flakes-into-failures-on-broad-runs` | A zero runner retry budget for a broad selection. |

`--allow-extreme-inefficiency` is renamed `--against-test-guidance-broad-local-run`; the old spelling refuses and names the replacement. `--force` still permits only the full-suite shortcut.

## Blaxel worker leases

A shard attempt leases one worker from before checkout until its processes are confirmed gone and its reports have been downloaded and checked (`scripts/test/blaxel-worker-lease.mjs`, `scripts/test/blaxel-lease-lifecycle.mjs`).

- The lease is `/tmp/tv-testshard.lock/owner.json` on the worker. Every change to it happens under a short `flock` on `/tmp/tv-testshard.guard` and rechecks the current owner first, so a delayed renewal or release cannot overwrite a newer owner. The guard is never held during downloads.
- Only the coordinator renews. It records each dispatch before requesting it, and the remote entry point registers its PID and start time before touching the checkout, and only while the lease still belongs to that coordinator.
- Every process the attempt starts carries `TV_TEST_SHARD_OWNER`, the lease's `lockId`, beside each surface's `TV_TEST_SURFACE_OWNER` token. Release requires an audit that finds no process carrying the attempt's tokens; survivors are stopped after their PID and start time are validated. An unreadable audit, an unknown dispatch outcome or a surviving owner leaves the worker leased and out of the run's retries.
- A lease not renewed for 20 minutes (`--lock-ttl-seconds` changes this) is abandoned. The next acquisition stops only the abandoned attempt's processes, confirms that no test owner remains, removes the abandoned attempt's scratch, discards its undownloaded reports, and writes a recovery receipt into the new attempt's evidence. If the owners cannot be identified or stopped, the worker is held for an operator.
- Lease records set `expiresAt: 0`, which runners predating the lease never treat as passed, so branches still on those runners leave current leases alone. A current runner respects a legacy lock until its deadline and then acquires only after a clean audit.
- Pool provisioning makes a worker eligible for test runs only after it is provisioned and verified. Deletion refuses leased workers, reserves an idle worker after a clean audit, and removes its eligibility before calling Blaxel (`scripts/test/blaxel-pool-lifecycle.mjs`).

## Temporary files and generated runtimes

Worker `/tmp` is memory-backed and holds Chromium's shared memory, so temporary files on a worker cost memory.

- Each shard attempt gets a private directory under `/tmp/tv-testshards/`, and `TMPDIR` points into it. Holding the lease, and after a clean audit, a run first removes only directories directly under `/tmp` named `television-source-cli-e2e-*` or `television-web-bundle-*`, and earlier attempts' scratch. After the attempt it stops the attempt's processes and removes its scratch. Persistent caches and unrelated files are kept.
- Test helpers give reusable builds the lifetime of their test worker (`test/helpers/worker-builds.ts`). A source-CLI or versioned web build is shared within its Vitest or Playwright worker, published only after preparation succeeds, and removed at worker teardown once servers have stopped and pending builds have finished. Failed preparation and per-launch copies remove themselves. The worker cleanup above reclaims what killed test workers leave behind, and what test revisions without these helpers leave behind.
- Five browser acceptances (two theme lifecycle walks and three demo-mode cases) load the built application through `ProductServer` and keep their authentication, restart, navigation and rendering assertions. `test/helpers/application-requests.ts` records their request paths to show they loaded built assets. The testing policy makes the built application the default for new or substantially changed `ProductServer` browser acceptances.

## Resource diagnostics

Each Blaxel surface execution records available memory, shared memory in use, free temporary space and the kernel's out-of-memory kill counter at its start and end, and adds the kernel's out-of-memory messages when a native attempt failed or the evidence is incomplete. The records are linked from the surface result, survive retries and download, and are bounded at 64 KiB of kernel lines, 128 KiB per record and 8 MiB per shard attempt (`scripts/test/resource-diagnostics.mjs`). They never change a test outcome, and they do not measure peak memory.

## Refusals and run directories

A refusal leaves no run directory, as `specs/arch/test-runner/reporting.md` states. In `scripts/test/cli.mjs`, `runBlaxel` makes its selection checks, one surface for a targeted run and a supported suite otherwise, before remote preflight and before it creates the run directory, and an invalid `--run-dir-output` value is rejected before either provider creates one. The arguments passed to the Blaxel coordinator are unchanged. A caller that passed `--run-dir-output` therefore finds either a run directory with its summary or no directory at all. This ordering is the only behavior change the spec rewrite made to the code.

## Live Blaxel qualification

`test/runner-fixtures/blaxel-harness/` is an automated qualification of the lease, recovery, deletion, delayed retrieval, diagnostics and temporary-file placement, run against disposable private workers. It has two experiment surfaces outside `all` and CI: `experiment:blaxel-harness`, the driver, and `experiment:blaxel-harness-fixtures`, which the driver dispatches. The driver runs only on a dedicated, credentialed coordinator sandbox outside every worker pool, with `TV_BLAXEL_HARNESS_COORDINATOR` and `TV_BLAXEL_HARNESS_POOL` set. The runner refuses it on Blaxel, inside a leased worker, or without both variables. The driver surface's registry root is its one test file, so on a marked host its command is `npm test -- local --file test/runner-fixtures/blaxel-harness/driver/harness.test.ts`. The fixture README gives the full usage.

## Contributor guidance

`AGENTS.md`, the testing policy, the spec workflow and the contributor and reviewer skill sources describe the practice the guardrails support. Contributors iterate on one file locally and commit and push regularly so that Blaxel can test current work. They run known multi-file checks on Blaxel rather than as a series of local one-file runs, keep default retries for validation, and narrow a broad failure to its file before the next broad run. The workflow adds that supervisors and coordinators must not casually tell workers to withhold development-branch commits or pushes. The testing policy says which overrides need human permission, and `specs/terms.md` defines *marked host*. The desktop, artifact, PostHog, daemon and Blaxel setup instructions use commands the guardrails accept.

## Test-runner specs

The nine specs under `specs/arch/test-runner/`, 28,168 words, become six specs of 10,627 words. They were written from an empty page under `specs/spec-policy.md`. A statement is included only where an agent deriving behavior from the code cannot be trusted to get it acceptably right, or where something outside the runner depends on it. Testing guidance is included only where removing it would change a correct proof derivation.

| Spec | Owns |
| --- | --- |
| `test-runner.md` | The command, selectors and exit codes; providers; the test registry; the shared-host guardrails and overrides; retries; verify; the processes and network addresses that tests create. |
| `blaxel-testshards.md` | The pool, repository and credentials, the lease protocol, temporary files, how Blaxel runs selections, and setup. |
| `sharded-execution.md` | Shard plans, the duration baseline, and how shard outcomes combine. |
| `reporting.md` | The run directory, honest status, the compact summary, timing records, keeping secrets out, and resource diagnostics. |
| `github-ci.md` | When CI runs, the required checks, and the build, cache and artifact arrangements. |
| `attestation.md` | Tree attestations: the claim, who may write, the policy file, skipping in CI, pruning and operations. |

`preflight.md`, `flaky-tests.md` and `test-registry.md` are deleted. The rules for remote revisions are at `test-runner.md#^remote-revision`, retries and flaky annotations under `test-runner.md#retries`, and the registry under `test-runner.md#the-test-registry`. Flake discipline is left to the testing policy, Electron preflight and runtime preparation to `specs/arch/desktop/e2e-harness.md`, and the PostHog key to `specs/arch/telemetry/sink.md`.

The specs pin the contracts that other runner revisions, people and external services depend on:

- the local mutex's location and record, the surface owner token, and the Blaxel worker lease with its deletion reservation, which runners of different revisions read on one host or worker;
- the `summary.json` fields that people and scripts read, and the `events.ndjson` envelope and fields that `npm test -- baseline update` validates in earlier runs' streams, with the rule for changing them;
- the job names the repository ruleset requires (`lint`, `type-check`, `package-manifests`, `unit`, `e2e:desktop` and `e2e-required`), the attestation ref and policy file, and the GitHub Actions behaviors the attested skip must work around, such as `continue-on-error` making a failed job look successful to its dependents and job-level conditions hiding a matrix job's check names;
- measured facts that derivation would not recover, such as the Chromium shared-memory cost of `304` responses and the single Playwright worker for `e2e:browser-app-real-stack`.

Internal types, algorithms, option tables and tuned settings are left to the code. The specs also state an existing gap: Blaxel workers have no Firefox, so a Blaxel run covers Chromium only, and an attestation from a Blaxel verify does not cover the Firefox projects, which CI then skips for that tree (TV-1011).

These are the judgment calls in the rewrite a reviewer is most likely to question:

- **Shapes pinned for the first time.** The mutex record, the owner token, the worker lease, and the summary and event fields were called contracts in the earlier specs without a shape. Each is pinned only as far as another revision or reader relies on it.
- **Left to the code.** The normalized result and provider report types, the baseline file's format, the shard-balancing arithmetic and the coordinator's option table.
- **What crosses runner revisions is named, and its shapes are left to the code by a stated exception.** In a Blaxel run with `--commit`, the coordinator is the checkout's runner and the workers run the tested commit's. `blaxel-testshards.md#runs` says that the registry, baseline, plan, worker command and shard summary cross revisions, and that a mismatch must fail as infrastructure and never be read as results. Spec policy asks for pinned types for data another revision reads, so the paragraph states an exception: both ends validate what they receive, and the worker checks the plan against a digest of its whole content, so no subset of fields would be the whole contract.
- **The attestation policy read comes before the run's tests, not before every phase.** CI's lint, type-check and manifest jobs start alongside the decision job that first reads the policy, while every test job waits for it. Requiring the read before every phase, as the earlier attestation spec did, would mean reordering CI.
- **Measurements left out.** The 36-shard timing figures, the timeout profiles, the `e2e:browser-app` two-worker setting and the cost-model revision triggers are not in the specs. The settings remain in the code.
- **Left to other owners.** Electron preflight and runtime preparation, the PostHog key, flake discipline and the `tv serve` test recipe. Each is right only if the named owner states it.
- **Small rules left out.** The quarantine-file allowance, `--fail-fast`, the `--allow-extreme-inefficiency` refusal, `--audit-stale-owners` and the record of retiring Blacksmith runners. The two options and the refusal remain in the code.

The removal account goes through the 430 passages of the nine earlier specs, as they stood with #49 and #12 integrated, and says what became of each: 2 kept, 257 reworded, 60 moved to another spec, 35 now derivable from a named statement, and 76 dropped. 77 of the reworded or moved passages also lose a detail, which the entry names.

## Proofs, references and tests

The proofs follow the six-spec layout. The proofs for the registry, preflight and flaky tests become sections of `proofs/arch/test-runner/test-runner.md`, keeping every assertion, hook and anchor, so tests that cite them change only the file name. The proofs were brought into line with the rewritten specs, not derived again from them:

- Links to removed headings and anchors point at where that content now lives.
- Statements the specs now contradict are corrected: attestation eligibility is by tree, not by `--commit` naming another commit; CI's build-recipe check covers surfaces in the `all` suite; the shard-count recommendation allows exactly two minutes and falls back to the pool size.
- Assertions on detail the specs leave to the code, such as the shard-assignment algorithm, the weighting constants and pinned worker settings, are kept and marked *superfluous*.
- Contracts the specs pin for the first time are cited to the tests that already cover them: the owner-token format, the worker's digest check on the shard plan, refusal of a worker reserved for deletion, `--run-dir-output`, and one rule of the timing-event envelope.

Two promises in the rewritten specs had no test, so tests were added. In a disposable checkout with the production CLI, `test/repo/test-runner-guardrails.test.ts` refuses a local full-suite shortcut, a two-surface targeted Blaxel selection, an unsupported Blaxel suite and an empty `--run-dir-output`, and shows that the checkout has no `.test-runs/` afterwards. `test/repo/test-runner-reporting.test.ts` checks the `summary.json` fields the spec pins. Two existing tests compared the code with sentences of the earlier specs; they now read the sentences in `github-ci.md` and `blaxel-testshards.md` that state the same rules.

References elsewhere follow the new files. `AGENTS.md`, the spec workflow, the testing policy, the desktop, licensing, Node-version and telemetry specs, the migration map, `developer-skills/tvdev-setup/SKILL.md` and code comments link to the sections that now hold their content. Two of these spec edits change wording rather than only a link:

- `specs/product/desktop-app.md` explained its required Mac verify run by citing preflight's testing guidance. The sentence now says what the run exercises: the runner's macOS process backend.
- `specs/terms.md` points each test-runner term at its new owner, defines *recovered flake* and *failed shard* by pointing at the rules that define them, and drops *execution group* and *normalized surface result*, which no spec now defines.

## Validation

`npm run verify -- blaxel` passed at `1945b6c5` (tree `b1d2a3d0a29355c94d99b0aea2908482eaacbc66`), the head before this document was added: lint, type-check and package manifests, then 22 surfaces on 36 shards with 3,812 tests passed, 8 skipped, and no failed tests, recovered flakes, process leaks or infrastructure failures, then the vibe-mode check. It published `refs/testpass/1/b1d2a3d0a29355c94d99b0aea2908482eaacbc66`. [GitHub CI run 40779402162](https://github.com/telepath-computer/television/actions/runs/40779402162) passed at that commit, with the heavy jobs skipping on that attestation. Blaxel runs Chromium only, so the Firefox projects ran in neither (TV-1011).

The full verify divides suites into planned shards, so it never takes the targeted Blaxel path where the guardrail and diagnostics code meet: `target-native.mjs` writes the targeted Vitest runner config and attempt file, and `supervised-command.mjs` reads that attempt file for resource diagnostics. Four fixture probes crossed the real Blaxel API and transport on `8e6cfcb2`, whose code differs from `1945b6c5` only in the run-directory ordering above and in comments. Under the default budget, a Vitest and a Playwright file selection each recovered a deliberate first-attempt failure, and the native report held only the selected file. `--retries 0` made the failure final. A planned two-shard run with the broad zero-retry override kept the failure final while the separately annotated case still retried. Each kept complete resource diagnostics with resolving links.

Each probe ran with `--commit 8e6cfcb2` on the `poc` pool with the default infrastructure retry budget of 2. Run directories were under `.test-runs/` in the checkout that ran them.

| Probe | Selection | Observed | Run directory |
| --- | --- | --- | --- |
| A | `--file test/runner-fixtures/guidance/vitest/one.test.ts --grep 'deliberate first-attempt failure\|sibling'` | exit 0; runner budget 2; native report holds only `one.test.ts`; attempts failed, then passed; generated runner config, attempt file and native report downloaded and readable; diagnostic record complete with the failed attempt and recovery marked, kernel evidence available, both links resolving | `2026-10-28T10-23-13-752Z-p1710376-r9118b10c699014bb` |
| B | as A, with `--retries 0` | exit 1; budget 0; one failed attempt; the same artifacts kept; diagnostic marks the failed attempt, no recovery | `2026-10-28T10-23-11-962Z-p1710373-r9ceb449ad7bda74d` |
| C | `--file test/runner-fixtures/guidance/playwright/one.test.ts --grep 'deliberate first-attempt failure\|sibling'` | exit 0; budget 2; native report holds only `one.test.ts`; diagnostic complete with the recovery marked | `2026-10-28T10-24-08-127Z-p1711445-rb2d4c679f21425bd` |
| D | `--tag runner-guidance --runner playwright --against-test-guidance-turn-flakes-into-failures-on-broad-runs --shards 2 --allow-shard-count-override 1` | exit 1; test retries 0, infrastructure retries 2; shard 1 ran `one.test.ts`, its deliberate failure final after one attempt and the annotated case recovered; shard 2 ran the sibling file; both shards' test lists, native reports and diagnostics kept | `2026-10-28T10-24-42-747Z-p1711676-r9d77334ea5dd8cef` |

The lease, recovery, provisioning, deletion and scratch-cleanup code is unchanged from #12, and the mutex and lifecycle code from #49, so their live evidence applies here:

- The Blaxel qualification passed on disposable private workers: competing acquisition and deletion, delayed retrieval, active and quiet coordinator crashes, recovery receipts, diagnostic transport, and the files Node and Chromium actually create under the attempt's `TMPDIR`. The worker-lease and lease-contract tests passed all 20 cases on private Blaxel workers at `2156f266`, including a root-only case with a same-user nondumpable child. [GitHub CI run 40594589067](https://github.com/telepath-computer/television/actions/runs/40594589067) passed at `9787188d`.
- A full Blaxel verify on #12's branch removed 1,510 generated runtime directories, 5,003,157,504 allocated bytes, and kept 231 diagnostic records with complete start and end readings and no change in the out-of-memory kill counter. Peak memory and how often renewals are lost over time remain unmeasured.
- [Isolated Linux lifecycle run 40502488567](https://github.com/telepath-computer/television/actions/runs/40502488567) passed at `eeef2dab`: the direct mutex tests, verify's handoff, four mutex crash and recovery cases and thirteen existing lifecycle cases. No macOS run is claimed. [GitHub CI run 40514829404](https://github.com/telepath-computer/television/actions/runs/40514829404) passed at `ea587122`.

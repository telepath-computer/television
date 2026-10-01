*The GitHub Actions CI execution contract: PR concurrency, per-job dependency and browser environment, build-once fan-out with an artifact manifest, cleanup tool prerequisites, worker counts, and the retirement record for the Blacksmith-dispatched shard provider.*

# GitHub Actions CI

GitHub Actions validates every ready pull request targeting `main` or `integration/**`, and every push to those branches. Draft pull requests skip the validation graph, including the `e2e-required` join; marking one ready starts validation. Shared-branch policy comes from the [contribution workflow](../../spec-workflow.md#^shared-branch-workflow). The CI workflow fans test suites out across parallel jobs and gates mergeable changes on the result. Ordinary test jobs restore an exact-keyed dependency cache that is equivalent to a clean install, e2e shards restore one image-bound archive containing those dependencies and the Playwright Chromium and Firefox browsers, and workspace builds happen once before their outputs fan out. This contract prevents each job from repeating dependency, browser, system-library, and workspace-build setup.

This spec is authoritative for how the GitHub Actions CI workflow (`.github/workflows/ci.yml`) cancels superseded PR runs and sets up and executes test jobs: the dependency-install contract, the browser-environment contract, the build-once fan-out, cleanup/leak-detection tool prerequisites, and CI worker counts. The repository's Node/npm values and `.nvmrc` selector are owned by [arch/node-versions.md](../node-versions.md). The canonical command surface is [test-runner.md](./test-runner.md) (which also owns the CI retry contract); the per-worker shard runner CI invokes is [sharded-execution.md](./sharded-execution.md); surface builds are declared in [test-registry.md](./test-registry.md).

What CI runs — the suites, duration-aware shard fan-out, run artifacts, and the `e2e-required` join for branch protection — is owned by the workflow under [test-runner.md](./test-runner.md)'s retry contract. This spec owns both that GitHub topology and the setup each job pays before tests execute; [sharded-execution.md](./sharded-execution.md) owns the shared plan and worker semantics. Whether the heavy test jobs run at all on an already-attested tree is owned by [attestation.md](./attestation.md).

The developer-to-CI reuse path starts with a normal `npm run verify -- blaxel`. When that complete, unfiltered verify passes and the trusted policy permits writing, it automatically publishes the tree attestation; no publication opt-in is part of the command. A ready pull request for the identical tree then reaches `attest-check` and uses the step-level no-op path below. `--no-publish` is the developer's explicit escape hatch when this reuse is unwanted.

GitHub CI is the other eligible attestation source. Its `attest-write` job sets `TV_TEST_REF_PUBLICATION` from the workflow's same-repository/fork classification and invokes the CI writer only after the complete graph and strict join pass. The writer command additionally requires `GITHUB_ACTIONS=true`, workflow `CI`, job `attest-write`, and `TV_TEST_REF_PUBLICATION=required`; a developer shell, an individual `provider=local` test job, and a fork context cannot use this path.

## Superseded pull request runs

A new CI run for the same pull request cancels its superseded run. Runs for different pull requests are independent; push and manual runs are not cancelled or serialized by this PR concurrency policy. The complete required-check graph remains the validation requirement for the head commit of a ready pull request. ^gha-pr-concurrency

## Dependency install: exact-key caching of the install's full effect

Every job that executes repository code selects Node from `.nvmrc` exactly once. The `ci` and `test` jobs select it through `setup-workspace`; the build and e2e shard jobs select it through `setup-shard-readiness`; `attest-check`, `e2e-required`, and `attest-write` call `actions/setup-node` directly before their repository command. Continue-on-error phase-metric recorders may run on the runner default before a setup composite because their failure is non-gating and they neither install dependencies nor validate the repository.

Every CI job that needs the workspace installed follows this contract:

- **What is cached:** the install's *complete* effect on the tree — every `node_modules` directory the install produces, plus the npm lifecycle output written outside `node_modules`: the `prepare` chain builds `packages/skillbench/dist` into the source tree (build-order constraint: `specs/arch/skillbench.md`). Caching `node_modules` without `packages/skillbench/dist` would reintroduce the pristine-install failure class the serialized prepare chain exists to prevent.
- **The key covers every input of what is cached.** Because the cached content includes *generated code*, the key must change when any of its inputs change, not only the dependency graph. Key components: OS, CPU architecture, Node major version, the execution environment's identity (the container image tag for container jobs; the runner image label for VM jobs), and a content hash over the committed `package-lock.json` **and the prepare chain's full input set**: the `packages/skillbench/` sources, configs, and manifests (excluding its `dist/` output), **and every package manifest that declares a lifecycle script** — concretely `packages/skills/package.json`, which contains the serialized prepare command itself; editing the script must miss, never stale-hit. The concrete `hashFiles` list is pinned in the workflow and mirrored by the repo assertion below; when in doubt, over-include an input rather than risk a stale hit.
- **No `restore-keys` fallback.** A partial or stale tree restored from a near-miss key is worse than a cold install.
- **On a hit, `npm ci` is skipped entirely.** The guarantee: a hit is behaviorally equivalent to a pristine `npm ci` at the same inputs. The key construction above is what makes this hold — any drift in an input produces a miss, never a stale hit.
- **On a miss, `npm ci` runs and the paths are saved under the exact key** in the same job, so the next run at the same inputs hits.
- Version-bump commits rewrite the lockfile and therefore miss; that cost is accepted (a version-normalized key is a possible later refinement, out of scope here).

The `setup-node` npm-store cache (`~/.npm`) is kept as the miss-path accelerator; it never substitutes for the contract above, because a store hit still runs the full install and lifecycle.

The `setup-shard-readiness` production namespace is a manually versioned payload-schema boundary: it must increment whenever the required browser set or another cached-path requirement changes without changing the source-input hash. The current default is `shard-readiness-v2`, which identifies a payload containing both locked Playwright browsers.

The e2e shard path specializes this contract through `setup-shard-readiness`: one exact cache archive contains `node_modules`, `packages/skillbench/dist`, and `~/.cache/ms-playwright`. Its key includes the same source-input hash plus OS, architecture, the **major version derived from the Node runtime actually selected by `setup-node`**, and GitHub's concrete hosted-image `ImageOS` and `ImageVersion`. `ubuntu-latest` is not a sufficient image identity: an image rollover must miss rather than restore readiness produced on an older image. The build job is the sole combined-cache producer. On a miss it runs `npm ci`, prepares Chromium and Firefox, proves real Chromium and Firefox launches, and saves the combined paths under the resolved key.

A consuming shard normally restores the build's exact key. On a miss it emits an Actions warning, runs its own `npm ci` and Chromium/Firefox system-dependency installation, and records a cache-miss `shard-readiness-fallback` phase before continuing to the mandatory launch probe. GitHub rolls hosted images out gradually, so a build and its shards can legitimately receive different `ImageVersion` values during one workflow. Failing on that miss would turn image-fleet skew into a red matrix before tests execute. The fallback preserves availability without weakening cache identity: it does not restore a near-match or publish a combined cache entry, and the build remains the sole producer with a strict pre-save launch proof.

## Browser environment

The dedicated `e2e:desktop` job gets Chromium and Firefox with their system libraries through the `setup-playwright` composite action: the browser binaries restore from a cache keyed on the exact Playwright version, and system dependencies install per job. `setup-playwright` deliberately carries no Node selector or default; every call follows `setup-workspace` or `setup-shard-readiness` and inherits that job's already-selected `.nvmrc` runtime for its `node` and `npx` commands. The e2e shard jobs normally receive Chromium and Firefox through the image-bound combined readiness archive above; a shard reuses `setup-playwright` only on its explicit self-seed fallback. During initial promotion, every shard performs minimal real Chromium and Firefox launch/close probes after cache restore or fallback on its own VM. This verifies the resulting payload against that shard's actual host libraries and fails before tests on corruption or incompatibility. The build's pre-save launches prevent publishing a known-bad archive; the per-shard launches are independently load-bearing because producer launches on another VM cannot prove the consumer host. The operator may remove the per-shard probes only after observing the promoted path across a hosted-image rollover; removing them is a deliberate contract update, not incidental cleanup.

**Deferred: the pinned Playwright container.** Running shard jobs inside `mcr.microsoft.com/playwright:v<version>-<base>` was implemented and validated with an in-container Node pin, an in-container cache, and a mixed 1/8 shard selection (runs 29525458743 and 29526644799). Its wall time was neutral compared with the apt path (~32 s image pull vs 15–31 s apt; the goal was determinism, not seconds). The first full-suite validation run (29531734369, shard 1/3) surfaced an in-container behavior difference that the narrower selection did not reach: font-metric-sensitive assertions in `packages/view-markdown/test/e2e/markers.spec.ts` failed on all three attempts. (That run's second failure, `test/node/missing-artifacts.test.ts` hook timeouts, initially looked container-specific but reproduced on the VM and was root-caused to the artifact transport stripping the built CLI's executable bit — fixed by the tar packing in the fan-out contract, run 29533230103.) Diagnosing and resolving the font difference (font pinning, environment-specific setup) belongs to the surface that owns the test, and changing its assertions is outside this contract's scope, so containerization is **deferred**: the composite path above is the contract. Revisit trigger: the named incompatibility is fixed or explicitly waived by its owning surface.

Jobs that run no browser surface (lint, type-check, package-manifests, vibe-mode, unit) use neither browser setup path. `e2e:desktop` additionally needs the Electron runtime environment and follows the fan-out scope rule below (own builds, no build-job dependency).

### Desktop runtime preparation

The dedicated `e2e:desktop` job obtains its Electron binary through [the test surface's own setup](../desktop/e2e-harness.md#^desktop-e2e-global-setup), not through `npm ci` or a workflow step. The workflow adds no Electron install step and no Electron cache. The harness's setup and handoff carry the behavioral proof; this negative workflow-structure decision is maintained by review and owes no separate assertion under [the testing policy's guidance for contextual statements](../testing-policy.md#^spec-purposes). ^gha-electron-runtime-preparation


## Duration-aware matrix execution

The e2e matrix plans the registry-owned `e2e-ci` suite, which includes `kind:e2e` and excludes `tag:electron`. A registry assertion requires that selection to equal all e2e surfaces except Electron surfaces. `e2e:desktop` remains selected and exercised by its dedicated matrix job, so the exclusion cannot silently drop desktop coverage.

Every e2e shard job independently computes the complete plan from the checked-out commit, the committed baseline, the `github-ubuntu-24.04-x64-2vcpu-vm` timing provider, and the configured shard total. It passes that file through the shared worker's single `--plan <path>` input and executes one index. Every GitHub test job sets the VM timing provider explicitly. The plan weighs files by the baseline's Blaxel measurements ([sharded-execution.md](./sharded-execution.md#Provider weights and unknown files)).

Each test job records schedule, checkout, dependency/cache, browser-readiness, plan, test-compute, and report phases under the normalized reporting contract, then uploads its complete `.test-runs/<run-id>/` child path with hidden files, error-on-missing behavior, and 30-day retention. Direct local test jobs pass `--run-dir-output "$RUNNER_TEMP/test-run-dir"`; their artifact step reads that exact identity and verifies it names a direct child of `$GITHUB_WORKSPACE/.test-runs`. It never enumerates `.test-runs`, where repository tests may create legitimate sibling directories. The e2e join downloads those run artifacts and invokes the shared agreement validator. In addition to the build/matrix status rules below, it requires indices `1..N` exactly once, equal valid plans, timing provider, tested commit/tree, and total, plus exact plan/assigned/collected file equality. A passing worker cannot hide a duplicated, omitted, or broadened file assignment.

## Build-once fan-out

Surfaces declare `preCommand` builds in the registry ([test-registry.md](./test-registry.md)), and the underlying builds overlap: the CLI package build (`packages/cli/build.mjs`) itself builds the web, server, view, and skills workspaces before bundling. Running each surface's `preCommand` in every parallel job therefore repeats the same work. One job builds; the e2e shards receive its output.

**The artifact is the build's output, shipped whole.** A shard assembles its workspace from three sources: ^gha-prebuilt-partition

- **its checkout** of the same commit, for every tracked file;
- **the readiness cache** (or, on a miss, its own `npm ci`, equivalent at the same inputs by the caching contract above), for dependency and prepare-chain state;
- **the artifact**, for the build's output.

The artifact is **every untracked file and symlink in the build job's workspace, excluding `node_modules`, `.git`, and `.test-runs`** — packed without output selection. The three exclusions are the paths a shard must not take from the build job: dependency state it restores from its own cache, repository metadata from its own checkout, and test scratch that belongs to whichever run produced it (on a developer machine `.test-runs` is the overwhelming majority of untracked files, and it is never build output). That set is what git itself reports as untracked, so nothing chooses which build outputs matter: nothing can choose wrongly, nothing needs maintaining, and a new build output ships because it exists rather than because someone listed it. **No hand-maintained output list appears in this contract, the workflow, or the manifest.**

The promise is bounded to exactly that: **every file the build wrote is on the shard.** It is not a claim that the two workspaces are identical, and this contract deliberately buys no machinery to make one. Four things are out of scope, and tests must not depend on them: repository metadata under `.git`, which differs between independent checkouts; anything a build writes *inside* `node_modules`, which the shard takes from the cache; *deletions*, since extraction adds and overwrites but never removes — a build that expresses itself by removing a pre-existing untracked file does not transport that removal; and *empty directories*, which git does not report as untracked content and which therefore do not ship (a directory holding output travels with its files). Some untracked paths (the prepare-chain `dist` trees) come from both the cache and the artifact; the artifact's copy is the built one and wins on extraction. ^gha-prebuilt-bounds

**The one rule this places on a build:** it must not leave a tracked file whose content differs from the commit, because a shard takes tracked files from its checkout and would never see the difference. The build job asserts this after the recipes — no tracked file differs from the commit — so a violation fails the producer loudly instead of silently diverging a consumer. Rewriting a tracked file with identical bytes is fine and invisible; the published packages' `LICENSE` copies do exactly that. ^gha-prebuilt-tracked-rule

The rest of the contract:

- **The manifest declares recipes, not paths** — which deduplicated builds run (each **once**, not one invocation per surface `preCommand`) and which surfaces they cover. It is a committed module at the repository root beside the registry, `test.prebuilt.mjs`:

  ```ts
  interface PrebuiltManifest {
    artifactName: "prebuilt-dists";
    builds: PrebuiltBuild[];
  }
  interface PrebuiltBuild {
    id: string;                  // deduplicated build recipe, e.g. "products"
    command: string[];           // the one command the build job runs for this recipe
    coversPreCommands: string[]; // surface ids whose registry preCommand this recipe subsumes
  }
  ```

  The registry stays the declaration of what each *surface* needs. The consistency check: every selected surface with a non-null `preCommand` appears in exactly one recipe's `coversPreCommands`. A violation fails the build job, not the consumer.
- The build job uploads one run artifact under the manifest-derived name with `retention-days: 1` (it is consumed only within its own workflow run, which also guarantees same-run validity; one day keeps it inspectable for post-run debugging without accumulating storage). It is packed as a **tar archive extracted with stored permissions**, because the artifact transport strips modes and tests spawn the built CLI directly.
- **Consumers fail loudly, not silently.** Shards download and extract; a missing artifact or a failed extraction fails the job, and there is no fallback to rebuilding. No path is inspected, because none was selected: the artifact arrives whole or extraction fails. ^gha-prebuilt-consumer
- Test jobs invoke the shard runner with pre-commands disabled: the worker input `--skip-pre-commands` (env `TEST_SHARD_SKIP_PRECOMMANDS=1`) skips every surface `preCommand`; the caller takes responsibility for having supplied the built outputs. The worker's sole plan input is `--plan <path>` (or `TEST_SHARD_PLAN`), which validates and executes an explicit shard plan. Both inputs are defined by the shared worker contract in [sharded-execution.md](./sharded-execution.md).
- The build job produces the image-bound combined shard-readiness cache before running the recipes, so its cost is bounded by one readiness restore (or one miss-path install/browser preparation) plus one deduplicated round of builds.
- **Fan-out scope:** the parallel e2e shard jobs consume the artifact. The `e2e:desktop` job does not — it keeps running its own registry `preCommand` builds and takes no dependency on the build job, so a build failure cannot mask desktop results and desktop stays independent. The cost (one duplicated build round on one job) is accepted.
- **Join integrity:** introducing the build job makes test jobs skippable by an upstream failure, and the branch-protection join must never read that skip as success. On a draft pull request, the join has the same draft guard as the validation jobs and reports neutral/skipped: it is not applicable while GitHub prohibits merging the draft. On every non-draft event, `always()` makes the join run despite dependency outcomes; it passes only when the build and e2e matrix both report success, including the successful step-level no-ops produced by an authorized attestation. Missing, skipped, cancelled, and failed dependencies fail the join. The join also depends on the `vibe-mode` job, which runs the [vibe-mode check](./test-runner.md#^verify-vibe-mode); any vibe-mode result other than success fails the join, so a branch in vibe mode fails the required check while every other job reports its own result. The `vibe-mode` job takes no dependency on `attest-check` and has no skip step, and the join applies this requirement before its attested-skip path, so an attested tree is not exempt. The join **checks out the repository like every other job** and runs the plan-agreement validator from that checkout: shipping the validator inside the artifact would mean deciding which of its files to ship, which is the maintenance this contract exists to abolish. An isolated live run with an induced build failure proves this failure path in addition to the YAML assertion.

## Tool prerequisites on CI workers

The shard worker's owner-lifecycle supervisor and leak detector (contracts owned by their runner/process-lifecycle specs) need specific host tools, and CI images do not reliably provide them. The rule this spec sets for every CI job environment (runner VM and container alike):

- **Never assume a tool.** Every binary the owner-lifecycle path invokes is either asserted present by a check that fails the job loudly, or installed explicitly as a setup step in the same workflow.
- The current required set: `ss` (iproute2) and a readable `/proc` (procfs) for socket-to-process attribution. The owning spec for the leak detector defines what it does with them; this spec guarantees the environment provides them.
- Changes to the required tool set land here and in the workflow's assert/install step in the same change.

## CI worker counts

**GitHub e2e matrix:** **16 shards** is the measured cost/latency knee. Run `29561697838` completed the build-through-join critical path in 3m31s at 29.42 e2e runner-minutes. The 24-way run `29565323284` saved only 17 seconds while consuming 37.10 runner-minutes (26% more), so regular CI does not buy that last increment. The job name denominator, matrix indices, planner total, worker total, and agreement-join expectation change together.

**`e2e:browser-app`** (`packages/web/playwright.config.ts`) keeps its CI Playwright worker pin at **2** — an explicitly conservative default, not a measured conclusion. The 2-vs-4 measurement is **inconclusive due to runner variance**: run 29523328500 measured 4 workers ~9% slower with per-test p95 roughly doubled, while run 29525458743 measured 4 workers ~23% faster (162 s → 124 s, p95 4.6 s → 6.1 s, zero retries in both). Two one-shot samples with opposite conclusions demonstrate that per-run runner variance dominates the effect size, so further one-shot sampling is not spent on it. **Revisit trigger:** the test jobs' run artifacts provide enough GitHub-hosted timing samples to compare worker counts across many runs. Every surface keeps its currently configured worker behavior; any per-surface change cites its own evidence here. In CI, `TV_PW_WORKERS` can override the two-worker pin for a controlled measurement run. It has no effect outside CI. The production workflow leaves it unset.

**`e2e:browser-app-real-stack`** runs browser acceptances that boot product servers with one Playwright worker. `path-artifact-real-stack-coverage.test.ts` raised the app's disconnected modal on every attempt in run 32435629379 when a second Playwright worker competed with its per-test servers, while it passed alone on the same 2-vCPU hosted VM. `onboarding-browser.test.ts` likewise passed alone locally and on Blaxel, but its application root never rendered when full TV-492 shard plans paired it with the setup-heavy onboarding skill-assets file: three full verifies failed only that assignment, including after extending the initial readiness deadline from five to twenty seconds. A full verify of bare `archive/feat-ui-redesign-2026-08` passed all 36 shards under its different plan. The surface's explicit `workers: 1` serializes both product-server files and prevents unrelated browser setup from competing inside their Playwright invocation; the cost remains one extra invocation on whichever shard each file lands on.

## Testing

No repository test uploads to or downloads from the GitHub Actions cache and artifact services. Run the isolated live validation below before merging changes that could plausibly disrupt CI workflow mechanics, such as cache reuse, build-output transfer between jobs, browser preparation, or failure propagation. An implementation change that preserves those mechanics does not require this exercise. When needed, run a complete isolated copy of the CI graph only on the branch carrying the change, using both services. The isolated copy passes scratch `cache-namespace` values to both setup composites ([#Test hooks](../../../proofs/arch/test-runner/github-ci.md#Test hooks)). After validation, its cache entries are deleted to protect the shared repository cache quota.

The live evidence must show all of the following:

- a forced miss in the combined shard-readiness cache completes the fallback described above and creates an entry under the exact key in its scratch namespace;
- a following cache hit consumes that entry and skips `npm ci` and browser preparation;
- on both paths, the Chromium and Firefox probes pass, surfaces consume the build artifact with their `preCommand`s disabled, and the strict plan-agreement join is green; and
- an induced build failure leaves the join red.

An isolated workflow cannot establish required-check contexts under the production job names. The first production run after the change reaches main must show that those contexts are emitted under the names branch protection requires.

## Retirement record — Blacksmith-dispatched shard provider (2026-07)

Historical record; the living contract above does not depend on it. Television previously carried a third remote execution path: a `workflow_dispatch` shard workflow on third-party Blacksmith runners, coordinated by `scripts/run-gha-testshards.mjs` and selectable as provider `gha`. It existed to compare sharded runners against Blaxel; it failed frequently at container provisioning, and the operator decided to retire it. The retirement removed:

- the `gha` provider from the canonical command surface and from `verify` resolution ([test-runner.md](./test-runner.md)); `verify` auto-resolution is Blaxel-or-local,
- the `github-cli` preflight ([preflight.md](./preflight.md)),
- the coordinator `scripts/run-gha-testshards.mjs`, its infrastructure-failure classifier, and its normalization coverage,
- the workflows `.github/workflows/gha-testshards.yml` and `.github/workflows/gha-testshards-image.yml`, and the `.github/gha-testshards/` image definition.

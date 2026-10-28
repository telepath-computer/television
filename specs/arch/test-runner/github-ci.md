*The GitHub Actions workflow that validates pull requests and shared branches: when it runs, the checks branch protection requires, how its jobs share setup, and how failures stay visible.*

# GitHub CI

`.github/workflows/ci.yml` validates every ready pull request into `main` or a branch under `integration/`, and every push to those branches. The [contribution workflow](../../spec-workflow.md#^shared-branch-workflow) decides when that validation is needed. CI runs the same registry and runner as local and Blaxel runs ([test-runner.md](./test-runner.md)), divides its end-to-end tests with the shared shard plan ([sharded-execution.md](./sharded-execution.md)), and skips heavy jobs for an already attested tree ([attestation.md](./attestation.md)).

## When it runs

Draft pull requests run nothing, including the join described below; marking a pull request ready starts validation. A new run for a pull request cancels the run it supersedes. Pushes are not cancelled.

Every run that is not for a draft runs lint, type-check, the package manifest checks and the [vibe-mode check](./test-runner.md#^verify-vibe-mode). The heavy jobs, which are unit tests, desktop end-to-end tests, the build and the end-to-end shards, run unless an attestation lets them skip.

## Required checks

The repository's ruleset for `main` and `integration/**` requires the checks `lint`, `type-check`, `package-manifests`, `unit`, `e2e:desktop` and `e2e-required`. People maintain that ruleset in GitHub's settings, so these job names are a contract with it. Renaming a job, or making one stop reporting, blocks merges or silently drops a requirement unless the ruleset changes with it.

`e2e-required` stands for the whole end-to-end matrix. On every run that is not for a draft it runs whatever happened upstream, and it passes only when all of these hold:

- the build and every shard succeeded, counting the successful no-ops of an attested skip;
- the vibe-mode job succeeded, so an attested tree is not exempt from that check;
- when the shards ran tests, they agree: each index from 1 to the shard total appears once, all ran the same plan on the same commit, tree and total, and each collected exactly its assigned files.

An authorized attested skip needs the successful build and shard no-ops and a successful vibe-mode check; it produces no shard reports, and none are required. Missing, skipped, cancelled or failed dependencies fail the join, so a job skipped by an upstream failure is never read as success.

## Jobs

The `unit` and `e2e:desktop` jobs run `npm test -- local` with `--suite unit` and `--surface e2e:desktop`. The end-to-end shards cover the `e2e-ci` suite: every end-to-end surface except Electron, which the desktop job covers. Each shard job computes the plan for itself and runs its index with the shared shard worker directly. Because that bypasses `npm test`, the shard jobs pass the runner's retry budget explicitly. The matrix has 16 shards; a measured run with 24 shards finished under 20 seconds sooner for about a quarter more runner time. The shard total appears in the job names, the plan and the join's expectation, which change together.

### Build once

One build job runs the deduplicated build recipes declared in `test.prebuilt.mjs`. Every surface's build step is covered by exactly one recipe, and the build job fails otherwise. The job then uploads every untracked file and symlink in its workspace, except `node_modules`, `.git` and `.test-runs`, as a tar archive that keeps file modes; the artifact service drops modes, and tests run the built CLI directly. Each end-to-end shard takes tracked files from its own checkout, dependencies from its cache and build output from the archive, and skips its surfaces' build steps. A missing or broken archive fails the shard, with no fallback build. No list of build outputs is kept anywhere, so a new output ships because it exists. ^gha-prebuilt-partition

That arrangement places limits on builds and on what shards may assume:

- A build must not leave a tracked file with content different from the commit, because shards take tracked files from their checkout and would never see the change. The build job checks this after the recipes.
- The archive only adds files. It carries no deletions and no empty directories, and nothing a build writes inside `node_modules`.
- The desktop job runs its own build steps and does not depend on the build job, so a build failure cannot hide desktop results.

### Dependency and browser caches

Every job that needs dependencies restores an exact-keyed cache of every `node_modules` directory a clean install produces, and skips `npm ci` on a hit. The key covers OS, CPU architecture, Node major version, the runner image and a hash of `package-lock.json` (and `packages/skills/package.json`). There is no fallback to a near match, because a hit must be equivalent to a fresh `npm ci`.

End-to-end shards restore one archive holding dependencies and Playwright's Chromium and Firefox. Its key also includes the hosted image's concrete `ImageOS` and `ImageVersion`, because `ubuntu-latest` names a moving image. Only the build job writes that archive, after proving both browsers launch. GitHub rolls new images out gradually, so a shard can land on a newer image than its build. On a miss, the shard installs dependencies and browsers for itself and records the fallback rather than failing. Each shard also launches both browsers before testing, because a launch in the build job on another machine does not prove the shard's host. The cache namespace, currently `shard-readiness-v2`, must be raised when the cached browsers or paths change without changing the key's inputs.

### Run artifacts

Every test job uploads its complete run directory as `test-run-<run-id>`, including hidden files, even when tests fail, and keeps it for 30 days. A job finds its run directory through `--run-dir-output` ([reporting.md](./reporting.md#run-directory)), never by listing `.test-runs/`.

### Browser worker counts

`e2e:browser-app-real-stack` runs one Playwright worker. With two, its product-server tests failed when their servers competed on the 2-vCPU hosted machine, although each passed alone.

## Testing guidance

No repository test can use GitHub's cache and artifact services. A change that could disturb CI mechanics, such as caching, the build transfer, browser preparation or failure propagation, therefore needs a live run of a complete isolated copy of the CI graph, only on the branch that carries the change. The copy passes scratch `cache-namespace` values to both setup actions, and its cache entries are deleted afterwards to protect the repository's shared cache quota. An isolated copy cannot report checks under the production job names, so the first production run after the change merges must show the required checks under the names the ruleset expects.

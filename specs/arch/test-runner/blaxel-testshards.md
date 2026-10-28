*Blaxel: the pool of persistent remote workers that runs broad validation, how runs from many branches and repositories share it safely, and how to set it up.*

# Blaxel test shards

Blaxel is the recommended way for people and agents to run broad validation during development, including `npm run verify -- blaxel`. A pool of persistent sandboxes is kept ready with browsers, the Node runtime and dependencies installed, so a run pays almost no setup and a full verification usually takes about three minutes. Even a run on one worker takes its load off a shared development host. `npm test -- blaxel` drives the coordinator, `scripts/run-blaxel-testshards.mjs`, and `npm test -- pool blaxel` manages the pool.

Every branch and checkout that uses the pool runs its own revision of the runner, and several repositories use it. Much of this spec is therefore the protocol that lets those runs share workers safely, and changes to it must stay compatible with revisions still in use.

How a suite run is divided into shards and how shard outcomes combine are owned by [sharded-execution.md](./sharded-execution.md). Resource evidence and recovery receipts are owned by [reporting.md](./reporting.md#resource-diagnostics). The Node version workers use comes from [node-versions.md](../node-versions.md).

## Pool

Workers are sandboxes labelled `project=television`, `purpose=testshards`, `pool=<name>` and `arch=x64`. The coordinator uses only `DEPLOYED` workers of the requested pool, checks that each is x64 Linux before use, and fails if there are fewer workers than shards. The runner uses the pool `poc`.

Blaxel's account tier allows at most 75 workers to run at once. The pool has 72 workers and a standard run uses 36 shards, so two verifications fit side by side within that limit. Suite runs refuse other shard counts unless `--allow-shard-count-override 1` is passed.

Provisioning is fresh-only: `ensure` creates and provisions every worker of an absent pool and refuses a pool that already has workers. Blaxel's create-if-absent call applies a sandbox specification only when the sandbox does not exist, so it cannot update an existing worker, and the pool manager does not try to reconcile unknown runtime state. A new worker installs nvm and the Node version selected by the repository's `.nvmrc`. It becomes eligible for test runs only after provisioning and its architecture check succeed. To change worker provisioning, delete the pool and ensure it again.

## Repository and credentials

Workers fetch the commit under test from GitHub, from the repository the invoking checkout calls `origin`. The URL is normalized to `https://github.com/<owner>/<repository>.git` without embedded credentials, and a URL that is not a GitHub repository fails before dispatch. A checkout of the public repository therefore tests against it, and a checkout of a private development repository tests against that, with no option.

One pool serves several repositories. Each worker keeps a single checkout at `/workspace/television`, points its `origin` at the run's repository and fetches what it lacks; dependencies are reinstalled only when the dependency declarations differ. Repositories that share a pool share a trust boundary: a run can read the Git objects and ignored files that earlier runs of other repositories left on the worker.

Workers authenticate to GitHub with a token from `.blaxel-gh-token` in the repository root, or else `BLAXEL_TV_GH_TOKEN`; a run without one fails. The token must be able to read the run's repository. Workers receive it through the environment and use it through `GIT_ASKPASS`; it is never written to repository files or Git configuration.

## Leases

A shard attempt leases one worker for its whole life: from before checkout, through setup, tests and teardown, until its reports have been downloaded and checked. Releasing earlier would let the next run's checkout overwrite results that are still being read.

- The lease is `/tmp/tv-testshard.lock/owner.json` on the worker. Every change to it, whether acquiring, renewing, registering a dispatch, recovering or releasing, happens under a short `flock` on `/tmp/tv-testshard.guard` and rechecks the current owner first, so a delayed renewal or release can never overwrite a newer owner. The guard is never held during downloads.
- Only the coordinator renews. Each renewal sets `recoverAfter` to the worker's clock plus the recovery interval: 20 minutes by default, or `--lock-ttl-seconds`. An expired lease cannot be renewed, and a shard process cannot renew on behalf of a coordinator that has gone.
- Every process the attempt starts inherits `TV_TEST_SHARD_OWNER`, set to the lease's `lockId`, alongside each surface's own owner token ([test-runner.md](./test-runner.md#processes-started-by-tests)). The coordinator records a dispatch before requesting it. The remote entry point registers its PID and start time in the lease before touching the checkout, and only while the lease is still the dispatching coordinator's, so a delayed request cannot start work after recovery.
- Release requires that the attempt's processes are confirmed gone and its reports retrieved. A shell exit or a Blaxel process stop does not prove that descendants have exited. The coordinator audits for processes carrying the attempt's tokens and stops survivors, validating PID and start time before each signal. If the audit cannot be read, the dispatch outcome is unknown, or an owner survives, the worker stays leased and is not reused for the run's retries.
- On `SIGINT` or `SIGTERM`, the coordinator writes an interrupted report that keeps whatever it has already retrieved, cleans up, and exits `130`; a second signal exits at once. A lease it cannot release safely is left for recovery.

Other revisions read the lease, so the fields that decide ownership are shared across revisions:

```ts
// /tmp/tv-testshard.lock/owner.json; other fields belong to the writer
type WorkerLeaseRecord = WorkerLease | DeletionReservation;

interface WorkerLease {
  lockId: string;       // also the value of TV_TEST_SHARD_OWNER
  runId: string;
  attemptId: string;
  lastRenewal: number;  // worker clock, milliseconds since the epoch
  recoverAfter: number; // worker clock, milliseconds since the epoch
  expiresAt: 0;         // see Older runners
}

interface DeletionReservation {
  lockId: string;
  deleting: true;       // see Deleting workers
}
```

### Abandoned runs

A lease whose coordinator has stopped renewing for the recovery interval is abandoned, whether the coordinator died, hung or lost its connection. The next ordinary acquisition then, under the guard:

1. rechecks the record and its deadline;
2. stops only the abandoned attempt's processes, found by its tokens and validated by PID and start time;
3. confirms that no live or stale test owner remains on the worker;
4. removes the abandoned scratch and the known leftovers listed under [Temporary files](#temporary-files);
5. discards the abandoned attempt's undownloaded reports;
6. takes the lease.

It writes a recovery receipt describing the previous run, its deadline, the processes stopped and the reports discarded into the new attempt's evidence. Discarded reports can never count as a pass for the abandoned run. Expiry authorizes cleanup, never running beside live processes: if the owners cannot be identified or stopped, the worker is held and reported for an operator. An unreadable or incomplete lease record is reclaimed only after a clean audit of the worker. A coordinator that returns after losing its lease cannot renew, release, dispatch or touch the attempt; it reports an infrastructure failure.

### Older runners

**Transitional, while branches still run a runner that predates this lease protocol.** Those runners keep a single `expiresAt` deadline in seconds and reclaim a lock once that time has passed. New records set `expiresAt: 0`, which older runners never treat as passed, so they leave current leases alone. A current runner respects a legacy record until its `expiresAt` passes, then acquires only after a clean audit of the worker. Older runners release before downloading their reports, so the lease cannot protect their results; a branch gets that protection when it takes up the current runner.

### Deleting workers

`npm test -- pool blaxel delete` follows the lease rules. It refuses workers with unexpired leases and reserves an idle worker only after a clean audit, by replacing the lease with a `DeletionReservation`. Every acquisition refuses a reserved worker, whatever its audit finds. It may destroy a worker whose lease has expired even if process cleanup failed, because deleting the sandbox is the cleanup. Before deleting, it removes the worker's eligibility for test runs, so a slow or failed deletion cannot admit a new run. A worker that cannot answer the ownership check is held for operator repair. A new worker that was never made eligible for test runs may be deleted without a lease.

## Temporary files

Worker `/tmp` is memory-backed, and Chromium keeps its shared memory there, so temporary files cost memory, not just disk. Each shard attempt gets a fresh private directory under `/tmp/tv-testshards/`, named for its run, shard, attempt and lease, and `TMPDIR` points inside it for everything the attempt runs. The path stays short enough for browser Unix sockets. Persistent caches for npm, Electron, browsers and dependencies stay where they are. ^blaxel-scratch

Once it holds the lease and no earlier execution remains, a run removes only:

- directories directly under `/tmp` named `television-source-cli-e2e-*` or `television-web-bundle-*`: generated runtimes that test helpers on some branches leave behind;
- earlier attempts' directories under `/tmp/tv-testshards/`.

Removal rejects unexpected mount boundaries and does not follow links out of these locations. The current attempt, the lease and guard, unrelated temporary files, the checkout and persistent caches are kept. The run reports what it removed and the free space before and after.

After the attempt, whether it succeeded, failed, timed out or was interrupted, the worker stops the attempt's processes, moves its evidence out of scratch and removes the attempt's directory, still holding the lease until download. Deleting files does not free Chromium's open, unlinked shared memory; only stopping the processes does. If teardown is uncertain, scratch is kept, and if cleanup fails the worker takes no new tests until a later cleanup succeeds. Workers keep only the current attempt's results and diagnostics under `/workspace/television/.testshards/results`; no archive accumulates on them.

## Runs

A selection made with `--surface`, `--file` or `--grep` must resolve to one surface, and runs as a single targeted shard. The suites `all`, `unit` and `e2e`, and selections by package, runner or tag, are divided across shards ([sharded-execution.md](./sharded-execution.md)). Other suites are refused.

Either way, a Blaxel run uses the same registry declarations as a local run, including build steps, services, wrapper commands and the runner's retry budget. That way a remote result stands for the local one. Each worker activates the Node version in the checked-out `.nvmrc` before installing or running anything.

The coordinator is the invoking checkout's revision of the runner, and each worker runs the tested commit's. When they differ, as they can with `--commit`, everything that passes between them crosses revisions: the registry and duration baseline the coordinator reads from the tested commit, the plan and worker command it sends, and the shard summary it reads back. A change to any of these should keep working with revisions still in use. Where it cannot, the mismatch must fail the shard or the run as an infrastructure problem and never be read as test results.

Before tests, each worker looks for stale owner tokens ([test-runner.md](./test-runner.md#processes-started-by-tests)). A worker that finds them runs no tests for that attempt, and the coordinator excludes it from the run's later attempts. An infrastructure retry may use a different worker once that worker has its own lease and a clean audit. Without a clean worker to use, the shard stays infrastructure-failed.

## Setup

Running Blaxel shards needs a Blaxel account with the CLI logged in:

```bash
brew install blaxel
bl login
```

The GitHub token is in the 1Password item **“Television Blaxel sharded test runner github PAT”**. Export it as `BLAXEL_TV_GH_TOKEN`, which works across worktrees, or write it to `.blaxel-gh-token` in the repository root. Creating `~/.tvdev-use-blaxel` makes the host a [marked host](./test-runner.md#^blaxel-host-marker), so that verify uses Blaxel by default.

To provision the pool, delete it and recreate it, which needs the pool to be idle:

```bash
npm test -- pool blaxel delete --pool poc
npm test -- pool blaxel ensure --pool poc
```

Deletion reports any worker it refused and exits nonzero if any requested worker remains. `npm test -- pool blaxel list --pool poc` shows the pool. Without `--pool`, these commands act on a pool named `default`, which the runner does not use.

## Testing guidance

A change that could affect the coordinator's remote operation needs a live Blaxel run before it reaches `main`; recorded responses cannot stand in for one. One targeted run is enough to exercise the API, the transport, leasing, setup, log streaming and result download. Runs that check other changes:

- a planned suite run checks a change to how plans reach workers, since a targeted run carries no plan;
- freshly provisioned workers on a dedicated pool check a change to provisioning or runtime selection, leaving the shared `poc` workers alone;
- runs from checkouts of two repositories on one pool, including a worker whose checkout last served the other repository, check a change to repository selection or switching.

Recovery and cleanup experiments use disposable processes on a dedicated pool and never contaminate shared workers. Temporary-file placement is shown only by observing, on a live worker, the files Node creates and Chromium's shared-memory descriptors under the attempt's `TMPDIR`.

The automated live qualification is the `experiment:blaxel-harness` surface, with the fixtures it dispatches in `experiment:blaxel-harness-fixtures`. Both stay out of `all` and CI. The driver runs only on a dedicated, credentialed Blaxel coordinator sandbox outside every worker pool, never on a shared development host or a leased worker. It runs from a committed and pushed checkout, with `TV_BLAXEL_HARNESS_COORDINATOR` naming that sandbox and `TV_BLAXEL_HARNESS_POOL` naming a disposable pool it owns, deletes and recreates. The runner refuses the driver on Blaxel, inside a leased worker, or without both names; choosing the right sandbox is the operator's job. Its usage is in `test/runner-fixtures/blaxel-harness/README.md`. ^blaxel-harness-placement

*How suite runs divide test files among parallel machines, the committed durations that balance them, and how shard outcomes combine into one honest result.*

# Sharded execution

Blaxel suite runs and GitHub CI's end-to-end matrix divide the selected test files among parallel machines, called *shards*, and combine what each shard reports. Both use the shared shard worker, `scripts/run-test-shard.mjs`. The rules here make that division complete and reproducible, so that a passing result means every selected file ran exactly once. Blaxel's own coordination is owned by [blaxel-testshards.md](./blaxel-testshards.md), and the CI workflow by [github-ci.md](./github-ci.md).

## Plans

Before any shard runs, a *shard plan* assigns every selected test file to exactly one of the run's shards. Files are never split between shards.

- The file inventory comes from the files tracked in the tested commit and the registry's ownership rules. Planning never imports runner configs or test modules, and never looks at the coordinator's own working tree.
- Each shard runs exactly its assigned files. After the native runner has collected tests, the shard checks that it collected exactly those files and no others; any difference fails that surface as an infrastructure problem. A shard with no files for a surface skips that surface entirely: no build step, services or runner start.
- Plans are deterministic. The same commit, selection, shard count, timing provider and baseline give the same plan, identified by a digest of its content. This matters because each GitHub CI matrix job computes the plan for itself, and CI's required join then checks that every shard ran the same plan and collected exactly its files ([github-ci.md](./github-ci.md#required-checks)). The Blaxel coordinator computes the plan once and sends it with each shard; the worker checks it before running anything.
- Shards are balanced by expected duration from the baseline below. A file with no recorded duration is weighted as expensive, so that new files spread across shards instead of collecting on one that looks cheap. Predictions add up per-file durations and leave out per-surface startup and runner parallelism, so they guide the balance but do not predict wall time.
- The plan is fixed for the whole run. Shards do not pull work from a queue, and an infrastructure retry reruns the same assignment.

## Duration baseline

`test/timing-baseline.json` holds a duration for each test file, measured on Blaxel. It is the median planning duration, which leaves out time spent on retry attempts ([reporting.md](./reporting.md#timing-records)). Only complete observations of a file that finally passed supply samples; that includes recovered flakes. Failed and incomplete observations supply none, so failures and flake overhead do not inflate the weights. Every plan, including GitHub CI's, balances with these Blaxel measurements, because balance depends on the files' relative cost rather than their absolute time.

The baseline changes only when a person runs `npm test -- baseline update` in a checkout that holds recent Blaxel run directories, reviews the diff and commits it. Test runs and CI never edit it. The update recomputes every entry from the runs it reads and carries nothing forward, so it reads only complete Blaxel runs of the full suite: a partial run would erase the measurements of every file it did not run. With no such run available, the command fails without touching the file. `--dry-run` shows the change without writing it.

The update also prints a recommended Blaxel shard count: the smallest count whose busiest shard has at most two minutes of predicted test work. A person changes the configured shard counts after reviewing the recommendation; no run changes its own shard count or pool demand.

## Shard outcomes

Each shard ends `passed`, `failed` or `infra-failed`. What decides it is whether the shard completed, before any individual test result.

- `infra-failed`: the shard's execution or evidence is incomplete. Examples are a setup failure, a plan or collection mismatch, a transport failure, an interruption, a missing or unreadable summary, or a passed summary with no known exit status. Reaching the tests, or recovering some results, does not make a shard complete. On Blaxel an infrastructure failure is retried up to twice with the same assignment. A completed retry supersedes the failed attempt, whose evidence stays in the run's attempt history.
- `failed`: the shard completed and reported a failed test or a process leak. A completed shard whose summary says it passed but whose exit status was nonzero is also `failed`; that contradiction invents no failed test, but leaves the run incomplete. Failed shards are never retried, because rerunning would hide a real result.
- `passed`: the shard completed with a passed summary and a zero exit status.

The run's result takes each shard from its latest attempt. Its list of failed tests comes only from those final shard results, so failures seen in a superseded attempt do not reappear. If a shard is still infrastructure-failed at the end, the run is incomplete: its known passes and failures are reported, but its overall test status is unknown ([reporting.md](./reporting.md#honest-status)). Regular GitHub CI has no retry coordinator; an infrastructure-failed matrix shard fails its job and the required join.

## Testing guidance

Only a live planned Blaxel suite run shows that workers receive and execute the plan the coordinator sent; a targeted run carries no plan. Only a live CI run shows that independently started matrix jobs derive the same plan; the isolated CI run in [github-ci.md](./github-ci.md#testing-guidance) supplies that evidence.

*What every test run leaves behind: the run directory, a compact summary for people and agents, honest status, timing records, and resource diagnostics from Blaxel workers.*

# Reporting

Every test run, whether local, on Blaxel, or in a GitHub CI job, leaves results in one shape. A compact summary tells people and agents what failed. Detailed files support debugging, and timing records feed the planning of later runs ([sharded-execution.md](./sharded-execution.md#duration-baseline)).

## Run directory

Each run writes a *run directory*, `.test-runs/<run-id>/`, in the checkout. Run IDs are unique even across concurrent processes and hosts. The directory holds:

- `summary.json`, the compact summary, whose path the command prints at the end;
- `results.json`, with one normalized result per surface that has evidence;
- `events.ndjson`, the timing records;
- `logs/`, `native/` (the Vitest and Playwright reports) and, for Blaxel, `provider/`.

Files are written atomically. A run that fails before any test still writes its summary, recording the failure it reached. The local runner owns the directory of a local run. For a Blaxel run, the coordinator's caller writes one combined directory after downloading each shard's parts. Each GitHub CI test job writes its own.

`--run-dir-output <file>` makes a run write the absolute path of its own run directory into the caller's file as soon as the directory exists, before preflight. Orchestration such as CI reads that file instead of searching `.test-runs/`, where tests themselves create other run directories.

## Honest status

The summary answers three questions separately:

- `infraStatus`: did the infrastructure deliver complete evidence for the selection? `completed` or `incomplete`.
- `testStatus`: did the tests pass? `passed`, `failed`, or `unknown` whenever the evidence is incomplete.
- `status`: the run as a whole. It is `incomplete` whenever the evidence is incomplete, and otherwise equals `testStatus`.

Reports state only what was observed. Known failures, passes, recovered flakes and skipped work stay visible in an incomplete run. Missing work is never counted as run, and an unreadable result never becomes a failed test. Nothing claims that a selection passed or failed as a whole without evidence for all of it.

A process leak fails each surface it belongs to and marks it incomplete, because cleanup was not clean; the leak appears beside that surface's test results. A recovered flake leaves its test passed and is listed with its attempts. Vitest's own JSON report does not record individual retry attempts, so Vitest runs use the repository's attempt recorder, and the recorded attempts are the only evidence of a Vitest recovery. Failure messages are never read as attempts.

## The compact summary

`summary.json` is written so that an agent can read it without flooding its context. It lists failed tests, recovered flakes and process leaks, and gives passing tests only as counts. Each listed test has its file, line, title, attempts, whether it was annotated flaky, and a short error excerpt. Each leak keeps its PID, command, owning surfaces and listening sockets, since those identify the harness that leaked. Detailed evidence stays in the other files.

## Timing records

`events.ndjson` records the run, its shards, surfaces and files, and every test attempt, with durations and setup phases. The same input gives the same bytes. Phases cover every step that can cost tens of seconds, such as worker wake-up, checkout, dependencies, browser readiness, planning, tests, report download and verify's phases, so that slow setup is visible. The summary repeats the phases.

Recording phases and other diagnostics is best-effort: a failure to record or upload them is a warning and never changes a command's or a test's result.

## Nothing secret

GitHub CI uploads run directories as workflow artifacts, which anyone who can read the repository can download. Run directories therefore never contain credentials. The timing records contain no environment values, command arguments, output or error text, and process records give the executable without its arguments.

## Resource diagnostics

Blaxel workers have memory-backed temporary storage, and tests there can die of memory exhaustion. Each Blaxel surface execution therefore records, at its start and end:

- available memory;
- shared memory in use;
- free space on its temporary filesystem;
- the kernel's out-of-memory kill counter.

The start is saved before the surface prepares, so a crash during the surface still leaves it. When a native attempt failed or the evidence is incomplete, the record adds the kernel's out-of-memory messages from that interval. Readings that could not be taken are recorded as unavailable, never as zero. These records give context and a change in the kill counter. They do not measure peak memory, and a missing kernel message does not prove that no kill happened. ^resource-diagnostics

Each record identifies its run, shard attempt and surface, and the surface's result links to it. Records survive retries and download, and an infrastructure retry does not overwrite the records of the attempt it superseded. They are bounded per surface and per shard attempt so they cannot exhaust a worker, and they never change a test outcome. A [recovery](./blaxel-testshards.md#abandoned-runs) leaves a receipt among the new attempt's records under the same bounds. The receipt says which run was abandoned, which processes were stopped and whether undownloaded reports were discarded.

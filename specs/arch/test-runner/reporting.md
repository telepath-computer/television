*What every test run leaves behind: the run directory, a compact summary for people and agents, honest status, timing records, and resource diagnostics from Blaxel workers.*

# Reporting

Every test run, whether local, on Blaxel, or in a GitHub CI job, leaves results in one shape. A compact summary tells people and agents what failed. Detailed files support debugging, and timing records feed the planning of later runs ([sharded-execution.md](./sharded-execution.md#duration-baseline)).

## Run directory

Each run writes a *run directory*, `.test-runs/<run-id>/`, in the checkout. Run IDs are unique even across concurrent processes and hosts. The directory holds:

- `summary.json`, the compact summary, whose path the command prints at the end;
- `results.json`, with one normalized result per surface that has evidence;
- `events.ndjson`, the timing records;
- `logs/`, `native/` (the Vitest and Playwright reports) and, for Blaxel, `provider/`.

Files are written atomically. Once a run directory exists, a run that fails still writes its summary with the failure it reached, even when no test ran. The local runner owns the directory of a local run and creates it before local preflight. For a Blaxel run, the canonical runner creates the directory once the dispatch checks have passed, and writes one combined report after downloading each shard's parts. Each GitHub CI test job writes its own. A guardrail refusal, or a Blaxel run refused by its dispatch checks, leaves no run directory.

`--run-dir-output <file>` makes a run write the absolute path of its own run directory into the caller's file as soon as the directory exists. Orchestration such as CI reads that file instead of searching `.test-runs/`, where tests themselves create other run directories.

## Honest status

The summary's `run` block answers three questions separately:

- `infraStatus`: did the infrastructure deliver complete evidence for the selection? `completed` or `incomplete`.
- `testStatus`: did the tests pass? `passed`, `failed`, or `unknown` whenever the evidence is incomplete.
- `status`: the run as a whole. It is `incomplete` whenever the evidence is incomplete, and otherwise equals `testStatus`.

Reports state only what was observed. Known failures, passes, recovered flakes and skipped work stay visible in an incomplete run. Missing work is never counted as run, and an unreadable result never becomes a failed test. Nothing claims that a selection passed or failed as a whole without evidence for all of it.

A process leak fails each surface it belongs to and marks it incomplete, because cleanup was not clean; the leak appears beside that surface's test results. A recovered flake leaves its test passed and is listed with its attempts. Vitest's own JSON report does not record individual retry attempts, so Vitest runs use the repository's attempt recorder, and the recorded attempts are the only evidence of a Vitest recovery. Failure messages are never read as attempts.

## The compact summary

`summary.json` is written so that an agent can read it without flooding its context. It lists failed tests, recovered flakes and process leaks, and gives passing tests only as counts. Each listed test has a short error excerpt alongside the fields below. Each leak keeps its PID, command, owning surfaces and listening sockets, since those identify the harness that leaked. Detailed evidence stays in the other files.

People, agents and scripts read these fields, including from earlier runs:

```ts
// summary.json; other fields belong to the writer
interface RunSummary {
  schemaVersion: 1;
  run: {
    id: string;
    status: "passed" | "failed" | "incomplete";
    infraStatus: "completed" | "incomplete";
    testStatus: "passed" | "failed" | "unknown";
  };
  failedTests: SummaryTest[];
  flakyRecoveredTests: SummaryTest[];
  processLeaks: Array<{
    pid: number;
    command: string; // the executable, without arguments
    owningSurfaceIds: string[];
    listeningSockets: Array<{ host: string; port: number }>;
  }>;
}

interface SummaryTest {
  surfaceId: string;
  file: string;
  line: number | null;
  title: string;
  attempts: number;
  flakyAnnotated: boolean;
}
```

## Timing records

`events.ndjson` records the run, its shards, surfaces and files, and every test attempt, with durations and setup phases. The same input gives the same bytes. Phases cover every step that can cost tens of seconds, such as worker wake-up, checkout, dependencies, browser readiness, planning, tests and report download, so that slow setup is visible. The summary repeats the phases.

Later invocations read earlier runs' event streams. `npm test -- baseline update` ([sharded-execution.md](./sharded-execution.md#duration-baseline)) validates the stream of every Blaxel run of the full suite it finds in `.test-runs/` and stops on one it cannot read, and those runs may come from earlier revisions of the runner. A revision that changes the stream must therefore keep accepting streams with `schemaVersion: 1`, or introduce a new version and decide how the update treats older runs.

The update checks every event before using any. Each event carries `schemaVersion: 1`, the run's `runId` and a zero-based `sequence` equal to its line position. Every event except a `process-leak` event carries one of the statuses below. Blaxel runs record the timing provider `blaxel-playwright-x64-4vcpu`, and the update reads only runs with that identity. Beyond that envelope, the update uses these fields:

```ts
// events.ndjson: one JSON event per line, the run event first; other fields belong to the writer
type EventStatus = "passed" | "failed" | "skipped" | "timed-out" | "interrupted" | "not-assigned" | "incomplete" | "unknown";

interface EventEnvelope {
  schemaVersion: 1;
  runId: string;    // the same on every event of a run
  sequence: number; // zero-based line position
}

type TimingEvent = EventEnvelope & (
  | {
      kind: "run";
      status: "passed" | "failed" | "incomplete";
      commandProvider: "local" | "blaxel" | null;
      timingProvider: string; // "blaxel-playwright-x64-4vcpu" for Blaxel runs
      completedAt: string;
      selection: { suite?: string; surfaces?: string[]; files?: string[]; grep?: string | null };
    }
  | { kind: "shard"; status: EventStatus; index: number; total: number }
  | { kind: "surface"; status: EventStatus; surfaceEventId: string; surfaceId: string }
  | {
      kind: "file";
      status: EventStatus;
      surfaceEventId: string;
      path: string;               // repository-relative
      complete: boolean;          // false when the native report cannot account for every attempt
      planningDurationMs: number; // the file's duration without its retry attempts
      retryCount: number;
      recoveredFlakeCount: number;
    }
  | { kind: "test-attempt"; status: EventStatus }
  | { kind: "process-leak" }
);
```

The event stream and the initial summary are required parts of a run: failing to write them fails the command. Optional diagnostics are best-effort whenever they are collected. They include resource probes, metrics that GitHub workflows record, and phases appended later; verify, for example, adds its own phases to its test run's summary after the test command finishes. A failure to record or upload a diagnostic is a warning and never changes a command's or a test's result.

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

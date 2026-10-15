# Blaxel result retrieval can race the next checkout

Follow-up identified while investigating Chromium resource failures. This item is outside draft PR #12's cleanup implementation. No observed Chromium failure has been attributed to this race. No change to the lease protocol is authorized by this document.

## Evidence and consequence

At `b5477211`, `scripts/run-blaxel-testshards.mjs` does the following:

1. The remote shard script's `EXIT` trap releases `/tmp/tv-testshard.lock` at shell exit.
2. `runShard()` waits for that remote process to finish, then downloads the summary and artifacts from `/workspace/television/.testshards/results`.
3. A new lease can start another checkout, whose preparation removes `.testshards`, before the prior coordinator finishes downloading.

The source establishes an unprotected interval, not an observed collision. A collision could lose the previous job's evidence or make it encounter another job's files. Existing report identity validation remains necessary but cannot recover deleted evidence.

## Scope for a separate proposal

Assess retaining the existing lease through retrieval versus using immutable attempt-specific report locations, with bounded orphan retention in either case. Work through coordinator interruption, download failure, worker reuse, and compatibility with older branches that still unlock at shell exit and reset the fixed results root. Compare the smallest correction before adding lease machinery.

TTL recovery is a separate availability decision. The current lock lives 900/1200 seconds against a worker timeout of 240/480 seconds; the Blaxel spec deliberately leaves uncertain cleanup to TTL as a final bound. Whether the provider can leave a supervisor alive beyond that timeout remains unproven. Replacing TTL with indefinite quarantine would require Josh to choose its availability cost and an explicit operator recovery procedure. Scratch ownership checks do not require that policy change.

The cleanup proposal preserves the existing results location and lease behavior. Its diagnostics inherit this download-race limitation. This follow-up has no assigned implementation or rollout date.

**FAIL — the rewrite is substantially clearer, but several shortened statements change the contract or claim more than the implementation delivers.** Findings 1–7 should be resolved before accepting these specs. Findings 8–10 are smaller corrections and refinements.

I reviewed the six rewritten specs at `f71b1f7d`, all nine predecessor specs at `d2837551`, the statement ledger, the spec policy, and the relevant implementation and neighboring specs. This is a review of the specifications, not a request to redesign the runner. I ran no tests and made no code changes. The separate PASS for the integration through `d2837551` still stands.

The six-file organization works. Removing the normalized helper interfaces, detailed scheduling formula, procedure-by-procedure test plans, and retirement history makes the material easier for a human to own. The safety rules for local contention, process attribution, leases through download, and abandoned-run cleanup still have identifiable purposes. Shared state read by other runner revisions also justifies some precise types; precision itself is not the problem. I would keep those gains and correct the following points.

1. **The persisted reporting contract has disappeared along with the internal types.** Place: [reporting.md](../../../specs/arch/test-runner/reporting.md), lines 9–38, and [sharded-execution.md](../../../specs/arch/test-runner/sharded-execution.md), lines 19–21.

   The rewrite names the output files and describes their contents, but removes their versioned shapes. It does not even say that the three status fields live under `summary.run`. More consequentially, `baseline update` reads `events.ndjson` left by earlier runs, validates its schema, and uses its identities, completion flags and planning durations. That is persisted data read by a later invocation or revision, precisely the kind of contract the spec policy distinguishes from internal helper types. Code that changes the event shape can otherwise invalidate the history the documented update command is supposed to consume. Ledger P4 and P9 identify consumers but do not account for this loss.

   Keep a small, explicit, versioned contract for the report fields callers consume and the persisted timing and baseline records used across runs. State the nesting of the summary statuses and the event fields required by baseline update. Leave private normalization helpers, temporary provider objects and function signatures to code. This does not require restoring the old 429-line reporting spec, but prose saying “one shape” cannot replace the shape at this boundary.

2. **The required join contradicts the attested-skip path.** Place: [github-ci.md](../../../specs/arch/test-runner/github-ci.md#required-checks), lines 17–23.

   The join passes “only when all” listed conditions hold, including every shard agreeing on its plan and collected files. An attested skip deliberately runs no shards and produces no such reports. The first bullet allows successful no-ops, but the third bullet still requires evidence those no-ops do not produce. This conflicts with [attestation.md](../../../specs/arch/test-runner/attestation.md#skipping-in-ci), line 62, and the workflow's explicit skip of artifact download and agreement validation (`.github/workflows/ci.yml:585–610`). The old contract made that exception explicit.

   Change the third bullet to: “When tests execute, the shards agree: each index …”. Then say: “An authorized attested skip needs the successful build and shard no-ops and a successful vibe-mode check; it does not require shard reports.” Keep the existing failure rule for missing or failed jobs.

3. **“Median duration” loses the deliberate treatment of retries and failed observations.** Place: [sharded-execution.md](../../../specs/arch/test-runner/sharded-execution.md#duration-baseline), lines 19–21; ledger X8–X9.

   The baseline is not simply the median of measured file durations. The previous specs and implementation use complete files that finally passed, including recovered flakes, and subtract time spent in retry attempts. `scripts/test/reporting.mjs:305–327` computes that planning duration; `scripts/test/timing-baseline.mjs:110–137` selects eligible observations. Taking the ordinary elapsed median is a reasonable derivation from the rewritten text, but it would feed failed attempts and flake overhead into shard weights. This is the meaning of the measurement, not an incidental scheduling formula.

   Add: “Each file's weight is the median planning duration of complete observations that finally passed, including recovered flakes. Planning duration excludes retry-attempt time; failed or incomplete file observations supply no duration sample.” The exact median implementation and unknown-file constants can remain in code.

4. **The accepted omission of Firefox outside GitHub CI has no owner.** Place: [test-runner.md](../../../specs/arch/test-runner/test-runner.md#the-test-registry), around lines 60–69; removal of `preflight.md`'s `playwright-firefox` rule.

   The previous spec explicitly allowed an unavailable Firefox executable to omit the Firefox projects outside GitHub Actions, while making that absence a configuration failure in GitHub CI. The rewrite drops this without relocating it. The behavior remains in `scripts/check-playwright-firefox.mjs` and `packages/web/playwright.config.ts:6–15`. A passing local browser selection therefore does not necessarily establish Firefox coverage. This matters to a reader deciding what the result proves, especially while product and UI specs explicitly require some Firefox acceptances. It is an accepted limitation, not a browser-installation implementation detail.

   Add a short capability note: “Outside GitHub Actions, browser configs may omit their Firefox projects when the installed Firefox executable is unavailable, with a skip diagnostic. GitHub CI requires Firefox and fails configuration when it is missing.” Preserve the current behavior explicitly; deciding to require Firefox everywhere would be a separate change.

5. **The run-directory promises do not match remote preflight.** Place: [reporting.md](../../../specs/arch/test-runner/reporting.md#run-directory), lines 16–18.

   The text promises a summary for failures before tests and says the identity file is written before preflight. But `runBlaxel` performs and asserts remote preflight before creating its run context or writing `--run-dir-output` (`scripts/test/cli.mjs:517–522`). Missing credentials or a dirty-tree refusal can therefore leave neither artifact. This overstatement was present in the predecessor too; retaining it does not make it accurate. An orchestrator following the spec would mistake an ordinary refusal for missing output from an admitted run.

   Scope the promise: “Once a run directory exists, failures retain a summary. Local execution creates it and writes the requested identity before local preflight. Blaxel dispatch preflight can refuse before a run directory exists.” There is no need to add artifact-producing machinery just to satisfy the broader sentence.

6. **Best-effort diagnostics have been broadened into best-effort report construction.** Place: [reporting.md](../../../specs/arch/test-runner/reporting.md#timing-records), lines 38–40; ledger P10.

   “Recording phases and other diagnostics” now never changes a command's result. The old contract distinguished required final report construction from later optional metrics appends and workflow sidecars. The implementation still makes that distinction: `scripts/test/run-context.mjs:131–134` writes the event stream and attaches phase metrics without a best-effort wrapper. A failure there can fail the command. The rewrite silently changes that outcome policy. It also says the event stream contains verify's phases and the summary repeats them, although `verify:tests` and `verify:total` are appended only to the summary after the event stream is sealed.

   Restore the distinction in a few sentences: “The event stream and initial summary are part of the finalized run artifact. Later phase appends, workflow metrics and resource probes are best-effort and do not change the underlying result. Verify's enclosing test and total phases are added to the summary after the test command finishes.” Do not require the implementation to swallow failures producing required evidence merely because optional diagnostics should be harmless.

7. **Process-capability preflight is presented as a guarantee on paths that do not run it.** Place: [test-runner.md](../../../specs/arch/test-runner/test-runner.md#processes-started-by-tests), line 164; ledger R39.

   The unqualified sentence says preflight verifies the backend and prevents execution without it. The deleted preflight spec expressly limited that probe to canonical local execution and planned workers, with targeted Blaxel and the non-plan diagnostic worker as exceptions. `scripts/test/planned-shard-worker.mjs:48` runs the probe; `scripts/test/supervised-command.mjs` does not. Blaxel setup supplies tools and audits owners, but that is not the same capability probe. The rewrite has converted a documented limit into an unsupported universal promise.

   State the scope: “Canonical local runs and planned shard workers check the process-inspection backend before tests. Targeted Blaxel and non-plan diagnostic execution do not run that probe; Blaxel supplies its prerequisites during worker setup.” Retain the prohibition on cleanup by process name or port. Extending the probe to other paths may be worthwhile separately, but it is not part of this rewrite.

8. **The no-failure-cap rule now also appears to prohibit an existing deliberate diagnostic mode.** Place: [test-runner.md](../../../specs/arch/test-runner/test-runner.md#retries), line 141.

   “Failing tests do not end a run early” is broader than the predecessor's prohibition on an automatic failure-count cap. The planned worker still accepts `--fail-fast` or `TEST_SHARD_FAIL_FAST=1` and marks the remaining assigned work skipped (`scripts/test/planned-shard-worker.mjs:24, 79–95`). The old sharding spec described that opt-in. The new sentence can be read as requiring its removal.

   Prefer: “Ordinary canonical runs impose no automatic failure-count cap, so independent work continues after a test failure.” If the diagnostic mode remains worth documenting, add only that deliberate early stopping retains the unexecuted assignment and cannot claim complete validation. A full description of the worker's options is unnecessary.

9. **The mutex format justifies a storage contract, not a particular update algorithm.** Place: [test-runner.md](../../../specs/arch/test-runner/test-runner.md#one-local-run-at-a-time), line 104; ledger R24.

   The shared path, SQLite table and JSON shape matter because other revisions read them. Requiring every change to use a compare-and-swap update goes further: an implementation using a short SQLite transaction to read, validate and update the same row could preserve the protocol and all observable behavior. The ledger's compatibility rationale does not distinguish those implementations. This sentence promotes the current method into an architectural restriction without establishing a need.

   Remove “Acquisition and changes are compare-and-swap updates of that row.” Keep atomic acquisition, identity-checked ownership changes, the shared representation, and the rule against holding a transaction while tests run. That preserves the actual interoperability and contention requirements.

10. **Several scoped defaults have become absolute statements.** Places: [test-runner.md](../../../specs/arch/test-runner/test-runner.md), lines 11, 136 and 148.

   These need small wording corrections, not implementation changes:

   | Place | Problem | Suggested correction |
   |---|---|---|
   | Line 11, “each override's name contains `against-test-guidance`” | The same spec documents `--force`; `--ignore-uncommitted` and the shard-count override also permit departures without that phrase. | Limit the naming statement to the host-protection and retry overrides it describes. |
   | Line 136, “5 in runner and CI runs” | `runnerEnv()` preserves an explicitly supplied `FLAKY_TEST_RETRIES`; `test/flaky-retries.ts` honors it. | “5 by default in runner and CI runs, unless `FLAKY_TEST_RETRIES` is supplied.” |
   | Line 148, tests “at the committed `HEAD`” | Verify forwards `--commit` when supplied (`scripts/test/cli.mjs:318–323`). The attestation spec itself discusses that non-publishing case. | “at the selected committed revision, `HEAD` by default.” |

I independently checked the current GitHub ruleset: the six required check names in the rewrite are correct. Keeping that correction, rather than the predecessor's claim that every concrete e2e shard name is required, is appropriate. The [live ruleset](https://github.com/telepath-computer/television/rules/24283591) requires `lint`, `type-check`, `package-manifests`, `unit`, `e2e:desktop` and `e2e-required`.

The ledger explicitly defers inbound-link repairs and proof derivation. I have not treated those unfinished later stages as defects in this assigned spec review, nor asked for a test run to validate prose. After the corrections, the next review should assess the revised statements and their interactions; the writer can then repair citations and derive the proofs under the standing workflow.

Primitive's automatic check reported that governing-decision retrieval was truncated, leaving possible decisions unchecked. That is not an all-clear or a complete source of authority. No specific conflict was supplied; the assessment above rests on the assigned revisions, repository policy, source and observed records.

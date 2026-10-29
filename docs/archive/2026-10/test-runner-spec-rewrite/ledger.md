> **Archived 2026-10 from PR #53.** This was the ledger of the test-runner spec rewrite; the specs merged as revised by the review responses at its end, and the proofs as described in its repair-phase section. It records why each statement in the rewritten specs is there and how each review finding was answered, including the alternatives rejected, which is found nowhere else. The body below is unchanged from its working state and is a clue to the change, not a record of it.

# Test-runner spec rewrite: ledger

This ledger records why each statement in the rewritten `specs/arch/test-runner/` specs is there. The specs were rewritten from an empty page under `specs/spec-policy.md`, following the spec-rewrite method's steps 1 and 3. The old specs are those at `bcc65d97`, the merge of #49 and #12. Later commits on this branch change no spec text.

The test for each statement: derivation from the code and the rest of the specs could not be trusted to get it acceptably right, or something outside this version of the product depends on it staying as it is. "Outside" here is mostly one of four things:

- other checkouts and branches running other revisions of the runner on the same host or the same Blaxel pool;
- people and agents who type the commands and read the output;
- GitHub settings and services that people maintain;
- Blaxel.

## Layout

The area is rewritten as a set, so that each fact has one owner.

| New file | Holds | Absorbs |
|---|---|---|
| `test-runner.md` | the command, guardrails, retries, verify, the registry, test processes and addresses | old `test-runner.md`, `test-registry.md`, `preflight.md`, `flaky-tests.md` |
| `blaxel-testshards.md` | the pool, repository and credentials, the lease protocol, recovery, temporary files, setup | old `blaxel-testshards.md` |
| `sharded-execution.md` | shard plans, the duration baseline, shard outcomes | old `sharded-execution.md` |
| `reporting.md` | the run directory, honest status, the compact summary, timing records, resource diagnostics | old `reporting.md` |
| `github-ci.md` | triggers, required checks, the join, build transfer, caches | old `github-ci.md` |
| `attestation.md` | the claim, writers, policy, skip wiring, pruning | old `attestation.md` |

Once the rest was cut, the registry, preflight and flaky-test content was each a few paragraphs, all about what the command does before and around a run. Keeping them as separate files would have made readers hunt across four files for one command's behavior. Their proofs under `proofs/arch/test-runner/` are now orphans, which the spec-link test reports until the proofs are re-derived.

## test-runner.md

**R1. One command; package scripts and direct native runs are not supported.** This is the design intent the whole area serves. Without it, derivation adds per-package scripts and invocations, which is the drift the runner exists to stop.

**R2. Ownership and pointers to the companion specs and the testing policy.** The policy asks for ownership where it would not be obvious. The testing policy owns permissions, and readers expect them here.

**R3. Guidance, not enforcement; the shared-host and retry overrides carry `against-test-guidance`; not a security boundary.** This design intent decides how far the checks go. Without it, an implementer would plausibly harden checks into authentication or host-wide policing. The shared phrase is a naming convention people and agents rely on, scoped to those overrides because `--force` and others do not carry it (review round 1, finding 10).

**R4. Providers: local runs the working tree; Blaxel runs a committed revision; CI is not a provider; only verify chooses automatically.** These define what a result means, which callers depend on.

**R5. Blaxel needs a clean tree and a commit on an origin branch; commit and push first; `--ignore-uncommitted`, `--commit`.** People must act on this, and the workflow spec links to it. The flag meanings are a command contract. Anchored `^remote-revision`.

**R6. Commands table.** These commands are the contract with people, agents, CI and the docs that name them. Each entry gives only its purpose and its owner.

**R7. Selectors, including how `--file` matches, that its matches must belong to one selected surface, that `--grep` alone does not narrow, and which commands default to `all`.** These are command-line contract. That `--file` is a substring filter unless exact is non-obvious, and people rely on it. Without the default sentence a reader would assume that `list` and `preflight` also start from `all` (per-file review round 1).

**R8. The runner resolves files itself, because Vitest and Playwright filters are not exact.** This is knowledge that would otherwise be lost. A derivation that passes the user's string through would silently run sibling files, breaking both the one-file limit and plan assignment.

**R9. Exit codes `0`, `1`, `2`, `130`, `143`, and `verify --plan` exiting `0` without verifying.** Scripts, CI and agents branch on these codes. `2` separates a refusal from a test failure.

**R10. A Blaxel command succeeds only with a passed normalized report.** This decision is about honesty. Trusting the coordinator's exit alone is a plausible derivation that would turn missing evidence into a pass.

**R11. The registry is the single declaration of surfaces; classification is never inferred from names.** This architectural decision makes everything else selectable. A derivation could plausibly infer kinds from paths.

**R12. Every test file under `packages/` and `test/` has exactly one owner, and an undeclared `vitest.config.ts`, `vitest.e2e.config.ts` or `playwright.config.ts` is an error.** This invariant guarantees that no test silently drops out of every run. The names matter because fixture configs with other names are deliberately unregistered (per-file review round 1).

**R13. `all` is unit plus end-to-end and means "the full suite" for verify, CI and attestation; agent, PostHog, daemon and experiment surfaces are outside it.** This defines the gate other specs depend on, and it records why each excluded class is excluded.

**R13a. Firefox projects are omitted with a warning outside GitHub Actions when Firefox is missing; GitHub CI requires it; Blaxel workers have none, so Blaxel runs cover Chromium only.** This is an accepted limitation that changes what a passing local or Blaxel result proves, which a reader would not derive from the registry. It was observed in Blaxel shard logs and native reports (review round 1, finding 4).

**R14. Daemon acceptance mutates the real global `tv` and user service, runs only on a designated host, and refuses without `TV_DAEMON_TEST_HOST=1`.** This is a contract with the people who run it, and a safety decision. The variable is set by hand.

**R15. `isolated-github-only` placement, the uncommitted operator workflow's name and variables, and that workflow's obligations.** The workflow is outside the repository and maintained by an operator, who depends on these exact names. The obligations are what make destructive fixtures safe there.

**R16. Shared-host intent: host health first; small, one-at-a-time local runs; broader work on Blaxel.** This design intent explains the guardrail family and sets its priority, so a human should own it.

**R17. The marker `~/.tvdev-use-blaxel`, found through `HOME`; unmarked hosts keep full local use.** People create the file and setup skills tell them to. Fork and contributor hosts depend on working without Blaxel. Anchored `^blaxel-host-marker`; `terms.md` cites it.

**R18. The one-file local limit on marked hosts, and that it counts uncommitted and untracked files.** This is the core guardrail decision. "Untracked counts" is a correction a derivation from committed inventories would miss. Anchored `^local-one-file`; the testing policy and the desktop harness cite it.

**R19. What the refusal offers: an equivalent Blaxel command, a local route for selections Blaxel cannot run, never acting for the caller.** This contract with agents is what makes the refusal usable. The local-only route was a real integration defect, found in review of this branch.

**R20. The broad-local override, and that `--force` does not lift the limit.** The testing policy and docs name this flag. Without the `--force` clause, a reader could plausibly treat `--force` as the master override.

**R21. The mutex: scope, when it is taken and held, and who does not take it.** These decisions shape every local run. Taking it on Blaxel dispatch, or releasing it before cleanup, are plausible wrong derivations. Anchored `^local-test-mutex`; the testing policy cites it.

**R22. Contention behavior: immediate refusal, the wait option, the contention bypass, advice not to kill another run, and how the options combine.** The flag names and behavior are command contract, cited by the testing policy and AGENTS.md. The combinations are where a derivation would most plausibly differ.

**R23. Staleness is by process identity, never elapsed time; the next run reaps leftovers and fails.** A time-to-live is the obvious derivation and would break long runs. The failure outcome matches the stale-owner rule.

**R24. The mutex's location and record are a cross-revision contract; the path rule ignoring `$HOME`; the pinned SQLite table and record; atomic acquisition, identity-checked changes, no transaction held during tests.** Checkouts at different revisions on one host read and write this record. The policy says to pin stored data another version reads. That the path ignores `$HOME` is non-obvious and load-bearing. The update method is left open (review round 1, finding 9).

**R25. Native-entrypoint refusal and `TV_TEST_AGAINST_TEST_GUIDANCE_DIRECT_NATIVE_RUN=1`; runner launches mark their environment.** People set the variable by hand, and the testing policy cites the route. The last clause keeps implementers from breaking the runner's own launches.

**R26. The full-suite shortcut is refused in favor of verify; `--force`; verify passes `--force`.** This decision keeps broad validation behind lint and type-check, and the forms that trip it are command contract.

**R27. The runner retry budget: 2 for non-unit surfaces, 0 for unit; `--retries`; recovered flakes pass and are reported.** These decisions define what passing means. Attestation and CI depend on the standard budget.

**R28. The zero-retry rule and `--against-test-guidance-turn-flakes-into-failures-on-broad-runs`.** This decision and flag are command contract, cited by the testing policy and contributor docs.

**R29. The per-test annotation: `FLAKY_TEST_RETRIES` (5 under the runner and CI unless the variable is set), the `flaky:` prefix that reports read, one case only, and only after investigation.** Test authors would not derive that the title prefix is load-bearing for reports. The "one case after investigation" rule counters a known agent tendency to annotate broadly to get a green run.

**R30. Infrastructure retries rerun only infrastructure failures.** This decision keeps test failures from being hidden. Detail lives in `sharded-execution.md`.

**R31. No retry clears a process leak.** A derivation that treats leaks as flakes would retry them away.

**R32. Ordinary runs impose no automatic failure cap.** This answers an objection an implementer can be expected to raise (a `maxFailures` cap), and it keeps evidence complete. It is scoped to ordinary runs, so it does not forbid the shard worker's deliberate opt-in early stop (review round 1, finding 8).

**R33. Verify's phases for each provider (Blaxel tests the selected committed revision, `HEAD` by default), its success line, publication, and `--plan`, which runs no phases but still selects a provider.** The contribution workflow, people and agents rely on the gate's composition and output. That `--plan` can contact Blaxel on a marked host is what a caller would not expect (per-file review round 1). Publication rules live in `attestation.md`.

**R34. Verify's provider choice: unmarked means local; marked means Blaxel if its checks pass, and refusal otherwise, never a silent fallback.** This decision's behavior people depend on, and silent fallback is the plausible wrong derivation.

**R35. The vibe-mode check: what it detects and why, that it runs last, and that CI applies it.** No other spec owns the check, and the vibe-waiver template depends on this behavior. Running last so that other results stay real is a non-obvious decision. Anchored `^verify-vibe-mode`; code and tests cite it.

**R36. Test process scopes and their owner as the final reaper.** This defines the term the rules below use. Anchored `^test-surface-owner`.

**R37. Token inheritance, and that helpers must preserve the token.** Test authors would not derive the helper obligation. Breaking it makes processes undiscoverable.

**R38. Teardown in its implemented order, leak detection, start-time revalidation, and that leaks fail the surface.** This strict decision has visible consequences. Warning instead of failing is a plausible derivation. Anchored `^test-process-leak`.

**R39. Discovery only by token through `/proc`/`ss` or `ps`/`lsof`, never by port or name; local runs and planned workers check the backend, and other paths such as targeted Blaxel runs do not.** This prohibition is stated on purpose: `pkill`-style cleanup is the obvious derivation and would kill concurrent runs on shared hosts. The preflight clause prevents silently running without cleanup where it applies. Its scope is stated so that it does not promise a check targeted runs lack (review round 1, finding 7).

**R40. Stale owners are reaped and fail the run; live ones are left alone.** This decision is about safety beside concurrent runs and about not running in a contaminated state.

**R41. The token format is a cross-revision contract; the pinned `SurfaceOwner`.** Hosts decode tokens written by other revisions to decide whether to kill processes.

**R42. Port `0` everywhere, full URLs from the binder, no derived ports or numeric literals, and why.** A fixed or reserved port is the common derivation and races concurrent runs. Anchored `^test-dynamic-ports`; the CLI specs and tests cite it.

**R43. The daemon acceptance exception.** Persisted serve rejects port `0`. Without the exception, the rule above would contradict a required suite.

**R44. Vite services bound by the runner because Vite treats port `0` as unset; pre-transforms off for teardown.** This is knowledge that would otherwise be lost, both times a trap a reimplementation would fall into again.

**R45. Vite services never answer `304`, and the Chromium shared-memory regression behind it.** This regression case says why it exists. Anchored `^test-service-full-responses`; code cites it.

**R46. The Cursor agent environment workaround.** This environment fact a test author would not know. The desktop harness spec cites the rule.

**R47. Testing guidance: destructive lifecycle tests go in isolated surfaces.** A proof writer could plausibly put crash and orphan cases into ordinary unit tests, which run on shared hosts.

## blaxel-testshards.md

**B1. Blaxel is the recommended broad validation; a hot persistent pool; a full verify in about three minutes; even one worker relieves the host.** This design intent is the reason for the provider and for its cost.

**B2. Workers are shared by branches at other revisions and by several repositories, so the protocol must stay compatible.** This frames the cross-version contracts below, which a reader would not otherwise recognize as contracts.

**B3. Ownership pointers to sharding, reporting and node versions.** These are where readers would expect the content.

**B4. Pool labels, `DEPLOYED`, the x64 check, and failing when too few workers exist.** Every revision discovers workers by these labels, which are Blaxel-side state.

**B5. The 75-worker tier limit, a pool of 72, standard runs of 36 shards, and the override.** The external service's limit is knowledge derivation cannot get. The numbers are the decision that keeps two runs within it.

**B6. Fresh-only provisioning, and why: Blaxel's create-if-absent does not update; eligibility only after verification.** This is knowledge about the external service plus an operator procedure. In-place reconciliation is the plausible wrong derivation.

**B7. Workers install nvm and the Node version from `.nvmrc`.** This is how the node-versions decision reaches workers. That spec links here for it.

**B8. Repository selection from `origin`, normalized without credentials; non-GitHub URLs fail.** People rely on public and private checkouts working without options. Stripping credentials is a security decision. The coordinator script's `--repo-url` is left to the code, because `npm test -- blaxel` does not pass it (per-file review round 1).

**B9. One pool, several repositories; one checkout switched per run; the shared trust boundary.** This is an accepted limitation with security weight, stated so that it reads as a decision.

**B10. Token sources, the access the token needs, and that it is never written to files or Git configuration.** People configure the sources. The never-written rule is a security decision.

**B11. The lease lasts until download, and why.** This decision fixes a real race: the next checkout overwriting results.

**B12. The lease path, the `flock` guard, recheck before change, and no guard during downloads.** Other revisions use the same paths and guard. These are the cross-version protocol.

**B13. Only the coordinator renews; the 20-minute interval; `--lock-ttl-seconds`; no reviving an expired lease.** This decision defines abandonment. The flag is command contract.

**B14. `TV_TEST_SHARD_OWNER` equals `lockId`; dispatch registration before checkout; delayed dispatch cannot start work.** Recovery by other revisions finds processes by this variable. The ordering prevents obsolete work after recovery.

**B15. Release needs confirmed process exit and retrieved reports; a shell exit is not proof; holding on doubt.** This decision rests on a non-obvious fact: a Blaxel process stop leaves descendants running.

**B16. Interrupt handling and exit `130`.** This is command contract, and the guarantee that interruption keeps retrieved evidence.

**B17. The pinned `WorkerLeaseRecord`: the `WorkerLease` fields that decide ownership, and the `DeletionReservation` that every acquisition refuses.** Other revisions read these fields to decide ownership. A revision that did not know the reservation could treat it as an incomplete record, reclaim it after a clean audit and start work on a worker being deleted (per-file review round 1). It is pinned only as far as they rely on it.

**B18. The abandoned-run recovery sequence, the receipt, and holding when unsure.** This decision is the automatic recovery. Its ordering (stop, confirm, clean, discard, take) is what makes it safe beside live processes.

**B19. Older runners and `expiresAt: 0`, marked transitional.** This cross-version compatibility with branches still on an older lock exists only while such branches exist, and the policy says to mark transitional code.

**B20. Deletion follows the lease rules, reserves the worker with a `DeletionReservation` and removes dispatch eligibility first; never-published workers need no lease.** This decision about safety alongside concurrent revisions of the runner would not be derived.

**B21. Memory-backed `/tmp`; private attempt directories; `TMPDIR`; short paths; persistent caches untouched.** These decisions rest on knowledge (memory cost, socket path limits). Anchored `^blaxel-scratch`; the testing policy cites the backstop.

**B22. Removing only the named leftovers and earlier attempt directories, rejecting unexpected mount boundaries, with no link following and everything else kept.** This decision is a deliberate allowlist. The prefixes are what helpers on older branches leave behind, so they are a cross-version fact.

**B23. Teardown removes scratch while holding the lease; deleting files does not free Chromium's memory; uncertain teardown keeps scratch.** This rests on knowledge (unlinked shared memory) and is a fail-safe decision.

**B24. Workers keep only the current attempt's results; no archive.** This decision bounds worker storage.

**B25. Targeted and planned selection forms on Blaxel.** This is command contract: what Blaxel accepts.

**B26. Blaxel runs use the same registry declarations as local runs.** This design intent is what lets a remote result stand for a local one.

**B27. Stale owners on a worker: no tests, excluded from the run, retry elsewhere.** This decision about safety and retry behavior would not be derived from the generic stale rule.

**B31. What a Blaxel run's coordinator and workers exchange crosses revisions when they differ, as with `--commit`: the registry and baseline read from the tested commit, the plan and worker command sent, the shard summary read back. A change keeps working with revisions in use, or the mismatch fails as infrastructure and is never read as results.** The code presents this exchange as internal: the coordinator plans and validates with the checkout's runner, and workers run the tested commit's shard worker. The shapes are left to the code, as an exception to the spec policy's rule on pinning types, stated in the spec itself (per-file review round 2). Both ends already validate what they receive, so a mismatch fails closed. The worker checks the plan against a digest of its whole content, so no subset of the plan's fields is a complete contract, and the exchange includes the worker command line and environment as well as the data shapes; pinning some of them would suggest the rest may change freely (per-file review round 1).

**B28. Setup: the CLI login, the 1Password item, the marker, the provisioning commands, and the `default` pool trap.** Operational procedure, which the policy places in arch specs. The setup skill links here.

**B29. Testing guidance: which live run each kind of change needs; dedicated pools for experiments; observing temporary files live.** These are facts about the environment a proof writer could not derive: what a targeted run does and does not exercise, and the risk to shared workers.

**B30. The live harness: placement, variable names, what the runner refuses, and the README.** This is an operator contract and a safety placement. A proof writer would not know the driver must not run on shared hosts or leased workers. Anchored `^blaxel-harness-placement`.

## sharded-execution.md

**X1. The purpose: complete, reproducible division, so that a passing result accounts for every selected file.** This design intent is the one guarantee everything else in the file serves. It is not "ran exactly once": an infrastructure retry can run a file again (per-file review round 1).

**X2. Every selected file is assigned to exactly one shard, and files are never split.** This decision underlies the guarantee.

**X3. The inventory comes from the tracked files of the tested commit and registry ownership, never from imports or the coordinator's tree.** This decision guarantees that independent jobs agree. Using the working tree is the plausible wrong derivation.

**X4. Each shard runs exactly its files and checks what was collected; a shard with no files for a surface skips that surface.** The collection check is the runtime guarantee. Skipping empty surfaces is a decision with real cost impact.

**X5. Plans are deterministic and identified by digest; why (CI jobs plan independently); how Blaxel distributes them, and that the plan crosses revisions (B31).** This is the decision that makes the CI join meaningful.

**X6. Balancing by duration; unknown files weighted as expensive; predictions are advisory.** "Unknown means expensive" is a decision a derivation might get wrong. The advisory note is an accepted limitation. The algorithm and constants are left to the code.

**X7. The plan is fixed; no queue; retries reuse the assignment.** This decision is about reproducibility, and a dynamic queue is a plausible alternative.

**X8. The baseline holds Blaxel medians of planning duration from complete, finally passing observations, and all plans use them, CI included.** What is measured is a decision: an ordinary elapsed median would let failures and flake overhead into the weights (review round 1, finding 3). Using Blaxel time for CI would otherwise look like an error to a reader of the CI plan. The baseline file's format is left to the code. It does cross revisions in a `--commit` run, under B31's rule (per-file review round 1).

**X9. The baseline is manual-only, from complete Blaxel full-suite runs, and fails without such runs, with the reason.** This decision guards against erasing measurements, which is non-obvious.

**X10. The shard-count recommendation, bounded by the pool's size, and that people change the counts.** This decision is against automatic scaling, with the target that makes the recommendation meaningful. The bound keeps the sentence from promising a count that meets the target when none does (per-file review round 1).

**X11. The three shard outcomes, retry rules, supersession, and how contradictions are treated.** This is the core honesty vocabulary, and the line between retrying and not retrying is a decision.

**X12. Final results come from each shard's latest attempt; failures from superseded attempts do not reappear; the run stays incomplete while a shard is still infrastructure-failed; CI has no retry coordinator.** This is the combination decision, which a reader could plausibly get wrong.

**X13. Testing guidance: only live planned and CI runs show plan transfer and agreement.** This environment fact is not derivable: a targeted run carries no plan.

## reporting.md

**P1. One result shape everywhere, and the uses: the summary, debugging, planning.** This is design intent.

**P2. The run directory's location and files; the summary path printed; atomic writes; a summary on failure once the directory exists; when local and Blaxel runs create it; refusals leave none.** People, agents and CI read these locations. The early-failure rule is a decision for diagnosability (review round 1, finding 5). A Blaxel run creates its directory once its remote preflight and selection checks have passed. Two selection checks in `runBlaxel` ran after the directory existed; they were moved ahead of remote preflight and the directory rather than promising less (per-file review rounds 1 and 2).

**P3. `--run-dir-output`, written when the directory exists, read by callers of `npm test`, and why `.test-runs/` is not searched.** This is a contract with orchestration, and the trap of enumerating directories is non-obvious.

**P4. The three status fields, in the summary's `run` block, and their relations.** This contract with every reader of results is the honesty mechanism the other specs refer to.

**P5. Reports state only what was observed.** This design intent is the rule a derivation under completion bias would bend.

**P6. Leaks fail the surface and mark it incomplete.** This consequence is non-obvious: a leak makes the run incomplete, not merely failed.

**P7. Recovered flakes, and the Vitest attempt recorder as the only evidence.** This is knowledge that would otherwise be lost: Vitest's JSON lacks attempts, and reading failure messages is the trap.

**P8. The compact summary for agents: what is listed, what is not, and what each entry keeps.** This design intent is about agents' context budget. The leak fields are what diagnosis needs. Passing tests are neither listed nor counted, and a recovered Playwright flake can have no error excerpt (per-file review round 1).

**P8a. The pinned `RunSummary` fields.** People, agents and `scripts/test/failing-set.mjs` read summaries, including from earlier runs, so the status block and the identifying fields of listed tests and leaks are command output to pin. The rest of the summary is left to the writer (review round 1, finding 1).

**P9. Timing records: their contents, determinism, the phases covered, and that they feed the baseline.** The baseline update depends on them. Phase coverage is the decision that makes setup cost visible.

**P9a. Event streams are read across revisions; the rule for changing them; the envelope every event carries (version, `runId`, contiguous `sequence`, a recognized status except on leak events); the Blaxel timing-provider identity; the pinned fields baseline update uses, including the meaning of `planningDurationMs`.** `baseline update` validates streams that earlier revisions left in `.test-runs/` and aborts on one it cannot read, so everything its validator checks is persisted data another version reads, not only the fields its calculation uses (review rounds 1 and 2, finding 1).

**P10. The event stream and initial summary are required; optional diagnostics (resource probes, workflow metrics, later phase appends such as verify's) are best-effort whenever they are collected and never change a result.** This decision prevents metrics from turning green red or the reverse, without making the required report optional (review round 1, finding 6; round 2, finding 2).

**P11. No secrets in run directories, because CI artifacts are readable by anyone who can read the repository.** This security requirement comes from an external fact: the repository is public.

**P12. Resource diagnostics: why, what is observed, the saved start, kernel lines on failure, unavailable is not zero, and the limits on what it proves.** This decision defines what evidence exists for memory investigations, with accepted limitations. Exact byte limits are left to the code. Anchored `^resource-diagnostics`.

**P13. Records are linked, survive retries and download, are bounded, never change outcomes, and include recovery receipts.** These decisions mean evidence is neither lost nor allowed to harm the worker.

## github-ci.md

**G1. Triggers and ownership.** The workflow spec depends on when CI runs.

**G2. Drafts run nothing; superseded pull-request runs are cancelled; pushes are not.** The contribution workflow and people depend on these decisions.

**G3. What always runs, and which jobs may skip.** This defines CI's composition alongside attestation.

**G4. The required check names as a contract with the ruleset maintained in GitHub.** These names come from GitHub's settings, not from the code. The old spec named required contexts that the live ruleset does not require.

**G5. The join's conditions, including that shard agreement applies when shards ran and that an authorized attested skip requires no shard reports, and that a skip is never read as success.** Branch protection depends on this decision about integrity. The conditions are what make a green join mean all tests ran once (review round 1, finding 2).

**G6. What the unit and desktop jobs run; shards use `e2e-ci` and the worker directly, so they pass the retry budget; 16 shards and why; the total changes together.** These are decisions with reasons. The retry clause prevents CI from silently dropping retries.

**G7. Build once, recipes covering each build step of the surfaces in `all`, ship every untracked file, no output list, a tar archive for modes, no fallback build.** This architectural decision is one the team should discuss if it changed. The mode-stripping fact is knowledge. Anchored `^gha-prebuilt-partition`; `licensing.md` cites it.

**G8. The build's rules and the transfer's limits: tracked files unchanged; no deletions, empty directories or `node_modules` writes; desktop independent.** These are the obligations the design places on builds, which a builder could not derive.

**G9. Exact-keyed caches with no near matches, and a hit equal to `npm ci`.** This is knowledge: restore-keys fallbacks are the common pattern and produce stale trees.

**G10. The combined shard archive keyed on the concrete image; the build as sole writer after launch proof; fallback on image skew; per-shard launches; raising the namespace.** This is knowledge about GitHub's gradual image rollout and why one machine's launch proves nothing for another, plus an obligation (raising the namespace) nothing else would reveal.

**G11. Every test job uploads its run directory, and finds it from the identity its runner reports: `--run-dir-output` for jobs that run `npm test`, the shard worker's summary for shard jobs.** The upload is a decision for diagnosability, and the identity rule is non-obvious.

**G12. One Playwright worker for real-stack browser tests, with the observed failure.** This regression case says why it exists.

**G13. Testing guidance: CI mechanics need a live isolated graph copy, with scratch namespaces deleted afterwards; production names are checked after merge.** These environment facts are not derivable: no test can reach the services, the cache quota is shared, and isolated copies cannot report production names.

## attestation.md

**A1. The purpose, and that attestation is an optimization, never a gate, resolving doubt to running tests.** This design intent decides every failure mode.

**A2. The ref name, the claim, recovered flakes counting, and that a Blaxel attestation does not cover Firefox projects.** The ref is shared across runs and revisions on GitHub. The claim is what readers trust, so it must say what a Blaxel-sourced attestation leaves out.

**A3. Tree hashing pins tracked content; what it does not pin; the 7-day bound; future dates rejected; the version.** This decision comes with its accepted limitation. Future-dated rejection is a non-obvious edge.

**A4. Bare refs checked by readers; atomic create-only writes; existing valid and malformed refs.** This cross-run contract on GitHub is where races are, which the push form avoids.

**A5. Lab refs are never honored.** The testing guidance depends on this boundary.

**A6. The two writers and their identities; forks cannot write.** This decision defines trust, and the identity checks are what keep other contexts out.

**A7. The eligibility conditions.** Each condition is a decision that could plausibly be derived differently: dirty trees, mismatched trees, skipped surfaces, or a version changing mid-run. The writer compares trees, not commits, and the first policy read precedes the run's tests rather than every phase (per-file review round 1).

**A8. Local runs never write; a miss is not an error; a write failure does not change the result.** These decisions keep attestation optional.

**A9. The trust model.** This answers the objection an implementer can be expected to raise about forged attestations.

**A10. The pinned policy file, read from `origin/main` only, with anything unexpected meaning disabled.** People write this file and every branch reads it. Reading from the tested checkout is the plausible wrong derivation that would let a branch enable itself.

**A11. The decision job's checks and log.** This is the contract for auditable skips.

**A12. GitHub Actions wiring: expected errors succeed; `continue-on-error`; `authorized`; `!cancelled()`; step-level skips on matrix jobs.** Each item is GitHub behavior that the obvious wiring gets wrong. All of it was measured, and none of it is derivable from the code's intent.

**A13. Only heavy jobs skip; the join passes skips; main pushes skip and stay green for publication.** Publication depends on this composition decision.

**A14. Revocation by deleting refs or with the flag, and in-flight skips.** This is the operator's contract, including its limitation.

**A15. Prune modes and safety rules.** This is command contract, and the safety rules are decisions.

**A16. The version-change procedure.** This operational procedure has an ordering that matters. Reusing a version is the trap.

**A17. Testing guidance: the isolated live CI graph against lab refs; what no test can reach; the operator's first checks and rollback.** These environment facts are not derivable.

## Inbound citations affected

The method defers repairing citations until after review. These references outside the rewritten files point at files or headings that no longer exist; block refs that survive are omitted.

- `AGENTS.md`, `specs/spec-workflow.md`, `specs/arch/testing-policy.md`, `developer-skills/tvdev-setup/SKILL.md`, `specs/arch/desktop/index.md`, `specs/arch/desktop/runtime.md`, `specs/arch/node-versions.md`, `specs/arch/telemetry/sink.md` and `specs/product/desktop-app.md` link to `preflight.md`. The remote-revision content is now `test-runner.md#^remote-revision`; process-backend checks are in `test-runner.md#processes-started-by-tests`.
- `specs/arch/testing-policy.md` links to `flaky-tests.md`; the content is in `test-runner.md#retries`.
- `specs/arch/desktop/e2e-harness.md` links to `test-registry.md` and `test-registry.md#Surface services`; the content is in `test-runner.md#the-test-registry`.
- `specs/arch/explainer-desktop-app.md` cites `preflight.md#^preflight-electron-runtime`. That statement is dropped as owned by the desktop harness spec.
- `specs/arch/testing-policy.md` links to `test-runner.md#Verify orchestration` (now `#verify`), `blaxel-testshards.md#Local setup` (now `#setup`) and `blaxel-testshards.md#Temporary files` (now `#temporary-files`).
- `specs/terms.md` entries name `test-registry.md`, `preflight.md` and `flaky-tests.md` as owners, and define `attempt` and `shard` against the old specs.
- Proofs under `proofs/arch/test-runner/` and test-code comments cite many anchors and headings of the old specs. They are re-derived later.
- `test/repo/test-runner-guardrails.test.ts` comments cite `github-ci.md#dependency-install` and `#test-assertions` headings that no longer exist.

## Responses to second opinions

### Round 1

The review is `second-opinion-r1.md` in this folder, on `f71b1f7d`.

1. **Persisted reporting contract.** Agreed in part, and changed. `reporting.md` now places the statuses in the summary's `run` block. It pins the summary fields that people, agents and `failing-set.mjs` read. It states that event streams are read across revisions by `baseline update`, gives the rule for changing them, and pins the fields the update uses, with the meaning of `planningDurationMs`. I did not pin `test/timing-baseline.json`: it is committed in the same tree as the planner and updater that read and write it, so a format change lands together with a regenerated file. Run directories, by contrast, stay in `.test-runs/` from runs at earlier revisions.
2. **The join and the attested skip.** Agreed, and changed. Shard agreement now applies when shards ran tests. A new sentence says that an authorized attested skip needs the build and shard no-ops and the vibe-mode check, and no shard reports. This matches `ci.yml` and `attestation.md`.
3. **What the baseline measures.** Agreed, and changed. `sharded-execution.md` now says the baseline is the median planning duration of complete observations that finally passed, recovered flakes included, and that failed and incomplete observations supply no samples. `planningDurationMs` is defined with the pinned event fields in `reporting.md`. The median arithmetic and the unknown-file constants stay in the code.
4. **Firefox outside GitHub CI.** Agreed, and changed. The registry section of `test-runner.md` now states the omission outside GitHub Actions and the failure inside it. Checking this found a wider consequence: Blaxel workers have no Firefox. In the full verify of `8e6cfcb2`, every browser-app shard ran only the `chromium` project, and the shard logs carry the skip warning. The spec now says that Blaxel runs cover Chromium only, and `attestation.md` says that a Blaxel attestation does not cover Firefox and lets CI skip it for that tree. Both statements describe current behavior; whether that is acceptable is a question for the owner.
5. **Run-directory promises.** Agreed, and changed. The summary-on-failure promise now holds once a directory exists. Local runs create theirs before local preflight; Blaxel runs create theirs after the dispatch checks pass. Refusals leave no directory, and `--run-dir-output` is written when the directory exists.
6. **Best-effort scope.** Agreed, and changed. The event stream and summary are now part of finalizing a run, and failing to write them fails the command. Only later additions are best-effort: verify's phases, which are added to the summary after the test command, workflow metrics and resource probes. Verify is no longer listed among the event stream's phases.
7. **Process-backend preflight scope.** Agreed, and changed. Canonical local runs and planned shard workers check the backend, and other paths such as targeted Blaxel runs skip it, with worker setup supplying the tools on Blaxel. I did not name the shard worker's diagnostic mode without a plan, which the specs mention nowhere else; "such as" keeps the list open.
8. **Failure cap versus the opt-in early stop.** Agreed, and changed. The sentence now says that ordinary runs impose no automatic cap on failures. I did not document the shard worker's `--fail-fast` option: nothing in the repository passes it, and the policy leaves out mechanisms nothing uses.
9. **The mutex update algorithm.** Agreed, and changed. The compare-and-swap sentence is gone. What remains is atomic acquisition, identity-checked changes, the shared representation, and no transaction held while tests run.
10. **Scoped defaults.** Agreed, and changed all three. The `against-test-guidance` naming is limited to the shared-host and retry overrides. `FLAKY_TEST_RETRIES` is 5 under the runner and CI unless the variable is set. Blaxel verify tests the selected committed revision, `HEAD` by default.

### Round 2

The review is `second-opinion-r2.md` in this folder, on `28039415`.

1. **The event contract omits fields the reader requires.** Agreed, and changed. `validateTimingEvents` (`scripts/test/timing-events.mjs`) rejects a stream whose events lack `schemaVersion: 1`, a shared `runId` or a `sequence` equal to the line position, or whose events other than leak events lack a recognized status. It also checks the timing provider, and `baseline update` reads only streams with the Blaxel identity. `reporting.md` now states that envelope and the Blaxel identity in a sentence each. It pins them in the type: a shared envelope, the status union, the shard status, and the `test-attempt` and `process-leak` kinds as far as the envelope and status reach them. Attempt payloads, hash formulas and the normalized result model stay in code.
2. **Best-effort described by timing.** Agreed, and changed. The paragraph now says that the event stream and initial summary are required, and that optional diagnostics are best-effort whenever they are collected. That covers resource probes, including the start observation saved before a surface prepares, workflow metrics and later phase appends such as verify's.

The reviewer agreed that `test/timing-baseline.json` can stay unpinned and confirmed that the Firefox statements are accurate (TV-1011).


## Responses to per-file reviews

### Round 1

The reviews are in `file-reviews/`, one per spec, all on `ee599ee8`. Each finding was checked against the code and the neighbouring specs before changing anything.

#### test-runner.md

1. **`--file` must resolve to one surface.** Agreed, and changed. `resolveFileSelection` (`scripts/test/test-guidance.mjs`) refuses matches that span surfaces even when each file has one owner. The `--file` bullet now says that matched files must belong to one selected surface, and that another selector such as `--surface` narrows a match that spans surfaces. R7; removal account test-runner 19.
2. **The default selection.** Agreed, and changed. Only `npm test -- local` and `npm test -- blaxel` supply `all`; `list` and `preflight` pass their options straight to `selectSurfaces`, which starts from every registered surface. The default sentence now says so, and the preflight row of the commands table takes selectors, with `--suite all` as its example. R7.
3. **Which configs are registry errors.** Agreed, and changed. Discovery recognizes only `vitest.config.ts`, `vitest.e2e.config.ts` and `playwright.config.ts`, and fixture configs with other names are deliberately unregistered. The sentence now names those three. Discovery is not broadened. R12; removal account test-registry 22.
4. **The grace period before the leak scan.** Agreed, and changed. After a normal exit there are no running commands left to stop, and `checkForLeaks` scans at once; the wait the code has is between `SIGTERM` and `SIGKILL`. The bullet now says that the owner stops the services and any commands still running, then scans. A wait before the scan is not intended: a process that exits before any signal is sent is not a leak (`isReportableProcessLeakCleanup`), which already covers a helper exiting just after its runner. R38; removal account test-runner 84 and 87.
5. **`verify --plan` still selects a provider.** Agreed, and changed. `resolveVerifyProvider` runs the Blaxel preflight on a marked host before `--plan` is checked. The sentence now says that `--plan` runs no phases and that choosing the provider on a marked host still runs its Blaxel checks. R33; removal account test-runner 48.
6. **The reason for dropping package-level zero retries.** Agreed. Grouped `unit:workspaces` runs pass no retry count and rely on the package configs' `retry: 0`. Removal account flaky-tests 4 now gives the runner-budget bullet's requirement, no runner retries for unit surfaces, as the reason, and leaves how it is met to the code. No spec change.

#### blaxel-testshards.md

1. **The deletion reservation is part of the shared lease contract.** Agreed, and changed. Deletion writes `{ lockId, deleting: true }` (`scripts/test/blaxel-worker-lease.mjs`), and acquisition refuses it before any audit. The pinned type is now `WorkerLeaseRecord`, either a `WorkerLease` or a `DeletionReservation`, and Deleting workers says that every acquisition refuses a reserved worker whatever its audit finds. B17, B20; removal account blaxel-testshards 13 and 24.
2. **`--repo-url` is not an option of the canonical command.** Agreed on the fact, and changed differently. `runBlaxel` (`scripts/test/cli.mjs`) does not pass `--repo-url` to the coordinator, and nothing in the repository uses it. The spec now says that workers use the checkout's `origin` and leaves the coordinator-script option to the code, rather than naming an option that `npm test -- blaxel` cannot reach. B8; removal account blaxel-testshards 4 and 39.
3. **Mount boundaries.** Agreed, and changed. A recursive removal can cross a mount point without following a link, and the cleaner checks mount points and devices separately. The sentence now reads "Removal rejects unexpected mount boundaries and does not follow links out of these locations." B22; removal account blaxel-testshards 28.

#### sharded-execution.md

1. **Plans, the baseline and shard summaries cross revisions.** Agreed in part. The boundary is real, and the ledger and removal account were wrong to treat these as read only within one revision. With `--commit`, the checkout's runner reads the tested commit's registry and baseline, plans, and validates the summary that the tested commit's shard worker returns. Changed: blaxel-testshards.md#runs now says that what the coordinator and workers exchange crosses revisions when they differ. A change should keep working with revisions still in use, and where it cannot, the mismatch must fail as infrastructure and never be read as test results. sharded-execution.md#plans points there. Not changed: the shapes stay in the code. The exchange is wider than the three types named (the worker's command line and environment cross too), both ends already validate what they receive, so a mismatch fails closed, and pinning three types would suggest the rest may change freely. B31, X5, X8; removal account sharded-execution 4, 18 and 56.
2. **The recommendation can exceed two minutes.** Agreed, and changed. `recommendShardCount` searches up to the pool's capacity and returns the capacity when no count meets the target. The sentence now says both. X10; removal account sharded-execution 45.
3. **Unique assignment is not exactly-once execution.** Agreed, and changed. An infrastructure retry can run a file again. The introduction now says that a passing result accounts for every selected file. X1.
4. **Retention of generated inputs.** Agreed. Removal account sharded-execution 39 is now Dropped, left to the implementation, and 40 says that only the mismatch behavior is kept. This moves one passage from Derivable to Dropped in the counts. No spec change.

#### reporting.md

1. **Some Blaxel refusals leave a directory without a summary.** Agreed on the fact; I kept the promise. In `runBlaxel` the directory is created after remote preflight, and the one-surface check for targeted selections and the suite check then exit through `fail()` with no summary. The spec now says that a Blaxel run creates its directory once its remote preflight and selection checks have passed, and keeps the promises that a refusal before dispatch leaves no directory and that an existing directory always gets a summary. Qualifying the promise would make every reader of `--run-dir-output` handle a directory without a summary, only to describe two checks that run in the wrong order. Moving them before the directory is created is a small code change for the repair phase. Until then the tree has this gap, and the PR description says so. P2; removal account reporting 5.
2. **The summary has no passing-test count, and not every listed test has an error.** Agreed, and changed. The summary counts surfaces, failed tests and recovered flakes, and a recovered Playwright flake takes its error from the passing attempt. The text now says that passing tests are not listed and that each listed test has a short error excerpt when one is available. P8; removal account reporting 22.
3. **`selection.suite` can be `null`.** Agreed, and changed. `selectionSummary` writes `suite: null` for selections without `--suite` or `--all`, and the run event copies it. The pinned type is now `suite?: string | null`. P9a.

#### github-ci.md

1. **Recipe coverage is for the `all` suite.** Agreed, and changed. `checkManifestCoversRegistry` checks only surfaces in `all`, and `daemon-acceptance:cli` declares a build step that no recipe covers. The sentence now covers the build steps of surfaces in `all`. G7; removal account github-ci 25.
2. **Shard jobs do not use `--run-dir-output`.** Agreed, and changed. Shard jobs read `runDir` from the shard worker's summary. The run-artifacts paragraph now says that a job takes its run directory from the identity its runner reports: `--run-dir-output` for jobs that run `npm test`, the shard worker's summary for shard jobs. reporting.md#run-directory now names callers of `npm test` instead of "orchestration such as CI". G11, P3; removal account github-ci 19.

#### attestation.md

1. **CI's first policy read does not precede every phase.** Agreed on the mismatch; I changed the spec rather than CI. The static-check matrix has no dependency on `attest-check`, so the old "before the first gate phase" never held in CI, and the removal account was wrong to call it kept. The condition now says that the first read comes before any of the run's tests. That holds on both paths: CI's test, build and end-to-end jobs all need `attest-check`, and a Blaxel verify reads the policy before its first phase. The remaining exposure is a version change in the seconds between the static checks starting and the decision job's read, on a run that also spans a version change made without the operations procedure's steps of disabling writes and letting in-flight runs finish. Lint and type-check also depend least on the outside conditions a version records. Reordering CI mechanics would need an isolated live CI run under github-ci.md#testing-guidance. The stronger rule remains available as a dependency of the static-check job on `attest-check`. A7; removal account attestation 10 and 24.
2. **The writer checks trees, not commits.** Agreed, and changed. `beginVerifyAttestationFacts` and the eligibility check compare `HEAD^{tree}` at start and end and the tested commit's tree, and `--commit` is not itself disqualifying. The condition now says "still clean, with the same tree", and that a verify whose tests target a commit with a different tree cannot write. A7; removal account attestation 19 and 20.

### Round 2

The reviews are the `*-r2.md` files in `file-reviews/`, on `db88693c`. `test-runner.md`, `blaxel-testshards.md`, `github-ci.md` and `attestation.md` passed with no findings.

#### sharded-execution.md

1. **The decision to leave cross-revision formats to the code is stated only in working documents.** Agreed, and changed by stating the exception in the spec. The spec policy's rule on pinning types covers data another revision reads, and the policy lets a more specific spec state an exception, but only in the spec. Pinning "the minimal fields the other revision consumes" has no small answer here. The worker checks the plan against a digest of its whole canonical content (`validateShardPlan`), so every field of the plan is consumed. The coordinator builds its whole report from the shard summary. The Runs paragraph of `blaxel-testshards.md`, which owns the coordinator–worker exchange, now states the exception: the shapes of these exchanges are left to the code, under the compatibility and infrastructure-failure rule. `sharded-execution.md#plans` names the plan, the baseline and the shard summary and points to it. This adds two sentences to `blaxel-testshards.md` after it passed; they change no rule there. B31.

#### reporting.md

1. **The run-directory code repair is outstanding.** Done. `runBlaxel` (`scripts/test/cli.mjs`) now computes its selection arguments, including the one-surface check for targeted selections and the supported-suite check, before remote preflight and before the run directory exists. The arguments passed to the coordinator are unchanged. The same review of the path found one more refusal after the directory existed: an invalid `--run-dir-output` value was rejected only when the identity was written. That check now runs first in `runWithSelection`, for local and Blaxel runs. `test/repo/test-runner-guardrails.test.ts` adds cases showing that each refusal comes before remote preflight and writes no run-directory identity. P2; removal account reporting 5.

## Repair phase

Josh approved the converged specs at `85b82b0d`. The repair phase brings everything that cites them into line, without re-deriving proofs: Josh asked for surgical proof edits that repoint citations, fold the proofs as the specs were folded, and correct what the new specs contradict, keeping coverage of anything the specs no longer promise and marking it *superfluous*. No proof, test or covered code is removed. Test changes are limited to the two tests that read old spec text, citation comments, and tests a new spec promise plainly lacks.

### Citations outside the proofs (`961967df`)

Every row of "Inbound citations affected" above is repaired, along with the removal account's table of old targets:

- Spec links in `AGENTS.md`, `spec-workflow.md`, `testing-policy.md`, the desktop, licensing, Node-version and telemetry specs, the migration map and `developer-skills/tvdev-setup/SKILL.md` now point at `test-runner.md` sections and anchors. `specs/product/desktop-app.md` cited preflight's testing guidance as the reason for its Mac verify run; that guidance is gone, so the sentence now says what the run exercises: the runner's macOS process backend.
- `specs/terms.md`: owners updated; *shard*, *attempt*, *infrastructure failure* and *test failure* restated against `sharded-execution.md`; *flaky test* replaced by *recovered flake*, the term `test-runner.md#retries` defines. *Execution group* and *normalized surface result* are removed: no spec defines them now.
- Workflow, script and test comments that named old headings now name current ones. Three pre-existing broken wikilinks in test comments (`^gha-prebuilt-consumer`, `^gha-prebuilt-cli-outputs`) became checked path citations.
- The two tests that read old spec text (`test-runner-guardrails.test.ts` "keeps CI-planned e2e surfaces registry-owned…", `test-runner-provider.test.ts` "keeps canonical stale-owner retry authority…") now read the sentences in `github-ci.md#jobs` and `blaxel-testshards.md#runs` that state the same rules.

### Proofs

- **Fold.** `proofs/arch/test-runner/test-registry.md`, `preflight.md` and `flaky-tests.md` are folded into `test-runner.md`'s proof as "Test registry", "Preflight checks" and a paragraph under "Retry selection and execution". Their hooks join its Test hooks. Every assertion and anchor is kept, so test citations change only their file (`^registry-committed-normalization`, `^preflight-t-electron-planner-handoff`).
- **Citations.** Every proof link to a removed heading or anchor is repointed, following the removal account's table.
- **Contradictions corrected.** Attestation eligibility is by tree, not by `--commit` ≠ `HEAD`. CI recipe coverage is for surfaces in `all`. The shard-count recommendation is "at most" two minutes, with the pool-size fallback. Two references to spec testing directives that no longer exist (a CLI-boundary directive, native-config loading "as directed by the spec") are removed, and the proof now names where it honors the one directive the spec has: destructive lifecycle tests in isolated surfaces.
- **Superfluous, kept.** Marked where an assertion covers detail the spec leaves to the code: the `tv serve` test recipe, `--allow-extreme-inefficiency`, execution groups and their order, invalid Vite service forms, the `node` check's name, the coordinator script's `--repo-url`, nvm's pinned version, image and memory size, worker Electron repair, the normalized result type, the LPT algorithm and weighting constants, combined Vitest invocation, diagnostic byte bounds, and the `e2e:browser-app` worker pin.
- **New promises cited to existing tests.** The owner-token format (`process-lifecycle.test.ts`), plan validation by digest (`test-runner-shard-plan.test.ts`), refusal of a reserved worker (`blaxel-lease-contracts.test.ts`), `--run-dir-output` and refusals before preflight (`test-runner-reporting.test.ts`, `test-runner-guardrails.test.ts`), and one rule of the event envelope (`test-runner-timing-baseline.test.ts`, with the rest of the envelope stated as having no cases of its own).
- **New tests for promises that plainly lacked one.** A local guardrail refusal leaves no run directory (`test-runner-guardrails.test.ts`). The summary keeps the fields `RunSummary` pins (expectations added to two existing tests in `test-runner-reporting.test.ts`). Both pass locally, one file each.

Primitive flagged `dec_8e3d38a8` (crash cases belong on the isolated lifecycle surface) on the new guardrails test. That test is a plain CLI refusal, not a crash case; recorded as followed.

### Responses to repair review round 1

The review is `repair-review-r1.md` in this folder, on `609a1b6d`.

1. **The refusal tests observed the identity file, not the run directory.** Agreed, and changed. Creating the directory and writing its identity are separate steps in `scripts/test/cli.mjs`, so the identity file's absence could not show that no directory was made. The four refusal cases in `test-runner-guardrails.test.ts` now run in the disposable checkout that `guidanceCheckout()` provides, with a second fixture surface committed there, because Blaxel selection reads the registry from the tested commit. Each asserts that the checkout has no `.test-runs/` directory afterwards. They keep the diagnostic, tripwire and identity-file assertions. The same fixture creates `.test-runs/<id>/` for an admitted run, so the observation can fail. The proof's `^reporting-t-refusal-no-run-dir` now describes that observation.
2. **The *broad run* entry added a routing rule.** Agreed, and changed to the suggested definition and pointer.
3. **The *test failure* entry equated a failed test with the `failed` classification.** Agreed. The entry is now *failed shard*, a pointer to the classification in `sharded-execution.md#shard-outcomes`. No spec uses *test failure* as a term.

While building the fixture I noticed that `--surface` silently ignores an ID that names no surface: `npm test -- list --surface unit:root,unit:nonexistent` lists `unit:root` alone. This predates the branch and the repair scope does not cover it; it is reported to Josh rather than changed.

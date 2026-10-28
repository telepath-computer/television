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

**R7. Selectors, including how `--file` matches and that `--grep` alone does not narrow.** These are command-line contract. That `--file` is a substring filter unless exact is non-obvious, and people rely on it.

**R8. The runner resolves files itself, because Vitest and Playwright filters are not exact.** This is knowledge that would otherwise be lost. A derivation that passes the user's string through would silently run sibling files, breaking both the one-file limit and plan assignment.

**R9. Exit codes `0`, `1`, `2`, `130`, `143`, and `verify --plan` exiting `0` without verifying.** Scripts, CI and agents branch on these codes. `2` separates a refusal from a test failure.

**R10. A Blaxel command succeeds only with a passed normalized report.** This decision is about honesty. Trusting the coordinator's exit alone is a plausible derivation that would turn missing evidence into a pass.

**R11. The registry is the single declaration of surfaces; classification is never inferred from names.** This architectural decision makes everything else selectable. A derivation could plausibly infer kinds from paths.

**R12. Every test file under `packages/` and `test/` has exactly one owner, and undeclared configs are errors.** This invariant guarantees that no test silently drops out of every run.

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

**R33. Verify's phases for each provider (Blaxel tests the selected committed revision, `HEAD` by default), its success line, publication, and `--plan`.** The contribution workflow, people and agents rely on the gate's composition and output. Publication rules live in `attestation.md`.

**R34. Verify's provider choice: unmarked means local; marked means Blaxel if its checks pass, and refusal otherwise, never a silent fallback.** This decision's behavior people depend on, and silent fallback is the plausible wrong derivation.

**R35. The vibe-mode check: what it detects and why, that it runs last, and that CI applies it.** No other spec owns the check, and the vibe-waiver template depends on this behavior. Running last so that other results stay real is a non-obvious decision. Anchored `^verify-vibe-mode`; code and tests cite it.

**R36. Test process scopes and their owner as the final reaper.** This defines the term the rules below use. Anchored `^test-surface-owner`.

**R37. Token inheritance, and that helpers must preserve the token.** Test authors would not derive the helper obligation. Breaking it makes processes undiscoverable.

**R38. Teardown, leak detection, start-time revalidation, and that leaks fail the surface.** This strict decision has visible consequences. Warning instead of failing is a plausible derivation. Anchored `^test-process-leak`.

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

**B8. Repository selection from `origin` or `--repo-url`, normalized without credentials; non-GitHub URLs fail.** People rely on public and private checkouts working without options. Stripping credentials is a security decision.

**B9. One pool, several repositories; one checkout switched per run; the shared trust boundary.** This is an accepted limitation with security weight, stated so that it reads as a decision.

**B10. Token sources, the access the token needs, and that it is never written to files or Git configuration.** People configure the sources. The never-written rule is a security decision.

**B11. The lease lasts until download, and why.** This decision fixes a real race: the next checkout overwriting results.

**B12. The lease path, the `flock` guard, recheck before change, and no guard during downloads.** Other revisions use the same paths and guard. These are the cross-version protocol.

**B13. Only the coordinator renews; the 20-minute interval; `--lock-ttl-seconds`; no reviving an expired lease.** This decision defines abandonment. The flag is command contract.

**B14. `TV_TEST_SHARD_OWNER` equals `lockId`; dispatch registration before checkout; delayed dispatch cannot start work.** Recovery by other revisions finds processes by this variable. The ordering prevents obsolete work after recovery.

**B15. Release needs confirmed process exit and retrieved reports; a shell exit is not proof; holding on doubt.** This decision rests on a non-obvious fact: a Blaxel process stop leaves descendants running.

**B16. Interrupt handling and exit `130`.** This is command contract, and the guarantee that interruption keeps retrieved evidence.

**B17. The pinned `WorkerLease` fields that decide ownership.** Other revisions read these fields to decide ownership. It is pinned only as far as they rely on it.

**B18. The abandoned-run recovery sequence, the receipt, and holding when unsure.** This decision is the automatic recovery. Its ordering (stop, confirm, clean, discard, take) is what makes it safe beside live processes.

**B19. Older runners and `expiresAt: 0`, marked transitional.** This cross-version compatibility with branches still on an older lock exists only while such branches exist, and the policy says to mark transitional code.

**B20. Deletion follows the lease rules and removes dispatch eligibility first; never-published workers need no lease.** This decision about safety alongside concurrent revisions of the runner would not be derived.

**B21. Memory-backed `/tmp`; private attempt directories; `TMPDIR`; short paths; persistent caches untouched.** These decisions rest on knowledge (memory cost, socket path limits). Anchored `^blaxel-scratch`; the testing policy cites the backstop.

**B22. Removing only the named leftovers and earlier attempt directories, with no link following and everything else kept.** This decision is a deliberate allowlist. The prefixes are what helpers on older branches leave behind, so they are a cross-version fact.

**B23. Teardown removes scratch while holding the lease; deleting files does not free Chromium's memory; uncertain teardown keeps scratch.** This rests on knowledge (unlinked shared memory) and is a fail-safe decision.

**B24. Workers keep only the current attempt's results; no archive.** This decision bounds worker storage.

**B25. Targeted and planned selection forms on Blaxel.** This is command contract: what Blaxel accepts.

**B26. Blaxel runs use the same registry declarations as local runs.** This design intent is what lets a remote result stand for a local one.

**B27. Stale owners on a worker: no tests, excluded from the run, retry elsewhere.** This decision about safety and retry behavior would not be derived from the generic stale rule.

**B28. Setup: the CLI login, the 1Password item, the marker, the provisioning commands, and the `default` pool trap.** Operational procedure, which the policy places in arch specs. The setup skill links here.

**B29. Testing guidance: which live run each kind of change needs; dedicated pools for experiments; observing temporary files live.** These are facts about the environment a proof writer could not derive: what a targeted run does and does not exercise, and the risk to shared workers.

**B30. The live harness: placement, variable names, what the runner refuses, and the README.** This is an operator contract and a safety placement. A proof writer would not know the driver must not run on shared hosts or leased workers. Anchored `^blaxel-harness-placement`.

## sharded-execution.md

**X1. The purpose: complete, reproducible division, so that passing means every file ran exactly once.** This design intent is the one guarantee everything else in the file serves.

**X2. Every selected file is assigned to exactly one shard, and files are never split.** This decision underlies the guarantee.

**X3. The inventory comes from the tracked files of the tested commit and registry ownership, never from imports or the coordinator's tree.** This decision guarantees that independent jobs agree. Using the working tree is the plausible wrong derivation.

**X4. Each shard runs exactly its files and checks what was collected; a shard with no files for a surface skips that surface.** The collection check is the runtime guarantee. Skipping empty surfaces is a decision with real cost impact.

**X5. Plans are deterministic and identified by digest; why (CI jobs plan independently); how Blaxel distributes them.** This is the decision that makes the CI join meaningful.

**X6. Balancing by duration; unknown files weighted as expensive; predictions are advisory.** "Unknown means expensive" is a decision a derivation might get wrong. The advisory note is an accepted limitation. The algorithm and constants are left to the code.

**X7. The plan is fixed; no queue; retries reuse the assignment.** This decision is about reproducibility, and a dynamic queue is a plausible alternative.

**X8. The baseline holds Blaxel medians of planning duration from complete, finally passing observations, and all plans use them, CI included.** What is measured is a decision: an ordinary elapsed median would let failures and flake overhead into the weights (review round 1, finding 3). Using Blaxel time for CI would otherwise look like an error to a reader of the CI plan. The baseline file's format is not pinned because it is committed with the code that reads it.

**X9. The baseline is manual-only, from complete Blaxel full-suite runs, and fails without such runs, with the reason.** This decision guards against erasing measurements, which is non-obvious.

**X10. The shard-count recommendation, and that people change the counts.** This decision is against automatic scaling, with the target that makes the recommendation meaningful.

**X11. The three shard outcomes, retry rules, supersession, and how contradictions are treated.** This is the core honesty vocabulary, and the line between retrying and not retrying is a decision.

**X12. Final results come from each shard's latest attempt; failures from superseded attempts do not reappear; the run stays incomplete while a shard is still infrastructure-failed; CI has no retry coordinator.** This is the combination decision, which a reader could plausibly get wrong.

**X13. Testing guidance: only live planned and CI runs show plan transfer and agreement.** This environment fact is not derivable: a targeted run carries no plan.

## reporting.md

**P1. One result shape everywhere, and the uses: the summary, debugging, planning.** This is design intent.

**P2. The run directory's location and files; the summary path printed; atomic writes; a summary on failure once the directory exists; when local and Blaxel runs create it; refusals leave none.** People, agents and CI read these locations. The early-failure rule is a decision for diagnosability, scoped to what the code delivers (review round 1, finding 5).

**P3. `--run-dir-output`, written when the directory exists, and why `.test-runs/` is not searched.** This is a contract with orchestration, and the trap of enumerating directories is non-obvious.

**P4. The three status fields, in the summary's `run` block, and their relations.** This contract with every reader of results is the honesty mechanism the other specs refer to.

**P5. Reports state only what was observed.** This design intent is the rule a derivation under completion bias would bend.

**P6. Leaks fail the surface and mark it incomplete.** This consequence is non-obvious: a leak makes the run incomplete, not merely failed.

**P7. Recovered flakes, and the Vitest attempt recorder as the only evidence.** This is knowledge that would otherwise be lost: Vitest's JSON lacks attempts, and reading failure messages is the trap.

**P8. The compact summary for agents: what is listed, what is not, and what each entry keeps.** This design intent is about agents' context budget. The leak fields are what diagnosis needs.

**P8a. The pinned `RunSummary` fields.** People, agents and `scripts/test/failing-set.mjs` read summaries, including from earlier runs, so the status block and the identifying fields of listed tests and leaks are command output to pin. The rest of the summary is left to the writer (review round 1, finding 1).

**P9. Timing records: their contents, determinism, the phases covered, and that they feed the baseline.** The baseline update depends on them. Phase coverage is the decision that makes setup cost visible.

**P9a. Event streams are read across revisions; the rule for changing them; the pinned fields baseline update uses, including the meaning of `planningDurationMs`.** `baseline update` validates streams that earlier revisions left in `.test-runs/` and aborts on one it cannot read, so the stream is persisted data another version reads (review round 1, finding 1).

**P10. The event stream and summary are part of finalizing a run; additions afterwards (verify's phases, workflow metrics, resource probes) are best-effort and never change a result.** This decision prevents metrics from turning green red or the reverse, without making the required report optional (review round 1, finding 6).

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

**G7. Build once, ship every untracked file, no output list, a tar archive for modes, no fallback build.** This architectural decision is one the team should discuss if it changed. The mode-stripping fact is knowledge. Anchored `^gha-prebuilt-partition`; `licensing.md` cites it.

**G8. The build's rules and the transfer's limits: tracked files unchanged; no deletions, empty directories or `node_modules` writes; desktop independent.** These are the obligations the design places on builds, which a builder could not derive.

**G9. Exact-keyed caches with no near matches, and a hit equal to `npm ci`.** This is knowledge: restore-keys fallbacks are the common pattern and produce stale trees.

**G10. The combined shard archive keyed on the concrete image; the build as sole writer after launch proof; fallback on image skew; per-shard launches; raising the namespace.** This is knowledge about GitHub's gradual image rollout and why one machine's launch proves nothing for another, plus an obligation (raising the namespace) nothing else would reveal.

**G11. Every test job uploads its run directory, and finds it via `--run-dir-output`.** The upload is a decision for diagnosability, and the identity rule is non-obvious.

**G12. One Playwright worker for real-stack browser tests, with the observed failure.** This regression case says why it exists.

**G13. Testing guidance: CI mechanics need a live isolated graph copy, with scratch namespaces deleted afterwards; production names are checked after merge.** These environment facts are not derivable: no test can reach the services, the cache quota is shared, and isolated copies cannot report production names.

## attestation.md

**A1. The purpose, and that attestation is an optimization, never a gate, resolving doubt to running tests.** This design intent decides every failure mode.

**A2. The ref name, the claim, recovered flakes counting, and that a Blaxel attestation does not cover Firefox projects.** The ref is shared across runs and revisions on GitHub. The claim is what readers trust, so it must say what a Blaxel-sourced attestation leaves out.

**A3. Tree hashing pins tracked content; what it does not pin; the 7-day bound; future dates rejected; the version.** This decision comes with its accepted limitation. Future-dated rejection is a non-obvious edge.

**A4. Bare refs checked by readers; atomic create-only writes; existing valid and malformed refs.** This cross-run contract on GitHub is where races are, which the push form avoids.

**A5. Lab refs are never honored.** The testing guidance depends on this boundary.

**A6. The two writers and their identities; forks cannot write.** This decision defines trust, and the identity checks are what keep other contexts out.

**A7. The eligibility conditions.** Each condition is a decision that could plausibly be derived differently: dirty trees, mismatched commits, skipped surfaces, or a version changing mid-run.

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

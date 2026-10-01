*How the promises in Test Attestation are proven.*

# Test Attestation — proof

Proves [specs/arch/test-runner/attestation.md](../../../specs/arch/test-runner/attestation.md).

## Coverage model

Coverage declarations are carried inside the migrated assertion blocks below.

## Test hooks


Contract tests may inject the policy reader into `readTestpassPolicy`, the publisher and loggers into `maybePublishAttestation`, and the Git executor and clock into `pruneTestpassRefs`. `readTrustedPolicy` accepts `repoRoot` and `remote` to select the repository and the origin whose default branch supplies the policy blob. Production commands use the real dependencies, the current repository, and `origin`.

In production mode, `publishAttestation` accepts an injected policy result or policy reader only when `TV_TEST_RUNNER_SELFTEST=1`, as defined by [test-runner.md's Test hooks](./test-runner.md#Test hooks); otherwise it ignores them and reads the trusted `origin/main` policy. The policy hook cannot bypass the writer's source, version, commit/tree, or ref-name checks.

`TV_TESTPASS_LAB=1` selects the `refs/testpass-lab` namespace for decisions, publication, and pruning; every other value selects production mode. `TV_TESTPASS_LAB_VERSION` supplies the synthetic lab version and defaults to `1`. It must use the same unpadded base-10 encoding and version domain as production, or lab skipping, writing, and pruning fail closed.

## Assertions

### Test assertions

Shapes per [testing-policy.md](../../../specs/arch/testing-policy.md).

**Contract — decision logic** (pure, committed):

- The skip decision affirms only when all of: policy flag true, version valid and matching, ref exists, object is a commit, name↔tree invariant holds, age within `[0, 7d]`; each single negation yields no-skip, and unreachable-origin and malformed-policy inputs yield no-skip. Missing, non-integer, out-of-domain, and malformed `testpassVersion` values each disable both the skip decision and the writer.
- The writer's version bracket: start-read and completion-read must both succeed, be enabled, and agree; a mid-run flag disable or version change makes the run ineligible (no publish), covered as an explicit permutation.
- The age computation uses the committer timestamp; unparseable, missing, and **future** timestamps reject (no-skip); both bounds are inclusive and both endpoints are asserted exactly: age exactly 0 skips, age exactly 7d skips, and the surrounding values are covered on both sides (6d23h skips; 7d1h does not, −1s does not).
- The eligibility predicate rejects each clause independently: a local or narrowed developer verify, phase/tree mismatch (`--commit` ≠ HEAD), dirty-at-start, changed-before-end (bracket check), `--ignore-uncommitted`, shard subsets, a skipped gate surface, nonstandard retries, attested-skip runs, disabled policy, wrong version. `--no-publish` bypasses the writer in the canonical CLI's verify orchestration before eligibility is evaluated; no committed test runs that orchestration to completion (boundary gaps below).
- The production writer accepts only source `blaxel-verify` or `github-ci`. The developer verify handoff supplies `blaxel-verify` only after its provider qualification passes. The CI `write` command refuses outside GitHub Actions workflow `CI` / job `attest-write`, refuses without `TV_TEST_REF_PUBLICATION=required`, and supplies `github-ci` only after those checks. A full passing local-provider fact set calls no publisher; a direct local invocation of the CI writer writes no ref.
- The writer's create-only path: pushes with the empty-lease CAS; on rejection validates the existing ref — valid ⇒ idempotent success without pushing, malformed ⇒ loud non-success.
- The name↔tree invariant checker flags a ref whose object is not a commit or whose commit tree differs from the ref name.

**Seam — trusted policy read** (real Git with a temporary bare origin):

- The reader takes `test/testpass-policy.json` from the exact object at origin's `refs/heads/main`: committing an enabling copy on a local branch that origin's main does not carry changes nothing, and pushing it to origin's main does.
- A missing policy, malformed JSON, an unsupported schema version, a missing or extra key, a non-boolean flag, a non-integer version, and an unreachable origin each read as unavailable.

**Contract — prune safety** (pure + local-bare-remote process tests):

- An unavailable or malformed trusted policy read yields zero deletions in every mode, dry-run or `--apply`.
- The age cutoff is exact: a ref at exactly the cutoff age is retained; deletion requires strictly older (both boundary sides asserted).
- `--dead-version <n>` refuses `n` equal to the current trusted version and any `n` greater; it deletes only under `refs/testpass/<n>/*` for a strictly lower `n`.
- `--delete-ref` rejects globs, non-version-qualified names, and refs outside `refs/testpass/`; it deletes exactly the named ref.
- A mid-batch deletion failure reports the failed ref, exits non-zero, and never reports overall success; remaining candidates are listed as not-deleted. Failure is checked on **both** halves of a deletion: a remote deletion that succeeds while the local deletion fails is a reported per-ref failure, never recorded as deleted.
- The namespace fetch reconciles local with remote (`--prune`): a ref deleted on the remote never lingers locally as a phantom candidate that could abort an `--apply` batch before real candidates process.
- Dry-run is the default; no mode deletes without `--apply`.

**Contract — the committed workflow encodes the wiring** (workflow-file assertions in the [github-ci.md](../../../specs/arch/test-runner/github-ci.md) pattern): `attest-check` exists, needs no install, declares `continue-on-error: true`, and exposes the full output set `skip`, `tree`, `version` — the captured half of the writer's validation bracket; attest-check, lint/type-check/package-manifests, and every heavy job retain the shared draft guard; each heavy job's **job-level `if` never references the skip output** (matrix jobs must expand on validation-bearing events so the concrete required contexts emit) **and carries `!cancelled()`** (a crashed `attest-check` must not suppress the heavy tier through the implicit `success()` gate), its needs include `attest-check`, every one of its steps composes the authorization-bound guard `(skip != 'true' || authorized != 'true')`, and only the literal `'true'` from a SUCCESSFUL decision job no-ops (`skip == 'true' && authorized == 'true'`); the `authorized` output maps from a dedicated `Authorize skip` step that is asserted to be the LAST step of `attest-check`; the e2e shards' `if` additionally requires `needs.build.result == 'success'`; the join depends on `attest-check`, combines `always()` with the shared draft guard at job level, contains no successful draft branch in its script, and requires successful build and e2e results for every green run path. The `attest-write` job runs only on a fully green run **including a successful `attest-check`** (a crashed decision job never feeds the writer), needs no install, is loud-but-non-gating (`continue-on-error: true`), carries `TV_TEST_REF_PUBLICATION=required` only for the same-repository writable context, and feeds the captured `tree` and `version` outputs to a completion re-read of the trusted policy with exactly four refusal conditions, each a logged no-op: missing or malformed attest-check outputs; a policy that is not enabled at completion; a trusted version differing from the captured output; a `HEAD^{tree}` differing from the captured tree. A run started under version N can never publish under N+1.

**Acceptance — live, on the implementing branch via an isolated workflow copy** (the [github-ci.md](../../../specs/arch/test-runner/github-ci.md) acceptance mechanism, lab namespace only), seven cases:

1. **Eligible writer:** a fully green isolated run with lab writing enabled publishes a lab attestation through the real eligibility and writer path, without a manually seeded ref.
2. **Attestation reuse:** a re-run on the identical tree finds that attestation, so heavy jobs no-op and fast-succeed **while still emitting every concrete required check context**. The live run must contain green checks named `unit`, `e2e:desktop`, and each `e2e shard n/16`, and the join must pass through its explicit attested-skip condition.
3. No attestation → everything runs.
4. Lookup pointed at an unreachable remote → attest-check completes successfully with `skip=false`, everything runs.
5. Induced decision-job crash → job fails without reddening the run, everything runs — asserted on the live run: every concrete heavy check context (`unit`, `e2e:desktop`, each `e2e shard n/16`, the build) **executed** (not skipped, not no-op'd) despite the failed decision job. Two variants, both required: a crash **before** decide (no outputs), and a failure **after** a successful decide with an attestation present (`skip=true` emitted and preserved) — the authorization binding must refuse the preserved skip and execute everything.
6. `break_build=true` with no attestation → join red, proving that an upstream build failure cannot become a false pass.
7. **Developer verify writer:** one real, normal `npm run verify -- blaxel` from a developer machine in explicit lab mode publishes automatically through the actual verify handoff, exercising qualification, eligibility evaluation, and the create-only ref write. This case cannot prove the trusted `origin/main` policy reads before activation; the first post-activation production runs provide that evidence. The run requires explicit resource and publication authorization, and its lab ref is pruned afterward.

The production-namespace write path is exercised only after the operator's policy flip, on the first post-flip normal Blaxel verify, and observed then.

**Boundary gaps — stated honestly per [testing-policy.md](../../../specs/arch/testing-policy.md):** committed tests cannot prove that the GitHub-provided environment identity is unspoofable; it is an execution-placement guard, while repository write credentials remain the security boundary. They also cannot exercise the real `origin/main` policy blob read, production-namespace push permissions, or `publish.yml` proceeding after an attested-skip main run. The operator verifies those live behaviors during activation, with the policy flag as the immediate rollback. No committed test spawns a complete green `verify` run through run-directory collection, eligibility evaluation, and publication because that would require nesting the full gate inside a repository test; acceptance case 7 covers that crossing, while process-level tests cover the decision and writer independently. A live concurrent-writer race proved the create-only write's atomicity; the committed test covers sequential conflicts.


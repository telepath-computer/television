*Tree-hash test attestation: recording that an exact tree passed full validation as a bare `refs/testpass/<version>/<tree-hash>` ref, and letting validation-bearing CI runs skip their heavy test jobs — never their cheap ones — when the identical tree is already attested under the current version.*

# Test Attestation

Blaxel verification and GitHub CI can each supply full validation under the [shared-branch workflow](../../spec-workflow.md#^shared-branch-workflow). An *attestation* records the first green full validation so later runs can skip their heavy test jobs instead of re-proving it — cutting minutes from CI and letting publishes land sooner — while cheap checks still run and any doubt resolves to running the tests. Draft pull requests use the separate whole-graph skip defined by [GitHub CI](./github-ci.md).

This spec is authoritative for the attestation contract: what an attestation claims, the ref shape, what may write one, the skip semantics in the CI workflow, staleness and revocation, failure modes, the activation policy file and its trusted read, and pruning. The CI workflow whose jobs skip is owned by [github-ci.md](./github-ci.md); the `verify` orchestration that writes attestations is [test-runner.md](./test-runner.md).

## What an attestation claims

An attestation is the claim: **the tree `<tree-hash>` passed the repository's full validation gate.** Concretely:

- *Tree hash* is `git rev-parse <commit>^{tree}` — the content identity of every tracked file, independent of commit metadata and history.
- *Full validation gate* is the CI gate's own test scope at that tree: lint, type-check, package-manifests, and the complete `all` suite (unit and e2e, desktop included) with the gate's standard retry budget ([test-runner.md](./test-runner.md)). A pass that used runner-level retries attests exactly like it gates: a recovered flake is a pass.
- **The claim is self-pinning for everything the tree controls — and only that.** The tree hash covers every tracked file: the workflow definitions, the test registry, the suite definitions, and the tests themselves. Two identical trees cannot disagree about the *repo-defined* meaning of "passed": any tracked change that alters the gate produces a different tree and never matches an existing attestation.
- **What the tree does not pin:** mutable third-party action tags (`actions/checkout@v4` is a moving pointer), the `ubuntu-latest` runner image label, repository/organization settings, Actions variables and secrets, and external services (npm registry, browser CDNs, Blaxel). Changes there can alter what "passed" means without changing the tree. Two mechanisms bound that exposure: the age limit (drift, see Staleness) and the **attestation version** (known contract changes, below).

**Attestation version.** The activation policy carries a `testpassVersion`. Attestations are written under the current version, the version is part of the ref name, and skip logic honors only refs of the version it reads from the trusted `origin/main` policy blob.

- **Domain and encoding:** a JSON integer, `1 ≤ testpassVersion ≤ 999999999`, encoded in the ref name as its plain base-10 digits with no padding (`refs/testpass/2/<tree-hash>`). A missing, non-integer, out-of-domain, or otherwise malformed value disables **both** writing and skipping — the same default-deny posture as a missing flag.
- **Version is bound to the validation interval, not the completion instant.** The writer reads the trusted version from `origin/main` **before the first gate phase** and again **at completion**, and publishes only when both reads succeeded and agree; a mid-run bump makes the run ineligible (the external contract changed while it was validating, so its pass may already be under the old contract). This closes the time-of-check/time-of-use hole where a run started under version N publishes under N+1.
- **Safe version-change procedure.** To make every in-flight validation ineligible under the changed contract: (1) set `testpassRefsEnabled: false` on main, which stops skipping and writing, including writes from runs that read version N at start; (2) let eligible in-flight runs drain or cancel them; (3) change the external contract (runner image, action versions, environment); (4) increment `testpassVersion` to a value that has never been used, and never revert to a used value; (5) re-enable `testpassRefsEnabled`. A version change alone cannot reach a run that already made its skip decision, but the disabled flag is checked again by that run's writer. Prune the retired version's namespace afterward. Policy history on main is the audit trail, and the version in each ref prevents retired refs from becoming eligible again.

## Ref shape

```
refs/testpass/<version>/<tree-hash>  →  <validated commit>
```

- A **bare ref**: no metadata object. The ref name carries the attestation version and the attested tree hash; the ref points at the validated commit whose tree has that hash.
- **Create-only, enforced atomically.** The writer pushes with a create-only compare-and-swap — `git push --force-with-lease=<ref>:` with an empty expected value — never an existence-check-then-push, which races. Two benign outcomes are successes: creation, and the transport-level no-op when the ref already points at the pushed commit (`Everything up-to-date` — measured, not assumed: an identical re-push never reaches the lease because nothing would change). A lease **rejection** means the ref exists pointing elsewhere: the writer fetches it by name and validates (object is a commit; name↔tree invariant holds) — a valid existing attestation is idempotent success without pushing; a malformed one is **not** success — it is reported loudly and left for exact-ref prune.
- A consumer must fetch the advertised object by ref name before resolving anything from it, then verify the invariant: `rev-parse <ref>^{tree}` must equal the `<tree-hash>` in the name and the object must be a commit. Any mismatch is a malformed ref — ignored by skip logic (fail toward running) and deletable by prune's exact-ref path.
- Experiments use `refs/testpass-lab/*` exclusively; CI never honors lab refs and lab refs are pruned by their experiment.

## Who writes, and when

An attestation is written only when the **eligibility predicate** holds — every clause, no exceptions. A green run that fails any clause simply does not attest; it is never an error.

1. **Eligible source.** A production attestation has exactly two eligible source classes: a publication-qualifying Blaxel verify, or the repository's GitHub Actions CI workflow after its complete validation graph passes. There is no third source class. In particular, a `local` provider run is ineligible regardless of cleanliness, scope, or result because a developer host is not a controlled validation environment. `--no-publish` suppresses publication on an otherwise qualifying Blaxel verify without changing its execution.
2. **One tree, everywhere.** All gate phases targeted a single captured tree: the runner captures `attestedTree = rev-parse HEAD^{tree}` before the first phase, and every phase runs against it. A verify whose test phase targets a different commit than its lint/type-check checkout (`--commit <other-than-HEAD>`) is ineligible — the phases would validate two different trees and the attestation would claim a gate no single tree passed.
3. **Clean and unchanged, bracketed.** The checkout is clean at start **and re-verified clean with the same HEAD at end** (`git status --short` empty, `rev-parse HEAD^{tree}` equal to the captured value). `--ignore-uncommitted` is ineligible. A recorded `workingTreeDirty: false` at start alone is insufficient.
4. **Complete scope.** Every surface in the gate scope produced a **passed** result — none skipped, none absent. `--shard-indices` subsets, partial suites, targeted selectors, and environment knobs that skip a gate surface (e.g. `SKIP_ELECTRON_E2E=1` recording desktop as skipped) are all ineligible. Environment knobs that are part of the gate's canonical configuration (e.g. `SKIP_ACP_TESTS=1`, which guards suites outside the gate scope) do not affect eligibility.
5. **Canonical retry policy.** The gate's standard retry budget ([test-runner.md](./test-runner.md)) applied; a run with a nonstandard retry override is ineligible. A pass that used the standard budget attests exactly like it gates: a recovered flake is a pass.
6. **Not itself attested-skipped.** A run whose heavy phase was skipped by an existing attestation never writes (it would refresh nothing and must not extend anything).
7. **Policy permits** (below), with the version captured before the first phase and re-read at completion — both reads valid, enabled, and equal (§Attestation version).

Eligible writers and their credentials:

- **`blaxel-verify`:** `verify` automatically writes after a passing publication-qualifying Blaxel run as defined by [test-runner.md#^test-publication-qualifying](./test-runner.md#^test-publication-qualifying) when clauses 2–7 hold. It tests a committed revision fetched from origin and pushes with the caller's existing origin credential. No publication flag is required.
- **`github-ci`:** the `attest-write` job writes only after a fully green GitHub Actions run (all matrix jobs, build, all shards, join). The command boundary requires GitHub Actions, workflow `CI`, job `attest-write`, and the positively classified `TV_TEST_REF_PUBLICATION=required` context before it reaches the production writer. The job uses `contents: write`. A fork carries `not-authorized` and cannot write.

The production writer receives one of those source identities and refuses any other source before pushing. Although GitHub-hosted test jobs invoke the runner with `provider=local` inside their ephemeral VMs, the attestation source is the complete `github-ci` workflow and its strict join, never one local-provider child. A developer local verify, a narrowed Blaxel verify, and an opted-out Blaxel verify never reach the production writer.

Trust model: identical to the team's existing repository-write trust, as ratified. Anyone who can push code can already change what the gate runs; attestation grants no authority beyond what `contents: write` and repo-write membership already carry.

## Skip semantics in CI

On validation-bearing events, the CI workflow gains one cheap, always-run decision job and conditions on it:

- **`attest-check`** (seconds, no install): computes `git rev-parse HEAD^{tree}`, reads the activation policy from the `origin/main` blob ([#Activation policy](#Activation policy)), looks up `refs/testpass/<version>/<tree-hash>` on origin, fetches and verifies the ref (object type, name↔tree invariant, age bound), and emits `skip=true` only when **every** check affirms. Its log states the tree hash, version, the ref found or absent, and the decision — a skip must be auditable at a glance. Wiring semantics, exactly:
  - **Expected negative outcomes are successes.** Lookup errors, unreachable origin, unreadable policy, malformed refs: the job catches them and completes **successfully** with the explicit output `skip=false`. An expected error never fails the job.
  - **Unexpected failure is non-gating.** The job runs with `continue-on-error: true`, so even a crash cannot redden the workflow conclusion (which would block `publish.yml`'s `workflow_run` gate). A crash **before** the decide step publishes no outputs; a crash **after** it does NOT erase them — GitHub preserves outputs written by a successful step even when a later step fails the job — so absence of outputs alone is not a safe no-skip signal (next bullet).
  - **Skip authorization is bound to decision-job success via the `authorized` output, not `needs.*.result`.** A decide that emits `skip=true` followed by a later step failing the job leaves the preserved output claiming a skip from a FAILED decision job — and the obvious binding does not work: under job-level `continue-on-error`, dependents read `needs.attest-check.result` as `'success'` even when the job failed (measured: run 29558875144, where result-based guards honored the preserved skip). Instead `attest-check`'s **final** step emits `authorized=true`; its implicit `success()` condition means any earlier step failure leaves it unset, and no step may follow it. Every consumer of the skip output — the heavy jobs' no-op steps and real-step guards, the join's attested branch, and `attest-write` — requires `authorized == 'true'` in addition to the literal skip `'true'`. The no-op condition is `skip == 'true' && authorized == 'true'`; the run-everything guard is its negation `(skip != 'true' || authorized != 'true')`. Known residual, accepted and documented: a failure in a post-action (e.g. checkout cleanup) runs after the final step and cannot retract an already-emitted authorization — the decision itself was validly computed by then, so the skip remains sound.
  - **Heavy-job conditions are skip-only-on-explicit-signal:** an absent, empty, or false output runs everything and only the literal `'true'` no-ops. The join's third condition conversely requires the literal `'true'`: it affirms only on the explicit signal, never on absence.
  - **Never-skip-on-doubt applies to the job graph itself.** A heavy job's `needs` on `attest-check` must not let GitHub's implicit `success()` gate suppress it when the decision job **crashes**: each heavy job's condition carries a status-check function (`!cancelled()`) so a failed `attest-check` still runs full validation — without it, a crashed decision job skips the entire heavy tier and the join can green a run with zero heavy validation. The e2e shards additionally require `needs.build.result == 'success'` explicitly, preserving the failed-build ⇒ shards-skipped ⇒ join-red edge that the implicit gate used to provide.
  - **The skip is enforced at step level, never at job level, on matrix jobs.** Branch protection requires the concrete matrix check contexts (`unit`, `e2e:desktop`, each `e2e shard n/16`), and GitHub evaluates a job-level `if` before matrix expansion — a job-level skip therefore suppresses the concrete contexts entirely and a required-context ruleset blocks the PR forever despite the green join (measured: run 29554767152 emitted only the unresolved templated names). Instead every heavy job always expands; under an attested skip each of its steps is guarded by `needs.attest-check.outputs.skip != 'true'` (composed with any existing step condition, including `always()` post-steps, which would otherwise run anyway) and the job fast-succeeds as an explicit logged no-op, emitting its concrete required context green.
- **What always runs on validation-bearing events:** lint, type-check, package-manifests, and `attest-check` itself. Only the heavy jobs (`unit`, `e2e:desktop`, `build`, the e2e shards) honor an attestation `skip`. Draft pull requests skip the complete graph under their separate job guards.
- **The join** (`e2e-required`, [github-ci.md](./github-ci.md)) is neutral/skipped on a draft pull request because its job-level condition composes `always()` with the same draft guard as the validation jobs. On every non-draft event it runs despite dependency outcomes and is green only when build and e2e both report success. An authorized attestation reaches that state through successful step-level no-ops; each artifact-download, unpack, and plan-agreement step is skipped by its explicit step-level guard on the authorized attestation outputs. Missing, skipped, cancelled, upstream-failed, and test-failed dependencies are red on this run path.
- **Main-push:** the same mechanism with no special casing — a squash-merge that reproduces an attested tree (branch up to date at merge) skips identically, and the CI conclusion stays green, so `publish.yml`'s `workflow_run` gate proceeds. A merge that produces a novel tree (conflict resolution, stale branch) misses and runs everything.

## Failure modes — never skip on doubt

Every failure resolves to running the tests:

- origin unreachable, `ls-remote` timeout or error → run everything.
- policy blob unreadable, malformed, or missing the flag → treat as disabled: no skip (and no write).
- ref present but name↔tree invariant fails, or the age bound cannot be computed → ignore the ref, run everything.
- `attest-check` job itself fails → heavy jobs run (its conditions are written so job failure means no-skip, not workflow failure).
- Write failures are non-fatal to the run that tried to write: a green run whose attestation push fails stays green and logs the failure; attestation is an optimization, never a gate.

## Staleness, age, and revocation

- **Definition changes:** self-invalidating by tree identity (above). No revocation machinery is needed for "the workflow changed" — the hash changes.
- **Environment drift:** an attestation is honored only when `0 ≤ now − committerTime ≤ 7 days`. Age is computed from the validated commit's committer timestamp — a conservative proxy, since bare refs carry no timestamp of their own: a commit validated long after it was authored *understates* its remaining validity and expires early, failing toward running tests. The lower bound matters too: git permits future committer timestamps, and a future-dated commit would otherwise stay eligible past 7 days after its validation — so a future timestamp, like an unparseable one, is rejected outright (no-skip). The bound and the proxy are named in `attest-check`'s log line.
- **Revocation:** deleting the ref revokes the attestation. The prune command's exact-ref path is the tool; the policy flag is the global kill switch — flipping it off stops every **new** skip decision immediately (each `attest-check` reads the trusted policy fresh), while a run whose decision already emitted `skip=true` finishes as an attested-skip; an emergency revocation that must also stop in-flight skips drains or cancels running workflows, as in step 2 of the version-change procedure. Refs are untouched either way — they are inert without the flag.

## Activation policy

Both writing production attestations and honoring them in CI are **default-deny**. The committed policy has this shape:

```ts
interface AttestationPolicy {
  schemaVersion: 1;
  testpassRefsEnabled: boolean;
  testpassVersion: number;
}
```

It lives at `test/testpass-policy.json`. `testpassRefsEnabled` gates production writes and skips; `testpassVersion` is the attestation version defined above. Every reader resolves the current `refs/heads/main` object ID from `origin`, fetches that exact object when necessary, and reads the policy blob from that object. It never trusts the tested checkout's copy, so a work branch cannot activate itself; only the operator's policy change on main turns production writes and skips on. An unreachable origin, failed fetch, absent default branch, missing policy blob, malformed JSON, unsupported schema, a key set other than the three above, or a non-boolean flag makes the policy unavailable: no write, no skip, and no prune deletion. Lab-namespace experiments (`refs/testpass-lab/*`) do not consult the policy but are never honored by CI.

## Prune and retention

```
npm test -- testpass prune --older-than 30d                                   # dry run, current version
npm test -- testpass prune --older-than 30d --apply
npm test -- testpass prune --dead-version <n> --apply                           # sweep an entire retired version
npm test -- testpass prune --delete-ref refs/testpass/<version>/<tree-hash> --apply
```

The command fetches the namespace explicitly (custom namespaces are not fetched by branch refspecs), is a dry run by default, deletes on origin and locally only with `--apply`, and uses exact-ref deletion for revocation and malformed refs. Before choosing refs to delete, the namespace fetch updates the local refs from origin and removes local refs that no longer exist there. Safety semantics, all modes: an unavailable or malformed trusted policy read means **zero deletions**; the age cutoff is exact and pinned (a ref at exactly the cutoff age is retained — deletion requires strictly older); `--dead-version` refuses the current version and any version ≥ current; `--delete-ref` rejects globs, non-version-qualified names, and any ref outside `refs/testpass/`. If deletion fails for a ref, the command reports that ref and exits non-zero. It stops at the first failure; later candidates remain untouched and are reported as not deleted. Three modes:

- **Age-based** (default): operates within the current trusted version, deleting refs older than the cutoff by the same committer-timestamp proxy as skip logic.
- **Dead-version sweep:** `--dead-version <n>` deletes every ref under `refs/testpass/<n>/*`. Per the safety semantics above it refuses when `<n>` equals or exceeds the current trusted `testpassVersion` read from `origin/main` — sweeping the live version is mass revocation and must go through the policy disable or exact-ref deletion instead. This completes the retired-namespace cleanup in the version-change procedure.
- **Exact-ref:** revocation and malformed-ref removal, version-qualified name required.

Attestations are pure optimization state and are always safe to delete (the cost of over-pruning is one redundant test run). Growth is naturally bounded at one ref per unique validated tree per version; age-based pruning bounds the live namespace and dead-version sweeps empty retired ones.

## Testing

Under the testing policy's [seam-test rule](../testing-policy.md#^shape-seam), the repository's tests of the attestation writer and prune command use real Git. They create objects, fetch and push refs, collide with an existing ref, and delete refs. They do not replace any part of Git. The repository's tests inspect the workflow file. They provide evidence about its contents, not about a live GitHub Actions run.

Before a change to this mechanism reaches main, an isolated copy of the complete CI graph must run only on the branch that carries the change. That copy must demonstrate:

- an eligible lab write;
- reuse of the identical tree with every concrete required check context green;
- all heavy jobs running when an attestation is absent or unreachable, or when the decision job fails before or after emitting `skip=true`; and
- the join turning red after a build failure.

In explicit lab mode, `npm run verify -- blaxel` must publish the attestation automatically as part of the same command. The lab refs are pruned afterward.

No test can exercise the trusted `origin/main` policy read or the credentials for writing to the production namespace. No test can show that `publish.yml` proceeds after an attested-skip run on main. After enabling the policy, the operator checks these behaviors during the first production Blaxel verify, the first production CI run, and the first attested-skip run on main. Disabling the policy flag provides the immediate rollback.


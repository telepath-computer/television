*Tree attestations: recording that an exact tree passed the full gate, so that GitHub CI can skip its heavy test jobs for that tree, without ever skipping on doubt.*

# Test attestation

An *attestation* records that a tree passed the full gate, so that later CI runs of the identical tree skip their heavy test jobs instead of repeating them. That saves minutes on pull requests and lets publication from `main` proceed sooner. Cheap checks always run, and any doubt resolves to running the tests. Attestation is an optimization, never a gate.

The CI jobs that skip are owned by [github-ci.md](./github-ci.md), and the verify command that writes attestations by [test-runner.md](./test-runner.md#verify).

## The claim

An attestation is the ref `refs/testpass/<version>/<tree-hash>` on `origin`, pointing at the commit that was validated. It claims that the tree with that hash passed lint, type-check, the package manifest checks and the complete `all` suite, desktop included, with the runner's standard retry budget. A recovered flake counts as passing, as it does in the gate. Blaxel workers have no Firefox ([test-runner.md](./test-runner.md#the-test-registry)), so an attestation from a Blaxel verify does not cover the Firefox projects, and CI skips them too for that tree.

- The tree hash, `git rev-parse <commit>^{tree}`, covers every tracked file, including the workflows, the registry and the tests. Any tracked change that alters the gate therefore gives a different tree.
- It does not cover what lives outside the tree: the versions behind action tags, the runner image, repository settings, secrets and variables, and external services. Two things bound that exposure. An attestation is honored only while its commit's committer time is at most 7 days old; a future committer time is rejected. And the ref carries a version that the operator raises when a known outside change alters what passing means.
- The ref is bare, with no metadata. A reader fetches it by name, checks that it points at a commit whose tree matches the hash in the name, and ignores it otherwise.
- Writes are create-only and atomic: `git push --force-with-lease=<ref>:` with an empty expected value. Finding an existing valid attestation for the tree counts as success. Finding a malformed one is reported and left for pruning.
- Experiments write `refs/testpass-lab/*`, which CI never honors.

## Who may write

Exactly two sources write attestations:

- **A complete Blaxel verify.** Its test phase runs the whole `all` suite with no narrowing selector and no shard subset; `--shards` only changes the partition. It writes with the caller's own push credential, unless `--no-publish` is passed.
- **The GitHub CI workflow's `attest-write` job,** after the complete graph and its join have passed, for a run from the repository itself; fork runs cannot write. The writer refuses unless it runs in GitHub Actions, in workflow `CI`, job `attest-write`, with `TV_TEST_REF_PUBLICATION=required`.

Either source writes only when all of these hold:

- Every phase checked one tree. The checkout was clean when the run started and is still clean, with the same tree, when it ends. A verify whose tests target a commit with a different tree from its checkout cannot write, and neither can a run with `--ignore-uncommitted`.
- Every surface of the gate passed, and none was skipped, for example by `SKIP_ELECTRON_E2E=1`.
- The standard retry budget applied.
- The run did not itself skip heavy jobs because of an attestation.
- The policy permitted writing, under the same version, both when the run first read it, before any of its tests, and when the run finished.

A local run never writes, whatever it ran, because a development host is not a controlled environment. A run that misses a condition simply does not write; that is not an error. A failed write is logged and leaves the run's result unchanged.

Anyone who can push to the repository can already change what the gate runs, so attestation grants no authority beyond that write access.

## Policy

Writing and honoring attestations are both off unless the policy on `main` turns them on:

```ts
// test/testpass-policy.json
interface AttestationPolicy {
  schemaVersion: 1;
  testpassRefsEnabled: boolean;
  testpassVersion: number; // integer from 1 to 999999999, written in ref names as plain digits
}
```

Every reader, whether the writer, CI's decision job or prune, reads this file from the current `main` on `origin`, never from the checkout under test, so a branch cannot enable itself. Anything unexpected means disabled, with no write, no skip and no prune deletion. That includes an unreachable origin, a missing file, malformed JSON, keys other than these three, and a version out of range. Only refs under the current version are honored.

## Skipping in CI

On every run that is not for a draft, CI's `attest-check` job decides `skip=true` only when every check affirms: the policy is enabled, a ref exists for the tree under the current version, its commit matches the name, and its age is in range. Its log names the tree, version, ref and decision. GitHub Actions behaves in ways that make the obvious wiring unsafe:

- Expected problems, such as an unreachable origin, an unreadable policy or a malformed ref, end the job successfully with `skip=false`.
- The job is marked `continue-on-error`, so a crash cannot turn the workflow red, which would block publication. Under `continue-on-error`, though, dependent jobs see the job's result as success even when it failed, and outputs written before a failing step survive. Consumers therefore trust a skip only together with `authorized=true`, an output written by the job's last step, which any earlier failure prevents. A post-action that fails after that step cannot retract the authorization. That limitation is accepted, because the decision was already made correctly.
- Heavy jobs carry `!cancelled()`, so they still run when the decision job crashes. End-to-end shards also require that the build succeeded.
- On matrix jobs, the skip is applied to each step, never as a job-level condition. GitHub evaluates a job-level condition before expanding the matrix, so a matrix job skipped that way never reports its concrete check names, such as `unit` and `e2e:desktop`, and the ruleset waits for them forever. A skipped heavy job instead runs as a logged no-op that reports success.

Only the heavy jobs skip: unit, desktop end-to-end, the build and the end-to-end shards. The join passes an authorized skip through. A push to `main` that reproduces an attested tree, as an up-to-date squash merge does, skips the same way and stays green, so publication proceeds.

## Revoking and pruning

Deleting a ref revokes that attestation. Setting `testpassRefsEnabled` to `false` on `main` stops new skips and writes at once. A run that has already decided to skip still finishes skipped; cancel it if the revocation is urgent.

`npm test -- testpass prune` is a dry run unless `--apply` is passed:

- `--older-than <days>d` deletes current-version refs strictly older than the cutoff, by committer time;
- `--dead-version <n>` deletes every ref of a retired version and refuses the current version or any later one;
- `--delete-ref <ref>` deletes one exact, version-qualified ref under `refs/testpass/`.

Prune refreshes the namespace from `origin` first, deletes nothing when the policy cannot be read, and stops at the first failed deletion. Pruning is always safe: the cost of removing too much is one redundant test run.

## Operations

When a known outside change, such as a new runner image or new action versions, alters what passing means, change the version so that no run validated under the old conditions can write or be honored afterwards:

1. Set `testpassRefsEnabled` to `false` on `main`.
2. Let in-flight runs finish, or cancel them.
3. Make the outside change.
4. Raise `testpassVersion` to a value never used before. Never reuse a version.
5. Set `testpassRefsEnabled` back to `true`, then prune the old version with `--dead-version`.

A run that read different versions at its start and its end cannot write.

## Testing guidance

The workflow's behavior can be shown only by a live run. Before a change to this mechanism reaches `main`, an isolated copy of the CI graph on the branch carrying the change must show these behaviors against lab refs:

- a write;
- a skip with every required check green;
- the heavy jobs running when the decision job fails before or after deciding to skip.

In lab mode, a Blaxel verify publishes as part of the command. Lab refs are pruned afterwards.

No test can exercise the trusted read of `main`'s policy, the production write credential, or publication proceeding after an attested skip on `main`. After enabling the policy, the operator checks the first production Blaxel verify, the first production CI run and the first attested skip on `main`; turning the flag off is the rollback.

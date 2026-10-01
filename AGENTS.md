# Agent Guidelines

Read the governing specs before making changes. Start with the links below.

## UI conformance

The automated markup-comparison system remains deferred until after release in [TV-649](specs/arch/ui/conformance.md#release-exception-for-tv-649). Existing stylesheet-copy, browser and verification assertions remain active. Do not revert UI specifications to match a nonconforming implementation.

## Team developer telemetry marker

Developers on the team MUST create the host marker before running Television on a development host:

```bash
touch ~/.tv-developer
```

The marker keeps production installations on development hosts silent. Telemetry enablement and destination follow the [four-rule cascade](specs/product/telemetry.md#^telemetry-rules). Persisted daemons check the marker in the installing user’s captured operating-system home on each boot.

## Specification authority

Specs govern the requirements they state; code governs the rest. The [migration map](specs/spec-migration.md) records the authority boundaries, and the [spec index](specs/index.md) locates the owners. Each product, architecture, and UI spec has an agent-owned proof at the mirrored path under `proofs/`; [proof policy](specs/spec-proofs.md) defines that relationship.

## Changing specs

Follow [spec policy’s ownership rules](specs/spec-policy.md#Slop-free zone) and [the workflow’s human-intent guidance](specs/spec-workflow.md#Human intent and agent judgment). They define what agents may resolve autonomously and what the human reviews before merge.

## Working documents

`docs/working/` is the default place for working notes, ledgers, proposals, saved review findings, and other task documents. Once the work is complete, clean it up under [pre-merge docs prep](specs/spec-docs.md#^pre-pr-docs-prep) before treating the contribution as ready to merge into a shared branch. Work-in-progress and draft PRs keep working documents, regardless of human spec-review timing. `docs/archive/` carries salient working documents into squash-merge history. Its contents may be deleted periodically; read the relevant squash-merge commit to see how a past change came about ([docs spec](specs/spec-docs.md#^docs-archive)).

## Start here

- [Spec policy](specs/spec-policy.md) — authority, ownership, and authoring rules.
- [Spec workflow](specs/spec-workflow.md) — spec-first changes and review convergence.
- [Spec index](specs/index.md) — the requirements and their owners.
- [Migration map](specs/spec-migration.md) — requirements under spec authority and code-authoritative boundaries.
- [Docs spec](specs/spec-docs.md) — guides, working documents, the archive, and pre-merge docs prep.

`docs/guides/television-admin-guide.md` is the source for the public administrator guide at `https://television.run/install.md`. Updating the source does not deploy the public copy; the [administrator-guide spec](specs/arch/cli/admin-guide.md) defines its publication arrangement.

`specs/arch/updates/update-channel.json` is the master copy of the public update channel at `https://television.run/update-channel.json`. The [update-channel spec](specs/arch/updates/update-channel.md#^channel-master-copy) defines how it is published and when a pull request must update it.

UI work follows the [UI conformance spec](specs/arch/ui/conformance.md). Test requirements are owned by the testing specs below.

## Shared branches

The [shared-branch workflow](specs/spec-workflow.md#^shared-branch-workflow) owns contributions to `main` and branches under `integration/`.

- Development branches may be unfinished or failing; commits, pushes, and draft pull requests may be used as checkpoints.
- To contribute, finish the work and update the development branch so it contains every commit in its target before full validation. Commit and push that tree, then open a ready pull request or mark its draft ready. Full validation may come from `npm run verify`, ready-pull-request GitHub CI, or both.
- Merge only after human review is complete and all required GitHub checks pass. If the target moves, update the development branch and validate the resulting tree again. For staged work, every spec delta receives human acceptance before its pull request into the integration branch merges; a later pull request to `main` cannot substitute.

## Testing

Use the [testing policy](specs/arch/testing-policy.md) for test authoring, iteration, and verification permissions. Use the [canonical test runner](specs/arch/test-runner/test-runner.md) for commands, the [remote preflight spec](specs/arch/test-runner/preflight.md) for committed revisions, and [Blaxel setup](specs/arch/test-runner/blaxel-testshards.md) for credentials and infrastructure.

## Commits

Do not add a `Co-Authored-By` trailer to commit messages.

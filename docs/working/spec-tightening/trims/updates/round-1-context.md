# Trim review context: updates area, round 1

## Area and specs

Area: updates and versioning. The trimmed specs are:

- `specs/product/update-notifications.md`
- `specs/product/versioning.md`
- `specs/arch/updates/index.md`
- `specs/arch/updates/update-channel.md`
- `specs/arch/updates/desktop-upgrade-gate.md`
- `specs/arch/updates/desktop-upgrade-recommendation.md`
- `specs/arch/updates/desktop-self-update-notice.md`
- `specs/arch/updates/version-advertisement.md`
- `specs/arch/updates/runbook-channel-deploy.md` (runbook)
- `specs/arch/updates/runbook-ux-staging.md` (runbook)

`specs/arch/updates/update-channel.json` is the master copy of a public file and was not edited.

## Base commit

`f6cdd91e417e1f94c8617baebb016e921c21d6e5` (`git merge-base HEAD origin/thopter/spec-tightening`). See the trim with `git diff f6cdd91e..HEAD`.

## What the trimmer did, in outline

- Replaced each `## Testing` section with `## Inputs to proof derivation that the spec does not otherwise show`, keeping directives and coverage-owned-elsewhere statements and cutting restatements of the spec's own promises.
- Folded "Plain english" paragraphs and "What this owns" sections into one introduction per spec.
- Cut source paths and internal function or constant names where they name no contract, restatements of rules owned elsewhere (for example the unknown-message rule in `index.md`, `tv status` details in `versioning.md` that `product/cli.md` owns, non-goals that repeated earlier statements), history ("verified against the repo's full history", the pre-`window.__tvVersion` fallback in the staging runbook), and the channel fetch's 10-second timeout.
- Removed the uncited anchor `^gate-server-keyed` in `desktop-upgrade-gate.md`, keeping one sentence of its content in the delivery paragraph; the product spec's `^gate-server-driven` carries the rest.
- Repointed links to the renamed `#Testing` headings in other specs and proofs (link text only). `product/telemetry.md` now points at `update-notifications.md#Telemetry`.

The trimmer kept text where unsure. Known doubtful keeps include the TV-684 cutoff paragraph (`^pre-gate-legacy-cutoff`), `^poll-lifecycle`, the `?t=` cache-busting detail, the `packages/server/src` location of the required-version constant, and `^pv-machine-boundary` (condensed, because test comments cite it, though `product/cli.md` states the same rule).

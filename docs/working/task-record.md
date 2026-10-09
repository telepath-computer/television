# Task record: CLI artifact layout

Branch `stlhood/cli-artifact-layout`, worktree `~/television-cli-layout`, based on `origin/main` at 9b69906 (fetched after SSH was fixed; up to date as of 2026-10-08).

## Settled intent (human, 2026-10-08)

- Proposal `proposal-cli-artifact-layout.md` approved as written.
- Telemetry unchanged (no move event).
- Early handoff: agents derive spec edits and converge them; human reviews all spec deltas on the PR before it merges.
- SSH fixed. No permission for local full verification (`--allow-extreme-inefficiency`). Full verification goes through Blaxel on a pushed head.
- Open a draft PR for morning review.

## Reviewer setup

Codex CLI 0.154.0, `gpt-6-astra`, `model_reasoning_effort="xhigh"`, fresh `codex exec` per review, given `developer-skills/tvdev-review/SKILL.md`. The auto-mode classifier refused `--dangerously-bypass-approvals-and-sandbox`, so reviews run with `--sandbox read-only` (enforces the read-only boundary; reviewers cannot run the test runner, which writes `.test-runs/`).

## Stages

- [x] Spec edits derived (ab3ad83)
- [ ] Spec convergence
- [ ] Proofs derived and converged
- [x] Slice decision / plan (one slice, no plan)
- [ ] Implementation (red/green) and convergence
- [ ] Update branch with origin/main, full verification (Blaxel)
- [ ] Docs prep, draft PR

## Findings and validation log

- Spec review round 1 dispatched against ab3ad83.
- Round 1 FAIL (ab3ad83): interrupted move unrecoverable (blocking); unconditional tab removal; content-total wording. Fixed in a70f641 with a durable move record completed at startup.
- Round 2 FAIL (a70f641): failed-save rollback contradicted startup completion (blocking); ownership statement; focus-directive definition. Fixed in 52f841b: the saved move record is the commit point.
- Round 3 dispatched against 52f841b.
- Proof and skill-guidance drafts committed at 8c98372/52f841b ahead of proof convergence (proof stage starts after the spec gate).
- Slice decision: one slice. Server move + startup completion + route + shared client method, two CLI commands, web client handling of moved-in artifacts, skill text: small, tightly coupled, reviewable as one result. No plan.
- Implementation note: web client learns artifact records from `artifact-created`; a `channel-updated` that adds an unknown artifact leaves no record, so the move needs client handling (see artifacts proof ^af-ac-move).

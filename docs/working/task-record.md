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
- [ ] Slice decision / plan
- [ ] Implementation (red/green) and convergence
- [ ] Update branch with origin/main, full verification (Blaxel)
- [ ] Docs prep, draft PR

## Findings and validation log

- Spec review round 1 dispatched against ab3ad83.

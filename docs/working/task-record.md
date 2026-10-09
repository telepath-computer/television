# Task record: CLI artifact layout

Branch `stlhood/cli-artifact-layout`, worktree `~/television-cli-layout`, based on local `main` at 9b69906 (not yet fetched: SSH was failing).

## Settled intent (human, 2026-10-08)

- Proposal `proposal-cli-artifact-layout.md` approved as written.
- Telemetry unchanged (no move event).
- Early handoff: agents derive spec edits and converge them; human reviews all spec deltas on the PR before it merges.
- Human is fixing SSH; no permission for local full verification (`--allow-extreme-inefficiency`). Full verification goes through Blaxel on a pushed head.
- Open a draft PR for morning review.

## Reviewer setup

Codex CLI 0.154.0, `gpt-6-astra`, `model_reasoning_effort="xhigh"`, fresh `codex exec` per review, given `developer-skills/tvdev-review/SKILL.md`.

## Stages

- [ ] Spec edits derived
- [ ] Spec convergence
- [ ] Proofs derived and converged
- [ ] Slice decision / plan
- [ ] Implementation (red/green) and convergence
- [ ] Update branch with origin/main, full verification (Blaxel)
- [ ] Docs prep, draft PR

## Findings and validation log


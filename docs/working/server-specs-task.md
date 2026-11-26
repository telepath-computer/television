# Server specs: task record

Working record for the task of moving Television's server from code authority to spec authority. No standing.

## Request (Josh, 2026-11-26)

Read every spec that touches server mechanics. Move the server from code authority to spec authority. Follow the revised spec policy rigorously on what belongs in a spec versus what is over-specified; the current specs tend to be too heavy. This is partly a reorganization: buffers holding server content move into server specs, and server content specified elsewhere may move too.

Context: three agents do this independently today (this one is the third, Opus 5.5, worktree `server-specs-opus55`); a fourth agent compares them. Do not read the other worktrees (`server-specs`, `server-specs-fable52`).

## Workflow position

- Handoff: verbal instruction for a large change. Agents derive spec deltas; independent agent review (Codex `gpt-6-astra`, `xhigh`) must converge before proofs. Human spec review may wait for the PR.
- This session's deliverable: the spec deltas, converged. Proofs, proof relocation, and code-comment citation fixes follow the spec gate and need Josh's go-ahead.
- `test/repo/spec-links.test.ts` enforces link targets, block-ref existence and uniqueness, the proof mirror, and code citations `specs/...md#^id`. Moving anchors or adding specs breaks it until proofs and citations follow. Acceptable as a development checkpoint; must be green before merge.

## Settled direction (my judgment, to report)

- Domain specs keep domain requirements even when a server module implements them (themes, resources, telemetry, updates, onboarding already work this way). Server specs own the server's own mechanisms: process lifecycle and listeners, authentication, the route surface and its authorization, `/health`, the `/events` stream, the data directory and its storage rules, bootstrap ordering, the channel and artifact registry, the artifact proxy, the content watcher.
- Buffers dissolve to their real owner, which is not always the server spec.

## Status

- [x] Read governance specs and writing skills
- [x] Read server-related specs and the server package's code
- [x] Designed the server spec tree and the moves
- [x] Wrote the specs and edits (commit `5ce976ba`)
- [x] Wrote `server-spec-changes-overview.md` for the judge
- Independent review: not applied to this result. The owner asked for the three attempts to be compared as unreviewed output.
- Proofs and code citations: not moved, on the owner's instruction.

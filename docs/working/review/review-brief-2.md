# Independent spec review: Television server specs

You are an independent reviewer for a Television contribution. Read and follow the reviewer skill at `/home/user/.claude/skills/tvdev-review/SKILL.md`. Do not load `tvdev-contribute`.

**Boundaries.** This review is read-only: do not edit, create, commit, push or delete files anywhere, and do not write to any persisted memory or memory files. Work only in the checkout `/home/user/workspace/wt/television/server-specs-opus55`. Do not read the other worktrees under `/home/user/workspace/wt/television/` (`server-specs`, `server-specs-fable52`): they are independent attempts at the same task and must not influence this review.

## Stage and result under review

Stage: **spec-delta convergence** (the review every spec delta needs before proofs are derived; see `specs/spec-workflow.md`, "Recommended approach" and "Independent review and convergence"). Review the specs only.

Result: branch `thopter/server-specs-opus55` at its current HEAD, diff `174e52ef..HEAD` in that checkout (`git diff 174e52ef..HEAD -- specs`). Base `174e52ef` is `origin/main`.

## Human intent

The repository owner asked, in their own words: read all the specs that touch server mechanics; move the server from code authority to spec authority; follow the core spec policy (`specs/spec-policy.md`) rigorously on what properly belongs in a spec versus what is over-specified, since the repository's specs tend to be too heavy and the policy was recently revised to say what belongs; the work is not just new spec files but some reorganization — buffers in other specs hold server content that should move into server specs, and server content specified elsewhere may belong in server specs and should move.

The owner then said: proceed on best judgment to a finished state on the spec changes; moving proofs and updating code-comment citations is **deliberately skipped** in this work. So: `proofs/` still cites anchors at their old paths, a few new specs have no proof file, and `test/repo/spec-links.test.ts` will fail on proofs and code citations. Do not report those as findings. Do report broken links or anchors inside `specs/`.

## What the author decided (assess these, do not take them as given)

- New tree `specs/arch/server/`: `index.md`, `lifecycle.md`, `http.md`, `storage.md`, `migration.md` (moved from `specs/arch/layout/migration.md`), `local-content.md`.
- Ownership principle: a feature's spec keeps the requirements the server carries out for that feature (themes, resources, telemetry, updates, onboarding already worked this way); the server specs own the mechanisms every feature shares.
- Buffers dissolved: the server half of `arch/cli/startup-bind-failure.md` (the migration map already planned that split), the CLI spec's server-origins and ACP home-context buffers, the onboarding installer's bootstrap, token-only and default-channel sections, channel state's display-migration buffer, the resource layer's artifact-record, share-serving and `/events` buffers, reload-navigation's content-watcher buffer. `arch/telemetry/server-telemetry-buffer.md` was deleted: the author judged most of it duplicated the telemetry module specs, moved the "prior serving evidence" definition into `arch/telemetry/identity.md` and the activity-signal acceptance rule into `arch/telemetry/sessions.md`, and put the route list and event-stream rules into `arch/server/http.md`. Check that nothing with real authority was lost in that deletion (`git show 174e52ef:specs/arch/telemetry/server-telemetry-buffer.md`), and the same for every other moved buffer.
- Moved statements were each re-judged under the policy; some were trimmed (history, backlog notes, restated rules). Moved anchors kept their IDs. Judge whether trims removed anything that belongs, and whether moved or new text is over-specified.
- Deliberately left code-governed or silent: the route and event wire vocabulary shared with the same release's app and CLI (per `arch/channel-state/index.md#^cs-wire-carve-out`); the Markdown editor's content protocol; the ACP bridge apart from its home context; the durability of channel and display record writes and the treatment of unreadable channel or artifact records at load (the author regards these as open owner decisions and kept them out of the specs).

The author kept a non-authoritative notebook of suspected defects in `docs/working/server-notebook.md`; you may read it for context, but it is not under review.

## What to return

Review the whole affected spec tree, not only the edited lines: coherence, consistency, ownership and DRY, implementability (predictable behavior across reasonable interpretations, per `specs/reviewer-checklist.md`), accuracy against the current code in `packages/server/` where the specs describe existing behavior, over-specification and missing decisions in both directions (`specs/spec-policy.md`, "Review discipline"), and the writing standards the policy names. Report all findings, prioritized, mark which are blocking, give the file and line or quote for each, and end with a binary verdict line: `VERDICT: PASS` or `VERDICT: FAIL`.

## Previous round

This is the second round. The first round returned FAIL with these findings, which the author assessed as warranted and remediated (commit `HEAD`, on top of `5ce976ba`). Review the whole current result again, not only these; verify each remediation rather than trusting this summary.

1. Boot focus unresolved when a valid record holds `null` focus and bootstrap creates "Default": now `storage.md#^srv-boot-focus` requires focusing an existing channel, with an implementation note that the code does not yet do it.
2. Unreadable display record: `storage.md#^srv-display-load` now says a record that cannot be read stops the boot, and a readable malformed one is replaced by fresh state.
3. Persistence and damaged-record decisions: the author decided, under the owner's instruction to proceed on best judgment, to require atomic replacement of channel and display records (`#^srv-record-replace`, with an implementation note), and to state the existing load behavior (`#^srv-artifact-record-load` stops boot, `#^srv-channel-record-load` skips) with its rationale.
4. First bind failure misclassifies the install: recorded as an accepted limitation in `arch/telemetry/identity.md#^prior-serving-evidence`, linked from lifecycle.
5. Unexpected-error rule scoped to the server's final handler (`http.md#^srv-unexpected-failure`).
6. `product/artifacts.md` and `arch/artifact-frame/reload-navigation.md` ownership statements about the artifact record updated.
7. Single-server limitation restated as an unenforced assumption.
8. The future-field optionality rule dropped.
9. Stale ownership in `arch/onboarding/index.md` and `arch/themes/bundled-installation.md` fixed.
10. Watcher disappearance wording now distinguishes the watched path from the folder a watch is rooted in.

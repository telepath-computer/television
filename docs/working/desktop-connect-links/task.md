# Desktop connect links: task record

Working record for `thopter/desktop-connect-links`. Not authority. The approved intent is [proposal.md](./proposal.md), approved by Josh for spec authoring only (not implementation).

## Method

- Specs are written fresh from the proposal. From prerelease PR #387 (`telepath-computer/television-prerelease-archive`, `feat/new-onboarding` at `1fedba8`), only visual design authority is imported: the markup and styling of `specs/ui/setup/setup.frame`, `specs/ui/app/system-modal/system-modal.frame`, the artifact-frame and copy-button frame parameters, the large button and input sizes and the `--line-control-lg` token, and the workshop frames that stage them. No product, architecture or UI prose, testing directive or copy decision is taken from that PR.
- Reviews: Codex CLI, `gpt-6-astra`, `xhigh` effort, fresh process, read-only; the brief points the reviewer at the proposal.

## Obligations carried to implementation

- `specs/arch/updates/runbook-ux-staging.md` step 4 names the old connect window and "Connect to server…". Update it once the shell implements the setup screen and Disconnect from Server, executing the new steps before editing.
- `packages/skills/skills/television/src/app-shell-reference.md` documents the token form's markup for theme authors; it changes with the implementation.
- Publishing the updated admin guide to `television.run/install.md` happens after merge, no later than the desktop release that ships the setup screen.

## Review record

- Spec review round 1 (Codex gpt-6-astra, xhigh, read-only): FAIL, four blockers, all accepted and fixed in 3e166bbd and 9e318989: `tv links` token inclusion follows the running server, not the config file; the upgrade gate keeps priority once shown (consistent with the gate spec and the proposal's "as today"); admin-guide Docker and SSH paths gave bare addresses, and `0.0.0.0`/`127.0.0.1` listeners need address substitution; setup token errors must speak about the link. Two refinements also applied (explicit unreachable message for `tv links`; workshop retry clears the error treatment). Proposal and shared doc updated.
- Spec review round 2 (same setup): PASS, no blockers. Applied its one refinement: `Writable` declares `isTTY?: boolean`. No further review under the bounded refinement rule. Proof derivation next.
- The supervisor assigned a preliminary plan in parallel: planner on `thopter/desktop-connect-links-plan` (Codex gpt-6-astra), plan reviewer Claude Fable standing by. Josh did not request planning before proofs; the supervisor coordinates independent review.
- Connection states explainer added (bf850e0f) with its own focused review: PASS; refinement and source references applied (06becc24).
- Josh approved the spec deltas at 06becc24 (spec gate complete). Any later spec change returns to him as its own delta.
- Proof review round 1 (Claude Fable, xhigh, on bd1a7193): FAIL, three blockers. B1 (drag strip over a collapsed sidebar) traced to a loose spec sentence; spec clarified in 06d9d79c (narrow reading, per Josh's "otherwise inaccessible" ruling) — awaiting Josh's approval as its own delta. B2 (persisted-install acceptance expects OSC-8 on a pipe) and B3 (bridge proofs order sender validation and child-frame checks the spec does not state) returned to the author with the eight refinements.
- Proof review round 2 (Claude Fable, xhigh, on b7f3e899): PASS, no blockers; proofs converged. Two observations for the spec owner applied as wording-only clarifications (edbec2cc: "while no shell is rendered"; explainer matches the owning spec) plus proposal rule 9 (358e6802). Two observations carried to implementation (reduced-motion Connected path if the implementation waits on a transition event; stale ^cli-osc8-token comment in packages/cli/test/cli.test.ts).
- Plan revision on the converged proofs committed at 22c3b2cd. The supervisor confirmed that the approved spec deltas include the connection states explainer and assigned independent plan review.
- Out of scope, tracked as TV-912 (Triage): persist the desktop app's last server appearance across launches to avoid the light-to-dark flicker on restart. This contribution keeps today's behavior (system at launch, last server's value for the rest of the run).
- Josh approved the licensing expansion (cd9afc46: a bundled theme's material is also attributed in the desktop app's notices when it ships the theme). Still awaiting his approval: drag-strip wording (06d9d79c, edbec2cc), the Clouds clause for local dialogs (d4c63e53), and the licensing architecture alignment that follows from his product rule (ca22ebbe).
- Plan review round 1 (Claude Fable, on 22c3b2cd): FAIL, one blocker and four refinements. The revision assesses them below; b0164479 is in independent re-review.
- Merged spec clarifications through ca22ebbe: local dialogs always wear Clouds, served dialogs wear the server's theme, and desktop notices and asset records include bundled-theme material the app ships. The plan preserves the appearance scope above. The supervisor confirmed that ca22ebbe resolves the licensing architecture follow-up.

## Plan round-one assessment

- **B1 — desktop licensing:** warranted. The asset records omit desktop delivery, and the licensing proof and real-build test assume a single bundled desktop package. Slice 3 now names the attribution outcome, the existing manifest/build/upload evidence to extend, and independent review of the revised licensing proofs. The product wording question is resolved by cd9afc46 and its architecture restatement by ca22ebbe.
- **R1 — daemon host:** applied the human's designation rule. The implementing agent waits for that designation and never chooses a host. The runner's environment flag is only an accidental-execution guard.
- **R2 — served-gate dragging:** moved its real-Electron crossing to slice 2. The existing saved-record gate launch and X11 driver make it independent of local-page implementation. Slice 3 completes the packaged local route; the shared assertion stays pending until both pass.
- **R3 — shared presentation:** slice 2 delivers one importable modal presentation and tests its local rows; slice 3 uses it. This keeps the proof's production-presentation boundary honest without adding another renderer or test matrix.
- **R4 — observed baseline:** recorded all four failures reported by the reviewer at 22c3b2cd and assigned them to slice 2. Theme-reference work now covers every changed tracked authority before updating its fingerprints, as required by the existing freshness proof. These are the reviewer's targeted observations, not a full-suite result.

Validation at b0164479: all 62 plan links resolve; `npm test -- local --file test/repo/spec-links.test.ts` passes; `git diff --check` passes. Proofs remain byte-identical to b7f3e899, and specs match cd9afc46. No application tests or full verification were run for the plan revision.
- Plan review round 2 (Claude Fable, on b0164479): PASS, no blockers; plan converged. The follow-up merge of ca22ebbe (68169e1d) changed only wording the reviewer had already read. Carry to the slice 3 review: check the licensing proof edits against the specs (cd9afc46, ca22ebbe) as well as the tests.
- Josh approved the remaining wording-level spec deltas: drag strip (06d9d79c, edbec2cc), the Clouds clause for local dialogs (d4c63e53), and the licensing architecture surface list (ca22ebbe). All spec deltas on the branch are now approved.
- Josh designated hzbox (this host) for the daemon-acceptance suite. Full verification runs on Blaxel.
- Blaxel readiness check: CLI logged in (workspace telepath); BLAXEL_TV_GH_TOKEN can read the archive repo but gets 404 on telepath-computer/television, so workers would fail checkout. Asked Josh to extend the token's repository access before the final gate.
- Josh extended the Blaxel token's repository access; verified it reads telepath-computer/television and its branches. Blaxel is ready for the final gate.

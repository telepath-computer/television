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
- Plan review round 1 (Claude Fable, on 22c3b2cd): FAIL, one blocker and four refinements. The revision assesses them below and is ready for re-review.
- Merged spec clarifications through cd9afc46: local dialogs always wear Clouds, served dialogs wear the server's theme, and Josh approved desktop notices for bundled-theme material. The plan preserves the appearance scope above. Licensing architecture still lists only CLI/source theme delivery; that wording is flagged to the supervisor for alignment with the approved product rule.

## Plan round-one assessment

- **B1 — desktop licensing:** warranted. The asset records omit desktop delivery, and the licensing proof and real-build test assume a single bundled desktop package. Slice 3 now names the attribution outcome, the existing manifest/build/upload evidence to extend, and independent review of the revised licensing proofs. The product wording question is resolved by cd9afc46; its architecture restatement remains to be reconciled.
- **R1 — daemon host:** applied the human's designation rule. The implementing agent waits for that designation and never chooses a host. The runner's environment flag is only an accidental-execution guard.
- **R2 — served-gate dragging:** moved its real-Electron crossing to slice 2. The existing saved-record gate launch and X11 driver make it independent of local-page implementation. Slice 3 completes the packaged local route; the shared assertion stays pending until both pass.
- **R3 — shared presentation:** slice 2 delivers one importable modal presentation and tests its local rows; slice 3 uses it. This keeps the proof's production-presentation boundary honest without adding another renderer or test matrix.
- **R4 — observed baseline:** recorded all four failures reported by the reviewer at 22c3b2cd and assigned them to slice 2. Theme-reference work now covers every changed tracked authority before updating its fingerprints, as required by the existing freshness proof. These are the reviewer's targeted observations, not a full-suite result.

Validation of this plan revision: all 62 plan links resolve; `npm test -- local --file test/repo/spec-links.test.ts` passes; `git diff --check` passes. Proofs remain byte-identical to b7f3e899, and specs match cd9afc46. No application tests or full verification were run for the plan revision.

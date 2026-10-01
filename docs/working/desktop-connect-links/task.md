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
- Planning started in parallel at Josh's request: planner on `thopter/desktop-connect-links-plan` (Codex gpt-6-astra), plan reviewer Claude Fable standing by.
- Connection states explainer added (bf850e0f) with its own focused review: PASS; refinement and source references applied (06becc24).
- Josh approved the spec deltas at 06becc24 (spec gate complete). Any later spec change returns to him as its own delta.
- Proof review round 1 (Claude Fable, xhigh, on bd1a7193): FAIL, three blockers. B1 (drag strip over a collapsed sidebar) traced to a loose spec sentence; spec clarified in 06d9d79c (narrow reading, per Josh's "otherwise inaccessible" ruling) — awaiting Josh's approval as its own delta. B2 (persisted-install acceptance expects OSC-8 on a pipe) and B3 (bridge proofs order sender validation and child-frame checks the spec does not state) returned to the author with the eight refinements.

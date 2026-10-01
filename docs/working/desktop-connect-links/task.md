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


## Slice 1 implementation — ready for independent review

The worker fast-forwarded to the supervisor's merge `940a744a` before implementation. Josh designated **hzbox** for daemon acceptance and chose **Blaxel** for the later full verification gate. The developer telemetry marker was present before any Television launch.

`tv links` now resolves the usual home and client port, reads health, validates the home's token through display retrieval, and tries the same read without authentication. Only the running server's responses decide token inclusion. All validation completes before output. Links and both startup paths use one formatter: OSC-8 only for `isTTY === true`, otherwise plain URLs. No server API or service lifecycle changed.

The CLI proof markers now cite implemented evidence. The unreachable walk uses a TCP forwarder to hold its client endpoint continuously; the proof describes that infrastructure explicitly. It forwards real HTTP while the server is live and closes on the real backend failure, supplying no substitute response. Inherited foreground evidence retains its grade. Native terminal detection and hyperlink activation remain unobserved as planned.

Red/green evidence: the new command contracts and three built-process walks failed because `links` was absent; formatter, foreground and installed-service checks failed on OSC-8 captured by a pipe. The type fixture detected the missing `isTTY` declaration. After implementation, narrowed reruns passed. The CLI suite then identified its old command list and two additional unconditional-OSC-8 expectations; those were reconciled and passed narrowly before rerunning the suite. Foreground assertions read stdout separately from combined diagnostics so stderr ordering cannot affect the plain-output check.

Completed checks, against `940a744a` plus this slice's working-tree changes (run reports record `dirty: true`):

| Check | Result | Run directory under `.test-runs/` |
| --- | --- | --- |
| `npm test -- local --surface unit:cli` | 146 passed | `2026-10-01T18-03-04-997Z-p2639938-rea1a0e8edf4e6591` |
| `npm test -- local --file test/node/cli-acceptance.test.ts` | 22 passed | `2026-10-01T18-03-28-000Z-p2640241-r2282c9d538b40250` |
| `npm test -- local --file test/node/cli-integration.test.ts` | 18 passed | `2026-10-01T18-04-16-699Z-p2641823-r7973c506662700fe` |
| Foreground cases after separating stdout capture (`--grep 'tv serve records lifecycle|tv serve with auth does not print' --retries 0`) | 2 passed | `2026-10-01T18-05-14-785Z-p2642605-r3c6f81c7e8dc6ef4` |
| `TV_DAEMON_TEST_HOST=1 npm test -- local --suite daemon-acceptance` | Passed | `2026-10-01T18-02-53-662Z-p2639327-r8d3360bb048e6f6f` |
| `npm test -- local --file test/repo/spec-links.test.ts` | Passed | `2026-10-01T18-04-45-713Z-p2642431-ra99e9c77d560a571` |

These runs reported no recovered flakes or process leaks. Type checking, ESLint on changed TypeScript files, and `git diff --check` passed. The daemon suite verified install, live refresh, boot, stop and persist-uninstall, leaving no installed/running service. The freshly packed global `tv` 1.4.13 remains at `/home/user/.nvm/versions/node/v24.21.0/bin/tv`; its developer version stamp names the build's HEAD, `940a744a`, while the build includes this slice's uncommitted source changes.

Reviewed the administrator guide's existing connect-link, installation, upgrade, Docker, SSH, Mac/browser and recovery instructions against the implementation; no further text change was needed. Publication remains deferred as recorded above. No full verification ran: the four review-observed UI/canonical failures still belong to slice 2, and local setup/desktop work to slice 3. No CLI failure remains outstanding. The supervisor coordinates independent slice review; nothing was pushed.


## Slice 2 implementation — ready for independent review

Implemented on top of slice 1's `03d3f122` while its review remains with the supervisor. Connection state now counts completed unreachable retries once, escalates on the third failure, retains the existing shell and live artifact documents through recovery, and keeps a displayed upgrade gate above later authorization failures. Rejected browser credentials are cleared; recovery uses the current link. The shared modal renders browser, served-desktop and local guidance without an application-service dependency; local unauthorized/error rows expose the Disconnect callback for slice 3.

Large controls and their token reach web foundation and live canonical v2. The Copy helper composes small, standard and large controls. Canonical v1 remains untouched. Built author guidance, the app-shell reference and the external-page placeholder match the approved material. The four failures recorded by plan review are resolved.

**Approved spec correction.** Native Electron testing found that a drag strip beside the dialog cannot receive input while the dialog is modal. Josh approved placing it inside the dialog. This slice changes `system-modal.frame`, `dialog.frame` and `desktop-upgrade-gate.frame` to carry that strip inside the modal boundary and outside the scrolling content. Production uses the same composition. The native served-gate test moves the window and then activates its Restart control. The dialog proof delegates the optional content to that seam; the gate proof already names it. Review of the changed authored frames and app composition preceded the theme-reference fingerprint updates.

Red/green work began with the completed-attempt contract, app state/content contracts and Copy size cases, followed by the foundation crossings, live canonical vocabulary/guidance and native served-gate drag case. The intended failures exposed the absent count, priority/escalation, token-form contents, size composition, stale style copies/guidance and inert sibling strip. Each implementation was checked narrowly before widening to its file or owning unit suite. Real browser walks cover token rejection at boot and after a session, three failed reconnects with document continuity, and a reconnect that becomes gated. Obsolete token-form recovery walks were reconciled while preserving link ingestion, token transport/storage and artifact reload evidence.

Completed checks used `npm test -- local` with `--retries 0`, against `03d3f122` plus the slice's working-tree changes (`dirty: true` in reports):

| Selection | Result | Run directory under `.test-runs/` |
| --- | --- | --- |
| `--surface unit:browser-app` | 568 passed, 1 existing skipped ACP bridge-drop test | `2026-10-01T18-37-12-980Z-p2664081-r3aaf2a21862811c5` |
| `--surface unit:canonical` | 18 passed | `2026-10-01T18-38-48-886Z-p2664955-r904ab3bfd89a702f` |
| `--file test/repo/skills-build.test.ts` | 9 passed | `2026-10-01T18-38-51-256Z-p2665097-r92025e850b4e23e5` |
| `--file packages/web/test/e2e/system-modal.test.ts` | 2 passed | `2026-10-01T18-30-07-038Z-p2660034-r014f73d9e6de5fd3` |
| `--file packages/web/test/e2e/auth.01.test.ts` | 3 passed | `2026-10-01T18-38-53-693Z-p2665349-rb8f558a5b12025ab` |
| `--file packages/web/test/e2e/auth.02.test.ts` | 2 passed | `2026-10-01T18-39-06-977Z-p2665912-rb42c20ad970ffdc1` |
| `--file packages/web/test/e2e/reload-after-reconnect.02.test.ts` | 3 passed | `2026-10-01T18-39-17-405Z-p2666329-r01ee6861869b7d05` |
| `--file packages/web/test/e2e/gate-boot-barrier.spec.ts` | 3 passed | `2026-10-01T18-39-48-093Z-p2666851-r88e8c0c4a02eba40` |
| `--file packages/web/test/e2e/dialog.test.ts` | 4 passed | `2026-10-01T18-40-03-345Z-p2667331-r3fada3e04358daaf` |
| `--file packages/web/test/e2e/desktop-upgrade-gate.spec.ts` | 4 passed | `2026-10-01T18-40-13-661Z-p2667845-r5e10234715363371` |
| `--file packages/desktop/test/e2e/window-drag-regions.test.ts` | 2 passed | `2026-10-01T18-40-23-435Z-p2668316-r21a29088b69b1eb0` |
| `--file test/repo/theming-reference.test.ts` | Passed after the approved frame correction | `2026-10-01T18-44-50-309Z-p2669730-re1d73cf7f7cf831c` |
| `--file test/repo/spec-links.test.ts` | Passed | `2026-10-01T18-45-26-576Z-p2669892-r664a6d3d79705721` |

The selected runs reported no recovered flakes, process leaks or infrastructure failures. Type checking, ESLint on changed TypeScript files and `git diff --check` passed. The later lint-only threshold naming change passed its focused state-selection test (`2026-10-01T18-38-30-170Z-p2664809-r67aae2ff63fe8d60`). No full verification ran; the integrated gate remains assigned to Blaxel.

Slice 3 still owns the packaged local page, native local dragging, complete foundation/Clouds delivery, asset attribution, preload/main-process lifecycle and the executed staging runbook. The foundation and modal-drag proofs retain their partial markers. Served-desktop guidance names Disconnect from Server before slice 3 changes that menu, as planned. No observed served-app failure is deferred. Nothing was pushed.


## Slice 2 round-one review refinements

Independent review by Claude Fable at `a3a37a00` passed with no blockers and seven refinements. The supervisor requested the bounded follow-up review after these edits.

| Item | Assessment and action |
| --- | --- |
| 1 — gate parameter prose | Corrected the gate spec's parameter description to include `top_layer_content`. The supervisor confirmed this completes the frame change Josh approved. |
| 2 — generated proof index | Regenerated the indexes with `npm run specs:index`; the dialog and system-modal proof counts are current. |
| 3 — partial drag marker | Restored the standard “test to be written” wording for the local route; the served route retains its implemented citation. |
| 4 — local bundle dependencies | Carried to slice 3 in the plan. Its renderer does not need the gate, but the shared modal imports it and its markdown pipeline. Decide against the real bundle whether to retain those packages and notices or separate that composition. No bundle change in this refinement. |
| 5 — token-form leftovers | Removed the unused rejected-token detail, projection, fixture methods and form-specific recorder/assertions. The connection still reports authorization rejection and resets it for a fresh connection; its existing contract now checks that fact directly. Gate/outage records assert the current unauthorized presentation's absence. |
| 6 — independent strip expectations | Each contract row now states whether it expects a shell, then checks the shell and strip independently against that expectation. |
| 7 — gate proxy declaration | Named the continuously bound front proxy and its real HTTP/WebSocket forwarding in the gate seam's proof. |

The reviewer independently reported 302 passing browser acceptance tests (2 skipped), 73 passing desktop tests, and passing browser-app/canonical units and targeted repository checks on the clean `a3a37a00` tree. Those are review evidence, not a full verification run or results of the refinements above.


Refinement validation ran against `a3a37a00` plus these working-tree changes (`dirty: true`), with `npm test -- local` and `--retries 0`. The strip, authorization-reset/bootstrap and snapshot-projection contracts passed narrowly before widening to the browser-app unit suite.

| Selection | Result | Run directory under `.test-runs/` |
| --- | --- | --- |
| `--surface unit:browser-app` | 568 passed, the same 1 skipped ACP test | `2026-10-01T19-11-03-808Z-p2703230-r5c59e83c16cad1fb` |
| `--file packages/web/test/e2e/auth.01.test.ts` | 3 passed | `2026-10-01T19-11-50-665Z-p2703760-r4d623d87fb8c1b1c` |
| `auth.02.test.ts`, electron token-query case | 1 passed | `2026-10-01T19-12-03-724Z-p2704270-r02c488326827b42f` |
| `gate-boot-barrier.spec.ts`, first-message gate case | 1 passed | `2026-10-01T19-12-13-680Z-p2704763-r4b2f8b9c50178ec0` |
| `reload-after-reconnect.02.test.ts`, outage escalation case | 1 passed | `2026-10-01T19-12-26-622Z-p2705186-raa2ae0d0a217b8b8` |
| Desktop `upgrade-gate.spec.ts`, `ac-gate-persists` | 1 passed | `2026-10-01T19-12-52-386Z-p2705614-rc454cb8ff800b49d` |
| `--file test/repo/spec-links.test.ts` | Passed | `2026-10-01T19-13-05-675Z-p2706212-r0b6874813a47b187` |

All selected runs reported no recovered flakes, process leaks or infrastructure failures. Type checking, ESLint on the changed TypeScript and `git diff --check` passed. No full verification ran. These refinements are ready for the requested follow-up review; slice 3's obligations remain unchanged apart from the recorded import decision. Nothing was pushed.

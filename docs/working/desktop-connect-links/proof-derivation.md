# Desktop connect links: proof derivation

Round-two status: independent review passed at `b7f3e899`; the supervisor confirmed proof convergence. The wording clarifications through `358e6802` resolve the explainer follow-up below and leave the proof design unchanged. The implementation plan builds on these proofs and carries the review's reduced-motion and stale CLI citation observations into implementation. Slice 1 supplied the CLI evidence and removed the stale citation. Slice 2 supplied the served-app, modal, Copy, canonical and served-gate drag evidence. Slice 3 supplies the local-page drag crossing, complete foundation/desktop delivery, connection lifecycle and licensing evidence. The task record identifies passing runs; slice 3's proof refinements below accompany its implementation review.

Plan review identified licensing coverage outside that submission: the desktop's additional assets and shared presentation change the contents its licensing proofs and tests describe. The plan assigns those revisions and their independent review to slice 3, following the approved product clarification at `cd9afc46`. The converged proofs remain unchanged in this plan revision.

The round-two submission was prepared against spec revision `06d9d79c`, merged into the planning branch as `1b26430b`. The implementation plan at `fbca5eed` was held unchanged during proof review. Round-one review found a drag-strip ambiguity that the first derivation had missed; the upstream spec resolved it with `06d9d79c`, and the app proof follows that resolution. No unresolved spec decision blocked the submission.

The round-two proof changes covered every product, architecture and UI owner touched between `ab6ce3c8` and that submission, including owners of changed frame, content and stylesheet material. The new [setup proof](../../../proofs/ui/setup/index.md) composes with [desktop product acceptance](../../../proofs/product/desktop-app.md) and [connection architecture](../../../proofs/arch/desktop/connect-flow.md). The [foundation distribution](../../../proofs/arch/ui/foundation.md) and [canonical](../../../proofs/arch/canonical.md) proofs also account for their changed consumers. Explainers, the generated spec index, migration map and glossary receive no proofs under proof policy.

Product proofs own real CLI/Electron outcomes. App coverage retains the specified real-browser token rejection and artifact-identity walks, extending them through outage escalation. Architecture contracts carry parsing, status, cancellation and IPC breadth. Existing Copy, dialog, icon, theme and stylesheet proofs supply their shared coverage. The proofs prescribe no new framework, exact retry schedule, extra Connected dwell, or general markup-comparison system.

Pending behavior is marked “test to be written”; the round-one corrections include the persisted and authenticated foreground startup output assertions and the canonical fixture/guidance additions. Unchanged inherited evidence keeps its grade. The desktop storage proof corrects its description of the existing tests: they mock the filesystem. A separate pending operation-order assertion proves temporary-write/rename and deletion; product acceptance supplies the real disk crossing.

During implementation, reconcile the tests that still exercise the separate token field, manual-prefill mode, unconditional OSC-8 output and authorization-over-gate priority. The retired `sm-ac-auth-submit` assertion orders no replacement token form. Its existing test is obsolete; shared token ingestion/transport remains covered by the app's real-link/authentication paths. Existing narrower tests cited beside pending obligations are starting evidence, not claims that the new behavior already passes.

Validation of the proof submission:

- Regenerated spec/proof indexes after the upstream merge and proof revisions.
- After the supervisor installed dependencies, `npm test -- local --file test/repo/spec-links.test.ts` passed. It also passes on this revised proof tree; this checks reference integrity, not the pending behavior.
- No application tests or full verification were run for proof derivation.

## Round-one review assessment

All three blockers were warranted. Each refinement was assessed against the owning specs and the testing policy's cost and boundary rules.

| Finding | Result |
| --- | --- |
| B1: drag strip over a collapsed shell | Applied the upstream resolution. The app contract requests the strip with no shell; a retained shell supplies its own drag areas. Local-page and served-gate drag coverage already matches. |
| B2: persisted output citation | Marked the piped-output change pending in `cli-ac-persist-home-install`, stated plain URL output, and retained the designated-host suite obligation. Also marked authenticated foreground output in `193e8638` pending. Existing lifecycle/service evidence remains narrower evidence. |
| B3: bridge requirements beyond the spec | Removed sender-validation and child-frame requirements. Product connection and local-button walks prove the working local controls; the connection and gate walks observe their absence from served pages. Removed the separate bridge contract and Electron launch. The spec does not order main-process sender hardening or a local child-frame fixture. |
| R1: first-error proxy description | The critique is correct: the development proxy generates a 502 on backend failure, and Vite supplies the page. Removed the extra acceptance instead of presenting it as a direct refusal. Initial-failure selection/composition remains in contracts; real unavailable-server retry/recovery is crossed by the outage walk. |
| R2: real-Electron cost | Folded prompt selection into the existing connection walk. Removed the second local-error button crossing and the reduced-motion connection repeat. Reduced-motion styling remains with delivery/conformance; a transition-event navigation mechanism is not assumed. Narrowed appearance retention to initial `system` and one non-system input, retaining one live native-input change to prove local adaptation. Removed later-auth repetition from the gate seam and the redundant gated-window permutation from the main-process disconnect contract. The two modal drag routes still earn their separate coverage because packaged and served styles/composition differ. |
| R3: terminal harness | Removed the pseudo-terminal seam. The environment passes `process.stdout` itself; real piped output crosses that handoff and contracts prove formatter behavior for all three `isTTY` inputs. Native terminal detection and hyperlink activation are explicitly unobserved. |
| R4: desktop auth wording | Added an unauthorized desktop-served row to the app composition contract to prove that it supplies `desktop` context and selects the menu-based guidance. |
| R5: pointer-only anchors | Removed `cli-osc8-token`, `desktop-t-page-entry` and `setup-t-connected`; proof consumers link directly to their owning assertions. The existing unconditional-OSC-8 test's bare citation to `cli-osc8-token` is retired with that test during implementation. |
| R6: canonical pending grades | Added pending markers directly to the public-name and skill-guidance assertions; existing citations identify only the evidence already present. |
| R7: claimed Mac coverage | Corrected the menu and appearance forfeits. The listed Mac checks do not establish native menu/accelerator activation or live device-preference changes; these are stated as unobserved. Direct `themeSource` assignment replaces the appearance input source, not the operating-system preference. |
| R8: derivation note | Corrected the ambiguity history, pending evidence grades, and canonical test result here. |

At submission, plan reconciliation was deferred until proof convergence. Its provisional drag condition, bridge-hardening detail, proof allocations and approval status were identified for revision. The imported connection-states explainer's “Moving the window” paragraph then used the shorter sidebar-based condition, while the owning system-modal spec stated the narrower rule explicitly. This was reported as a nonblocking derived-wording follow-up for the supervisor, not a proof decision; the wording is now reconciled through `358e6802`.

## Slice 2 proof reconciliation

Implemented citations replace the served-app, modal-contents/non-dismissal, Copy and canonical pending markers. The outage proof describes the continuously bound development proxy and real backend failure used by the browser walk. The drag proof declares the existing simulated update/restart hooks used to provide an actionable gate button; native hit testing and window movement remain real. The packaged local route remains pending.

Native Electron hit testing found that the authored strip, as a sibling of the native dialog, was inert. The supervisor relayed Josh's approval to put it inside the dialog. The system-modal frame now passes it through the dialog and gate frames, outside the scrolling content. The dialog proof delegates that optional content's native handoff to the existing system-modal drag assertion; the gate proof already makes that coverage relationship explicit. No additional drag permutation or dialog test is ordered. The slice review includes this approved spec delta and its proof reconciliation.

## Slice 3 proof reconciliation

The local lifecycle, setup, assets, appearance and drag assertions now cite their
implementation. The licensing proofs describe the renderer packages and asset
records delivered by the real desktop bundle and upload directory. Inherited
storage and identity-check evidence keeps its grade.

Saved-startup observation uses a request barrier in the existing forwarding
proxy, releasing real checks after Connecting is visible. This substitutes
transport timing, not the response or client retry timers. The stopped-server
walk declares the proxy's 502 response and real backend restart. The renderer
contract declares controlled animation frames and no active animations for the
reduced-motion completion path; normal-motion painting remains with native
Electron acceptance. The appearance seam sets its server preference before
connecting, then observes real delivery, retention on disconnect and local
adaptation to the declared native input substitute.

The served app now composes the upgrade gate directly, keeping its markdown
pipeline out of the packaged local renderer. Composition assertions and the
browser presentation recorder count that direct gate alongside the shared
standard-modal host. This changes an implementation boundary, not the modal's
specification or its proof obligations. These proof refinements receive review
with slice 3.

# Desktop connect links: implementation plan

Working document for implementation and review. The result is a single connect-link workflow: the CLI supplies links, the desktop app accepts one link and remembers the connection, and connection dialogs explain recovery without asking for a separate token.

Prepared on `thopter/desktop-connect-links-plan` from spec revision `6ddfcf5c`, including the proposal remediation at `9e318989` and the CLI output stream's optional `isTTY` declaration. The approved intent is [proposal.md](./proposal.md); [task.md](./task.md) records the source of the visual design, obligations carried to implementation, and independent spec review's round-two PASS. This plan is ready for review as a provisional plan; proofs have not yet been derived, and it does not claim proof or plan convergence or authorize implementation.

The user explicitly requested planning before proof derivation. With independent spec review complete, derive and independently approve the affected proofs, then reconcile and converge this plan against them before implementation. Any later spec remediation enters the same reconciliation. The governing sequence, slice reviews, and final integrated review remain those in [spec workflow](../../../specs/spec-workflow.md#planning-and-slices), [proof policy](../../../specs/spec-proofs.md), and [testing policy](../../../specs/arch/testing-policy.md). Josh coordinates independent review.

## Scope and governing requirements

| Work | Authority |
| --- | --- |
| Connect links, `tv links`, home/port selection, terminal output | [Product CLI](../../../specs/product/cli.md#connect-links), [CLI architecture](../../../specs/arch/cli/index.md#client-boundary) |
| Setup, saved startup, disconnect, persistence, local bridge, failed navigation | [Desktop connection flow](../../../specs/arch/desktop/connect-flow.md), [desktop product](../../../specs/product/desktop-app.md) |
| Connection-state priority, three failed reconnects, shell continuity | [App UI](../../../specs/ui/app/index.md#connection-states), with transport internals remaining under the [channel-state carve-out](../../../specs/arch/channel-state/index.md#code-governed-carve-out) |
| Setup and connection-dialog presentation | [Setup UI](../../../specs/ui/setup/index.md), [system modal](../../../specs/ui/app/system-modal/index.md), [dialog](../../../specs/ui/app/dialog/index.md), their frames and content |
| Local appearance and packaged Clouds assets | [Desktop appearance](../../../specs/arch/desktop/appearance.md), [theme delivery](../../../specs/arch/themes/delivery.md), [Clouds](../../../specs/ui/themes/clouds/index.md) |
| Large controls, Copy size, static frame chrome, browser external-page copy | [Button](../../../specs/ui/foundation/button/index.md), [input](../../../specs/ui/foundation/input/index.md), [copy button](../../../specs/ui/app/copy-button/index.md), [artifact frame](../../../specs/ui/app/artifact-frame/index.md) |
| Connect-check compatibility and retained upgrade gate | [Desktop upgrade architecture](../../../specs/arch/updates/desktop-upgrade-gate.md), [gate UI](../../../specs/ui/app/desktop-upgrade-gate/index.md) |
| Guide instructions and publication | [Administrator guide](../../../specs/arch/cli/admin-guide.md), [guide source](../../guides/television-admin-guide.md) |

The imported frames on this branch supply the visual design. No implementation or test obligations are imported from prerelease PR #387. In particular, the setup screen has no tracked current step, and its card uses frame chrome without an artifact view, iframe, webview, or artifact bridge.

## Implementation approach

Keep the existing CLI, browser connection owner, and desktop main process as their respective lifecycle owners. Share presentation and stylesheet sources where useful; the desktop's identity-check retry loop and the served application's websocket session remain distinct mechanisms. This change does not need a new cross-platform connection framework.

Three implementation slices keep related behavior and tests together. Slice 1 is independent of the UI work. Slice 2 supplies the controls and dialog presentation used by slice 3. Each slice receives independent whole-slice review; after slice 3, the integrated contribution receives final review and full verification.

The file references below locate the current implementation. They are starting points, not an exhaustive change list or an instruction to preserve a module boundary that obstructs the result.

### Proof decisions that must precede implementation

The validation criteria below identify outcomes to demonstrate, not new proof assertions. The proof author chooses the assertion boundaries, mocks and forfeits, fixtures, hooks, and test locations under the testing policy. Existing proofs have not been updated for this contribution: for example, the desktop connection proof still describes manual prefill and a separate token field. Those statements cannot override the revised specs.

| Decision for proof convergence | Consequence for this plan |
| --- | --- |
| Allocate CLI authentication, listener selection, and terminal-output evidence between product acceptance and architecture contracts/seams. | Slice 1's exact test split follows that allocation. Reuse existing client/process boundaries; do not add a server endpoint solely to make the tests easier. |
| Allocate connection-state selection, retry counting, rejected-token recovery, and retained artifact identity across app and connection coverage. | Slice 2 needs the real-browser paths required by the app's Testing section, including rejection at boot and after a session. Mocked selector coverage cannot substitute for those paths. |
| Derive the new setup proof and reconcile desktop connection, appearance, product, and upgrade proofs. | Slice 3 must include the specified real-Electron path from setup through a token-requiring server to its served page. Identity-response permutations and success-only save/navigation remain owned by the upgrade proof; avoid duplicating them. |
| Decide how to prove the Connected transition before navigation, cancellation during it, and desktop drag-region behavior. | The setup completion handoff and any needed observations follow that proof design. Evidence about CSS motion uses real motion and browser lifecycle signals; a disabled-motion test does not prove the transition. Browser CSS inspection alone does not prove native window movement. |
| Allocate shared-control, stylesheet delivery, local packaged-asset, and appearance coverage. | Extend the current copy/delivery and Electron evidence at the actual boundaries. A stylesheet-only spec can have a no-tests proof where policy permits; no new general markup-comparison system is required. |

Proof reconciliation covers every affected product, architecture, and UI spec under the mirrored-path rule, including owners of changed non-Markdown material such as button tokens and error-page copy. Also update proofs whose existing assertions change because their consumer changes, such as foundation delivery and live canonical distribution. Runbooks, explainers, governance documents, and the glossary do not gain proofs. Record retained inherited evidence honestly; newly written or replaced tests meet the current policy. Ambiguous expected behavior returns to the owning spec rather than being decided here or in a test.

## Slice 1 — Supply usable connect links through the CLI

**Deliverable.** `tv links` prints the running server's links, one per line. CLI link output remains readable in captured output and becomes an OSC-8 hyperlink only on an interactive output stream.

**Implementation.** Start in `packages/cli/src/index.ts`, its `CLIEnvironment` boundary, the shared client, and the existing connect-URL helpers.

- Register `links` in command parsing/help and use the existing home, config, token lookup, and client-port resolution. The client contacts localhost; the printed addresses and actual port come from the running server's health response.
- Follow the spec's authenticated and unauthenticated checks through the existing client. A suitable existing read-only authenticated operation, such as display-state retrieval, can distinguish accepted credentials from an authless server; `/health` alone cannot. Validate the result before printing any link. A rejected home token or failed request produces the existing command error and no partial success output.
- Choose token inclusion from the server's responses. A config edit does not change the running server's authentication or listeners until restart; leftover token-file contents do not make an authless link authenticated.
- Route `links` and both foreground/persisted startup link paths through the same output-stream-aware formatter. `isTTY === true` enables OSC-8 with the URL as visible text; every other value produces the plain URL. Keep the startup headings, and omit headings from `links`.
- Review the already-edited guide against the implemented command: installation, authentication-changing upgrades, rejected-link troubleshooting, npm desktop migration, SSH tunnels, and giving links for an existing installation. Preserve the distinction between connect-screen requests, other supported-Mac requests, and browser use on other platforms. Guide content is checked by review, not wording tests.

**Verification criteria.** Proof-derived tests demonstrate reported listener/port selection, correct token inclusion for the running server despite changed config, home/port errors, unreachable/unauthorized stderr and exit status, and output-stream formatting. A spawned CLI against a real Television server proves usable link output. Cover both startup callers of the shared formatter without treating a fake daemon as evidence of a real service installation. Existing locations include `packages/cli/test/cli.test.ts`, `test/node/cli-acceptance.test.ts`, and `test/node/cli-integration.test.ts`; proof convergence determines the cheapest honest distribution.

**Expected baseline and remaining work.** Slice 1's targeted CLI coverage is green. UI and desktop behavior remain at the incoming implementation; their new proof obligations belong to slices 2 and 3. The incoming spec changes already differ from production foundation/system-modal styles, so existing stylesheet-copy checks are expected to remain red until slice 2. This is an expected baseline from inspection, not a reported test result. No new CLI failure is deferred.

## Slice 2 — Implement served-app connection states and shared presentation

**Deliverable.** Browser and desktop-served pages show the specified single connection dialog, recover using links, and preserve an established shell and artifacts across an outage. Shared controls and presentation are ready for the desktop local page.

**Implementation.** The current path runs through `packages/web/src/services/server-connection.ts`, `server-connection-owner.ts`, `application-service.ts`, `views/application-state.ts`, `television-app.ts`, and `system-modal.ts`.

- Count completed unreachable reconnect attempts at the connection owner, where one attempt is distinguishable from multiple socket events. The initial drop is not one of the three retries. Reset on a successful connection; a definite auth or gate answer takes its own path immediately. Retain the existing backoff mechanism and expose only the state needed by the presentation.
- Select the retained upgrade gate before authorization and outage states. Once shown, it stays until reload, including after a later rejected token. Otherwise authorization wins immediately and stops retrying. Preserve the browser's rejected-token clearing and connect-link URL consumption rather than introducing a second authentication path.
- Distinguish first-connect failure from an outage after a session. Both unreachable presentations keep retrying and display the countdown or “Reconnecting now…”. Preserve the same shell, artifact-frame nodes, and documents while an established session progresses through Disconnected, Can't connect with server, and recovery. The current `hasApplicationShell` includes only Disconnected among interrupting states, so adding an error presentation alone would wrongly unmount the shell.
- Replace the modal token form and its authentication callback with the specified context-dependent explanation. Use the frame/content copy for browser, desktop-served, and local contexts. Only the local variant receives a Disconnect action; showing a desktop-served dialog grants no connection-control bridge.
- Keep system modals and the gate nondismissible by Escape or backdrop. Preserve ordinary dialog callers' own dismissal behavior. Include the 36px native drag strip in desktop presentations when the sidebar drag handle is unavailable, accounting for native-dialog top-layer hit handling.
- Carry the specified large button/input sizes and `--line-control-lg` into the web foundation and live canonical v2 production copies. Update the public vocabulary fixture and artifact-authoring guidance where they enumerate the new public attributes/token; frozen v1 stays byte-identical. Extend the Copy helper to accept the setup screen's standard size while retaining existing callers' sizes and copy behavior.
- Implement the external-web-page placeholder's Mac-only wording in its production document. Update `packages/skills/skills/television/src/app-shell-reference.md` to describe the resulting connection-dialog markup instead of the removed token form, as required by the task record.
- Update the existing stylesheet source/delivery mappings and production copies for changed surfaces. New setup-specific copies belong to slice 3. Production uses production assets, without importing `specs/` or executing workshop wiring.

**Verification criteria.** Proof-derived contracts exercise state priority, the three-attempt threshold and reset, one count per failed attempt, and retry cessation after auth rejection. The app spec's real-browser acceptance covers initial failures, rejection at boot and after a session, recovery through a current link, and retained shell/artifact identity through escalation and reconnection. Gate evidence demonstrates that a later auth error cannot replace a displayed gate; reuse the existing real `server-status` and gate coverage for its owned paths.

Update the relevant existing suites, including `server-connection`, `server-connection-owner`, `application-service`, application presentation/snapshot, auth, system-modal, dialog, gate, and reconnect tests. Tests that enter a bare token through the UI must be rewritten around the new link workflow where that is their purpose; unrelated scenarios should use their existing sanctioned authenticated setup. Remove assertions whose only subject is the retired token form. Keep token ingestion, storage, and transport regression coverage.

Stylesheet-copy/delivery checks and live canonical tests establish the large-control distribution. Existing Copy acceptance remains the clipboard evidence; setup will prove the prompt it supplies rather than duplicate all Copy behavior. The [TV-649 exception](../../../specs/arch/ui/conformance.md#release-exception-for-tv-649) defers general structural comparison, not implementation conformance or active browser/copy/delivery checks.

**Expected baseline and remaining work.** Targeted web, shared-control, canonical, and applicable style checks are green. The served-page dialogs may already name Disconnect from Server while the current desktop implementation still has its old menu; slice 3 resolves that temporary mismatch. The local setup page, saved-startup dialogs, local asset delivery, and native disconnect remain unimplemented. If a new setup delivery check is introduced before its assets exist, its exact failure is assigned to slice 3 rather than disabled. No served-app behavior failure is deferred.

## Slice 3 — Complete the desktop setup and saved-connection lifecycle

**Deliverable.** The packaged desktop app shows setup only without a saved connection, connects from one link, displays Connected before navigation, reconnects saved connections automatically, and can forget its server from every state.

**Local page and packaging.** Start in `packages/desktop/src/connect.html`, `connect-page.ts`, `connect-preload.ts`, and `packages/desktop/build.mjs`.

Use a small local renderer with the existing shared Copy and dialog presentation where their imports remain independent of application services. Port the setup frame's markup into this renderer and copy its authoritative styling through the existing stylesheet mechanism. If sharing the modal view would pull in the application service or server lifecycle, extract just its presentation or compose the same markup locally. This is an implementation choice left open by the connection spec; settle it by inspecting the resulting imports, without creating a new shared package for this one use.

Package the complete foundation, surface styles, fonts, icons, Clouds theme, and both wallpaper assets needed by the local page. Resolve their URLs over `file:` in the built app, without fetching a server stylesheet or relying on source-tree paths. The root is an application document and its effective light/dark marker follows the window's current native appearance. Retain the previous server's native appearance input on disconnect and continue responding when system appearance changes; Clouds remains the local theme. Extend the actual desktop build/upload and licensing inventory paths for any additional assets, including copied font/theme material.

The setup card implements ready, connecting, connected, and error states from the frame. Copy has its existing short confirmation and no effect on step state; pressing the prompt selects it. A person can paste or type a link and submit by Connect or Return without copying first. Disable the field/button while connecting, retain the entire entered link after failure, and show the failure in place of the hint with the specified invalid-field relationship. The background drags the window and the card stays interactive.

**Main-process connection lifecycle.** Start in `packages/desktop/src/index.ts`, `connect-screen.ts`, `connect-url.ts`, `connect-error.ts`, `connect-preflight.ts`, and `connection-store.ts`.

- Replace the bootstrap/manual-prefill distinction with saved versus unsaved entry. Main remains responsible for the active connection attempt, saved record, navigation, and disconnect. Give the local page the state/results it needs through its local-only bridge; retain failure classification so it can distinguish `401` from other saved-startup failures.
- Accept one submitted link. Keep the existing HTTP(S)/bare-host normalization and persistence format. A missing token in a new link means no token; it never inherits one from an earlier input or saved record. Reword the two setup auth errors around obtaining the current link, leaving other connect-check classifications intact.
- Check before saving or navigating. On setup success, save, enable Disconnect immediately, let the local renderer show the real Connected transition, and then load the remote root with the required mode/version/token parameters. The present code awaits `loadRemote` before resolving `connect`, so its success cannot drive this UI as written. Use a small, guarded completion handoff between main and the local page; the renderer's transition completion can release navigation only for the still-current successful attempt. The proof decides the observation hooks, including reduced-motion completion.
- Starting with a saved record shows Connecting immediately, without a setup flash. A passed check loads the served page; `401` shows Access token required and stops attempts; every other check failure shows Can't connect with server and schedules backoff. Expose the retry deadline/in-flight state for the shared countdown. The local page never decides the upgrade gate: a gate-requiring server passes the connect check and its served page owns the gate.
- Replace the menu item with Disconnect from Server and the existing `CmdOrCtrl+,` accelerator. Enable it exactly while a valid saved connection exists. The menu and the local dialogs use the same disconnect operation: cancel/invalidate in-flight checks, pending retries, and delayed navigation; delete the saved record; load setup. Late results cannot restore a deleted record or navigate away from setup. A closed window also releases outstanding work.
- Expose connection operations only to the packaged local main frame. The remote page retains its existing native appearance/update capabilities but gains no connection or disconnect operation. Reconcile preload and main-process sender validation with that boundary.
- Route genuine top-level remote navigation failure back through saved startup, including retries. Preserve exclusions for aborted navigation, subframes, and local-page load failure. Treat a failure to load the served page after saving as recovery of that saved connection, not as a setup-field error.

**Verification criteria.** Reconcile the existing desktop contract tests and `test/e2e/connect-screen.*` suites with the proofs. Retire manual-prefill, separate-token, and “keep the existing token on tokenless paste” expectations. Preserve normalization, atomic persistence, preflight compatibility, and page-entry token consumption evidence.

The specified real-Electron acceptance crosses the packaged local page, preload, main process, running token-requiring Television server, saved record, and served UI. Additional proof-selected evidence covers saved startup/restart, unreachable retry/recovery, auth stop, disconnect from local errors and the upgrade gate, stale completion after disconnect, and main-frame load recovery. Contract breadth can use declared peers; it does not prove packaged assets, IPC, or native behavior. Observe the local page in both appearances using the real Electron/native-theme path. Build checks verify that a distributable contains the local assets and required notices; a source HTML test cannot substitute.

Reconcile all helpers and fixtures that currently target the address/token form, including unrelated desktop acceptance that uses it to establish a session. Extend existing stylesheet delivery coverage to the new `specs/ui/setup/` owner and the packaged local route; the current foundation discovery walks other UI directories and would otherwise miss this surface.

**Deferred task obligations completed here.** Execute the new setup/disconnect steps in the real-Electron upgrade-gate staging recipe, then update step 4 and its surrounding instructions in `specs/arch/updates/runbook-ux-staging.md`. Record the execution evidence with the contribution. Do not merely rename the menu item in an untried recipe. Recheck the theme-author app-shell reference from slice 2 against the finished markup.

**Expected baseline.** All three slices' implementation and proof obligations are fulfilled and targeted suites are green. Every temporary style/setup or desktop-menu mismatch above is resolved. No planned failing baseline remains for integrated review. The full verification result is still required separately; targeted success does not establish it.

## Verification and completion

For each slice, write the proof-derived failing tests before implementation, show that the failures concern the intended behavior, then implement and run them to green. Expand to the owning suites when the narrow results mature. Record any unexpected baseline failure with its test identity and resolving slice; a broad failure sends iteration back to its narrow reproducer. Do not manufacture a waiver or weaken a proof to keep a slice green.

Use the [canonical runner](../../../specs/arch/test-runner/test-runner.md#commands), with file/title selection first, for example:

```bash
npm test -- local --file packages/cli/test/cli.test.ts --grep links
npm test -- local --file packages/web/test/server-connection.test.ts
npm test -- local --file packages/desktop/test/connect-flow.test.ts
npm test -- local --file packages/desktop/test/e2e/connect-screen.01.test.ts
```

These are iteration examples, not an exhaustive test list; proof reconciliation determines the actual selections. Before starting Television on a development host, create `~/.tv-developer`. Use isolated server homes and desktop user-data directories through the established harness. Respect the runner's dynamic-port and cleanup requirements. Ordinary CLI tests use the injected daemon boundary; if persisted-service behavior changes beyond link formatting, assess the required opt-in daemon acceptance under its designated-host rules.

At integrated review, check agreement among specs, reconciled proofs, implemented tests, production code, shipped assets, the administrator guide, and bundled skill guidance. Confirm there are no unresolved assertion obligations for this contribution or temporary baselines. Include implementation/visual review of the specified frames and their production counterparts under the active conformance exception.

Before treating the implementation as ready to merge, follow the shared-branch workflow: incorporate the actual target's current commits with policy reconciliation, commit and push that implementation tree, and obtain full validation through `npm run verify`, ready-PR GitHub CI, or both. On a host marked for Blaxel, remote verification requires the committed, pushed revision; using the local bypass requires explicit human authorization. Report the revision tested, complete result, recovered flakes, and specialized evidence. The present planning task commits locally and does not push or run the implementation gate.

The desktop product spec also requires the applicable checks on an unreleased ToDesktop candidate or signed test build before this behavior reaches `main`. The planned connection IPC, build, and gate-presentation changes require the supported-Mac Bridge and IPC, Mac install, and Updates checks. Assess the finished change against the remaining triggers, including Electron license-file checks if their delivery changes, and record the build identity, source commit, operator, and results. Linux Electron acceptance does not establish signed Mac installation or native Mac operation. Arrange those checks during implementation; their absence does not block this planning deliverable, but required checks cannot be left outstanding at the merge to `main`.

Human acceptance of every spec delta and the guide's changed instructions remains due before the first shared-branch merge. Keep these working documents while the contribution is in progress; perform [pre-merge docs prep](../../../specs/spec-docs.md#pre-merge-docs-prep) once the implementation is complete.

Publishing `television.run/install.md` is a post-merge release obligation, separate from editing the guide source. Publish the merged source no later than the desktop release that ships setup. Record that handoff in the PR/release work so finishing implementation does not silently drop it. This contribution's plan does not perform publication or choose a release/version bump.

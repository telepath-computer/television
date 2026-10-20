# Transparent artifacts: task record

Working record for the transparent artifacts change on `feat/transparent-artifacts`, branched from `feat/artifact-templates` at `613bb48`. An earlier, unmerged attempt survives as a patch in `/root/workspace/tmp/old-television-checkouts-backup-2026-10-01/`; it is reference material only. The authority is the specs listed below.

## Settled

- The artifact record gains a flat, optional `transparent` (`specs/arch/artifacts/index.md`); absent means opaque. It applies to path and URL artifacts.
- `tv create-artifact` and `tv update-artifact` take `--transparent` and `--no-transparent`; giving both is a directive error (`specs/product/cli.md`).
- Templates and the create request carry `transparent` inside `display`, as a starting default (`specs/product/templates.md`, `specs/arch/layout/index.md`).
- The frame's transparent state is the Storybook UI spec in `storybook/spec/artifact-frame/`. Stories render only the component; staging lives in a decorator.
- A background page holding a transparent artifact does not blur the wallpaper behind it; the stage states this in prose only (`specs/ui/app/stage/index.md`).
- Spec deltas converged under independent review on October 20, 2026 (CLI and state: two rounds, PASS; whole result: round 1 FAIL on two frame-styling findings, round 2 PASS). Three wording-only edits to `specs/arch/artifacts/index.md` and the resources storage listing followed at Rupert's request, after the last PASS. Rupert approved the spec changes on October 20, 2026.
- Rupert authorized checkpoint commits on this branch on October 20, 2026; he reviews the full diff at the PR. No pushes, PR or merge without asking. Commits carry no AI attribution or co-author trailer.
- The initial slice-1 request withheld commits. The follow-up authorizes three logical commits: approved specs and Storybook, proofs and working documents, then implementation/tests with their proof citations. Use the configured identity; do not push.

## Stages

| Stage | Status |
|---|---|
| Spec convergence | Done: round 2 PASS; Rupert approved |
| Proof derivation | Done: 11 proofs; one spec finding (creation with `false`) resolved by restoring "Only `true` is ever stored" in `^ar-transparent` |
| Proof convergence | Done: round 1 PASS, no findings |
| Plan (if more than one slice) | Done: two slices; round 1 PASS, no findings |
| Implementation, red/green TDD | Slice 1: done; review round 1 PASS at `f9e426c`, follow-up round 2 PASS at `80f100c`. Slice 2: implemented; integrated code, visual, architecture, test-correction and guidance reviews PASS |
| Integrated result and full verification | Requested local regression and static checks passed. Theme-authority conflict resolved by the supplied spec correction. Full gate blocked by missing Blaxel repository-read credentials and the prohibition on pushing |
| Draft PR | Not started. Merge needs Rupert's go-ahead |

## Follow-ups outside this change

- Pre-existing: `tv create-artifact` and `tv reposition-artifact` still detect `--full-screen` / `--no-full-screen` by scanning raw argv, so an option value spelled `--full-screen`, such as a title, turns full-screen on. Transparency uses parser option events instead; full-screen could adopt the same approach in a separate change. Raised by the slice 1 review (P3).

## Comment obligation

- Closed: the `store` and `share` comments in `packages/artifact/src/model.ts` cite `specs/arch/artifacts/index.md#^ar-record`.

## Slice 1 review

Independent review found that raw argv scanning treated a title of `--transparent` or `--no-transparent` as an option. Four regression cases failed before correction. Creation and update now collect actual parser option events, preserving omission, explicit false, and conflict detection. The complete CLI contract file passes all 280 tests. Follow-up code review returned PASS. This corrects the plan method; no spec or proof assertion changed.

The final inherited-evidence check found that `ar-t-input-seam` named “round-trips pointer artifacts through the real CLI, server, and proxy” as its URL-repoint evidence, although that test creates only a path artifact. Independent review confirmed the citation defect. The corrected citation names the existing “server and CLI round-trip through status, title update, get, and delete” test: it creates a URL artifact, calls `runCLI` to repoint it through the shared client and running server, and calls `get-artifact` to verify the changed URL. This is an agent-owned proof correction; the assertion and spec need no change.

Slice 1 leaves frame and stage rendering for slice 2. The new artifact spec requires a mirrored proof file for reference integrity, so the spec commit includes only its title and `Proves` declaration; the proof content follows in the second commit.

## Validation

All commands below ran on the uncommitted implementation. `P`, `F`, and `filtered` mean passed, failed, and excluded by `--grep`. The final four-surface run has one genuine environment-dependent skip: this host cannot stage privileged-port `EACCES`/`EPERM`. No passing run needed retries or reported recovered flakes, leaked processes, or infrastructure failures.

Every file row uses `npm test -- local --file <path>`:

| Path | Final full-file result |
|---|---|
| `packages/artifact/test/unit/model.test.ts` | 13 P |
| `packages/cli/test/cli.test.ts` | 276 P before review; 280 P after the parser correction |
| `packages/server/test/endpoints.test.ts` | 30 P |
| `packages/server/test/page-layout.test.ts` | 22 P |
| `packages/server/test/templates-scanner.test.ts` | 14 P |
| `packages/server/test/templates-create.test.ts` | 8 P |
| `packages/server/test/resources/artifact-stores.test.ts` | 25 P |
| `packages/server/test/telemetry-emitters.test.ts` | 13 P |
| `packages/server/test/artifact-transparency.test.ts` | 7 P |
| `test/node/cli-acceptance.test.ts` | 41 P |
| `test/repo/skills-build.test.ts` | 12 P |

Red/green iterations use the same file command, with the listed filter when present:

| Path and filter | Before implementation | After implementation |
|---|---|---|
| Model, no filter | 12 P / 1 F: schema rejected transparency | 13 P |
| Artifact transparency, no filter | 2 P / 5 F: creation and loading rejected transparency | 7 P |
| Page layout, `--grep 'rejects invalid creation display'` | 1 P / 21 filtered: existing strict validation already rejected these values | 1 P / 21 filtered |
| Telemetry, `--grep 'emits artifact updates only when transparency changes'` | 1 F / 12 filtered: no update emission | 1 P / 12 filtered |
| CLI, `--grep 'maps display options\|maps transparency\|conflicting update transparency\|transparency flags\|requires a field\|rejects invalid creation display'` | 27 P / 24 F / 225 filtered: flags and help missing | 51 P / 225 filtered |
| Template scanner, no filter | 10 P / 4 F: boolean discarded and invalid values accepted | 14 P |
| Template creation, `--grep 'display'` | 1 P / 1 F / 6 filtered: boolean missing from scan result | 2 P / 6 filtered |
| Skills build, `--grep 'emits template discovery'` | 1 F / 11 filtered: emitted guidance missing flags | 1 P / 11 filtered |
| CLI acceptance, `--grep 'transparency\|template creation option'` | 3 F / 38 filtered; each retried twice, nine failed attempts | 3 P / 38 filtered; repeated after parser correction with the same result |
| CLI parser regression, `--grep 'keeps transparency flag spellings'` | 4 F / 276 filtered: title values mistaken for options | Full CLI file: 280 P |

The first attempts at the model, artifact-transparency, filtered page-layout, and filtered telemetry commands ran no tests: the sandbox denied the runner's `spawnSync npm` call with `EPERM`. All four were rerun with sandbox escalation and produced the red/baseline results above.

Additional validation:

| Command | Actual results |
|---|---|
| `npm test -- local --surface unit:artifact,unit:shared,unit:cli,unit:server` | First run overlapped the new parser regressions before the fix: 1,557 P / 4 F / 1 skipped. Corrected rerun: 1,561 P / 0 F / 1 skipped (artifact 110, shared 67, CLI 303, server 1,081). |
| `npm test -- local --file test/node/cli-integration.test.ts --grep 'round-trips pointer artifacts\|server and CLI round-trip through status'` | 2 P / 16 filtered |
| `npm run type-check` | First exit 2: missing `ArtifactPatch` barrel export. Export added; rerun exit 0. |
| `npm run lint` | First exit 2: generated onboarding file disappeared during a concurrent acceptance build. Rerun after builds: exit 0. |
| `npx vitest run test/repo/spec-links.test.ts` | 8 P, exit 0 |
| `npm run specs:index` | Two successful runs after proof edits; each indexed 141 specs and 124 proofs. |
| `git diff --check` | Passed throughout and after final validation. |

Canonical reports remain under `.test-runs/`; the final four-surface report is `.test-runs/2026-10-20T18-44-52-150Z-p3870640-rfbca919a72ab5e22/summary.json`. Iteration logs are `/tmp/transparent-*.log`. Builds ran through the canonical test harness. The checkout was never linked or installed into the host; tests used isolated absolute homes. The existing developer marker was present, and the Storybook server on port 6012 was not touched.

Frame/stage rendering, browser/Electron transparency acceptance, the popover transparency walk, theme guidance, and full `npm run verify` remain intentionally deferred to slice 2.

## Citation correction and commit preparation

The full affected file, `npm test -- local --file test/node/cli-integration.test.ts`, passes all 18 tests after the citation correction, with no retries, skipped tests, leaked processes, or infrastructure failures. `npx vitest run test/repo/spec-links.test.ts` passes all 8 tests. `npm run specs:index` regenerates 141 spec entries and 124 proof entries.

The three authorized commits separate approved specs and Storybook, proof design and working documents, then slice-1 code/tests and their evidence citations. Each staged tree is exported to a temporary directory and checked with the spec-links test before committing, so unstaged files cannot supply missing references. The required artifact-proof declaration and its generated index entry accompany the new spec; all proof assertions follow in the second commit.

## Slice 2 implementation

Work continues from `be358af` on October 20, 2026. Production frames use the existing metadata replacement path and existing descendant menu state. Stage wallpaper treatment can follow the direct-child frame class without adding retained state to `Stage`.

One authority conflict is pending Rupert's decision: the plan requires Storybook authorities in the theme-reference fingerprints, while `specs/arch/themes/authoring.md` Testing permits only app `.frame`/`.css` files plus the app index and rejects additional entries. The freshness change is paused. A concrete correction was proposed to include current authorities delegated by the app UI specs; other work continues independently.

Initial frame-state TDD: `npm test -- local --file packages/web/test/artifact-view.test.ts --grep 'selects transparency'` first stopped in sandbox preflight (npm unavailable; zero tests). The escalated rerun failed as intended: 2 failed, 86 filtered, because true metadata did not add `artifact-frame-transparent`, in both ordinary and full-screen contexts. No retries. Report: `.test-runs/2026-10-20T19-12-16-670Z-p4003634-r4f94527c58c7563b/summary.json`.

The existing developer marker is present. The host also has `~/.tvdev-use-blaxel`; full verification will use its normal provider and will stop before any required push. The Storybook on port 6012 remains untouched.

Frame motion red: `npm test -- local --file packages/web/test/e2e/artifact-view.test.ts --grep 'transparent frame hover' --retries 0` failed all 3 new tests as intended: the title bar remained visible at rest. No retries or process leaks; Chromium ran, while the optional Firefox project was unavailable. Report: `.test-runs/2026-10-20T19-13-19-952Z-p4013644-r8493905229cdc714/summary.json`.

Theme guidance red/green: the existing proof named a test that has been renamed. Two sandbox attempts stopped at preflight; an escalated stale-name filter selected zero tests (12 filtered), so that run is not credited. With the actual name, `npm test -- local --file test/repo/skills-build.test.ts --grep 'builds only television for agents and separates calendar and task components for onboarding'` failed on the absent transparent-frame selector (1 failed, 11 filtered), then passed after updating the reference (1 passed, 11 filtered). The full `npm test -- local --file test/repo/skills-build.test.ts` passed all 12 tests. The unchanged `npm test -- local --file test/repo/theming-reference.test.ts` failed its one test on the new selector absent from recorded authorities; that is the pending spec conflict above. No retries or recovered flakes. The final full skills report is `.test-runs/2026-10-20T19-19-06-663Z-p4068519-re88a735074c02040/summary.json`; freshness is `.test-runs/2026-10-20T19-19-09-463Z-p4069106-r6d1e3405dadb606e/summary.json`.

The frame-state targeted green command passes: 2 passed, 86 filtered, no retries (`.test-runs/2026-10-20T19-25-32-919Z-p4123680-raca1a0317413e5c0/summary.json`). Production selects one class from metadata and carries Storybook-derived transparent styles in the existing host stylesheet, with an iframe/webview selector and no change to webview display. The stage exception is one direct-child `:has` rule in its existing host stylesheet. Base stylesheet copies and their imports are unchanged.

The independent read-only reviewer runs `gpt-6-astra` at `xhigh` through the Codex skill in a separate session, `01a15ac5-6297-7352-a3be-2f816b625ee3`. Native agent capacity was exhausted; no review result is claimed yet.

Acceptance TDD (all targeted commands use `--retries 0`):

| Command after `npm test -- local` | Actual results |
|---|---|
| `--file packages/web/test/e2e/artifact-view-wheel.test.ts --grep af-ac-transparent` | Sandbox preflight: zero tests. First escalated run: 1 failed during initial navigation (30s), not a behavioral red. |
| `--file packages/web/test/e2e/skill-selector.test.ts --grep templates-ac-transparent-ui` | Sandbox preflight: zero tests. First escalated run: 1 failed on missing class, with global 30s timeout also expiring. |
| `--surface e2e:browser-app --grep 'af-ac-transparent\|templates-ac-transparent-ui'` | Valid red: 2 failed on missing transparent class; no retries. |
| `--file packages/desktop/test/e2e/artifact-view-webview-wheel.test.ts --grep af-ac-transparent` | Sandbox preflight: zero tests. First two escalated runs: 1 failed each at the existing 8s launch bound, not behavioral reds. The new test now opens the real built app from its isolated product server, avoiding cold Vite compilation. Rerun: valid red, 1 failed on missing class. Green: 1 passed, no skips/retries, 37.4s test / 1m12s overall. |
| `--file packages/web/test/e2e/stage.test.ts --grep st-ac-transparent-input` | Sandbox preflight: zero tests. Escalated red: 1 failed on missing transparent class. |
| `--surface e2e:browser-app --grep 'transparent frame hover\|st-ac-transparent-input\|af-ac-transparent\|templates-ac-transparent-ui'` | 5 passed, 1 failed, no retries. Browser acceptance, popover, stage, pointer fade and reduced motion passed. Menu test incorrectly assumed pointer opening focused its first option; corrected the real keyboard sequence to ArrowDown before Enter. |

Browser combined report: `.test-runs/2026-10-20T19-25-52-701Z-p4129546-rfa47bbec4637870f/summary.json`. Electron green: `.test-runs/2026-10-20T19-28-29-551Z-p4160028-ra051c62dc9c2edbf/summary.json`.

Preliminary independent review found one coverage defect: bubbled transition events did not identify the clip versus title bar. The test now records exact event targets for clip background/backdrop and bar opacity. The reviewer confirmed the pending theme-authority conflict and found no new slice-1 integration defect. Final review remains pending.

Visual review used the existing Storybook at port 6012 without restarting it. Screenshots and temporary scripts are under `/tmp/transparent-s2-visual/`, outside the checkout. `node /tmp/transparent-s2-visual/storybook.mjs` and `node /tmp/transparent-s2-visual/production.mjs` both completed successfully. Production mounted its real frame, with the same authored clock document, theme, 420×280 box and patterned staging wallpaper as the stories. Side-by-side review of `story-{opaque,transparent-at-rest,transparent-hovered}.png` and matching `production-*.png` found matching surface, rim, shadow, corners, tint, blur and title-bar placement. Rest has no visible outer frame; hover frosts the clip and overlays the bar, with the clock unchanged. The transparent document bounds exactly match the 420×280 frame in both states.

`production-stage-backgrounds.png` compares transparent background `a`, selected opaque `b`, and opaque background `c` on patterned wallpaper with visible theme blur. The transparent page leaves the wallpaper grid sharp while its document fades and blurs; the opaque background page blurs the wallpaper rectangle. Both background pages retain scale, artifact fade and artifact blur. Temporary visual measurements recorded `none` versus `blur(24px)` backdrop treatment, and `blur(2px)` / opacity `0.55` for both background artifacts; these are review evidence, not new automated styling assertions. `electron-local.png` and `electron-shared.png` show authored opaque panels over the transparent frames. Frame and webview bounds both measured about 694.203125×826.96875, with guest viewport 694×827; no oversized paint or collapsed webview was visible. Capture instrumentation was removed from the tests.

The motion-target sensitivity check temporarily removed only the production clip transition and restored the stylesheet in `finally`. `npm test -- local --file packages/web/test/e2e/artifact-view.test.ts --grep 'fades on pointer entry and exit' --retries 0` failed its one test as intended: the recorded bar-opacity events could not satisfy the missing clip-background transition. No retries. Report: `.test-runs/2026-10-20T19-32-16-480Z-p4186606-r96ae68494854702d/summary.json`.

The feature citation audit checked all added proof lines against source declarations. It corrected three remaining inherited citations: the invalid-create names in `ar-t-targets`, the two real-resource test names in `rs-arch-t-artifact-record`, and the five parameterized opaque window-edge tests. All 68 quoted names resolve to declarations (including suite/test paths and parameterized titles); no changed proof retains `(test to be written)`. The `store`/`share` comment obligation remains closed. `git diff --check -- proofs` passes.

The independent architecture check found no issues: artifact metadata is the sole setting owner; the frame derives its presentation state; CSS owns hover, menu retention and reduced motion; and stage derives only its wallpaper-backdrop exception. No new state, service, timer, event or dependency crossing was introduced.

The first full `npm test -- local --file packages/web/test/e2e/artifact-view.test.ts` run reported 19 passed / 1 failed, with two retries (three failed attempts of the menu test). ArrowDown focused the real custom menu item, but Playwright's role locator did not resolve its `ElementInternals` role. The test now uses the existing `tv-menu-item` locator to assert that focus. The focused rerun, `npm test -- local --file packages/web/test/e2e/artifact-view.test.ts --grep 'holds the visible bar' --retries 0`, passed its one test with no retries. Full-file validation is running again. The pointer test also explicitly checks that the shown bar overlaps the document at its bottom edge.

The corrected full frame browser file passes all 20 tests without retries or skips (`.test-runs/2026-10-20T19-38-39-659Z-p23235-r09e6d49662c2cf56/summary.json`); the optional Firefox project is unavailable on this host. The full frame view-contract file passes all 88 tests (`.test-runs/2026-10-20T19-41-25-684Z-p38547-r82ad63c6fd827ba9/summary.json`). Remaining requested files and surfaces are running sequentially.

Independent integrated code review returned PASS on the completed implementation, tests, guidance, proof citations and all nine screenshots. It confirmed closure of the motion-target finding and the title-bar overlay assertion. No further slice-1 integration defect was found. It explicitly leaves feature convergence blocked on the pending theme-authority correction and final validation. The implementation is being checkpointed under Rupert's authorization; this is not a claim that full verification or all deferred obligations are complete.

Checkpoint commit: `2434269` — “Transparent artifacts: render frames and cover browser and Electron”. Created with the configured identity, path-limited staging and no attribution trailer; not pushed.

`npm run verify -- --no-publish` ran on that clean committed checkpoint and exited 2 before tests. The host marker selected Blaxel, whose capability preflight stopped at `blaxel-github-token`: A repository-root `.blaxel-gh-token` file or `BLAXEL_TV_GH_TOKEN` is required so sandbox workers can fetch the repository. The setup spec identifies its source as the corporate 1Password item “Television Blaxel sharded test runner github PAT”. No remote test was dispatched. Once credentials exist, remote verification also requires the implementation commit reachable from `origin`; `2434269` is unpushed. Rupert prohibited pushes, and no local full-verification bypass was requested or used. `--no-publish` suppresses attestation writes. Log: `/tmp/transparent-s2-verify.log`.

The slice-1 surface rerun passes 1,561 tests with one existing skip and no retries: artifact 110, shared 67, CLI 303, server 1,081. The server skip is the privileged-port refusal case because this host cannot stage `EACCES`/`EPERM`. The prior slice-1 record had artifact/shared counts transposed; the original normalized report confirms 110/67, and the wording above is corrected. The complete spawned CLI acceptance file passes all 41 tests with no retries or skips.

The combined `unit:root,unit:browser-app` run exits 1: root 444 passed / 1 failed / 1 skipped; browser-app 573 passed / 1 skipped. The sole failure is the already-known theme-reference authority conflict. The two standing skips are the isolated-lifecycle guardrail acceptance case (TV-597) and the fake ACP bridge disconnect case (TV-186). No retries, recovered flakes, process leaks or infrastructure failures. Report: `.test-runs/2026-10-20T19-54-02-915Z-p74151-r0b7d0a246aaabf9d/summary.json`.

Existing UI safeguards remain active: the root run passes all 3 tests in `ui-style-source.test.ts` and all 3 in `ui-style-delivery.test.ts`, alongside 6 measure-crossing tests and the UI module-shape check. The opaque window-edge file passes all 15 cases. No new automatic stylesheet-copy or markup-conformance test was added for the Storybook transparent states; their prescribed visual review is recorded above.

The full browser surface in the requested `e2e:browser-app,e2e:desktop` run completed with 304 first-attempt passes, one recovered retry and one skip (15.1 minutes of Playwright test time). The recovered case is the existing `theme.test.ts` test “PATCH /display activeThemeName reloads mounted artifact iframes so canonical styles pick up the new theme”: its first attempt's `locator.evaluate` ran while the iframe navigation destroyed its execution context at line 306; its one retry passed. No feature code change was made for that unrelated timing failure. The skipped Chromium case is “Firefox system appearance follows emulated preference in the same cross-origin iframe”, explicitly owned by Firefox; the optional Firefox project is unavailable on this host. The 85-test Electron surface is still running.

The requested full browser/Electron command exits 0 under the canonical retry rules: browser 304 first-attempt passes + 1 recovered retry + 1 skip; Electron 84 first-attempt passes + 1 recovered retry, no skips. No process leaks or infrastructure failures. Report: `.test-runs/2026-10-20T19-57-46-205Z-p84685-rdf1326b228d15570/summary.json`.

The Electron retry belonged to the new transparency walk, so it was investigated before close-out. Its first native click left the document output at `Ready`. `selectArtifact` waits for selected attributes, but stage centring then runs a Web Animation that the standing CSS-motion override does not disable. The new test measured guest click coordinates while that filmstrip could still move. Its `expectFrame` helper now starts the existing motion observer before selection and waits for animation, scroll and frame settlement before measuring. It still sends one native click; no retry, sleep, timeout increase or mocked action was added. Independent review returned PASS and confirmed that the acceptance proof remains intact. `npm test -- local --file packages/desktop/test/e2e/artifact-view-webview-wheel.test.ts --retries 0` passes all 3 tests with no retries or skips (`.test-runs/2026-10-20T20-21-15-406Z-p171752-r402a929eb927514c/summary.json`). A full Electron-surface run with retries disabled follows.

During final checks, an external edit to `specs/arch/themes/authoring.md` added delegated Storybook stories, MDX and stylesheets to the current-authority source list. This resolves the recorded conflict; the implementation did not choose or write that rule. Freshness work resumed against the updated governing text. The existing retired Templates frame substitution remains unchanged.

The first static-check pass completed successfully: `npm run type-check` exit 0; `npm run lint` exit 0; `npx vitest run test/repo/spec-links.test.ts` 8 passed; `npm run specs:index` indexed 141 specs and 124 proofs. These will be repeated after the final test/fingerprint edits.

Freshness TDD is complete under the corrected authority. `npm test -- local --file test/repo/theming-reference.test.ts` first failed its one test because 27 sources were recorded while the corrected assertion required 30. After reviewing the three artifact-frame Storybook authorities and recording their hashes, the same command passed 1 test. Both runs had no skips or retries. Reports: `.test-runs/2026-10-20T20-22-48-325Z-p177080-r439dcef7faf5441f/summary.json` and `.test-runs/2026-10-20T20-23-25-841Z-p178717-rf990d95557337e56/summary.json`. The proof now explicitly includes delegated authorities, exact enumeration and matching fingerprints.

Independent final guidance review returned PASS: the supplied spec amendment resolves the conflict; the list adds exactly the three artifact-frame authorities while retaining the base sources; all hashes match; the reference agrees with the frame and stage specs; and the proof correctly combines bounded automated checks with semantic review. A proposed external Codex review resume was rejected by automatic approval review for possible private-code egress without explicit authorization. It was not retried or bypassed; the existing in-session independent reviewer completed the read-only review instead.

Every slice-2 proof now names its evidence:

| Assertion | Implementing evidence |
|---|---|
| `af-ac-transparent` | Browser: `artifact-view-wheel.test.ts`, “path and shared URL frames adopt live transparency and retain it after moves and restart (^af-ac-transparent)”. Electron: `artifact-view-webview-wheel.test.ts`, the corresponding “path and shared URL webviews…” test. |
| `af-ui-ac-transparent-state` | `packages/web/test/artifact-view.test.ts`, “selects transparency from path and URL metadata in full-screen=%s without changing the document”, both parameter values. |
| `af-ui-ac-transparent-hover` | `packages/web/test/e2e/artifact-view.test.ts`, suite “transparent frame hover (^af-ui-ac-transparent-hover)”: “fades on pointer entry and exit, overlays a stable document, and hides keyboard controls after exit”; “holds the visible bar and usable menu outside the frame until dismissal”; “applies reduced-motion entry and exit immediately without transitions”. |
| `af-ui-ac-window-edges` (retained) | `window-edge-rims.test.ts`: “window rim theme decorations accept complete overrides and inactive frames retain their edge”; “window rims retain fractional paint and iframe input at DPR1” and “…DPR2”; “canonical panels share complete paints and independent borders in light” and “…dark”. |
| `st-ac-transparent-input` | `stage.test.ts`, “stage transparent background input (^st-ac-transparent-input) > a press over a transparent background document control selects once and only a later press activates it”. |
| `st-ac-selection-motion` (retained) | `stage.test.ts`, “stage selection motion (^st-ac-selection-motion) > background presses centre adjacent and nonadjacent pages in the same authored time without recreating documents”. |
| `templates-ac-transparent-ui` | `skill-selector.test.ts`, “Templates popover creates a focused transparent frame from manifest defaults without sending display (^templates-ac-transparent-ui)”. |
| `theme-authoring-t-app-shell-freshness` | `test/repo/theming-reference.test.ts`, “the authored theme reference covers current application authorities”, plus the independent reference review. |
| Existing theme bundle assertions | `test/repo/skills-build.test.ts`, “builds only television for agents and separates calendar and task components for onboarding”. All nine inherited rows now cite this actual test name. |

All feature proof placeholders and comment obligations are closed. Full provider-compliant verification remains the only deferred close-out obligation; the local surfaces do not substitute for it.

## Completed local validation

The table records every complete-file/surface and static command in the sequential validation batches, including the first failed root run and the later repeats. Targeted red/green commands and harness failures are recorded above. `P`, `F`, and `S` mean passed, failed, and skipped; recovered tests are included in the passed count.

| Command | Actual result |
|---|---|
| `npm test -- local --file packages/web/test/e2e/artifact-view.test.ts` | Exit 0; e2e:browser-app: 20 P / 0 F / 0 S; 0 retries, 0 recovered |
| `npm test -- local --file packages/web/test/artifact-view.test.ts` | Exit 0; unit:browser-app: 88 P / 0 F / 0 S; 0 retries, 0 recovered |
| `npm test -- local --file packages/web/test/e2e/stage.test.ts` | Exit 0; e2e:browser-app: 21 P / 0 F / 0 S; 0 retries, 0 recovered |
| `npm test -- local --file packages/web/test/e2e/artifact-view-wheel.test.ts` | Exit 0; e2e:browser-app: 6 P / 0 F / 0 S; 0 retries, 0 recovered |
| `npm test -- local --file packages/web/test/e2e/skill-selector.test.ts` | Exit 0; e2e:browser-app: 8 P / 0 F / 0 S; 0 retries, 0 recovered |
| `npm test -- local --file packages/desktop/test/e2e/artifact-view-webview-wheel.test.ts` | Exit 0; e2e:desktop: 3 P / 0 F / 0 S; 0 retries, 0 recovered |
| `npm test -- local --file packages/web/test/e2e/window-edge-rims.test.ts` | Exit 0; e2e:browser-app: 15 P / 0 F / 0 S; 0 retries, 0 recovered |
| `npm test -- local --surface unit:artifact,unit:shared,unit:cli,unit:server` | Exit 0; unit:artifact: 110 P / 0 F / 0 S; 0 retries, 0 recovered; unit:cli: 303 P / 0 F / 0 S; 0 retries, 0 recovered; unit:shared: 67 P / 0 F / 0 S; 0 retries, 0 recovered; unit:server: 1081 P / 0 F / 1 S; 0 retries, 0 recovered |
| `npm test -- local --file test/node/cli-acceptance.test.ts` | Exit 0; e2e:node: 41 P / 0 F / 0 S; 0 retries, 0 recovered |
| `npm test -- local --surface unit:root,unit:browser-app` | Exit 1; unit:root: 444 P / 1 F / 1 S; 0 retries, 0 recovered; unit:browser-app: 573 P / 0 F / 1 S; 0 retries, 0 recovered |
| `npm test -- local --surface e2e:browser-app,e2e:desktop` | Exit 0; e2e:browser-app: 305 P / 0 F / 1 S; 1 retries, 1 recovered; e2e:desktop: 85 P / 0 F / 0 S; 1 retries, 1 recovered |
| `npm run type-check` | Exit 0; passed |
| `npm run lint` | Exit 0; passed |
| `npx vitest run test/repo/spec-links.test.ts` | Exit 0; 8 P / 0 F / 0 S |
| `npm run specs:index` | Exit 0; 141 specs and 124 proofs indexed |
| `npm test -- local --surface e2e:desktop --retries 0` | Exit 0; e2e:desktop: 85 P / 0 F / 0 S; 0 retries, 0 recovered |
| `npm test -- local --surface unit:root,unit:browser-app` | Exit 0; unit:root: 445 P / 0 F / 1 S; 0 retries, 0 recovered; unit:browser-app: 573 P / 0 F / 1 S; 0 retries, 0 recovered |
| `npm run type-check` | Exit 0; passed |
| `npm run lint` | Exit 2; ENOENT while scanning .agents; stopped before checking code |
| `npx vitest run test/repo/spec-links.test.ts` | Exit 0; 8 P / 0 F / 0 S |
| `npm run specs:index` | Exit 0; 141 specs and 124 proofs indexed |
| `npm run lint` | Exit 0; passed |

The final Electron surface passed all 85 tests with retries disabled and no skips. The final root/browser-app unit run passed 445 and 573 tests respectively, each with its one standing skip; no retries. Type-check, spec links and index generation passed on repetition. The first final lint run exited 2 because `.agents` disappeared during directory enumeration; the directory existed on inspection and the unchanged rerun passed. No lint configuration or code was changed for that transient filesystem error. No completed validation run reported leaked processes or infrastructure failures.

The reviewed implementation and proof work is complete. The optional Firefox project was unavailable; Chromium skipped its Firefox-owned appearance assertion. The server privileged-port skip, root lifecycle-guardrail skip (TV-597), and browser-unit ACP-disconnect skip (TV-186) are the existing conditions described above. The full provider-compliant gate still requires the missing Blaxel repository-read token and an authorized pushed revision. No push or local bypass was performed.

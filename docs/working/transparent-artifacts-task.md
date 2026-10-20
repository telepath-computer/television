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
| Implementation, red/green TDD | Slice 1: done; review round 1 PASS at `f9e426c`, follow-up round 2 PASS at `80f100c`. Slice 2 in progress |
| Integrated result and full verification | Integrated code/proof review and regression validation in progress; theme-authority correction pending; provider-compliant full gate pending |
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
| `npm test -- local --surface unit:artifact,unit:shared,unit:cli,unit:server` | First run overlapped the new parser regressions before the fix: 1,557 P / 4 F / 1 skipped. Corrected rerun: 1,561 P / 0 F / 1 skipped (artifact 67, shared 110, CLI 303, server 1,081). |
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

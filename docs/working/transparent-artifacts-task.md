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
| Implementation, red/green TDD | Slice 1 implementation and requested validation pass. Inherited proof citation corrected. Slice 2 pending |
| Integrated result and full verification | Not started |
| Draft PR | Not started. Merge needs Rupert's go-ahead |

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

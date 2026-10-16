# Artifact templates: task record

Working record for the artifact templates change on `feat/artifact-templates`. The work was developed on a private branch and moved here as one change on October 16, 2026; the revisions named below are on that private branch. The intent is `docs/working/templates-proposal.md`; the authority is the specs it was derived into, plus the Templates popover's UI spec pilot in `storybook/spec/templates-popover/`.

## Settled

- The spec deltas converged under independent review on October 16, 2026 (round 9 PASS, at `12b05c1`, with one non-blocking note then fixed in `8f18ef6`). Rupert read and approved the spec changes on October 15, 2026, subject to coverage of the proposal and his changes during the read; every later round's coverage check confirmed that coverage.
- The Templates popover is built from the pilot's stories, prose and stylesheet and checked against the stories by eye. Automated UI conformance is out of scope for this change.
- The branch does not merge until the real templates (Calendar, Table, Checklist, Markdown) are specified and built. Merging needs Rupert's go-ahead.
- Implementation notes in the proposal apply: verify once that `tv create-path-artifact` and `tv create-url-artifact` fail as unknown commands; delete the two retired-name CLI tests.

## Stages

| Stage | Status |
|---|---|
| Spec convergence | Done: round 9 PASS |
| Proof derivation | Done: committed at `b3d620c`, 41 proof files; one spec finding resolved in the pilot prose |
| Proof convergence | Done: round 6 PASS |
| Plan (if more than one slice) | Done: four slices, plan review round 3 PASS |
| Implementation, red/green TDD | Slice 1 done (review round 3 PASS at `e9ca8ce`); slice 2 done (review round 4 PASS at `a88f23d`); slice 3 done (review round 2 PASS at `bcdff51`); slice 4 done (review round 2 PASS at `4c55f20`) |
| Integrated result and full verification | Integrated review round 2 PASS at `9a3a03f`; the recovered telemetry flake was a test bug, fixed in `87e3beb` |
| Draft PR | Open. Merge waits for the real templates, pre-merge docs prep, Rupert's review and go-ahead |

## Open obligations

None beyond the stages above.

## Validation

- Slice 1, at `e9ca8ce` (implementer's runs): unit:server, unit:shared and unit:browser-app 1,680 passed, 2 pending; e2e:browser-app 292 passed, 1 skipped (one theme iframe test passed on retry; the reviewer judged the race pre-existing, in unchanged code); e2e:browser-app-real-stack 23 passed, 1 skipped; type-check and lint passed. Firefox was unavailable. The full gate is slice 4's.
- Slice 2, at `a88f23d`: unit:server 1,058 passed; unit:root 444; e2e:node 313; e2e:browser-app, e2e:browser-app-real-stack, e2e:server, e2e:calendar-skill and e2e:tasks-skill 465 passed, 2 skipped; type-check and lint passed. Known temporary guidance mismatch until slice 3.
- Removed create commands, checked once by hand at slice 3 with the built CLI and a fresh home: `tv create-path-artifact --home <tmp>` and `tv create-url-artifact --home <tmp>` each print `Unknown tv command: …` and exit 1; the control `tv templates path --home <tmp>` prints the templates path and exits 0. No permanent test, by Rupert's decision.
- Slice 3, at `bcdff51`: unit:cli 249 passed; unit:server 1,058; unit:root 445; e2e:node 320, 2 skipped; e2e:browser-app 293 and e2e:browser-app-real-stack 24; spec-links 8 of 8; type-check and lint passed. The optional live PostHog roundtrip could not run without its read key.
- Slice 4, at `1167ecc`: full gate `npm run verify -- blaxel` passed: 22 of 22 surfaces, 0 tests failed, 0 flaky recovered, 0 process leaks, 0 infrastructure failures; attestation `refs/testpass/1/daef8d2743cbcebad55b298adfc1fbdae9c7dacc`. Visual comparison of the 15 pilot states against production, by eye: matching apart from the scanner's alphabetical order, real server error text and the focused search field's outline.
- Final integrated revision `b19d0a6`: full gate on Blaxel passed, 22 of 22 surfaces, 0 tests failed, 0 process leaks, 0 infrastructure failures, **1 flaky test recovered on retry**: `packages/web/test/e2e/theme-product-acceptance.test.ts:881`, "executable themes run only in the Chromium application lifecycle and isolate failures" (e2e:browser-app-real-stack, 2 attempts). Attestation `refs/testpass/1/738a5564800a418e18bc872a76605f3153687f29`.
- Revision `9a3a03f`: full gate on Blaxel passed, 22 of 22 surfaces, 0 failed, **1 flaky test recovered on retry**: `test/node/telemetry-cli.test.ts`, "tv skills install -i emits only after installer success and emits no installer arguments". Cause: the assertion searched the whole event, including its random distinct ID, for `add`; fixed in `87e3beb` by checking only the event's properties. The assertion predates this branch. Attestation `refs/testpass/1/54ade7c60bf9864686429bc633bf4070ccafac01`.
- Final revision `7f1b1ac`: full gate on Blaxel passed, 22 of 22 surfaces, 0 failed, 0 recovered retries, 0 process leaks, 0 infrastructure failures. Attestation `refs/testpass/1/35a67f9f2ed37adeabecc4d5791c62b0d4236cd8`.

## Starting sizes (TV-970)

- Intent: `docs/working/template-sizes-proposal.md`, approved by Rupert on October 16, 2026. Specs derived in seven files from `1d14895`; independent review round 1 FAIL (Example wording, fixed), round 2 PASS at `9bdafaa`. Later wording changes by Rupert: the type is `ArtifactDisplayOptions` and the concept is *display options* (glossary entry added).
- Rupert approved the spec changes on October 16, 2026 and handed over the autonomous phase.
- Expected shape: one slice (CLI options, creation requests, template manifest validation, layout of the new page, `television` skill guidance), so no separate plan.

| Stage | Status |
|---|---|
| Proofs | Done: 7 proofs at `5e95062`; review round 1 PASS with three non-blocking findings, applied with the implementation (its review is the follow-up review) |
| Implementation, red/green TDD | In progress, one slice |
| Full verification | Not started |
| PR description | Not started |

- Open: `npm run type-check` in `storybook/` reports 3 errors in `.storybook/preview.ts` (the icon frame import and the adopted-styles loop). They predate the display options work and are on this branch's head; fix before merge.

# Checklist conformance review record

This records the changes and validation for Checklist conformance on `feat/artifact-template-checklist`, based on `6db4cfe`. All changes remain uncommitted. The owner edits were read before work and saved under `/tmp/checklist-conformance-baseline`; comparisons against that baseline distinguish the changes below from the existing work.

## Result

All 21 exported Checklist stories pass conformance in Chromium, with one worker, no retries and no permitted differences. The 23 Checklist real-stack tests, 52 model tests, four package tests and relevant repository checks also pass. Spec prose, story modules, and stylesheets have not been changed by this task.

## Files changed by this task

| File | Change |
| --- | --- |
| `proofs/ui/templates/checklist/index.md` | Derive story conformance, state setup and boundary; expand accessible names; retire stylesheet-copy assertion. |
| `proofs/arch/templates/checklist.md` | Replace byte-identity references with conformance; retain real delivery against the packaged production stylesheet. |
| `proofs/index.md` | Regenerate the Checklist UI description. |
| `packages/web/package.json` | Pin `@telepath-computer/conform` to `0.1.0` as a dev dependency. |
| `package-lock.json` | Record conform and its Playwright peer dependency. |
| `packages/web/test/e2e/template-checklist-conformance.test.ts` | Generate one comparison for each exported Checklist story using the existing real-stack harness. |
| `packages/web/playwright.checklist-conformance.config.ts` | Give conformance a Chromium-only configuration with one worker and no native retries. |
| `config/vite.checklist-storybook.ts` | Serve the worktree Storybook build through a runner-managed Vite service. |
| `scripts/test/build-checklist-conformance.mjs` | Build production assets and Storybook sequentially. |
| `storybook/.storybook/main.ts` | Resolve the docs addon for MDX outside the Storybook workspace; preserve authored custom-property values by disabling CSS minification. |
| `test.config.mjs` | Register conformance and its managed service; resolve web Playwright commands from the pinned root toolchain. |
| `test.prebuilt.mjs` | Include Storybook in the existing build-once execution path. |
| `packages/web/playwright.config.ts` | Exclude the dedicated conformance file from the general browser surface. |
| `test/repo/test-runner-config.test.ts` | Check the new surface, group and file ownership. |
| `test/repo/package-version-sync.test.ts` | Apply workspace wildcard requirements to actual workspace names; conform is an external same-scope dependency. |
| `packages/web/test/e2e/markdown-editor-integration.test.ts` | Resolve its fixture relative to the module when Playwright runs from the repository root. |
| `packages/web/test/e2e/skill-selector.test.ts` | Resolve its thumbnail fixture relative to the module for the same reason. |
| `packages/web/test/e2e/template-checklist-real-stack.test.ts` | Assert every accessible control name, including item positions after removal; retain delivery checks against production source. |
| `packages/server/test/checklist-template.test.ts` | Remove the Checklist stylesheet byte-copy test. |
| `packages/server/assets/templates/checklist/index.html` | Give the add field an explicit empty value attribute. |
| `packages/server/assets/templates/checklist/page.js` | Reflect checkbox state and add-field input into the corresponding HTML attributes. |
| `docs/working/checklist-conformance-report.md` | Record the requested review evidence. |

The installed conform package is MIT-licensed and used only by tests. Development dependencies that never enter a shipped surface are excluded by `specs/product/licensing.md`; no notices change is required. Manifest validation passes. The install reported two high-severity audit findings; dependency upgrades outside the requested install were not attempted.

## Proof assertions

- Added `^checklist-ui-ac-conformance`: every exported story, including stories not embedded in MDX, compared with production in the same state using conform. Storybook generates the export index; an export without production-state support fails its own test.
- Removed `^checklist-ui-t-styles` and its byte-copy test. Removed the obsolete architectural deferral to TV-649 and references that depended on stylesheet identity.
- Expanded `^checklist-ui-ac-remove`: `Title`, `Add an item`, each checkbox name, each `Remove <item>` name, `Empty item`, and each item text box named `Item N`, including renumbering after removal.
- Retained `^templates-checklist-t-delivery`: real HTTP serves the copied production stylesheet, canonical CSS and SDK; the independent copied artifact still works after template discovery changes. Foundation and other surface copy checks are unchanged.

The comparison boundary is real Chromium, a real Television server and copied template through `ChecklistHarness`, and a real worktree Storybook build. Both pages use `.checklist-page` as their root, the story viewport, and the same light/dark system preference. The production appearance resolver reads that preference. The Storybook helper waits for `play`; the test reads resolved args, globals and viewport parameters from Storybook. Production receives no comparison-only markup or CSS.

Store fixtures use the actual resource API. There is no replacement SDK, DOM, data reply or permission result. The existing forwarding proxy controls network timing and reachability. `SaveFailed` selectively buffers the real access notification while delivering a real authorization rejection; that forfeits production message order. Ordinary access delivery remains covered by the real-stack access test. Conformance retains production CSS motion and uses conform to settle capture; the existing behavior tests retain their declared motion override.

## How each story is reached

| Story exports | Production setup |
| --- | --- |
| `New` | Create the installed template through the API; retain its seed and actual add-field autofocus. |
| `WithItems`, `LongItems`, `ManyItems`, `Narrow`, `Dark` | Store the resolved story title and ordered items through the real API, then open the copied artifact at the story viewport and appearance. |
| `EditingItem`, `EditingDoneItem` | Click the indicated text box and press the platform end-of-content shortcut; assert focus and a collapsed caret at the end. |
| `NewEmptyItem` | Seed without the new empty item, click the preceding item, move to its end and press Return; wait for the persisted new row and focus. |
| `KeyboardFocus`, `RemoveFocus` | Click the title and Tab to the second checkbox or second remove button. |
| `Adding` | Click the add field and type the resolved story value using real keyboard input. |
| `Untitled` | Select and delete the title with real keys; wait for the empty stored title and click outside it. |
| `ReadOnly`, `EmptyReadOnly` | Create and open a real share with read access. |
| `Loading` | Hold initial server-to-browser resource messages after loading the actual document and SDK. |
| `LoadingDisconnected` | Hold those messages, then sever the connection and refuse reconnection. |
| `Disconnected` | Load valid data, then sever the connection and refuse reconnection. |
| `SaveFailed` | Open a real read-write share, hold a checkbox write, downgrade the share through the server while buffering the access notification, and release the write. Wait for real rejection, rollback and status; click outside before comparing. |
| `Unreadable` | Store an item missing its required `done` field; wait for the actual page alert. |
| `UnreadableDisconnected` | Reach the same unreadable state, then sever the connection and refuse reconnection. |

## Differences and fixes

The first completed red comparison was `WithItems`, with 229 differences. Its production attribute differences were:

```text
ul:nth-child(2) > li:nth-child(1) > input:nth-child(1) [checked]: expected "", got (absent)
ul:nth-child(2) > li:nth-child(3) > input:nth-child(1) [checked]: expected "", got (absent)
label:nth-child(3) > input:nth-child(2) [value]: expected "", got (absent)
```

Production now assigns `defaultChecked` alongside the live checkbox value. The add-field template declares `value=""`; real input updates `defaultValue`, and Return or multiline paste clears both the live value and the default value. These changes make the attributes reflect the state already shown by the controls. Those are all production changes made for conformance; no production stylesheet changed.

The other 226 differences came from static Storybook CSS minification. For example:

```text
:scope { --accent }: expected oklch(.623 .214 259.815), got oklch(0.623 0.214 259.815)
:scope { --accent-600 }: expected oklch(from oklch(.623 .214 259.815) calc(l*.906) calc(c*1.034) h), got oklch(from oklch(0.623 0.214 259.815) calc(l * (1 - 0.094)) calc(c * 1.034) h)
```

After the attribute fixes, all 21 stories reached comparison. Twenty reported 226 custom-property string differences; `Dark` reported 230. There were no remaining element, attribute, text or other computed-style differences. Vite had shortened decimals, changed whitespace and simplified calculations in authored custom properties. Disabling CSS minification in the Storybook build preserves the source representation, as development Storybook does. Conform still compares every property without normalization or exclusions. The focused comparison and then all 21 stories passed.

Full initial difference output is in `/tmp/checklist-conform-differences.txt`; the complete first 21-story failure output is in `/tmp/checklist-conform-all-differences.txt` and the canonical run directory recorded below.

## Command and validation record

Heavy jobs ran sequentially. Every Playwright run used one worker and `--retries 0`. Deliberate red/green reruns after changes are listed separately from retries; no flaky retries were used. The full e2e gate and `npm run verify` were not run.

| Command | Result |
| --- | --- |
| `git status --short`, `git diff`, `git diff --cached` | Read before changes; preserved the existing owner edits and staged deletions. |
| `npm install --workspace @telepath-computer/television-web --save-dev --save-exact @telepath-computer/conform@0.1.0` | Sandbox attempt stalled and was interrupted (130). Authorized network retry passed, adding three packages. |
| `npm test -- local --file packages/web/test/e2e/template-checklist-conformance.test.ts --grep 'Checklist conforms: WithItems$' --retries 0` | First attempt failed building Storybook because MDX outside its workspace could not resolve the docs addon. Added the exact addon alias. |
| Same focused command, second attempt | Build passed; test collection failed because workspace `npx` chose the newer conform peer Playwright CLI while tests imported the root runner. Pinned web surface command working directories to the repository root. |
| Same focused command, third attempt | One completed red test, 229 conform differences: 226 custom-property strings and three missing attributes. `/tmp/checklist-conformance-red-3.log`. |
| `npm test -- local --file packages/web/test/e2e/template-checklist-conformance.test.ts --retries 0` | First full run: 21 completed failures, solely custom-property strings after the attribute fixes. No setup failures or retries. `/tmp/checklist-conformance-all-1.log`. |
| Focused `WithItems` command after preserving authored CSS | One passed, no retries. `/tmp/checklist-conformance-with-items-green.log`. |
| Full conformance command after preserving authored CSS | 21 passed; zero skipped, flaky tests or leaked processes. `/tmp/checklist-conformance-all-green.log`. |
| `npm test -- local --file packages/web/test/e2e/template-checklist-real-stack.test.ts --retries 0` | 23 passed, including accessible names and the production attribute changes. `/tmp/checklist-real-stack.log`. |
| `CI=1 TV_PW_WORKERS=1 npm test -- local --file packages/web/test/e2e/markdown-editor-integration.test.ts --retries 0` | Eight passed with one worker. `/tmp/checklist-markdown-fixture-check.log`. |
| `CI=1 TV_PW_WORKERS=1 npm test -- local --file packages/web/test/e2e/skill-selector.test.ts --retries 0` | Seven passed with one worker. `/tmp/checklist-selector-fixture-check.log`. |
| `npm test -- local --file packages/server/test/checklist-template.test.ts` | Four passed after removing the byte-copy contract. `/tmp/checklist-template.log`. |
| `npm test -- local --file packages/server/test/checklist-model.test.ts` | 52 passed. `/tmp/checklist-model.log`. |
| `npm test -- local --file test/repo/spec-links.test.ts` | Eight passed. `/tmp/checklist-spec-links.log`. |
| `npm test -- local --file test/repo/specs-index.test.ts` | Two passed. `/tmp/checklist-specs-index.log`. |
| `npm test -- local --file test/repo/test-runner-config.test.ts` | Sandbox preflight could not run nested npm. Authorized red run: 11 passed, three failed on the new surface expectations. One intermediate run could not find the not-yet-created test file. After implementation: 14 passed; rerun after final working-directory edits: 14 passed. |
| `npm test -- local --file test/repo/test-runner-prebuilt.test.ts` | Ten passed. |
| `npm test -- local --file test/repo/test-infrastructure-addresses.test.ts` | Three passed. |
| `npm test -- local --file test/repo/package-version-sync.test.ts` | Red: six passed, one failed because the old scope-prefix rule treated external conform as an internal workspace. After using actual workspace names: seven passed. `/tmp/checklist-package-version-sync-green.log`. |
| `npm run lint:package-manifests` | Passed twice, 15 manifests. `/tmp/checklist-package-manifests-green.log`. |
| `node scripts/specs-index.mjs` | Both runs regenerated 141 specs and 124 proofs. The spec index remained byte-identical to the owner baseline. |
| `npm run type-check` | First two runs failed on the newer conform peer Playwright types. After typing the common browser/page interface at the library boundary, the third run passed. A fourth run after the final Storybook configuration also passed. `/tmp/checklist-typecheck-final.log`, `/tmp/checklist-typecheck-final-2.log`. |
| `npm run lint` | Both runs passed. `/tmp/checklist-lint-final.log`. |
| `npx eslint storybook/.storybook/main.ts --max-warnings=0` | Passed after the final CSS minification setting. `/tmp/checklist-storybook-lint-final.log`. |
| `node --check test.config.mjs`, `node --check test.prebuilt.mjs`, `node --check scripts/test/build-checklist-conformance.mjs` | Passed. |
| `git diff --check` | Passed on repeated checks. |
| `rg -n 'checklist-ui-t-styles\|copies the authoritative Checklist stylesheet\|storybook/spec/templates/checklist/styles.css' packages test proofs scripts` | No remaining obsolete Checklist-copy references (exit 1 means no matches). |

Read-only inspection also used `cat`, `sed`, `rg`, `ls`, Node import/path checks and Python comparisons/extractions. These read the required skills/specs, conform sources and installed package, harness and tests; checked the existing developer marker; verified fixture paths and registry ownership; and extracted conformance output. Two exploratory lookups used nonexistent paths (the root-level conform manifest and a licensing glob); the workspace manifest and actual licensing files were then read successfully. `git rev-parse --short HEAD` returned `6db4cfe`.

Canonical evidence for the first complete red comparison is `.test-runs/2026-10-22T15-59-08-932Z-p1470340-rdc6b52b78c0fcfbc/summary.json`. The full 21-story red run is `.test-runs/2026-10-22T16-05-19-093Z-p1512405-r7d857498bace8f02/summary.json`. The focused green run is `.test-runs/2026-10-22T16-12-14-720Z-p1553771-r20dd828eb1e5de34/summary.json`. The full 21-story green run is `.test-runs/2026-10-22T16-13-14-264Z-p1559348-r9755ed66a7a6de8b/summary.json`.

## Review and remaining work

Independent proof, implementation, simplification and architecture review found no open findings. The reviewer also checked the reference-build decision, verified that Checklist prose, stories and stylesheets were preserved, and inspected the final conformance result: 21 passed, zero skipped or flaky tests and zero process leaks.

No task blockers remain. Both fixture-path browser suites, final type-check, lint and integrity checks pass. A byte comparison against the saved baseline found no owner-file changes outside the requested proof/index updates; `HEAD` remains `6db4cfe`, and the original staged deletions remain the only staged changes.

The general browser configuration reports that Firefox is not installed; these selected files are Chromium-only, so their test coverage was not reduced. Vite reports dynamic-import analysis warnings for a generated Storybook mocker bundle; builds and all comparisons complete successfully. The full e2e gate was intentionally not run, and the install audit findings noted above remain outside this task.

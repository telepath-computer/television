# Desktop area trim: review

**Branch:** `thopter/trim-desktop`, based on `f6cdd91e` (the merge base with `thopter/spec-tightening`). There is one commit per trimmed spec, plus one commit for this area's review files. No citation needed repointing, so there is no link-only commit.

**Convergence:** converged in round 2. Round 1 raised one blocking finding, which was fixed. Round 2 raised none.

| Spec | Words before | Words after |
| --- | ---: | ---: |
| specs/product/desktop-app.md | 1313 | 1253 |
| specs/arch/desktop/index.md | 818 | 681 |
| specs/arch/desktop/appearance.md | 479 | 457 |
| specs/arch/desktop/connect-flow.md | 1083 | 1082 |
| specs/arch/desktop/distribution.md | 2246 | 2183 |
| specs/arch/desktop/e2e-harness.md | 1132 | 927 |
| specs/arch/desktop/runtime.md | 987 | 929 |
| specs/arch/desktop/updates.md | 897 | 851 |
| specs/arch/explainer-desktop-app.md | 1885 | 1885 |
| specs/arch/explainer-connection-states.md | 915 | 917 |
| **Total** | **11755** | **11165** |

Overall the area was already fairly tight. Most of what remains is contracts with outside parties: ToDesktop, Electron, released shells that newer servers talk to, data that older apps saved, and the people who release the app. It also holds decisions with stated reasons. The largest cuts are internal TypeScript types and procedure detail in the test-harness specs.

## Decisions for Josh

1. **Should the first-release constraint stay?** It is in distribution.md under Releases (`^desktop-dist-first-release`). It says that Television's ToDesktop app holds two test releases, 1.4.0 and 1.4.1, so the first release for users carries a higher version. The repository is now at 1.4.25, and the administrator guide publishes the download link, so the constraint is probably already met and is now history. I could not confirm from the repository that a release for users has been made, because that is visible only in the ToDesktop dashboard. desktop-upgrade-recommendation.md (`^desktop-rec-first-version`) and two proofs cite the paragraph. It also explains why `1.4.0` is still the boundary between apps installed from npm and downloaded apps.
   - Options: keep it as it now stands; or remove it, rewrite the recommendation spec's sentence so it no longer needs the citation, and fix the two proofs.
   - What the branch does now: it keeps the constraint, without the pull-request narrative.
2. **Should the product spec name where macOS evidence for preflight comes from?** I cut a one-time requirement from the product spec's Testing section: the pull request that moved the app to ToDesktop had to record an `npm run verify -- local` run on a Mac. That run was "the evidence that [preflight testing](../../../../../specs/arch/test-runner/preflight.md#Testing) requires from a real macOS host". The pull request has merged, so the requirement is history. However, preflight.md still says that proving its macOS backend needs a macOS host, and no remaining spec says how or when that evidence is gathered.
   - Options: accept that preflight's macOS evidence has no standing source; or add a standing rule, either in preflight.md (the test-runner area) or as another real-host check here.
   - What the branch does now: it has no standing rule.

## Judgment calls

- **runtime.md, Runtime location and validation: the internal TypeScript block is replaced with prose.** The block defined `ValidElectronRuntime` and `RuntimeValidation`. These types are exchanged only between in-repository modules: runtime inspection, preflight and Playwright global setup. The policy's TypeScript rule treats such types as internal. The block also did not match the code (see the mismatches under Findings). The remaining text still lets a reader derive the following:
  - validation classifies a runtime as absent, valid or invalid;
  - a valid runtime yields an absolute executable path built from the resolved package root;
  - the full validity predicates still stand.
- **e2e-harness.md, Shared environment plan: the `ElectronE2EEnvironmentPlan` type block is replaced with prose.** It is internal for the same reason. The remaining text still says that one planner serves preflight and global setup. It also says what the planner reports (the runtime's state, xvfb, sandbox and failures) and keeps all of the classification and sandbox rules.
- **e2e-harness.md, launch timeout (`^desktop-e2e-launch-timeout`): the value "eight seconds" is removed.** The policy names a timeout chosen to make an implementation work as something that does not belong. The remaining text keeps the decision behind it:
  - each launch phase has its own timeout;
  - runtime installation and bundle builds finish before launch;
  - a later readiness wait carries its own timeout;
  - provider setup does not lengthen the launch timeout.

  The value lives in `packages/desktop/test/e2e/helpers.ts`.
- **e2e-harness.md, Launch contract and Global setup: the argument list and the six numbered setup steps are condensed into prose.** Three things were dropped:
  - fixture paths resolving against the published origin while absolute URLs pass unchanged (the helper's code);
  - the Playwright configuration requiring the variable;
  - the Blaxel and GitHub routing sentences, which "What this owns" already covers.

  The reviewer's round 1 blocker restored the rule that `TV_DESKTOP_E2E_URL` must be an HTTP URL on `127.0.0.1`. The helpers derive a second `localhost` origin from it.
- **product/desktop-app.md, Testing: the one-time requirement on the ToDesktop migration pull request is cut.** It is history. See decision 2.
- **distribution.md, The desktop workspace: "declares no `bin`, `files` or `engines`" is cut.** `"private": true` is what stops npm publishing. The missing fields are a negative description, not a rule anything relies on. The distribution proof still asserts them (see Effects).
- **distribution.md, Dry runs: the note that the script leaves out the log-following option with `--dry-run` is cut.** The proof's real-CLI dry-run test would fail if the script passed it, and the script's own comment explains it.
- **updates.md, Testing: the last paragraph is cut after the final review, as the round 2 reviewer suggested.** It listed things coverage must show: `init()` called once with its one option, the restart guard, and the non-empty version string. All three restate rules stated earlier in the spec (`^desktop-updates-start` and `^desktop-updates-ops`). No reviewer has seen this change applied.

## Kept but doubtful

- **product/desktop-app.md, `^desktop-mac-wording`:** wording names the Mac where it names a platform. It may be derivable from the support rule. I kept it because it is a copy decision that an agent could plausibly get wrong, for example by writing "your computer".
- **arch/desktop/index.md, `^desktop-window-identity`:** the window title `Television` and `assets/icon.png`. The title largely restates the product identity promise, and the icon path is a file name. I kept it because proofs cite it.
- **arch/desktop/index.md, `^desktop-about-version-config`:** how the About panel options are set, including `version: ""`. A competent engineer might find this setting, but it is not obvious, so I kept it.
- **arch/desktop/index.md, module map and Boundaries list:** these are routing aids that partly restate each module's "What this owns". I kept them for the human reader.
- **runtime.md, the exact Electron version `43.7.6`:** it is restated from package.json. I kept it because the Electron version is a human-owned decision with its own upgrade procedure.
- **runtime.md, the full Linux and macOS layout predicates:** this is detail about Electron's own install layout, which is work outside the product's specialisation. I kept it because it encodes a known failure: an install that reports success over an incomplete runtime.
- **connect-flow.md, `^desktop-connect-persistence`, "Writes use a temporary sibling followed by rename":** this may be an implementation choice. I kept it because it protects the saved connection, which is data a later release reads.
- **connect-flow.md, `CmdOrCtrl+,` accelerator:** this is user-visible, so it is arguably a product or UI concern rather than architecture.
- **distribution.md, configuration table and the `runAsNode` explanation:** these are long. I kept them as a contract with ToDesktop and a security decision.
- **e2e-harness.md, Operations:** the macOS note about writing to the real `~/Library/Application Support/Television`, and the Linux first-run command. I kept them as facts a developer would otherwise miss.
- **Explainers:** left almost untouched. Explainers may restate their owners, and I found nothing stale apart from the wording fix below.

## Routine cuts

**Restatements of other owners**
- index.md: the terms pointer, which [terms.md](../../../../../specs/terms.md) carries.
- index.md: the closing Boundaries paragraph about ToDesktop builds and updates (the module map carries it), and "A different embedded-document mechanism is outside this architecture" (the artifact-bridge bullet keeps `<webview>`).
- index.md: "This baseline window identity applies across the product-supported platforms". It added nothing.
- index.md: "Package and bundle metadata carry the same release version" (distribution.md's `buildVersion` row).
- index.md, Testing: the sentences pointing at the product spec's identity section and support rule. They are condensed into a pointer to the Mac install check.
- runtime.md, Operations: "The product spec owns those checks, their supported host and their evidence exception."
- distribution.md, Releases: the "Tested before `main`" bullet (the product's `^desktop-checks-before-main`, which the candidate-build paragraph already cites).
- e2e-harness.md: the Provider integration section. Its one rule moved into the launch-timeout paragraph.
- e2e-harness.md: "this harness does not define a second input or message contract", and "rather than defining a second contamination policy". Each pointer is kept.
- product/desktop-app.md, What this owns: the list of architecture topics is shortened to "how the app is built and run".

**Internal detail**
- appearance.md: `packages/desktop/src/appearance-mode.ts` as the owner of the channel name and predicate.
- appearance.md: "The browser build never invokes a native bridge method". It follows from the guard that the renderer calls the bridge only when Electron mode and the operation are present.
- runtime.md: the esbuild `es2022` browser target.
- e2e-harness.md: the rule that scenarios go under `packages/desktop/test/e2e/` with fixtures under `fixtures/`. This is visible in the code.

**Plans and history**
- index.md: "This root owns these identity rules until a desktop main-process module spec exists…"
- distribution.md, `^desktop-dist-first-release`: the pull-request narrative is reworded into present-tense fact. See decision 1.

**Form**
- connect-flow.md: the "**Plain english:**" line above the title becomes the introduction under it.
- explainer-connection-states.md: Access token required also follows a missing token, as connect-flow.md says, so the saved-connection paragraph now says "wants a token or rejects the one given".

## Findings that are not edits

- **Mismatch, runtime.md's former type:** the `RuntimeValidation` type (`{ valid: true; runtime: { layout, executablePath } } | { valid: false }`) did not match the code. `inspectElectronRuntime` in `scripts/electron-e2e-env.mjs` returns `{ state: "absent" } | { state: "valid"; executablePath } | { state: "invalid"; reason }`, with no `layout`. The trim removes the type, so the spec no longer conflicts with the code.
- **Minor mismatch, e2e-harness.md global setup order:** in `packages/desktop/test/e2e/global-setup.ts`, global setup publishes the executable path before it builds the bundles. The spec's former step list had the reverse order. The condensed prose keeps the reverse order but does not stress it, and the order does not matter.
- **Unstated behaviour (not a contract):** on macOS the main process also sets the Dock icon from `assets/icon.png` (`app.dock?.setIcon` in `packages/desktop/src/index.ts`). No spec mentions it. It is probably derivable and needs no spec.
- **Unstated behaviour:** the main process's connect IPC handlers (`television:connect` and the others in `packages/desktop/src/index.ts`) do not check their sender. The local-only rule (`^desktop-connect-local-bridge`) rests on the preload exposing them only on a `file:` page. This matches the spec's wording ("the connect preload exposes…"), so it is not a mismatch. It is noted because the spec's security rationale depends on that one layer.
- **No other mismatches found.** I spot-checked these claims against the code, and they match:
  - normalization, persistence, 401 handling and retry backoff;
  - Disconnect behaviour and the menu;
  - load recovery, the window-open handler and the About panel options;
  - the update runtime start, the update record and the restart guard;
  - the upload directory contents, the build script and both workflows (repository guard, SHA pins and candidate checks);
  - the React 17 override;
  - runtime validity and the environment planner;
  - the Blaxel `electron-repair` phase;
  - the absence of `yauzl` and `fd-slicer` from the lockfile.

## Effects

**Stale proof sections** (to update when proofs are re-derived):
- proofs/product/desktop-app.md, line 17: the implementation pull request's `npm run verify -- local` run on a Mac. Its spec statement is cut.
- proofs/arch/desktop/distribution.md, line 27: the workspace assertion's "has no `bin`, `files` or `engines` field". Also proofs/arch/node-versions.md (Coverage model), which attributes the missing desktop Node floor to that assertion, as the round 2 reviewer noted.
- proofs/arch/desktop/e2e-harness.md: any assertion of the eight-second launch-phase value, the fixture-path resolution or the Playwright configuration's requirement for `TV_DESKTOP_E2E_URL`. These details now have no spec statement.
- proofs/arch/desktop/runtime.md: any reference to the `layout` field of the cut validation type.

**Citations repointed:** none. No block ref was removed.

**Citations left dangling:** none.

**Link test:** `test/repo/spec-links.test.ts` passes, 8 of 8, with no expected failures. The brief's borrowed `node_modules`, `~/workspace/wt/television/serve-persist-fix-tv-856`, no longer exists on this host. The test was run with `~/workspace/television-prerelease-archive/node_modules` (vitest 2.1.9) instead. It passed at the base commit too.

## Review rounds

- **Round 1.** One blocking finding: the trim had removed the `127.0.0.1` requirement on `TV_DESKTOP_E2E_URL`. It was restored. Two non-blocking findings:
  - the first-release paragraph's history, which was reworded (decision 1);
  - a proof's attribution of the cut manifest clause, which is recorded above.
- **Round 2.** The reviewer accepted all three responses and found no blocking findings. One non-blocking finding: a redundant testing paragraph in updates.md. It was cut after the review (see Judgment calls). The round 2 reviewer also pointed to proofs/arch/node-versions.md as a further stale proof, recorded above.
- **Reviewer behaviour:** neither reviewer run changed any file except its own review and log.

**Primitive:** no Primitive hook output, decisions or messages appeared during this session, so there is nothing to evaluate.

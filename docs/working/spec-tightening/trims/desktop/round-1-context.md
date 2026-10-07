# Desktop trim, round 1 context

**Area:** desktop.

**Specs in the area:**
- specs/product/desktop-app.md
- specs/arch/desktop/index.md
- specs/arch/desktop/appearance.md
- specs/arch/desktop/connect-flow.md
- specs/arch/desktop/distribution.md
- specs/arch/desktop/e2e-harness.md
- specs/arch/desktop/runtime.md
- specs/arch/desktop/updates.md
- specs/arch/explainer-desktop-app.md
- specs/arch/explainer-connection-states.md

**Base commit:** f6cdd91e417e1f94c8617baebb016e921c21d6e5 (see the trim with `git diff f6cdd91e..HEAD -- specs`).

## Notes from the trimmer

These explain the main cuts so the reviewer can check the reasoning. They are not authority.

- No block ref was removed, so no citation was repointed or left dangling.
- product/desktop-app.md: cut the paragraph requiring the pull request that moves the app to ToDesktop to record an `npm run verify -- local` run on a Mac. The move has happened (the build workflows, `todesktop.json` and the published download link are on main), so the paragraph is a one-time requirement that is now history.
- runtime.md and e2e-harness.md: cut the TypeScript blocks `ValidElectronRuntime`/`RuntimeValidation` and `ElectronE2EEnvironmentPlan`, replacing them with prose. Both types are exchanged only inside the repository (runtime inspection, preflight, Playwright global setup), so under the policy's TypeScript rule they are internal. The `RuntimeValidation` shape also did not match the code (`scripts/electron-e2e-env.mjs` returns `{ state: "absent" | "valid" | "invalid" }`).
- e2e-harness.md: removed the eight-second figure from the launch-phase timeout, keeping the rule that each launch phase is bounded and that installation, builds and provider setup do not lengthen it. The policy names a timeout chosen to make an implementation work as something that does not belong. Also condensed the global-setup steps and the launch argument list into prose and cut the provider-integration section, whose one rule moved into the timeout paragraph.
- index.md: cut the terms pointer (terms.md carries it), the closing paragraph that restated the module map, a sentence tying window identity to "product-supported platforms", the "package and bundle metadata carry the same release version" sentence (owned by distribution.md's `buildVersion`), and a note about a future main-process module spec. Condensed the Testing section.
- distribution.md: cut the dry-run note about leaving out the log-following option (the real-CLI dry-run test catches it, and the script's comment carries it), the "Tested before main" release bullet (restates the product rule, which the candidate-build paragraph already cites), and "declares no `bin`, `files` or `engines`" on the workspace manifest.
- appearance.md: cut the internal file that owns the channel name and predicate, and "the browser build never invokes a native bridge method", which follows from the guard on the bridge.
- runtime.md: cut the esbuild `es2022` browser target and a sentence restating that the product spec owns the real-host checks.
- connect-flow.md: turned the "Plain english:" line above the title into the introduction.
- explainer-connection-states.md: Access token required also follows a missing token, so the saved-connection paragraph now says so, matching connect-flow.md.

# Desktop connect links: proof derivation

Prepared for independent review against spec revision `d6eef624`, merged into the planning branch as `d5168a30`. The implementation plan at `fbca5eed` is unchanged. No spec ambiguity requiring an owner decision was found during this derivation.

The proof changes cover every product, architecture and UI owner touched since `ab6ce3c8`, including owners of changed frame, content and stylesheet material. The new [setup proof](../../../proofs/ui/setup/index.md) composes with [desktop product acceptance](../../../proofs/product/desktop-app.md) and [connection architecture](../../../proofs/arch/desktop/connect-flow.md). The [foundation distribution](../../../proofs/arch/ui/foundation.md) and [canonical](../../../proofs/arch/canonical.md) proofs also account for their changed consumers. Explainers, the generated spec index, migration map and glossary receive no proofs under proof policy.

Product proofs own real CLI/Electron outcomes. App coverage retains the specified real-browser token rejection and artifact-identity walks, extending them through outage escalation. Architecture contracts carry parsing, status, cancellation and IPC breadth. Existing Copy, dialog, icon, theme and stylesheet proofs supply their shared coverage. The proofs prescribe no new framework, exact retry schedule, extra Connected dwell, or general markup-comparison system.

New and changed obligations are marked “test to be written.” Unchanged inherited evidence keeps its grade. The desktop storage proof corrects its description of the existing tests: they mock the filesystem. A separate pending operation-order assertion proves temporary-write/rename and deletion; product acceptance supplies the real disk crossing.

During implementation, reconcile the tests that still exercise the separate token field, manual-prefill mode, unconditional OSC-8 output and authorization-over-gate priority. The retired `sm-ac-auth-submit` assertion orders no replacement token form. Its existing test is obsolete; shared token ingestion/transport remains covered by the app's real-link/authentication paths. Existing narrower tests cited beside pending obligations are starting evidence, not claims that the new behavior already passes.

Validation at derivation time:

- Regenerated spec/proof indexes. The spec-index change is only the CLI spec's line count from its already-reviewed type addition.
- A dependency-free static check passed across 245 authority Markdown files for file links, block-ref targets, unique anchors and required proof mirrors.
- The canonical command `npm test -- local --file test/repo/spec-links.test.ts` could not start: this worktree has no installed `vite` dependency. This is not a passing repository test or a behavior-validation result.
- No application tests or full verification were run. Independent proof review and implementation remain ahead.

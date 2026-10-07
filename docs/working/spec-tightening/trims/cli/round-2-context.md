# CLI trim: round 2 context

- **Area:** CLI.
- **Specs:** `specs/product/cli.md`, `specs/arch/cli/index.md`, `specs/arch/cli/startup-bind-failure.md`, `specs/arch/cli/admin-guide.md` (unchanged).
- **Base commit:** `f6cdd91e417e1f94c8617baebb016e921c21d6e5` (`git merge-base HEAD origin/thopter/spec-tightening`). See the whole trim with `git diff f6cdd91e..HEAD -- specs proofs`.
- **Previous review:** `docs/working/spec-tightening/trims/cli/round-1-review.md`. Round 1 context, for what the trim intended: `round-1-context.md` in the same folder.
- **Changes since round 1:** commit `3f1f68bc` (`git show 3f1f68bc`).

## Responses to round 1 findings

1. **Theme refresh for `none` (blocking): addressed.** The `tv set-theme` bullet in "Client boundary" now applies the refresh-then-patch rule only to theme IDs other than `none`, and says `none` patches without refreshing.

2. **Persisted ACP environment (blocking): addressed.** "Daemon boundary" now states that the agent variables are `TELEVISION_ACP_AGENT` and every variable whose name starts with the selected agent's prefix, `OPENCLAW_` or `HERMES_`. This matches `buildPersistedACPEnvironment` in `packages/server/src/config.ts`.

3. **Internal test interfaces (non-blocking): disputed for now, to be raised with Josh.** The ownership paragraph names the source-module surface and the dependency-injection boundary as things this spec owns, which reads as an architect's decision rather than agent filler, and the brief says to keep text when unsure. Part of the surface also has a consumer outside the CLI's running code: `scripts/check-release-telemetry.mjs`, run by the publish workflow, loads the built `dist/cli.cjs` as a module with `VITEST=true` so the `isVitestRuntime()` guard keeps it from running, and calls `inspectTelemetryBuildConfig`. The review document will list the exact `CLIEnvironment` and export shapes as kept but doubtful, and ask Josh whether to reduce them to the decision that tests inject the environment.

4. **`tv status` ordering repeats product authority (non-blocking): addressed.** The bullet is removed. The product spec's `^cli-config-invalid`, `^cli-client-port` and its `tv status` paragraph carry the same rules.

5. **TV-507 future plan (non-blocking): addressed.** `^unit-start-limit` keeps the present constraint (no explicit start-limit setting, so `RestartSec` must stay at least about three seconds) and says only that Linear TV-507 tracks making retry-forever explicit.

6. **Proof citation to removed text (non-blocking): addressed by repointing.** In `proofs/arch/cli/index.md`, the `^cli-legacy-variables-warning` assertion's "placement in `runCLI`" link now points to `specs/product/cli.md#^cli-legacy-selectors`, which owns the warning and when it is written. The same kind of repoint was made for "the shared formatter rule" in the stream-dependent link-formatting assertion, which pointed at the removed formatter sentence under "Client boundary"; it now points to `specs/product/cli.md#^cli-link-output`. Only the link targets changed.

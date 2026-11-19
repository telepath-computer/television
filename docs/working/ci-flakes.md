# CI flakes on ubuntu-24.04 runners

Working note for PR #59. Remove under pre-merge docs prep.

## Flakes found

Sources: every CI run from 2026-10-02 to 2026-11-19, including re-run attempts, and the "flaky recovered" lines of green runs since the runner moved to `ubuntu-24.04`.

| Test | Job | Cause | Status |
| --- | --- | --- | --- |
| `test/repo/blaxel-worker-lease.test.ts` (several cases) | unit | Blaxel worker code run off Blaxel | Fixed by #58 |
| `test/repo/test-runner-guardrails.test.ts` "refuses broader marked selection --suite unit before execution" | unit | `ENOENT` while walking a vanishing `test-results/.playwright-artifacts-0` | Fixed by #57 |
| `test/repo/test-runner-file-selection.test.ts` "focused zero reaches actual native attempts" (Playwright) | unit | Stale owner token left by the interrupted resource-parent test in another file | This PR shortens the window; moving the test is proposed below |
| `packages/desktop/test/e2e/all-webview-dispatcher.02.test.ts` "markdown application links cross the real Linux operating-system handler" | e2e:desktop | Unconfirmed; likely injected clicks sent before the webview handles input | Annotated `flaky:` in this PR |

## Proposed proof change

Move the "interrupted surface parent leaves an explicit missing final observation" case out of `test/repo/test-runner-resource-parent.test.ts` into a new `isolated-github-only` surface, as the testing guidance in `specs/arch/test-runner/test-runner.md` requires for tests that kill a supervisor. In `proofs/arch/test-runner/reporting.md`, `^reporting-t-resource-parent`:

Replace

> A separate interrupted-parent fixture leaves the baseline with an explicitly missing final observation rather than invented zeroes.

with

> A separate interrupted-parent fixture, which kills its supervisor and therefore runs only in the `isolated-github-only` surface `experiment:lifecycle-interrupted-parent` ([testing guidance](../../../specs/arch/test-runner/test-runner.md#testing-guidance)), leaves the baseline with an explicitly missing final observation rather than invented zeroes.

and in the same bullet's citation, after the `test/repo/test-runner-resource-parent.test.ts` link, add

> ; interrupted parent in [`test/runner-fixtures/process-lifecycle/interrupted-parent/interrupted-parent.test.ts`](../../../test/runner-fixtures/process-lifecycle/interrupted-parent/interrupted-parent.test.ts)

The cost: isolated surfaces run only in the operator-run `Process Lifecycle Fault Injection` workflow, so the case leaves routine CI.

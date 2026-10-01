*The flaky-test policy: the runner's retry budget, the per-test `FLAKY_TEST_RETRIES` annotation, and how recovered flakes are surfaced.*

# Flaky Tests

Flaky tests are an unfortunate fact of end-to-end testing, so Television handles them with a two-layer mechanism. The first layer is a default retry budget the runner applies to the non-unit Vitest and Playwright e2e surfaces — unit surfaces get no runner-level retries; on those surfaces it surfaces which tests are flaky and provides a thin line of defense. The second is an annotation in code that marks a single known-flaky test as warranting more retries to keep it passing — a per-test retry option in Vitest, or a retry-configured group wrapping the one test in Playwright.

This spec is authoritative for the flaky-test policy: the retry budget the runner applies, the `FLAKY_TEST_RETRIES` annotation that opts a single test into retries, and the rule that recovered flakes are reported rather than hidden. Budget application is owned by [test-runner.md](./test-runner.md); recovered-flake reporting is owned by [reporting.md](./reporting.md); the per-worker retry pass for remote runs is in [sharded-execution.md](./sharded-execution.md).

A *flaky test* is a test that passes and fails non-deterministically for reasons other than a product regression — a test-harness or environment problem, not a real defect.

## Retry budget

Non-unit Vitest and Playwright surfaces retry twice at the runner level by default, including targeted runs; unit surfaces receive no runner-level retries ([test-runner.md](./test-runner.md), [sharded-execution.md](./sharded-execution.md)). A test that fails then passes within its runner retries is a recovered flake: the surface passes and the recovery is reported, not counted as a failure ([reporting.md](./reporting.md)). Package-level Playwright `retries` and Vitest `retry` stay at `0`, so the runner is the single place runner retries are configured.

A provider's infrastructure retry is a separate boundary governed by [test-runner.md#Retries](./test-runner.md#Retries). It may repeat unit work because observations from an incomplete shard do not establish a completed shard result. Task observations retained from the incomplete attempt remain diagnostic attempt evidence and do not enter the final failure list after a completed retry. This provider-level retry does not increment `testsFlakyRecovered`, because that counter records attempts exposed by the native runner within a completed task result.

## FLAKY_TEST_RETRIES

```ts
// test/flaky-retries.ts
export const FLAKY_TEST_RETRIES: number;
```

`FLAKY_TEST_RETRIES` resolves at import time from `test/flaky-retries.ts`:

- if the `FLAKY_TEST_RETRIES` environment variable is set, its value parsed with `Number.parseInt(value, 10)` — which reads a leading integer and ignores any trailing non-numeric characters, so `"5abc"` resolves to `5`; a value with no leading integer, or a negative one, throws;
- otherwise `5` when `CI` is set;
- otherwise `0`.

The canonical runner and the shared shard worker inject `FLAKY_TEST_RETRIES=5` into the child test environment unless it is already set, so a runner-driven or CI run defaults to `5` annotated-retries, while an ad hoc direct `vitest`/`playwright` invocation with neither the variable nor `CI` resolves to `0`.

## Annotation patterns

A flaky annotation is applied to exactly one test case, never a whole file or feature suite.

**Playwright** — wrap the single case in a nested `describe` whose title begins with `flaky:` and configure its retries:

```ts
import { FLAKY_TEST_RETRIES } from "../../../../test/flaky-retries.js";

test.describe("flaky: short reason", () => {
  test.describe.configure({ retries: FLAKY_TEST_RETRIES });
  test("actual test name", async ({ page }) => { /* ... */ });
});
```

**Vitest** — set the per-test retry option and keep an explicit title:

```ts
import { FLAKY_TEST_RETRIES } from "../../test/flaky-retries.js";

test("flaky: actual test name or short reason", { retry: FLAKY_TEST_RETRIES }, () => { /* ... */ });
```

A dedicated flaky-quarantine file is allowed only when the filename makes that purpose explicit.

## Policy

On a first failure, investigate. A real failure is fixed. Only persistent, investigated infrastructure or harness flakiness earns an annotation, and only on the one offending case. The `flaky:` title prefix is what marks a case as annotated; [reporting.md](./reporting.md) sets `flakyAnnotated` from it when surfacing recovered flakes.

## Recovered-flake reporting

[reporting.md](./reporting.md) classifies a passed-after-runner-retry case as a recovered flake. For Vitest, the attempt-recorder sidecar is authoritative: a test is recovered when its recorded attempts include a failure and its final recorded attempt passed. For Playwright, the native `flaky` status identifies the recovery. The report lists each recovery under `testsFlakyRecovered` with its attempt count, distinct from failures.

## Lifecycle failures are not recoverable flakes

The outer surface owner evaluates process cleanup after the native runner has completed all test attempts ([test-runner.md](./test-runner.md)). A leaked process fails the surface even when a test retry passed, and the result preserves both the recovered-flake record and lifecycle failure ([reporting.md](./reporting.md)). Runner retries and `FLAKY_TEST_RETRIES` never retry or suppress this lifecycle failure. A completed shard carrying the lifecycle failure is likewise not eligible for an infrastructure retry.

A network reset or unhandled socket error emitted by test infrastructure is a harness defect. It is investigated and contained under [testing-policy.md](../testing-policy.md); it does not qualify a case for a flaky annotation while the infrastructure error remains unhandled.

## Testing

Tests do not check whether a flaky annotation follows the patterns and policy above. That question is judged in review under the testing policy's rule for coverage and test honesty across the spec system ([testing-policy.md#Tests are the validation mechanism](../testing-policy.md#Tests are the validation mechanism)).


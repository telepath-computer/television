*How the promises in Flaky Tests are proven.*

# Flaky Tests — proof

Proves [specs/arch/test-runner/flaky-tests.md](../../../specs/arch/test-runner/flaky-tests.md).

## Coverage model

Coverage declarations are carried inside the migrated assertion blocks below.

## Assertions

### Test assertions

This spec owns conventions whose enforcement is review-judged rather than gate-enforced ([testing-policy.md](../../../specs/arch/testing-policy.md)); it adds no test assertions of its own. The recovered-flake normalization those conventions rely on is asserted in [reporting.md](../../../specs/arch/test-runner/reporting.md). The `FLAKY_TEST_RETRIES` resolver has no dedicated unit test today. No dedicated test enforces the annotation patterns.


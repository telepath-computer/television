*How production UI conformance is checked while automated markup comparison is scheduled for TV-649.*

# UI conformance — proof

Proves [specs/arch/ui/conformance.md](../../../specs/arch/ui/conformance.md).

## Coverage model

[Foundation architecture](./foundation.md) and [UI architecture](./index.md) describe the active stylesheet-copy and delivery checks.

The automated structural comparison, selector checks over posed production states, and detection of surfaces missing that coverage are deferred by the spec's [TV-649 release exception](../../../specs/arch/ui/conformance.md#release-exception-for-tv-649). They have no implemented coverage here. Existing behavior tests and implementation and visual review remain required; they do not establish that the deferred automated checks exist.

## Deferred coverage

TV-649 must update this proof with assertions and tests for the implemented comparison system, including required surface coverage and its handling of permitted differences. Its completion includes removing the release exception. The scheduling decision is human-owned policy and needs no test of the policy's wording.

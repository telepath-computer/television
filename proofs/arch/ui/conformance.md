*How production UI conformance is checked while automated markup comparison is scheduled for TV-649.*

# UI conformance — proof

Proves [specs/arch/ui/conformance.md](../../../specs/arch/ui/conformance.md).

## Coverage model

[Foundation architecture](./foundation.md) and [UI architecture](./index.md) describe the active stylesheet-copy and delivery checks. [Checklist byte identity](../../ui/templates/checklist/index.md#^checklist-ui-t-styles) and [copied-page delivery](../templates/checklist.md#^templates-checklist-t-delivery) add the template-specific route; these are pending implementation. The [Templates popover proof](../../ui/app/templates-popover/index.md) records its explicit exception from automated stylesheet-copy and conformance checks.

The automated structural comparison, selector checks over posed production states, and detection of surfaces missing that coverage are deferred by the spec's [TV-649 release exception](../../../specs/arch/ui/conformance.md#release-exception-for-tv-649). They have no implemented coverage here. Existing behavior tests and implementation and visual review remain required; they do not establish that the deferred automated checks exist.

## Test hooks

No new production hook is declared for deferred machinery. Active checks use the hooks in the owning proofs linked above.

## Deferred coverage

TV-649 must update this proof with assertions and tests for the implemented comparison system, including required surface coverage and its handling of permitted differences. For MDX surfaces, enumerate every story exported by the named module, including unembedded exports; args, globals, viewport parameters, and deterministic focus/selection `play` setup define the shared input on both sides. Mount production at that viewport and apply focus and selection to the corresponding elements before comparison. Frame surfaces retain their template-argument poses. The shared normalization and exemption rules apply to both forms. Its completion includes removing the release exception. The scheduling decision is human-owned policy and needs no test of the policy's wording.

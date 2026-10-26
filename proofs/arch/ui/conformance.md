*Proves conformance for frame and template UI specs: byte-identical stylesheet copies, their delivery routes, and review.*

# UI conformance — proof

Proves [specs/arch/ui/conformance.md](../../../specs/arch/ui/conformance.md).

## Coverage model

This proof applies only to frame and template surfaces. MDX surfaces follow [story conformance](../../../specs/spec-ui.md#^ui-conformance-test), proved by each surface's own proof.

[Foundation architecture](./foundation.md#^ui-t-foundation-copy) owns the byte identity checks and [UI architecture](./index.md#^ui-t-style-delivery) owns the delivery checks. Markup and appearance are judged by implementation and visual review; this proof orders no automated test of them.

## Test hooks

No additional production hook is declared here; the stylesheet and delivery proofs own their inputs and boundaries.

*Proves conformance for legacy frame and template UI specs: byte-identical stylesheet copies, their delivery routes, and review.*

# UI conformance — proof

Proves [specs/arch/ui/conformance.md](../../../specs/arch/ui/conformance.md).

## Coverage model

This proof applies only to [legacy frame and template specs](../../../specs/spec-ui.md#^ui-frame-specs). MDX surfaces follow [story conformance](../../../specs/spec-ui.md#^ui-conformance-test), or the check their spec states in its place, proved by each surface's own proof.

[Foundation architecture](./foundation.md#^ui-t-foundation-copy) owns the byte identity checks and [UI architecture](./index.md#^ui-t-style-delivery) owns the delivery checks. What a surface's frames and templates bind ([what a frame binds](../../../specs/spec-ui.md#^ui-frame-binds)) is judged by implementation and visual review; this proof orders no automated test of it. Automating that comparison is tracked in [TV-649](https://linear.app/telepath-computer/issue/TV-649). Markup that exists for behaviour, such as menu pairing ids, is not part of that review: its owning spec states the contract and that spec's proof tests it, as [the menu view proof](./menu-view.md#^mn-ac-markup-smoke) does for minted trigger ids.

## Test hooks

No additional production hook is declared here; the stylesheet and delivery proofs own their inputs and boundaries.

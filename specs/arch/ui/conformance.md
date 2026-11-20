*Conformance for frame and template UI specs: byte-identical stylesheet copies, their delivery routes, and review.*

# UI conformance

This spec covers surfaces specified as frames and templates under the [UI policy](../../spec-ui.md). Surfaces specified in MDX follow [story conformance](../../spec-ui.md#^ui-conformance-test) instead.

## What conformance means

In every state its spec defines, production renders the markup the spec's templates render and carries the styles its stylesheets state. When production needs markup or styling the spec does not state, the spec changes, with the approval spec changes require, or the spec names it as implementation-owned.

## Checks

- **Byte identity.** Every spec stylesheet that production uses has a production copy that is byte-for-byte the same. Tests compare each copy with its spec source.
- **Delivery.** Each stylesheet reaches production by the route its architecture specifies. Document delivery is found by walking imports from the web entry; a surface-specific route is checked at that surface's boundary. A stylesheet that production uses but no spec states is listed as implementation-owned.
- **Review.** Behavior tests prove what each spec's prose promises. Implementation and visual review judge whether production's markup and appearance match the spec.

The byte identity and delivery checks are required by [index.md](./index.md) and, for a surface-specific delivery route, by the spec that owns that route.

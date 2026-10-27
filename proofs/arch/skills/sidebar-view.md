*How the sidebar-view skill's architecture is proven: the surface proof's walk proves where the sidebar width is kept, and the spec's other facts order no tests.*

# Sidebar-view skill (architecture) — proof

Proves [specs/arch/skills/sidebar-view.md](../../../specs/arch/skills/sidebar-view.md).

## Coverage model

[Storage](../../../specs/arch/skills/sidebar-view.md#Storage) is proven by [the surface proof's walk](../../ui/skills/sidebar-view/index.md#^sv-ac-width), in a real browser against a running server. The walk sees the default width while the store holds none, reads the width a drag saves at `tv-sidebar-view/width` with `tv resource json get`, and sees another view follow it without a reload. It also sees a page opened through a `read` share link keep its own new width, with no error. The SDK refuses that page's write because it already knows the page's level.

Two cases are not walked:
- a store that cannot be read, where the sidebar keeps its default width;
- a write that the server refuses, or that fails, as on a lost connection, where the new width stays in the page.

Both are rare, and a mistake in either affects only the width, so neither has a test.

The rest of the spec orders no tests. [Events](../../../specs/arch/skills/sidebar-view.md#Events) says that the skill exposes no selection event. [The prototype boundary](../../../specs/arch/skills/sidebar-view.md#Prototype and publication boundary) and [the known gap](../../../specs/arch/skills/sidebar-view.md#Known gap) say what promotion requires and what the skill does not implement. [Derivation](../../../specs/arch/skills/sidebar-view.md#Derivation) records how each carried file was made. [The surface proof](../../ui/skills/sidebar-view/index.md) explains why the skill's other behavior has no tests while it is a prototype.

## Assertions

This spec's one tested promise, its storage, is proven by [the surface proof's walk](../../ui/skills/sidebar-view/index.md#^sv-ac-width).

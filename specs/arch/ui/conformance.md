*The UI conformance machinery: byte identity and delivery checks, structural comparison, selector coverage, and explicit per-surface exemptions.*

# UI conformance

This spec governs the machinery that verifies production UI against `specs/ui/`. It exists so that "the built surface matches the specified surface" is an automated check rather than a review judgment. The requirement it enforces: **structure and style must conform to maintain visual identity.** [spec-ui.md](../../spec-ui.md) states the requirement; this page owns the mechanism.

## What conformance means

A surface's states are the named template-argument sets its spec defines; production's internal state representations are irrelevant to the enumeration. For every spec surface, in every state its spec defines:

- **Structure.** The production render equals the spec template's render, normalized to remove what cannot affect the rendered result — comments, insignificant whitespace, attribute order, and what HTML parsing canonicalizes; nothing else. Any other difference is a conformance failure unless it is a declared exemption.
- **Style.** The spec's stylesheets are the styles production carries (byte identity), each through the delivery route the surface's architecture specifies, and every selector in the surface's spec stylesheet matches the production render in at least one posed state.

Exemptions are per-surface declarations. An exempted difference must not change visual identity, and may affect behavior only to conform to the spec. Silent divergence is forbidden: deviate only by declaring.


## Release exception for TV-649

The automated structural comparison, selector checks over posed production states, and detection of surfaces missing that coverage are scheduled after the themes release in [TV-649](https://linear.app/telepath-computer/issue/TV-649). Their absence does not block that release. The sections below describe the system that ticket is to implement; their requirement for every surface to have a conformance test takes effect when TV-649 is complete.

Production markup and styling must still match their specifications. Existing behavior tests, stylesheet-copy and delivery checks, and implementation and visual review remain required. Review the TV-649 approach with Josh as part of that work. Remove this exception when the automated checks are implemented and their required coverage passes.


## Mechanisms

Three checks, all in the standard test lanes:

1. **Byte identity and delivery checks** — file-level tests asserting spec stylesheets and their production copies are byte-equal, and that each stylesheet reaches the production tree by the route its architecture specifies. Document delivery is found by walking imports from the web entry; a surface-specific route is checked at that surface's boundary. Divergence exists only as an explicitly listed entry, and each entry is itself asserted — a listed file must still differ, a listed route must still be reachable — so resolving a divergence forces removing its entry in the same change. These checks are required by [index.md](./index.md) and, for a surface-specific delivery route, by the spec that owns that route.
2. **Structural comparison** — per surface × state, render the spec template (via the liquid plugin) and mount the production view in jsdom with the same pose data; normalize both; compare. Differences must each match a declared exemption.
3. **Selector check** — every selector in the surface's spec stylesheet must match at least one node in the relevant rendered tree in at least one posed production state. Selectors that cannot match in posed states (e.g. real `:hover` where only the attribute twin is posable) are exempted like any other difference.

Style application is not computed at runtime: with sheets byte-identical and delivery pinned, application is identical by construction, and the selector check covers styling defeated by structural difference. Browser-based computed-style or screenshot comparison is a deliberate non-goal at this level; if these checks prove insufficient, the same tests support that escalation without redesign.

## The conformance tests

Each spec surface has a conformance test in `packages/web/test/conformance/`: an ordinary vitest file that mounts the production view (shallow render-only service fakes, in the manner of the e2e fixture pages), poses each specified state, and asserts conformance. It carries the surface's pose data and exemption list.

- Surfaces mount individually, in a wrapper supplying the ancestor context their staging frame defines (size, tokens). A parent surface's comparison stops at a child surface's root; the complete app is posed only by the app-shell test.
- A spec surface with no conformance test is itself a conformance failure. Spec artifacts with styles but no template (ambient element styling, foundation) have nothing structural to compare; byte identity and the selector checks of the surfaces using them cover what they specify. The copies under a frozen canonical version are not surfaces and have no conformance test; what a version renders from them is governed by [canonical's version-directory contract](../canonical.md#the-version-directory).
- An exemption permits exactly one difference, specific values included: an entry exempting an attribute's absence in the spec render exempts it for the one value production renders, not for any value.
- Normalization, comparison, and exemption matching are implemented once, in a shared helper module the suite owns; the tests use it and never restate those semantics. A test that hand-rolls its own comparison does not count as conformance coverage.
- Pose data is the single source for both sides of a comparison: the same values feed the template render and the production mount.

An implementer who needs DOM or styling the spec does not state has two moves: change the spec (with the approval that spec changes require), or declare an exemption that satisfies the criterion. An exemption that affects visual appearance is a defect wherever it is found. Exemption lists are expected to shrink over time as their entries are either promoted into specs or fixed; growth of a surface's list is a review signal.

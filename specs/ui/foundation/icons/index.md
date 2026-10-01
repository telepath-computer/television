*UI spec: the icon — what one looks like, the set of them, and how one is sized.*

# Icon (UI)

A small drawing standing in for an idea — the pin beside a pinned channel, the cross that closes something. An icon is asked for by name, and whatever asks decides nothing else about it.

**Status:** current icon authority. The element, closed icon set, four named standalone sizes, and spinning state are specified.

## Markup

An icon is a `<tv-icon>` element whose own open shadow root holds the glyph's SVG and the styles that size it. The SVG is *in* the authored markup rather than referenced by it, so the path data remains part of the rendering an implementation is held to. The inherited font-size and `currentColor` cross the shadow boundary, preserving the text-relative size and colour a URL in an `<img>` cannot provide.

The rendered result is the bare tag and its shadow root, with empty light DOM; every surface that renders [icon.frame](./icon.frame) carries the whole authored icon. How the root is constructed — declaratively from the authored markup, or on upgrade — is [arch/ui/elements.md](../../../arch/ui/elements.md)'s. ^ic-light-dom

The `.frame` is the authoritative rendered truth for this surface.

## The set

[icons.yml](./icons.yml) is the set: a mapping from the name a surface uses to the file the drawing comes from. It is the whole vocabulary — a name not in it cannot be asked for.

Names say what the interface means rather than what the glyph is called upstream — `pin`, not `push-pin` — so a surface asks for the idea and this file owns which drawing serves it.

The drawings come from [Phosphor](https://phosphoricons.com), referenced by package path rather than copied into the spec tree. Most use the `regular` weight; `artifact` uses its listed duotone asset. Nothing is vendored, and the version is whatever the repo has installed.

Artifacts draw on this same set, since canonical makes the element public ([arch/canonical.md](../../../arch/canonical.md)): one vocabulary serving the chrome and the documents alike.

## Sizing

The element's contract — what may be written and relied on — is specified by [arch/ui/elements.md](../../../arch/ui/elements.md).

**By default an icon follows its text.** It is `1em` square and takes `currentColor`, so it matches whatever it sits beside and changes with it — an icon next to a label needs no size at all, and cannot fall out of step with one.

**`size` is how an icon opts out of that.** An icon standing on its own — in an icon button, a toolbar, an empty state — has no text to take a size from, so it names one instead. Absence of the attribute means "belongs to this text"; presence means "stands alone, at this size".

The attribute sets a font-size and nothing else, which the `1em` rule then reads, so there is one sizing rule rather than two. The steps are whole even pixels rather than a computed ratio, because these are drawings and a glyph on a half-pixel grid blurs where a letterform does not.

The step names match the type scale's but the values deliberately do not: an icon standing alone is doing the work a word would otherwise do, and reads too small at the text size of the same name.

An undefined `tv-icon` in a canonical-styled document occupies exactly the box it will occupy after upgrade: `display: inline-flex`, `flex: none`, a `1em` square, and `vertical-align: -0.125em`. Its absent `size` follows inherited text as usual, while `size="sm"`, `size="md"`, `size="lg"`, and `size="xl"` reserve the same 16 px, 20 px, 24 px, and 32 px squares their upgraded hosts use. Upgrade adds the glyph inside that box without moving surrounding content.

[styles.css](./styles.css) is the single UI owner of both the upgraded `:host` sizing and the pre-upgrade placeholder declarations. The placeholder set is exactly the top-level CSS rules whose every comma-separated selector is either `tv-icon:not(:defined)` or `tv-icon:not(:defined)[size="…"]`; a selector list containing anything else or an extended selector is outside the set. No other rule from that sheet applies in canonical document scope. [Foundation distribution](../../../arch/ui/foundation.md#Distribution) governs how the complete stylesheet reaches production. [Canonical's v1 composition](../../../arch/canonical.md#v1) governs how the placeholder rules enter canonical document scope.

## Spinning

A spinning icon turns evenly, so the glyph never seems to stick; [ui/foundation/icons/styles.css](./styles.css) states the rate. It is the loading state's verb — activity, not decoration — so the turn is continuous and unaccented.

## Testing

Under [What a UI surface's suite is responsible for](../../../arch/testing-policy.md#What a UI surface's suite is responsible for), real-browser coverage must exercise every name in [icons.yml](./icons.yml) through both the authored declarative markup and the production code that creates the shadow root. For each name, both must produce an open shadow root containing that name's exact installed SVG. The two roots must have equivalent authored styles and glyphs. In both cases, the host's light DOM must remain empty.

Real-browser coverage must show an icon without `size` and an icon with one representative `size` value. It must exercise each icon in the document's light DOM and in an author-created open shadow root. In both locations, each icon must occupy a non-zero square. An icon without `size` must match its inherited `1em`. An icon with `size` must match its computed font size.

A real browser using a fresh production canonical stylesheet must render an undefined icon without `size` and undefined icons at `sm`, `md`, `lg`, and `xl`. Each icon must keep the same bounding box when the production element definition loads.

Under [Tests are the validation mechanism](../../../arch/testing-policy.md#Tests are the validation mechanism), [foundation architecture](../../../arch/ui/foundation.md#Testing) owns proof that the complete icon stylesheet reaches a fresh production web build. This surface must provide a separate proof through the real repository filesystem and a fresh canonical build. That proof must show that the production icon stylesheet, which is byte-identical to the authoritative stylesheet, produces exactly the placeholder set defined under [Sizing](#Sizing). It must show that each placeholder matches its corresponding upgraded `:host` declarations. It must also show that no other rule from the icon stylesheet enters canonical document scope.

Under [Motion: the default CSS-motion override and real-motion tests](../../../arch/testing-policy.md#^real-motion), real-browser motion coverage must show that `spinning` produces one continuously advancing animation under the normal motion preference. It must also show that the `spinning` state produces no animation under the reduced-motion preference.

Under [The suite does not assert styling adherence](../../../arch/testing-policy.md#^ui-styling-out), this surface's suite does not independently cover glyph alignment, inline alignment, colour, `currentColor`, the four exact pixel sizes, or the animation's exact duration and easing. Those remain staging and review concerns.

Under [Tests are the validation mechanism](../../../arch/testing-policy.md#Tests are the validation mechanism), [element architecture](../../../arch/ui/elements.md#Testing) assigns [Canonical](../../../arch/canonical.md#Versioning) responsibility for proving that the icon is public and preserving compatibility of its public API. It assigns [UI architecture](../../../arch/ui/index.md#Testing) responsibility for proving how production element modules are structured. For the icon, those proofs show that public names remain available. They also show that the production element follows the custom-element conventions. This suite does not repeat those proofs. Each surface that composes an icon owns the icon's requested name, `size`, and `spinning` state. This suite proves what those inputs mean.

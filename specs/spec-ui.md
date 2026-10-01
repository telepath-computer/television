*How visual design is specified and held authoritative: a spec per surface whose reference frames are rendered truth, staged for judgment in the workshop ([staging.md](staging.md)), and enforced by automated conformance.*

# UI specs

**Status:** adopted; surfaces are being transitioned. Where specs are silent, the transitional rule of [spec-policy.md](spec-policy.md) applies: code is the authority.

## Authority

**`specs/ui/` is the exclusive authority for three things: a surface's interaction, markup, and styling.** A *surface* is a distinct part of the user interface; a *document* is a page surfaces render into, specified by the stylesheet it carries. Each lives in `specs/ui/`. The live artifact document is specified by its canonical aggregate here. When a canonical version freezes, its exact built payload moves under `packages/canonical/frozen/` with a per-version provenance record (currently [v1's `frozen.json`](../packages/canonical/frozen/v1/frozen.json)) and its live aggregate leaves the spec tree; [arch/canonical.md](arch/canonical.md) owns that payload and compatibility lifecycle. No other spec may own any of the three; product and arch specs reference the owning UI spec.

A specific UI spec may define design sources for artifacts whose installed files are authored separately. In that case, exclusivity applies to the design source, and the specific UI spec names the package or architecture authority for what is installed. The installed files may be derived from the design source by a scripted, manually-run port whose output is committed and reviewed like any content change — never imported at runtime, so the no-production-import rule below holds. The onboarding artifact designs use this boundary ([ui/onboarding-artifacts/index.md](ui/onboarding-artifacts/index.md); their port is [arch/onboarding/bake.md](arch/onboarding/bake.md)).

- **Interaction** — how the surface communicates information to the user and responds to user input.
- **Markup** — the structure and content of the surface's rendered output in every state.
- **Styling** — what the surface looks like.

Browser-platform choices across interaction, markup, and styling follow the [UI browser-compatibility policy](ui/index.md#browser-compatibility).

As with every spec, a UI spec is separate from the codebase, and the codebase is derived from it: production never imports the spec's templates, styles, content, or motion modules. There are two important reasons for this decision:

1. It keeps UI concerns cleanly separate from binding implementation details.
2. It keeps the spec layer unambiguously slop-free: if spec files were imported as production code, implementation work would end up editing them, and the spec would no longer own every line.

A UI spec makes no claims about the implementation itself — it binds **what must render**, never **how the code must be shaped**; code shape is an arch spec's authority ([arch/ui/index.md](arch/ui/index.md) for the UI's own architecture). Any technology that produces the specified output conforms, and an implementation can be rewritten freely so long as it still does.

Binding prose lives in the markdown files alone. What binds in the other artifacts is their content — the markup and style declarations in a frame, the values in a yml, and the outputs of explicitly designated motion functions. Comments in those files are descriptive context only: they say what a thing is, and commit nothing — claims, decisions, and rationale belong in the owning spec's prose.

## UI spec structure

### Spec document

A UI spec is a primary spec document — an ordinary spec (`index.md`, the usual convention for a spec directory). It can point to zero or more *reference frames*, each assumed as rendered truth for the part of the surface the spec signifies with it.

A linked artifact is spec — presumed authoritative — and the primary spec says what it is: which states a frame demonstrates, and how the implementation is held to it. Unless it says otherwise, the holding is exact within what a frame binds (below): everything the frame states must render as written, and structure or styling it does not state is a divergence — permitted only as a declared exemption, never at the implementation's discretion.

### What a frame binds

A frame binds how the surface looks, state by state: the styling that must be computed; the structure and semantic attributes that styling attaches to — classes, roles, state attributes like `aria-selected` and `open`, and the composition of one frame inside another; and the copy written in the markup. This is the visual authority for the surface.

A frame does not bind markup that exists for behavior rather than appearance: pairing ids, attributes like `trigger` that reference them, and implementation bookkeeping. Those contracts are stated where they are owned — the Markup section of the owning foundation spec, and the architecture specs that govern how implementations produce them (for example [arch/ui/menu-view.md](arch/ui/menu-view.md) for minted trigger ids) — and conformance ignores that class of attribute when comparing. A frame under `specs/` carries no script, ever: behavior is specified in prose and data, with optional pure motion functions as described below, and the workshop adds its own wiring from outside ([staging.md](staging.md)).

### Frames

A **frame** is one file — YAML front matter over a Liquid body — in the format of the frameset viewer; the format, its rendering, and the viewer's controls are the frameset package's own documentation. What this spec adds are the rules for frames under `specs/`: one frame per surface or piece, the stylesheet carried in the frame's `style:` block, and never a `script:` block.

A frame computes only what Liquid can say — interpolation, conditionals, loops, and the standard filters (deriving a group with `where` is fine). The language is the bound: anything that needs more than Liquid offers is prepared by the caller.

**Parameters** declare the states a frame can render; defaults supply the sample content it renders unposed. Defaults are for the small vocabulary pieces; a composed surface renders a world its caller supplies — in the workshop, a staging fixture fed through the render — rather than carrying a sample world of its own. A scalar parameter (a `type` or an `enum`) is posable: the viewer offers it as a control, and a URL can set it (`?selected=agenda`), so every state has an address. A structured parameter (a list, an object) carries content — sample channels, a tab list — supplied by defaults or by a composing caller. A state that must be singular is declared singular — one `selected` id rather than a flag on every row — so an illegal combination cannot be written.

**Composition.** Wherever a composed surface has a frame, the composing frame renders it (`{% render './channel', name: channel.name %}`) rather than inserting the implementation's tags; arguments are explicit, and the composed frame sees only what it is handed.

**Rendering.** The same arguments produce the same markup every time, and that rendering — the frame module's `render` — is what conformance holds production to. Rendering runs no script, so tests and comparisons consume frames with nothing unverified attached.

**Transition.** Surfaces not yet converted keep the earlier form — a `template.liquid` with `content.yml` and stylesheet files beside it, rendered by the machinery in `config/liquid/` — upgraded to frames as touched.

### Styling

Styling lives in the `style:` block of the frame, written against the markup below it, so each piece of the surface is one self-contained file. Foundation styling — the tokens and the shared element vocabulary ([ui/foundation/index.md](ui/foundation/index.md)) — is delivered to every document separately; a frame states only what the surface adds.

### Content

Copy is written in the markup where it appears, or supplied through parameter defaults where it varies, and is ratified as rendered. Sidecar `content.yml` files remain on unconverted surfaces.

### Assets

An icon renders by composing the icon frame ([ui/foundation/icons/index.md](ui/foundation/icons/index.md)). Other image assets bind through front-matter `imports`, which yields the bundled URL for the markup to place. A rendered URL is an opaque placeholder — the implementation supplies its own — so only the markup around it is held to the spec.

## Staging

Staging is for the design process and its validation; it is not part of the spec, and nothing in it binds the implementation. It happens in the workshop tree (`frames/`) exclusively, keeping the spec frames pure. The workshop — the viewer, the boards, the prototype wiring, the document environment — is owned by [staging.md](staging.md). Frames there may also mount the implementation — the surface as actually built — so a human judges the built result in the same workshop.

## Motion and interactivity

CSS transitions and keyframes belong with the surface styles. Prose specifies behavior; an executable reference can specify intermediate appearance or timing when code expresses it more precisely.

The owning UI spec names the reference module under `specs/ui/`, its functions and inputs, and the outputs that bind production. These functions are pure: the same inputs produce the same outputs, without DOM access, services, a clock, or retained state. Prose covers behavior the functions do not express, without repeating their calculations.

[Staging](staging.md#staging-code) may run the reference for inspection. [Testing policy](arch/testing-policy.md#motion-the-default-css-motion-override-and-real-motion-tests) governs comparisons with production.

## Verification

[arch/ui/conformance.md](arch/ui/conformance.md) owns the automated checks that hold a surface to the requirement above, and what an exemption must satisfy. Its [TV-649 release exception](arch/ui/conformance.md#release-exception-for-tv-649) schedules the automated markup-comparison system after the themes release. Until that work is complete, production must still implement the specified UI correctly and pass existing tests and implementation and visual review. Stylesheet-copy and delivery checks remain required.
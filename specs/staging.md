*The staging workshop: where spec renders are staged and judged — the frameset viewer, the frames tree, and its conventions.*

# Staging

The workshop where the interface's specifications are viewed and judged: each spec's states render as browsable pages, so design is approved by looking at the real thing. What staging is for, and its non-binding standing, are stated in [spec-ui.md](spec-ui.md) (Staging); this document owns the workshop's conventions.

## The viewer

Staging is served by frameset, run as a published package (`npm run frameset`) — never from a checkout. `frameset.json` at the repo root indexes the sidebar — sections, folders, and frames — and imports the document environment into every frame document. The foundation stylesheet is imported as `specs/ui/foundation/index.css` directly, never a build of it: a spec edit shows in every frame, and import hoisting places it in the document before any frame styles, so the cascade order holds wherever the tags sit.

## The document basics

Appearance and theme belong to each frame. Its controls and URL choose them, falling back to its declared defaults. These choices are not remembered in browser storage or shared between previews. Standalone frames default to light appearance and no theme; embedded frames inherit from their board unless they declare a choice. Named theme previews retain their authored theme.

App previews apply the application document conventions, including button focus, text selection, and placement of posed-open panels. Onboarding artifact previews load their declared dependencies without the app-only conventions.

Reference frames have no background of their own, so missing surface backgrounds remain visible. Boards may provide an explicit background through `frameset-frame`.

## Boards and prototypes

A **board** is a frame under `frames/` that embeds spec frames in posed states (`<frameset-frame src>`), at the sizes and on the ground they are judged against — a column of states, a centered specimen.

A **prototyping frame** renders a spec frame inline and wires it: each component's wiring is one module in `frames/lib/`, exporting a function the host's `script:` applies to the staged markup. The function registers its event listeners — on the staged markup, and on `document` where a gesture must be tracked past the markup's edge — and returns a disposer that removes every listener it registered. The host applies the wiring when its script runs, and again on each `frameset:rendered` event, which the runtime dispatches after re-rendering the document and replacing the staged markup; it calls the previous disposer first, so no listener is registered twice. Rigs may change the staged markup directly while a gesture runs; at rest, the result must match what the frame would render for that state, so a re-render changes nothing. A staging frame's one-off wiring stays in that frame's own `style:` and `script:` blocks. Spec frames carry no scripts ([spec-ui.md](spec-ui.md), What a frame binds).

## Staging code

Workshop wiring may measure a frame, apply an [executable motion reference](spec-ui.md#motion-and-interactivity) to its DOM, and provide playback or progress controls. The wiring binds nothing; the reference retains its specified authority. Simulation css and DOM added around a spec render — scroll spacers, injected handles, wrappers — are labelled as staging and carry the reason they exist.

- Staging never restates a value the spec authors — it reads it (`drag.yml` imported as data), so every number exists in exactly one place.
- A fresh render poses its state: transitions are held off until the posed values have painted, or entry animates from defaults.
- A claim's invariant may be enforced by a guard in the staging code, loud on violation and never silent — staging has no test harness, and a guard is how a regression surfaces while gestures are being tried.

Fixture content (sample channels, example artifacts) is staging's own, kept beside its consumers or in `frames/lib/` when shared.

## The earlier workshop

The `staging/` tree and the remaining Storybook stories (`storybook/`) persist for surfaces not yet converted: per-state documents mounting `template.liquid` files, sheets as `index.html`, and shared mechanisms in `staging/lib/`, including the pseudo-state mirror. They are upgraded to the frames workshop as touched.

## Linting

Staging is deliberately not exempt from the `no-magic-numbers` lint rule. A bare number in staging is usually a value that carries design authority, restated where authority cannot see it — the lint error is the signal, and the response is ordered:

1. First ask whether the value is the spec's — stated in prose, or judged in the viewer and adopted. Then it belongs in an authored artifact (a measures yml like `drag.yml`; or the sheet), the prose cites it, and staging reads it from there, so nothing can drift.
2. Only when a value is genuinely staging's own — a board's geometry, a sample world number, a guard's tolerance, an algorithm's internal constant — declare it as a named constant beside its use, the name (and a comment where the name is not enough) saying what it is.

Never silence the rule inline: a disable comment hides exactly the question the rule exists to ask.

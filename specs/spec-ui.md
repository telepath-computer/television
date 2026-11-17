*How UI is specified: an MDX spec per surface, whose prose and the appearance of the stories it points to are the authority, checked against production story by story.*

# UI specs

**Status:** adopted. UI specs written before it, as frames or templates with stylesheets, stay in force; a surface moves to an MDX spec with stories when it is next redesigned. [Spec migration](spec-migration.md) records which surfaces have moved and how the rest are checked. Where specs are silent, the transitional rule of [spec-policy.md](spec-policy.md) applies: code is the authority.

## Authority

**`specs/ui/` is the exclusive authority for two things: a surface's appearance and its interaction.** A *surface* is a distinct part of the user interface; a *document* is a page surfaces render into, specified by the stylesheet it carries. Each lives in `specs/ui/`. The live artifact document is specified by its canonical aggregate here. When a canonical version freezes, its exact built payload moves under `packages/canonical/frozen/` with a per-version provenance record (currently [v1's `frozen.json`](../packages/canonical/frozen/v1/frozen.json)) and its live aggregate leaves the spec tree; [arch/canonical.md](arch/canonical.md) owns that payload and compatibility lifecycle. No other spec may own either; product and arch specs reference the owning UI spec.

A specific UI spec may define design sources for artifacts whose installed files are authored separately. In that case, exclusivity applies to the design source, and the specific UI spec names the package or architecture authority for what is installed. The installed files may be derived from the design source by a scripted, manually-run port whose output is committed and reviewed like any content change. The onboarding artifact designs use this boundary ([ui/onboarding-artifacts/index.md](ui/onboarding-artifacts/index.md); their port is [arch/onboarding/bake.md](arch/onboarding/bake.md)).

- **Appearance** — what the surface looks like in every state, as its stories render it.
- **Interaction** — how the surface communicates information to the user and responds to user input, as its prose describes.

Browser-platform choices for appearance and interaction follow the [UI browser-compatibility policy](ui/index.md#browser-compatibility).

A UI spec binds **what must render**, never **how the code is shaped**; code shape is an arch spec's authority ([arch/ui/index.md](arch/ui/index.md) for the UI's own architecture). Production never imports a UI spec's files, such as its stories, styles or motion modules: if it did, implementation work would end up editing them, and the spec would stop being [slop-free](spec-policy.md#Slop-free zone). Any technology that produces the specified output conforms.

Comments in story modules, stylesheets and motion functions are descriptive context only: they say what a thing is, and commit nothing. Claims, decisions and rationale belong in the spec's prose.

## The spec and its stories

A UI spec is an MDX file under `specs/ui/`, one per surface. It is written like any other spec, and its prose binds like any other spec's. It points to Storybook stories, which live in the Storybook package. Each story in a module the spec imports is one state of the surface, whether or not the spec embeds it. ^ui-spec-stories

What binds in a story is what it looks like in the state its args, globals, parameters and `play` function set up, including the state of its controls, such as a ticked box or the text in a field. Its markup does not bind: production can use different elements and attributes as long as it looks the same. Where something that does not show matters, such as a role or an accessible name, the prose names it. A spec story's `play` function sets up its state deterministically, so the story always ends in the same state. Anything else about a surface binds only where the prose says so. ^ui-story-output

## Experiments

Experiments carry no spec authority; stories a spec needs live in `storybook/spec/`. An active experiment lives at `storybook/experiments/<name>/`; when it finishes, move it under `storybook/experiments/<YYYY-MM>/<name>/` for its finishing month. Its title is `Experiments/<Name>` while active and `Experiments/<YYYY-MM>/<Name>` when finished; `<Name>` is any descriptive name and need not match the folder. Neither the folder nor title uses an outcome category such as `Rejected`.

## Conformance

Production is checked against each state by conform (`@telepath-computer/conform`), which compares what two pages look like in Chromium and reports every difference. ^ui-conformance

Each spec story is compared with production in the same state: the code that ships, at the same viewport and with the same theme and appearance, with nothing added to its markup or styles. The surface's proof says how production reaches each state: through real services, or through mocks under the [mocking policy](arch/testing-policy.md#Mocking policy), reusing shared mocks and test harnesses where they exist. Anything a person does to get there is done with real input. ^ui-production-story

Each surface has one conformance test file, which runs conform on every spec story against production in that state, one test each, and fails for a spec story it does not cover. It holds no list of permitted differences: when production needs markup or styling the spec does not show, the spec changes, with the approval spec changes require, or production changes to match. Conformance covers what each state renders. Behaviour the prose describes is proven by tests derived in the surface's proof, like any other spec promise. ^ui-conformance-test

## Change over time

A surface can change over time, as in a transition. A story can show a moment part-way through such a change, and the prose says what starts it and what interrupting it does.

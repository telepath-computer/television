*How UI is specified: an MDX spec per surface, whose prose and the appearance of the stories it points to are the authority, checked against production story by story, and the rules for legacy frame and template specs.*

# UI specs

**Status:** adopted. UI specs written before it, as frames or templates with stylesheets, stay in force under the rules in [Legacy frame and template specs](#^ui-frame-specs); a surface moves to an MDX spec with stories when it is next redesigned. [Spec migration](spec-migration.md) records which surfaces have moved and how the rest are checked. Where specs are silent, the transitional rule of [spec-policy.md](spec-policy.md) applies: code is the authority.

## Authority

**`specs/ui/` is the exclusive authority for two things: a surface's appearance and its interaction.** A *surface* is a distinct part of the user interface; a *document* is a page surfaces render into, specified by the stylesheet it carries. Each lives in `specs/ui/`. The live artifact document is specified by its canonical aggregate here. When a canonical version freezes, its exact built payload moves under `packages/canonical/frozen/` with a per-version provenance record (currently [v1's `frozen.json`](../packages/canonical/frozen/v1/frozen.json)) and its live aggregate leaves the spec tree; [arch/canonical.md](arch/canonical.md) owns that payload and compatibility lifecycle. No other spec may own either; product and arch specs reference the owning UI spec.

A specific UI spec may define design sources for artifacts whose installed files are authored separately. In that case, exclusivity applies to the design source, and the specific UI spec names the package or architecture authority for what is installed. The installed files may be derived from the design source by a scripted, manually-run port whose output is committed and reviewed like any content change. The onboarding artifact designs use this boundary ([ui/onboarding-artifacts/index.md](ui/onboarding-artifacts/index.md); their port is [arch/onboarding/bake.md](arch/onboarding/bake.md)).

- **Appearance** — what the surface looks like in every state, as its stories render it, or, for a legacy spec, as [its frames bind](#^ui-frame-binds).
- **Interaction** — how the surface communicates information to the user and responds to user input, as its prose describes.

Browser-platform choices for appearance and interaction follow the [UI browser-compatibility policy](ui/index.md#browser-compatibility).

A UI spec binds **what must render**, never **how the code is shaped**; code shape is an arch spec's authority ([arch/ui/index.md](arch/ui/index.md) for the UI's own architecture). Production never imports a UI spec's files, such as its stories, styles or motion modules: if it did, implementation work would end up editing them, and the spec would stop being [slop-free](spec-policy.md#Slop-free zone). Any technology that produces the specified output conforms.

Comments in story modules, frames, stylesheets, YAML files and motion functions are descriptive context only: they say what a thing is, and commit nothing. Claims, decisions and rationale belong in the spec's prose.

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

## Legacy frame and template specs

Surfaces not yet moved to MDX are specified by an `index.md` spec that points to frames, to a Liquid template, or only to stylesheets, as the [foundation](ui/foundation/index.md) does. [Spec migration](spec-migration.md) lists them. These specs state a surface's appearance as markup and styling, and its interaction in prose. This section holds the rules for reading them; [Authority](#authority) applies to them as to MDX specs, and the sections on stories, conformance and change over time apply only to MDX specs. ^ui-frame-specs

The spec's prose binds like any spec's, and says which states each frame demonstrates. Each frame specifies what production renders for the part of the surface the spec uses it for: within [what the frame binds](#^ui-frame-binds), production renders what the frame states. Values in the spec's YAML files, such as copy in `content.yml` or sizes in `measures.yml`, bind as written, as do the designated outputs of a [motion reference](#^ui-motion-reference). [Frame and template conformance](arch/ui/conformance.md) owns how production is checked against these specs, and what happens when production needs markup or styling a frame does not state.

### What a frame binds

A frame binds how the surface looks, state by state: the styling that must be computed; the structure and semantic attributes that styling attaches to, such as classes, roles, state attributes like `aria-selected` and `open`, and the composition of one frame inside another; and the copy written in its markup. ^ui-frame-binds

A frame does not bind markup that exists for behaviour rather than appearance: pairing ids, attributes such as `trigger` that refer to them, and implementation bookkeeping. Those contracts are stated where they are owned: the Markup section of the owning foundation spec, and the architecture specs that govern how production generates them, such as [arch/ui/menu-view.md](arch/ui/menu-view.md) for minted trigger ids. A production menu whose trigger id differs from the id written in a frame conforms.

### Frames and templates

A frame is one file, YAML front matter over a Liquid body, in the format of the frameset viewer; the frameset package documents that format, its rendering and the viewer's controls. A frame under `specs/` specifies one surface or one piece of a surface, carries its stylesheet in its `style:` block, and has no `script:` block: behaviour is specified in prose and data, and the workshop adds its own wiring from outside ([staging.md](staging.md)). ^ui-frame-format

- **Computation.** A frame computes only what Liquid can express: interpolation, conditionals, loops and the standard filters. Anything that needs more is prepared by the caller.
- **Parameters** declare the states a frame can render, and their defaults supply the sample content it renders unposed. A scalar parameter, a `type` or an `enum`, can be posed: the viewer offers it as a control and a URL can set it (`?selected=agenda`), so every state has an address. A structured parameter, a list or an object, carries content supplied by defaults or by a composing caller. A state that must be singular is declared singular, such as one `selected` id rather than a flag on every row, so an illegal combination cannot be written. Defaults are for small vocabulary pieces; a composed surface renders content its caller supplies, which in the workshop is a staging fixture.
- **Composition.** Where a composed surface has a frame, the composing frame renders it (`{% render './channel', name: channel.name %}`) and does not write the implementation's tags. Arguments are explicit, and the composed frame sees only what it is handed.
- **Rendering.** The same arguments produce the same markup every time. That rendering, the frame module's `render`, is what production is compared with, and it runs no script.

A template spec has a `template.liquid` with `content.yml` and stylesheet files beside it, rendered by the machinery in `config/liquid/`. The frame rules apply to a template, with its stylesheet in those files and its copy in `content.yml`.

### Styling, copy and assets

- **Styling** is written against the markup it styles, in the frame's `style:` block or in stylesheet files beside the spec. Foundation styling, the tokens and shared element vocabulary ([ui/foundation/index.md](ui/foundation/index.md)), reaches every document separately; a frame states only what its surface adds.
- **Copy** is written in the markup where it appears, or supplied through parameter defaults where it varies. Some surfaces keep copy in a `content.yml` beside the spec.
- **Assets.** An icon renders by composing the icon frame ([ui/foundation/icons/index.md](ui/foundation/icons/index.md)). Other images bind through front-matter `imports`, which yields the bundled URL for the markup to place. A rendered URL is a placeholder: production supplies its own, and only the markup around it binds.

### Motion references

CSS transitions and keyframes belong with the surface's styles, and prose specifies behaviour. Where code states intermediate appearance or timing more precisely than prose, the spec can designate a *motion reference*: a module under `specs/ui/` whose functions calculate that appearance or timing. The spec names the module, its functions and inputs, and the outputs that bind production. The functions are pure: the same inputs produce the same outputs, with no DOM access, services, clock or retained state. Prose covers behaviour the functions do not express, without repeating their calculations. The workshop may run a reference for inspection ([staging.md](staging.md)), and the [testing policy](arch/testing-policy.md#^real-motion) governs comparing production with it. ^ui-motion-reference

### Staging

Legacy surfaces are staged and judged in the workshop ([staging.md](staging.md)). Nothing in the workshop binds production.

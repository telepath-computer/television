*UI spec: the skill selector — the navbar trigger and the skills popover; its interaction, markup, and styling.*

# Skill selector (UI)

A trigger in the navbar's trailing position presents a popover of the bundled artifact skills. Each skill is a card — a thumbnail previewing what it makes, its name and a short description, and a button that copies a starting prompt for it. The user completes that prompt with their own request and sends it to their agent; what the prompt then drives — the agent building the artifact — is out of scope here. This directory owns the surface's interaction, markup, and styling ([spec-ui.md](../../../spec-ui.md)).

The supporting artifacts, each authoritative:

The surface is [skill-selector.frame](./skill-selector.frame): the trigger, and the popover panel with its heading, intro, and the four bundled skill cards — each a committed thumbnail import, name, description, and copy-prompt button — plus the panel's interior styling (its size, the heading, intro, the card grid, the thumbnail image, and the placement of each card's copy button). The panel is always in the markup, closed until presented; trigger and panel are paired by the panel's `trigger` reference, and the panel itself — chrome, placement, dismissal — is the popover's ([ui/foundation/popover/index.md](../../foundation/popover/index.md)). The copy button's swap is the [app/copy-button/index.md](../copy-button/index.md) surface's.
- [ui/app/skill-selector/content.yml](./content.yml) — the surface's fixed strings, and the bundled `skills` (each skill's name, description, and prompt — hard-coded for v1, moving to each skill's own spec later).
- `thumbnails/` — the committed per-skill thumbnail PNGs, imported with `{% import %}`. They are captured from the `Design / Skill thumbnails` workshop story (their editable source).

Conformance of the implementation to these artifacts is automated ([arch/ui/conformance.md](../../../arch/ui/conformance.md)); [Testing](#Testing) states the behavior this surface's suite must prove.

## Interaction

- The trigger opens the panel; toggle, placement, focus, and light dismissal are the popover's ([ui/foundation/popover/index.md](../../foundation/popover/index.md)). (Contrast [app/update-notification/index.md](../update-notification/index.md), which deliberately resists outside-press dismissal — `manual` in the popover's terms.)
- The popover presents the bundled skills as a grid of cards — v1 is a fixed set of four, each fully specified here. (A variable, runtime-sourced list — with its empty and overflow states — is a later concern, when the surface becomes a component fed real skills.)
- Pressing a card's *Copy prompt* button copies that skill's prompt to the clipboard and briefly confirms. The prompt is a starting point — it names the skill and the artifact and ends at "…request, and put it on TV: " for the user to append their own request. The button is the composed [app/copy-button/index.md](../copy-button/index.md) surface (handed the skill's prompt and the `Copy prompt` label); its copy-and-confirm mechanics are owned there, the card only places and compacts it.
- Each card supplies the composed copy button's `onActivate` callback ([app/copy-button/index.md#^cb-activate-callback](../copy-button/index.md#^cb-activate-callback)) to report `artifact_skill_prompt_copy_clicked` through the client telemetry signal path ([arch/telemetry/client-signals.md](../../../arch/telemetry/client-signals.md)), carrying only the card's fixed `artifact_skill` key: `calendar`, `table`, `tasks`, or `markdown`. It fires once per press, including repeated presses, and carries neither the prompt nor any appended user request. The event records the click because clipboard writing and confirmation are best-effort. ^ss-telemetry

## Testing

Under [What a UI surface's suite is responsible for](../../../arch/testing-policy.md#What a UI surface's suite is responsible for), this surface's suite must prove that the icon trigger's accessible name and tooltip are both **Artifact skills**. It must prove that the panel is paired to the trigger — the panel's `trigger` names the trigger button — and displays its heading and intro. Exactly four cards must appear in this order: Calendar, Table, Tasks, and Markdown. Each card must have its decorative thumbnail and exact name and description. It must also have one composed **Copy prompt** button. That button must receive the card's exact prompt, including its trailing space.

Real-browser acceptance must press the production **Copy prompt** button on every fixed card. It must show that each press reports exactly one `artifact_skill_prompt_copy_clicked` event. That event must contain only the pressed card's fixed `artifact_skill` key. Pressing a card again must report one additional event. No reported event may contain prompt text.

Under [Tests are the validation mechanism](../../../arch/testing-policy.md#Tests are the validation mechanism), the [popover](../../foundation/popover/index.md) owns toggle, focus, dismissal, and placement behaviour. The [copy button](../copy-button/index.md#Testing) owns clipboard writing and confirmation. The [navbar](../top-bar/index.md) owns this surface's placement and presence in its controls. The proofs for the popover and the copy button cover the interactions assigned to those components. This surface's suite owns proof that the panel is paired to its trigger and contains the fixed card content. It also owns proof that each card's callback has the behavior required by the preceding acceptance paragraph.

Under the same rule, [telemetry client-signal architecture](../../../arch/telemetry/client-signals.md#Testing) owns signal validation. It also owns generic websocket forwarding into the event chokepoint. [Product telemetry](../../../product/telemetry.md#Testing) owns the requirement that the serialized event contain no user-generated content. For this surface, those proofs establish what happens after the selector hands the signal to the telemetry sender; this suite does not repeat the websocket or server path.

Under [The suite does not assert styling adherence](../../../arch/testing-policy.md#^ui-styling-out), this surface's suite makes no claim about thumbnail crops, panel size, the card grid, truncation, or copy-button placement.

## Decisions

- Deliberately minimal: the panel is the foundation's popover and the surface owns only its interior. The trigger's placement is the navbar's — [app/top-bar/index.md](../top-bar/index.md) composes this surface into its controls.
- The trigger is the foundation icon button carrying the `skills` glyph (triangle, circle, square) a step below its line — quiet at rest in the bar, visible on approach.
- v1 is fully specified, not data-driven: the four skills are unrolled as explicit cards, their strings bundled in [ui/app/skill-selector/content.yml](./content.yml) and their thumbnails committed as PNGs imported with `{% import %}`. Each thumbnail is a cropped detail of the real artifact (a calendar corner, a record table, a task list, a doc). When the surface becomes a component fed real skills, the cards collapse to a loop over that data.

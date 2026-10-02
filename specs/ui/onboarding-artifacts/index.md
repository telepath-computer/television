*UI spec: four designed onboarding channels and their artifacts — the design-source markup, styling, content, and shared conventions.*

# Onboarding artifact designs (UI)

These channels show how Television artifacts can teach a new user what to build
and what to ask an agent for. This directory defines four channel designs and
the visual language shared by their artifacts.

The reference frames, Markdown document, and layout files here are the
design source for TV Guide and the Business ops, Productivity, and Research
examples. [spec-ui.md](../../spec-ui.md) owns the general authority and
production-derivation rules. The onboarding-specific port is the
[bake](../../arch/onboarding/bake.md), and the committed installed bundle is
owned by [onboarding content](../../arch/onboarding/content.md).

**Status:** design source for the four channels below. A design is part
of the installed bundle only when the package config and content tree include
it.


## Designed channels

One coherent fiction runs through the three example channels: a single working day of
the founder of a small AI startup. The same people (Priya the lead
developer, Marcus the senior engineer, Jake), the same customers (Acme AI,
NeonBank, Mallory Health), and the same threads (the Acme pilot, eval
ownership, the seed deck, open-model research) recur across channels, so a
user exploring the set sees one plausible life, not disconnected lorem
ipsum. The fiction is deliberately fictional — invented companies, invented
model names, and a fixed story day in the design sources — and internally
consistent. ^one-fiction

Channels and artifacts, in design order:

| Channel (slug) | Artifact (slug) | Source |
|---|---|---|
| TV Guide (`tv-guide`) | Welcome to Television (`welcome`) | frame |
| Productivity (`productivity`) | About this channel (`about`) | frame |
| | Priorities for Today (`priorities-today`) | frame |
| | Company To-dos (`company-todos`) | frame + tv-tasks assets |
| | Today's Calendar (`todays-calendar`) | frame + tv-calendar assets |
| | Meeting prep (`meeting-prep`) | frame |
| Business ops (`business-ops`) | About this channel (`about`) | frame |
| | Revenue vs. goals (`revenue-vs-goals`) | frame |
| | Retention vs. recent releases (`retention-vs-releases`) | frame |
| Research (`research`) | About this channel (`about`) | frame |
| | Today's AI News (`todays-news`) | frame |
| | Open model research (`open-model-research`) | frame |
| | Draft blog post (`draft-blog-post`) | markdown document |

Each channel directory contains its `layout.yml` and one source named for each
artifact slug: an argumentless `<slug>.frame` or a Markdown `<slug>.md`.
A frame's body is the artifact's HTML and its `style:` block is the artifact's
CSS. The frame does not own the production document shell or its dependency
URLs. There is no per-artifact prose spec. The decisions and notes below record
only what the source files cannot show.

## Decisions

- **Artifacts respect the active theme.** No artifact resets or pins theme
  tokens: colors come from the canonical semantic tokens
  ([`--color-text`](../foundation/tokens/colors.css),
  [`--color-surface`](../foundation/tokens/colors.css),
  [`--color-border`](../foundation/tokens/colors.css), …), so the set
  renders correctly under any theme, including dark ones. Accent coloring
  (chart series, the priority rank numerals, the news source bands) uses
  canonical ramp tokens (`--blue-500`, `--green-600`, …), so themes may tune
  them through the same public vocabulary. Artifact styling uses no hex
  literals; the inline Television logo preserves its brand artwork colors.
  ^respect-theme
- **Every example channel opens with an About artifact** — a lede stating what the
  channel demonstrates, then three example prompt cards, each an ask the user
  can hand their agent verbatim. The prompts are the set's teaching device;
  the other artifacts on the channel are the kind of result those prompts
  produce. About artifacts read as the channel's guide, not an example result,
  so a post-it yellow surface (`--yellow-100` — a deliberate exception to the
  no-background rule) sets them apart from the example artifacts. Because that
  surface uses a ramp token rather than a semantic surface token, the About
  text and accent use dark ramp tokens rather than the theme's semantic
  text colors. ^about-cards
- **Example-artifact headings size down for card density.** Document-scale
  headings are oversized inside a TV card, so the example documents use smaller
  headings.
- **The story day is Wednesday, July 8, 2026.** The Company To-dos and Today's
  Calendar frames retain their authored dates. When either installed document
  opens, its displayed dates shift by the whole number of
  calendar days from July 8, 2026 to the viewer's current local day. Company
  To-dos shifts its heading date and every task `date` attribute. Today's
  Calendar shifts `start-date` and every event's `start` and `end` attributes,
  preserving each event's clock times. The gaps between all authored dates
  stay the same. Other story content and relative freshness lines such as
  "Generated 1 hour ago" keep their authored wording. ^productivity-relative-dates
- **Frames write public artifact elements directly.** These frames specify the
  HTML an agent authors inside an artifact, so literal public tags such as
  `<tv-icon>`, `<tv-task-list>`, and `<calendar-week>` are the required
  output. This is a narrow exception to the general UI-spec rule that a
  composing application frame renders another reference frame.

## Channel layout

Each designed channel has a defined artifact order. Every design carries a
*channel manifest* (`<channel>/layout.yml`), the machine-readable definition
that staging and the bake ([arch/onboarding/bake.md](../../arch/onboarding/bake.md)) consume. The manifest
carries the channel's display `name` and its `cards` in initial tab-page order,
each with:

- `id` — keys the artifact within design staging;
- `slug` — the artifact's source filename here, without its extension, and
  its packaged artifact slug when baked;
- `title` — the artifact's display title;
- initial page fields, when the design needs them: `size: { width, height }`
  uses reference CSS pixels and `geometry: { kind: "single", full_screen }`
  selects the stage-1 page mode. They are the exact shared `PageSize` and
  `PageGeometry` shapes, not document-specific sizing hints. Either may be
  omitted independently and then uses its shared default. Authors should
  account for the stage's rendered bounds: the artifact-frame floor is
  230 × 230 CSS pixels when the page box can hold it, while a smaller page box
  wins ([stage bounds](../app/stage/index.md#bounds));
- `skill: <name>`, when the frame uses browser components supplied by a
  bundled skill. The frame contains the public element markup but no import.
  During preview, the Frameset workshop loads that skill's source CSS and
  JavaScript. During bake, this field makes the bake copy the skill's built
  browser files beside the generated HTML and link them from its document
  head;
- `components: false`, when the baked document omits the canonical components
  module. It defaults to `true`. ^channel-layout

Each manifest entry becomes one tab page in that order, containing its one
artifact and carrying its configured-or-default initial page fields. The
manifest carries no stack, row, membership, or second layout tree; the layout
and onboarding owners define those rules
([arch/onboarding/content.md#^layout-config](../../arch/onboarding/content.md#^layout-config),
[how the installer writes the initial pages](../../arch/onboarding/installer.md#^layout-write-unmarked)).

## Per-artifact notes

These notes capture only what the source documents cannot show: component
dependencies, fiction constraints, and deliberate deviations.

### TV Guide

- **Welcome to Television** — the permanent first-run guide. Its
  `welcome.frame` owns the artifact markup and styles, uses canonical semantic and ramp
  tokens, and includes the small Television mark as inline SVG so the design
  and baked artifact need no separate first-party asset contract. Its three
  overlapping prompt cards are an intentional off-scale composition; they
  become a single responsive column on narrow cards. This guide is not part of
  the fictional working day shared by the three example channels.

### Productivity

- **About** — the three prompts descend in scope, ascending in specificity:
  a recurring morning synthesis (→ Priorities for Today), a one-shot display
  ask (→ Today's Calendar), a person-specific prep (→ Meeting prep).
- **Priorities for Today** — shell capped at 920px; the content is a single
  column and loses nothing narrower.
- **Today's Calendar** — a **directory artifact** backed by the bundled
  tv-calendar skill (manifest: `skill: tv-calendar`): `calendar.css`/
  `calendar.js` are sibling dependencies of `index.html`, and the document
  shell links them. `<calendar-week>`/`<calendar-event>`
  are defined by `calendar.js` (inert text without it), and the tv-calendar
  module replaces the canonical components module. The calendar fills the
  card full-bleed. Event `color` values (`blue`/`green`/`purple`/
  `orange`/`yellow`) are the component's palette API, not theme tokens.
- **Meeting prep** — shell capped at 880px; the person card stacks on narrow
  widths.
- **Company To-dos** — a **directory artifact** backed by the bundled
  tv-tasks skill (manifest: `skill: tv-tasks`): `task.css`/`task.js` are
  sibling dependencies of
  `index.html`, alongside the canonical components module for `<tv-icon>`.
  It owns no CSS: the tv-tasks component supplies the whole surface at zero
  body padding. Uses
  `<tv-icon>` (current name, post the `ui-icon`→`tv-icon` rename).

### Business ops

- **About** — the prompts point at this channel's own artifacts (the revenue
  and retention dashboards beside it); the third (ad-campaign performance)
  shows the ask generalizes beyond the two demonstrated.
- **Revenue vs. goals** — a dashboard; the bar chart's SVG geometry is the
  mock's, kept verbatim. Fiction fix: the mock's implausible "ARR $11.36M"
  fourth KPI became an "Expansion pipeline · $9.6M" card, with the summary
  adjusted to match.
- **Retention vs. recent releases** — a dashboard whose chart legend and impact
  list use the same release labels.

### Research

- **About** — the prompts escalate in ambition; the third produces a
  *markdown* artifact (→ Draft blog post), teaching that artifacts can be
  editable documents, not just dashboards.
- **Today's AI News** — shell at 760px (default is 720) for the feed's line
  lengths. Fiction: the model roster (GLM-4.6-405B, Llama-4-70B, …) matches
  Open model research; HN story domains are fictional (openweights.blog);
  the TechMeme claim is provider-neutral and benchmarks on AgentBench-2.0.
- **Open model research** — shell at 860px to hold the seven-column
  comparison table (left-aligned, categorical values); the ranked bar chart
  is bespoke inline markup. The models and the AgentBench-2.0 eval are
  fictional, consistent with Today's AI News.
- **Draft blog post** — is a **markdown document** (`draft-blog-post.md`, rendered by
  the product markdown pipeline), not HTML; its source is preserved
  verbatim, including its top-level heading. The onboarding package supports
  markdown artifact sources, and the bake copies the document byte-verbatim
  ([source shapes](../../arch/onboarding/bake.md#^source-shape-mapping)).

## Testing

Under [What a UI surface's suite is responsible for](../../arch/testing-policy.md#What a UI surface's suite is responsible for), these design sources require neither a markup snapshot nor a table-driven test that renders every artifact only to compare each result with its own source. The designs are the authority for the artifact documents. Proof is needed where the bake turns those designs into packaged content.

Under [The suite does not assert styling adherence](../../arch/testing-policy.md#^ui-styling-out), this surface requires no measurement of responsive widths, the appearance produced by theme tokens, charts, tables, internal cards, or the CSS width transition on the Open model research bar. Those visual details are judged in staging and review.

Under [Tests are the validation mechanism](../../arch/testing-policy.md#Tests are the validation mechanism), [bake testing](../../arch/onboarding/bake.md#Testing) owns proof that the real bake renders the frames into complete packaged documents, preserves the Markdown source byte for byte, and includes every declared sibling asset for a skill-backed artifact. This surface requires no second smoke test that covers every artifact.

The bake also owns validation of these manifests. It owns the configuration output that records their artifact order. This surface requires no duplicate test of manifest validation or configuration output.

Real-browser coverage must load the baked Company To-dos and Today's Calendar documents using assets from the production skill and canonical builds. Every authored task checkbox must upgrade with a real input whose accessible name is taken from the adjacent task title. Every authored due date must render without the component reporting it as invalid. The calendar must upgrade and render every authored event. Neither document may report a JavaScript module loading error or an error from a custom element.

With the browser on a known local day after July 8, 2026 that differs from its
UTC day, that coverage also checks the task heading and due-date labels, the
calendar header, and the shifted `start-date`, `start`, and `end` attributes.

Under [Tests are the validation mechanism](../../arch/testing-policy.md#Tests are the validation mechanism), [product onboarding acceptance](../../product/onboarding/onboarding-channels.md#Testing) owns proof of installation through the built `tv` process and of serving the packaged bytes, including the markdown source. [Installer testing](../../arch/onboarding/installer.md#Testing) owns proof that each page is created with the values configured for it or the shared defaults. [Artifact product testing](../../product/artifacts.md#Testing), [artifact-frame lifecycle testing](../../arch/artifact-frame/index.md#Testing), and [reload and navigation architecture](../../arch/artifact-frame/reload-navigation.md) own proof that artifact documents load, remain isolated, are interactive, and reload when the theme changes. Because those specs own these behaviors, the real-browser coverage here starts with baked documents. It does not repeat installation, page order, artifact-frame behavior, or theme changes. The bundled task and calendar skill suites retain ownership of their components' complete behavior and motion. This surface proves only that the authored task and calendar documents produce the browser outcomes above when loaded with the assets declared in their manifests.

## Staging

The workshop sidebar groups onboarding under App → Onboarding, with one board per channel.

The permanent Frameset workshop poses each of the thirteen authored documents
and each of the four whole channels in manifest order through the stage and
artifact frame, one artifact per configured-or-default page. Static artifacts
have one state each. For `company-todos.frame`, the workshop configuration
loads the tv-tasks source CSS and JavaScript. For `todays-calendar.frame`, it
loads the tv-calendar source CSS and JavaScript. The Markdown document goes
through Television's Markdown pipeline.

These imports belong to the workshop, not the authoritative frames. Staging
displays the authored sources; it does not read the packaged copies or repeat
their markup or styles.

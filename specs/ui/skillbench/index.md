*UI spec: skillbench — the eval review page's interaction, markup, and styling.*

# Skillbench (UI)

The eval review page: a central view showing the active job's artifact, and a single right rail for choosing and interrogating jobs. This directory owns the surface's interaction, markup, and styling ([spec-ui.md](../../spec-ui.md)); what the page is for, how it loads, and where it runs are [arch/skillbench.md](../../arch/skillbench.md).

**Status:** v1 UI authority alongside the live implementation (`packages/skillbench/public/`); the conformance boundary below is deliberate.

**Conformance:** held by review, behaviorally — what renders in each state, and how it looks. Structure is not tested; two implementation idioms are accepted mappings of this spec's markup: the layout may be hosted on `body` rather than the `.skillbench` wrapper, and states may toggle via `hidden` rather than conditional rendering.

The supporting artifacts, each authoritative:

- [ui/skillbench/template.liquid](./template.liquid) — the page's rendered markup: the central view (the artifact iframe, or the not-run message) and the right rail (jobs title, job list `ul`, then the inspector form: readonly prompt textarea, size `select`).
- [ui/skillbench/styles.css](./styles.css) — the styling: system fonts and literal values (internal tooling; deliberately independent of product styles).
- [ui/skillbench/content.yml](./content.yml) — the fixed strings (labels, the not-run texts).

Points:

- One rail only, on the right: the page renders embedded in Storybook, whose own sidebar is already the left rail.
- The rail is halved: the top half is the job list — plain tappable rows, iOS-list style, no radio affordance; the bottom half is the inspector form for the active job.
- Jobs with output list first, in config order; not-run jobs follow at the bottom, dimmed with a "not run yet" suffix.
- Pressing a row makes its job active: the central view shows that job's artifact, and the inspector shows its prompt and the size selection.
- A job with no output reads as state, not error: the central view shows the not-run message in place of an artifact.
- The artifact renders at the selected size, exactly, centered in the view horizontally and vertically — the stage scrolls when the size exceeds it; nothing scales. Sizes come from the package's data, first entry selected initially.
- On load, the active job is the first with output, or the first job if none have any.
- Failures read as state in the central view: a missing or job-less config, or unloadable data, shows a plain message where the artifact would be.

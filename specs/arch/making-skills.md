*Arch spec: how a bundled skill gets made — authority, bundle derivation, optional UI-spec staging, and final consumer delivery.*

# Making skills

A bundled skill gives an agent instructions and may ship assets used by the artifact it authors. `packages/skills/skills.json` defines bundle membership; the owning product, UI, and architecture specs define the content. Shipped output is derived from those sources and verified through the real build, package, and direct-install path. This spec owns that process. Skillbench itself is [arch/skillbench.md](./skillbench.md).

## Authority and optional surface staging

A skill that defines a designed artifact surface may have a UI spec under `specs/ui/skills/<name>/` (`index.md`, `template.liquid`, `styles.css`, and `content.yml` as needed), per [spec-ui.md](../spec-ui.md). Its templates are rendered truth; production and bundles never import them. General product guidance, including the `television` skill's primary and theming documents, follows its owning product and architecture authorities and does not need a UI surface.

Where a skill has a staged UI spec or an empirical authoring evaluation, its current records live under `storybook/stories/skills/<skill>/` and `storybook/skill-evals/<skill>.json`. A staging story is titled under the Specs area with the skill's human name and may contain:

- **State leaves** that render spec templates with sample data in frames (`storybook/lib/frame.ts`), linking the canonical stylesheet that artifacts inherit. Sample data and behavior shims are story-side apparatus, never spec content.
- **A `Preview` leaf** that embeds skillbench pointed at the skill's eval config.

The presence of source under `packages/skills/skills/` does not by itself require these optional records or make the skill shippable. The sidebar-view records demonstrate this distinction: their active authority marks that skill a non-shipping prototype, and `skills.json` omits it.

## The bundle

A skill's source lives in `packages/skills/skills/<name>/`, its shipping membership comes from `skills.json`, and the build emits it to `packages/skills/dist/<name>/`. Each shipped file is derived from authority by one of four mechanisms:

- **Copy** — carried CSS is the spec's `styles.css`, copied at port time (plus artifact page sizing).
- **Render** — exemplar markup in the skill text is the spec template rendered with sample arguments (hand-rendered until bake tooling exists).
- **Generate or author** — the skill text (SKILL.md) conveys the spec's author-facing points; hand-authored for now, generation-from-points is an option per skill.
- **Implement** — carried JS implements the ui spec's interaction points, with tests.

Derived source files are committed and reviewed. When an authority change affects them, they are re-derived before the change is complete; generated `dist/` output remains a build artifact.

The bundled `television` skill emits two guidance files. `SKILL.md` is the primary entry point and references its sibling `theming.md`; [theme authoring](./themes/authoring.md) owns that supporting document's content and derivation.

`SKILL.md` teaches HTML authors that a canonical stylesheet link may carry `authoredForAppVersion`, explains that the value is advisory authoring context rather than a load requirement, and tells an agent to copy the target server's exact release version from `tv status` or the checkout's exact version from the root `package.json` without translation. A missing status version or the `0.0.0` development sentinel establishes no target release. It sets the value when creating or deliberately re-authoring an artifact against that app surface, preserves an existing value during unrelated maintenance, and permits omission when the target version is unknown. The `tv-tasks`, `tv-calendar`, `tv-sidebar-view`, and `tv-table` skill sources put the same query placeholder on their canonical stylesheet links and give the same running-server and checkout version sources; the `television` skill remains the authority for the parameter's meaning.

## Evals

An eval config at `storybook/skill-evals/<skill>.json` stages the **built** bundle and prompts a fresh agent to author an artifact. Outputs land under `storybook/skill-evals/out/<skill>/<job>/` as gitignored per-user scratch. Prompts probe the skill's specific vocabulary and rules rather than generic requests. Run them through skillbench's CLI and review them in the corresponding `Preview` leaf. Config format and CLI are [arch/skillbench.md](./skillbench.md).

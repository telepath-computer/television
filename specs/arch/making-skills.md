*Arch spec: how a bundled skill gets made — authority, bundle derivation, and final consumer delivery.*

# Making skills

A bundled skill gives an agent instructions and may ship assets used by the artifact it authors. `packages/skills/skills.json` lists only `television`, the skill Television ships. The owning product and architecture specs define its content. Shipped output is derived from those sources and verified through the real build, package, and direct-install path. This spec owns that process.

## Authority

A skill that defines a designed artifact surface may have a UI spec under `specs/ui/skills/<name>/` (`index.md`, `template.liquid`, `styles.css`, and `content.yml` as needed), per [spec-ui.md](../spec-ui.md). Its templates are rendered truth; production and bundles never import them. General product guidance, including the `television` skill's primary and theming documents, follows its owning product and architecture authorities and does not need a UI surface.

The presence of source under `packages/skills/skills/` does not by itself make a skill shippable. The `tv-calendar`, `tv-table`, and `tv-tasks` sources remain in that tree but are not bundled agent skills. The calendar and task browser components are still built for the [onboarding bake](./onboarding/bake.md#^skill-assets). The active authority for sidebar-view marks that skill a non-shipping prototype, and `skills.json` omits it.

## The bundle

A skill's source lives in `packages/skills/skills/<name>/`, its shipping membership comes from `skills.json`, and the build emits bundled skills to `packages/skills/dist/<name>/`. That directory contains only manifest members, including in development. The build emits calendar and task browser components to `packages/skills/onboarding-dist/<name>/` for the onboarding bake.

Derived source files are committed and reviewed. When an authority change affects them, they are re-derived before the change is complete; generated `dist/` output remains a build artifact.

The bundled `television` skill emits four guidance files. `SKILL.md` is the primary entry point and references `theming.md`, `resources.md`, and `templates.md`. [Theme authoring](./themes/authoring.md) owns the content and derivation of `theming.md`, [resource guidance](./resources/guidance.md) owns those of `resources.md`, and [artifact template guidance](./templates/authoring.md) owns those of `templates.md`.

`SKILL.md` teaches HTML authors that a canonical stylesheet link may carry `authoredForAppVersion`, explains that the value is advisory authoring context rather than a load requirement, and tells an agent to copy the target server's exact release version from `tv status` or the checkout's exact version from the root `package.json` without translation. A missing status version or the `0.0.0` development sentinel establishes no target release. It sets the value when creating or deliberately re-authoring an artifact against that app surface, preserves an existing value during unrelated maintenance, and permits omission when the target version is unknown.

## Evaluation

Television currently has no empirical evaluation of skill authoring.

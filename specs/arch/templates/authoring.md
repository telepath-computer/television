*Artifact template guidance: the short introduction and `templates.md` document bundled in the `television` skill for using and authoring templates.*

# Artifact template guidance

The `television` skill tells agents that reusable artifact templates exist, and carries a separate document for authoring them. This spec owns that guidance and its source-to-bundle placement. [Product behavior](../../product/templates.md) and the [folder contract](./index.md) own the facts it teaches; [making skills](../making-skills.md) owns general bundle and installation mechanics.

## Skill introduction

The primary `SKILL.md`, built from `packages/skills/skills/television/src/skill-intro.md`, says in one sentence what an artifact template is and names `tv templates list`, `tv create-artifact --template`, and `tv templates path`. It tells an agent to check `tv templates list` when a person asks for an artifact and to consider whether an available template fits, including requests described as a “macro” or “stock artifact.” It points to `templates.md` for a request to create, change, or fix a template. It tells agents to pass `--width`, `--height`, `--full-screen`, or `--no-full-screen` to `tv create-artifact` when the request calls for particular display options. ^artifact-template-skill-intro

## Authoring document

The skill build copies `packages/skills/skills/television/src/templates.md` into the `television` bundle beside `SKILL.md`, `theming.md`, and `resources.md`. The document teaches an agent to find the selected home's folder with `tv templates path` and to use the same `--home` selection for later commands. It covers the folder form, the three required manifest fields, optional `display` options for size and full-screen state when defaults do not suit the template, the required `index.html`, optional `data.json`, and how `tv templates list` reports validity errors. It explains that `README.md` gives the adapting agent context and is copied into each new artifact; the manifest, starting data file, and optional `thumbnail.png` stay with the template. It says an image is optional, leaving image authoring details to the [Templates UI spec](../../ui/app/skill-selector/index.md).

The document explains that editing a valid installed bundled template at or above its minimum version preserves that installed copy on later boots; a folder below the minimum or invalid is backed up and replaced under [bundled installation](./bundled-installation.md). It teaches agents to use the scan after editing to see whether their template is valid. It does not make template-origin claims about created artifacts, which are [ordinary path artifacts](../../product/templates.md#^artifact-template-result).

The document says that a template's `index.html` is an HTML artifact page, so the Artifact workflow and HTML artifact style sections of `SKILL.md` apply to it, and that the folder name, which is the template ID, follows that workflow's naming guidance. The manifest's `name` is the title people see and the default title of each created artifact. When the template has starting data, the document tells an agent to describe the store's shape in `README.md`, and points to `resources.md` for the store itself. It refers to that guidance rather than restating it. ^artifact-template-authoring-doc

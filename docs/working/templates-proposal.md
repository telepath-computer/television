# Templates — proposal

**Status:** approved by Rupert on October 15, 2026, and derived into the specs. Started by Josh as the stencils proposal; Rupert settled its open questions. The decisions below are recorded where they were made.

## Summary

A *template* is a reusable starting point for an artifact: a folder of HTML and supporting files, with an optional starting value for the artifact's store. Using a template creates a new, ordinary path artifact from a copy of that folder, so an agent can start from a working page and adapt it instead of building a similar artifact from nothing every time.

Templates live in the Television home, one per folder, and people and agents can edit them or add new ones. Television ships a set of bundled templates and installs them with the same rules it uses for bundled themes. People use templates from a Templates popover in the navbar, which replaces the current Artifact skills popover. Agents use them through `tv` commands. The `television` skill tells agents that templates exist, and a separate document inside the skill explains how to write and maintain them.

Rupert decided on October 15, 2026 that Television stops shipping the `tv-calendar`, `tv-table` and `tv-tasks` skills: `tv skills install` installs only the `television` skill, and removes nothing already installed. Their source stays in the repository because the onboarding build copies their browser components into the onboarding artifacts. Agents lose their guidance for calendars, tables and task lists until those arrive as templates; Rupert accepted that gap.

## What a template is

A template is a folder directly inside `<home>/templates/`:

```text
<home>/templates/<template-id>/
  manifest.json      required
  index.html         required
  data.json          optional; when present, the new artifact's starting store value
  README.md          optional; context for agents, copied with the page
  preview image      see open questions
  ... any other files the page uses (CSS, scripts, images, fonts)
```

The manifest holds:

| Field | Meaning |
| --- | --- |
| `name` | Display name. A new artifact made from the template takes this as its title unless another title is given. |
| `description` | A short sentence describing what the template makes. It appears in the popover and in `tv` output. |
| `version` | A Semantic Version. Bundled-template installation compares it with a minimum (see below). |

Whether a template has data is decided only by whether `data.json` exists. The manifest has no flag for it, so the two cannot disagree.

### Identifier

The template ID is the template's folder name. Templates need a unique identifier, and users must be able to add templates by creating folders. The filesystem already guarantees that two folders in one directory cannot share a name, under its own platform's case rules. Using the folder name gives every template a unique ID without any extra mechanism.

Themes work the same way: the theme ID is the folder name, kept exactly as the filesystem reports it and compared by exact string equality, with no normalization or character rules. The manifest `name` is only for display.

### Validity

A template is valid when:

- `manifest.json` is valid JSON with a non-empty string `name`, a non-empty string `description`, and a valid Semantic Version `version`;
- `index.html` is a readable file at the folder root;
- `data.json`, when present, parses as JSON.

Following themes, folders whose names begin with `.` are ignored, which covers backups, and ordinary files at the top level are ignored. Every other folder produces either a valid template or one error message naming all of its problems. Unknown manifest fields are allowed and ignored.

## Using a template

Using a template creates a new artifact in a channel:

1. Television copies the template folder into a new folder under `<home>/artifacts/`, except `manifest.json` and `data.json`, which describe the template rather than the page. `README.md` is copied, so the agent that adapts the artifact has the template author's context. The bundled onboarding channels already copy their content into `<home>/artifacts/`, so Television-created artifact content has an established home there.
2. Television creates an ordinary path artifact pointing at that folder. Its title is the template's `name` or the title the caller supplied.
3. When the template has `data.json`, or the caller supplied replacement data, Television writes that value as the first write to the artifact's own store, the way the onboarding installer seeds stores.
4. The artifact is placed in the target channel, and its ID is returned.

The result is an ordinary artifact. The agent edits the copied files; the template is untouched. Deleting the artifact behaves as for any path artifact: the record goes away and the copied files stay on disk.

## Bundled templates and installation

Television ships bundled templates in its package and installs them into `<home>/templates/` at server boot, using the theme rules:

- A bundled template is installed when its ID is absent and Television has never handled that ID for this home. Once handled, an absent template stays absent: Television treats the absence as the user's deletion.
- When something exists at that ID, Television keeps it if it is a valid template whose version is at or above the bundled minimum, and replaces it otherwise.
- Before replacing, Television copies the existing folder to a hidden, timestamped backup beside it (`.<id>.backup.YYYY-MM-DD-HH-MM-SS`), which discovery ignores.
- Handled IDs are recorded in a state file, as `state/bundled-themes.json` does for themes.

The minimum version is raised only when compatibility is genuinely at stake, for example when the template depends on a Television interface that changed. A routine improvement to a bundled template does not reach users who already have it, which protects their customizations.

## Finding templates: scan on every request

Every `tv` template command and every opening of the popover scans the templates folder again. Television therefore keeps no stored template list: each request scans and returns the result. Themes keep a stored list because one theme is selected and in use between scans; templates have no equivalent, and the folder is small enough that scanning is cheap.

A scan returns the valid templates and the invalid folders with their errors, in the theme registry's shape:

```ts
interface Template { id: string; name: string; description: string; version: string; hasData: boolean; path: string }
interface TemplateScan { templates: Template[]; errors: { folder: string | null; error: string }[] }
```

(The exact type belongs in the architecture spec; this shows what the list contains.)

## CLI

Rupert decided on October 15, 2026 that artifact creation becomes one command, with a template as one of its sources:

```bash
tv create-artifact --channel <id> (--path <path> | --url <url> | --template <id>)
                   [--title <title>] [--data <json> | --data-file <path>]
                   [--before <artifact-id> | --after <artifact-id>]
                   (--focus-artifact | --no-focus)
```

- Exactly one source: `--path`, `--url` or `--template`. Each keeps the validation the old commands had.
- `--title` is required with `--path` and `--url`, and optional with `--template`, where it defaults to the template's `name`.
- `--data` or `--data-file` replaces the template's `data.json` as the starting store value, and is allowed only with `--template`. `--data` takes the JSON text itself; `--data-file` reads it from a file, where `-` means standard input. The command refuses both at once, as the JSON store commands refuse a value and `--file` together. Television checks that the data is valid JSON and within the store's 1 MiB limit before it creates anything, so bad data never leaves a half-made artifact.
- `--before` and `--after` place the new artifact beside another one, for every source.
- `tv create-path-artifact` and `tv create-url-artifact` are removed, with no aliases.

Template commands are grouped:

- `tv templates list` prints the scan as JSON: each valid template's ID, name, description, and folder path, plus the invalid folders and their errors.
- `tv templates path` prints the templates folder of the selected home, without contacting the server, as `tv themes-path` does for themes.

## Notes for implementation

- Removing `tv create-path-artifact` and `tv create-url-artifact`: verify once, during implementation, that both now fail as ordinary unknown commands. This is a check on the build, not a permanent test, and the spec does not list removed commands. (Rupert, October 15, 2026.)
- Delete the two tests in `packages/cli/test/cli.test.ts` that assert older retired command names fail as unknown commands ("keeps deferred commands absent behind the directive contract" and the historical-names test). The spec no longer lists removed commands, so nothing backs them. (Rupert, October 15, 2026.)

## The Templates popover

The navbar's Artifact skills trigger and popover are replaced by a Templates trigger and popover. Its UI spec is piloted in `storybook/spec/templates-popover/`. Rupert decided on October 15, 2026:

- Opening the popover rescans the templates folder.
- Each valid template appears as a tile with its thumbnail and name. Descriptions are not shown; search matches names and descriptions.
- Clicking a tile, or pressing Return on the highlighted one, creates the artifact in the focused channel, to the right of the selected tab in that browser, and focuses it. Other ways of creating an artifact keep their placement rules.
- If creation fails, the popover shows no error; the CLI reports errors to agents.
- Invalid template folders appear with their errors, as the theme list shows invalid themes.

## Telemetry

Using a template reports a template-use event carrying two properties:

- **source:** `cli` or `ui`;
- **template:** the template ID when it is one of Television's bundled template IDs, otherwise `custom`.

This is because Television makes a best-effort promise not to send user-generated content through telemetry. A template ID is a folder name that anyone can choose, so an arbitrary ID is user-generated content. Television's own bundled IDs are not, because Television chose them. Theme telemetry follows the same rule: its theme state is `none`, a bundled theme ID, or `custom`.

The skills popover's `artifact_skill_prompt_copy_clicked` event is retired with the popover.

## Agent guidance

- **`television` skill intro (`SKILL.md`):** a short section saying templates exist, naming the commands, and telling the agent to check `tv templates list` when the user asks for an artifact. A user may say "macro," "stock artifact," or similar; the agent considers whether a template fits.
- **`templates.md` beside `SKILL.md`:** read when the user asks to create, change, or fix a template. It covers the folder form, the manifest, validity, how to check a template (`tv templates list` reports its errors), the README, the preview image, and how editing a bundled template interacts with version minimums. Theme authoring has the same arrangement with `theming.md`.

## Consequences elsewhere

- **Navbar and settings specs.** The navbar UI spec and the themes product spec ("a settings control immediately after the skill picker") refer to the skill picker. Those references change.
- **The word "template" already has a meaning in the specs.** The glossary (`specs/terms.md`) defines *template* as a UI spec's Liquid file that owns the authoritative markup for a surface, owned by `specs/spec-ui.md`. The specs for this feature need a term that cannot be confused with it, such as *artifact template*, while the interface can still say "Templates".
- **Where the specs would live.** A product spec (`product/templates.md`), an architecture area (`arch/templates/` for the package form, the scan, bundled installation, the CLI integration, and the authoring document), a UI spec replacing `ui/app/skill-selector/`, and edits to the CLI product spec, the navbar, telemetry, terms, and the migration map.

## Not in scope

- A UI for editing, deleting, or installing templates. People and agents work in the folder directly, as with themes.
- Sharing templates between Television installations.
- Recording on an artifact which template it came from. Nothing in this proposal uses such a record, and it would be unreliable: the copy can be edited until it no longer matches the template, and a template ID is a folder name that can be renamed or reused. (Decided by Rupert, October 15, 2026.)

## Open questions

### Template image (decided in part)

Rupert decided on October 15, 2026:

- A template may carry an image for the popover. It is optional: a template without one is valid, and the popover shows a neutral placeholder with the template name.
- The image stays in the template folder, like the manifest, and is not copied into the new artifact.
- A wrong size or shape does not make a template invalid.

Settled with the popover design (Rupert, October 15, 2026): the image is `thumbnail.png`, portrait, ideally 4:5, such as 400 by 500 pixels. The Templates popover's UI spec, piloted in `storybook/spec/templates-popover/`, owns how it is shown.

### Which templates ship first (decided)

Rupert decided on October 15, 2026 that the template mechanism is specified and built first with one simple example template, enough to prove that copying, seeding the store and live updates work. The real templates are specified next. This branch does not merge or ship until they are specified and built; Example is not meant to ship alone. The intended set is Calendar, Table, Checklist and Markdown:

- Checklist replaces the Tasks card in today's skills popover.
- The Markdown template is an ordinary folder template whose page is an interactive Markdown editor like Television's existing one, keeping its text in the artifact's JSON store instead of in a Markdown file.
- Markdown file artifacts keep opening in Television's existing Markdown editor; only the popover's button for it goes away.

Deleting the last channel immediately creates and focuses an empty channel named "New channel", so there is always a focused channel to create an artifact in. (Decided by Rupert, October 15, 2026.)

### Naming of the copied folder (decided)

Today agents choose artifact folder names themselves, and they use readable names built from the title. Using a template is the first case outside onboarding where Television names the folder, because no agent is involved when a person uses one from the popover. Rupert decided on October 15, 2026 to follow the agents' convention:

- The folder name is readable: the artifact's title when it is created, made safe for a folder name, plus a short random suffix, such as `checklist-k3x9q`. The title is the template's `name` unless the caller supplied one.
- The suffix keeps names unique when the same template is used more than once.
- Retitling the artifact later does not rename its folder.

The exact rule for making a title safe belongs to the architecture spec.

### A note on the theme precedent for flags

Themes pair each optional script with a manifest flag. A flag set to `true` without its file is invalid, and a file without its flag is ignored, not invalid. There the flag does more than signal presence: `false` switches off a script that is present, which matters because a script runs code in the app. `data.json` has no such need, which is why templates use presence alone.

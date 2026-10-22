# Artifact templates — proposal

**Status:** the original mechanism was approved on October 15, 2026 and implemented on `feat/artifact-templates`. This document now incorporates the October 22 decisions for linked templates and the Toolbox. Those revisions are a draft for review on `feat/linked-templates`; earlier implementation and validation do not cover them. The governing contracts are in [artifact templates](../../specs/product/templates.md) and [template architecture](../../specs/arch/templates/index.md).

## Model

An artifact template is an installed folder describing a reusable artifact. A folder template has an HTML page and supporting files. Using it creates an ordinary path artifact pointing at that installed folder, without copying. Each artifact has its own store. Editing the template folder updates every linked artifact live, while store writes affect only the artifact that owns that store.

An agent links when only data needs changing. For page-file changes that apply to one new artifact, `--copy` creates a separate folder under `<home>/artifacts/`. Its name follows the existing title-derived slug and random suffix rule; retitling does not rename it. Copies omit `manifest.json` and include the page, README, icon assets, and other supporting files. The Toolbox always links folder templates.

For an existing linked artifact, the agent copies its folder and runs `tv update-artifact --id <id> --path <copy>`. The artifact keeps its ID and store. This uses existing file and artifact operations and needs no detach command. An agent must never edit the installed template for a request about one artifact. When asked to change a template, the agent tells the person that all artifacts linked to that folder receive the change.

A URL template has manifest `url`, an absolute HTTP or HTTPS address. It creates an ordinary URL artifact without a store on this server; `index.html` is unnecessary. Manifest `dataSchema`, request data, and `copy` are errors for URL templates before anything is created. The field stays `url`; Web App Manifest `start_url` has different same-origin semantics.

An artifact records no template-origin field. The path of a linked artifact identifies its installed folder. Deleting an artifact leaves its page files and store on disk. Deleting or moving an installed template folder breaks linked artifacts; their records and stores remain.

## Installed folder and data

Templates live directly inside `<home>/templates/`, one folder per exact template ID. The manifest requires non-empty `name` and `description` strings and a Semantic Version `version`. A folder template includes readable `index.html`; other page assets and an adapting-agent `README.md` may accompany it. A description remains required for agents even though the Toolbox shows names only.

Templates supply no starting data. The caller may supply one starting value, including explicit `null`; without one, the store starts unwritten. The server validates that value against the store rules and 1 MiB limit before creation, then writes it within the creation request.

Optional manifest `dataSchema` embeds a JSON Schema Draft 2020-12 schema describing the store value and guiding agents. It is a schema object or boolean, not a file path; references resolve within that schema. An invalid `dataSchema` invalidates the template. The server validates caller-supplied starting data against it before creating anything; later store writes do not enforce it. Schema `default` annotations do not supply values. A page treats missing data as its empty state and renders defaults for missing fields in partial data, without writing defaults on load.

A new schema must accept every value accepted by the previous schema, and the page must still render those values. Existing linked artifacts keep their data while the shared page changes. This is an authoring responsibility, without automatic schema-evolution checks or store migrations.

Optional manifest `display` retains width, height, full-screen, and transparency settings. Creation options override the corresponding manifest fields, followed by the shared defaults. Each field is independent, including explicit false values. Later changes to these manifest settings leave existing artifact display settings unchanged. Linking shares page files, not later manifest display changes.

## Discovery and CLI

The server builds and watches an in-memory scan at serving boot. The app loads it and the required icons at startup, replaces it on `templates-changed` pushes over the existing `/events` WebSocket, and opens Toolbox immediately from that cache. CLI list, show, and creation always scan again so an edit is visible immediately. Watcher failure logs a warning and makes the app request a fresh scan on each Toolbox opening; [template architecture](../../specs/arch/templates/index.md#^artifact-template-watch-fallback) owns that fallback. Dot-prefixed folders and top-level ordinary files are ignored. Every other folder yields either a valid record or an error naming its defects. The [scan contract](../../specs/arch/templates/index.md#discovery) owns sorting and failure details.

- `tv templates list` prints compact JSON summaries and folder errors. Summaries contain only `id`, `name`, `description`, and optional `url`. The presence of `url` identifies a URL template.
- `tv templates show <id>` prints the full validated record from a fresh scan, including `version`, the installed folder `path` for both folder and URL templates, and any `dataSchema`, icons, and display options. Both CLI commands omit app metadata such as `hasIcon`. Agents use list to choose and show before preparing or writing data.
- `tv templates path` prints the selected home directory for templates without contacting the server.
- `tv create-artifact` takes exactly one of `--path`, `--url`, and `--template`, a channel, and an explicit focus decision. `--title` is required for a direct path or URL and defaults to the template name for a template.
- `--copy` is opt-in for folder templates. `--data` or `--data-file` supplies the sole optional starting value; `--data-file -` reads standard input. These options require a folder template. Existing placement and display options apply.

Schema errors name the failing field and tell the agent to run `tv templates show <id>`. The existing server creation route remains responsible for validation, registration, placement, and starting data. It registers the installed folder by default, copies when requested, or registers the URL. Once copying or registration starts, nothing created is removed on failure; errors identify the target and any attempted artifact registration so the agent can inspect what remains before retrying.

## Icons

Manifest `icons` uses [W3C Web App Manifest form](https://www.w3.org/TR/appmanifest/#icons-member): local relative `src`, plus optional `sizes`, `type`, and `purpose`. SVG and PNG are supported. For the 20px slot, selection prefers SVG or `sizes: "any"`, then the smallest PNG at least 40px on both axes, then the largest. Unusable entries, including paths whose real location leaves the folder, are ignored. The authenticated icon route serves the selected local file by template ID.

An agent creating a URL template fetches the best site icon once: SVG or a large PNG declared by the page or its web app manifest, with `/favicon.ico` converted to PNG as fallback. It saves the result locally and declares it in `icons`. The server and app never fetch site favicons.

Supplied icons are drawn as-is, without a circle or background. Otherwise, the Toolbox shows the first character of the name, uppercase and white in a filled circle; the template ID deterministically selects the colour. [The Toolbox spec](../../specs/ui/app/toolbox.mdx) owns the palette and hash.

## Toolbox

The navbar popover is called Toolbox; CLI commands, template folders, APIs, and agent terminology keep “template.” The existing ghost icon button with the `skills` icon remains before Settings. The redesigned surface is specified by [MDX](../../specs/ui/app/toolbox.mdx) and its stories in `storybook/spec/toolbox/` under the [adopted UI policy](../../specs/spec-ui.md).

The panel opens straight to search and lists an icon and name per row. It has no heading or introduction. Search matches names only; descriptions remain in agent records. Rows use 20px icons, standard body text in medium weight, 7px vertical padding, and a 12px icon–name gap. The search field has 5px vertical padding, a muted background, no border, and no focus ring. The panel is about 300px wide. The UI spec owns the complete appearance, keyboard behavior, accessibility, and state copy.

Clicking a row or pressing Return on the highlight creates a linked folder artifact or a URL artifact through the server route, to the right of the selected tab in the focused channel, then focuses it. An empty channel receives its only page. The current creation failure and focus behavior remains. Before the first list arrives, the panel body is blank with the search field visible. Empty, invalid-folder, unreadable-directory, and no-match states remain; later updates keep the previous list visible until replaced.

Rows describe icon, name, and activation supplied by an item source; artifact templates are the only source today. This introduces no new item mechanism, API, or kind field.

## Bundled templates

The [bundled inventory](../../specs/arch/templates/bundled-templates.md) owns the names and versions. A valid installed copy at or above the minimum is preserved, including local edits, even when the bundled source version changes. A missing unhandled template is installed; an invalid or older occupant is backed up and replaced at the same path. That path must remain stable because linked artifacts use it. An interrupted replacement may leave the path absent until the next serving boot restores it. Deliberate deletion remains respected. Detecting local changes is deferred.

The current bundled page shows its default message when the store is empty and gains manifest `dataSchema`; the versions stay unchanged. The intended later set remains the subject of [the real-templates proposal](real-templates-proposal.md).

## Telemetry and skill distribution

Template-use telemetry stays as specified on this branch: `source` is `cli` or `ui`, and `template` is a bundled ID or `custom`. Artifact data, template names, paths, URLs, and custom IDs are not sent. Linking and copying add no new telemetry properties.

The `television` skill introduces templates and the link-versus-copy choice; `templates.md` teaches data, schemas, authoring, icons, and detaching. The earlier distribution decision remains: only `television` is installed, existing skills are not removed, and the former `tv-calendar`, `tv-table`, and `tv-tasks` sources remain because onboarding uses their browser components.

## Earlier implementation decisions retained

The original consolidation removed `tv create-path-artifact` and `tv create-url-artifact` without aliases. Their absence was checked once during implementation, rather than covered by permanent retired-command tests. The original task and validation history remains in [the task record](templates-task.md); it does not validate the linked-template draft.

Deleting the last channel continues to create and focus an empty “New channel,” so the Toolbox always has a focused channel available. This work adds no UI for template editing, deletion, installation, or sharing between Television installations.

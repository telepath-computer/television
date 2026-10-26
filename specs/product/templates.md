*Artifact templates: copied folder artifacts, URL artifacts, starting data, discovery, and the bundled set.*

# Artifact templates

An *artifact template* is a reusable starting point for an artifact, kept in an installed folder. A folder template supplies a working HTML page and supporting files, with optional starting data; using it creates an ordinary path artifact pointing at a copy of those files. A URL template supplies a web address and creates an ordinary URL artifact. The [template architecture](../arch/templates/index.md) owns the folder format and discovery contract.

## Finding and using an artifact template

Artifact templates live as folders directly under `<home>/templates/`, where [the Television home](./cli.md#^cli-home) is selected. People and agents may edit those folders or add their own. The server scans at serving boot and watches for edits. The app loads and retains that list and its icons, receives updates as folders change, and opens Toolbox immediately from the cache. CLI list and show commands, and every creation request, use a fresh scan. If observation fails, the server logs a warning and Toolbox requests a fresh scan on each opening ([fallback](../arch/templates/index.md#^artifact-template-watch-fallback)). Valid templates are available for creation; an invalid folder is reported with an error rather than offered for use. The [scan contract](../arch/templates/index.md#discovery) owns the exact results.

Using a folder template copies the page and supporting files into a fresh folder under `<home>/artifacts/` and registers an ordinary path artifact pointing at that copy. Each artifact has its [own store](./resources/resources.md#^rs-own-store). Later edits to the template files or `data.json` affect only artifacts created afterwards; moving or deleting the template leaves existing artifacts intact. ^artifact-template-result

The folder name follows the [title-based naming rule](../arch/templates/index.md#^artifact-template-copy-name). Retitling the artifact does not rename the folder. Agents edit the copied page files directly to change one artifact; ordinary [folder live update](./artifacts.md#^af-folder-live-update) applies.

A URL template creates an artifact at the manifest address, subject to ordinary [URL-artifact behavior](./artifacts.md#external-web-pages-in-a-browser-demo-mode). It has no store. Caller data, `data.json`, and manifest `dataSchema` are errors for a URL template before anything is created. Changing the template address later does not repoint artifacts already created from it.

Every resulting artifact has a generated ID and the manifest name as its title unless the caller supplies a title. The record holds no template ID or other origin field. Deletion follows [ordinary artifact semantics](./artifacts.md#^af-delete-semantics): its record is removed, while any local folder and store remain on disk.

A template may declare *display options*: width, height, full-screen state, and [transparency](./artifacts.md#^af-transparent) for each new artifact. Each value is chosen separately: a value supplied at creation takes precedence, followed by the manifest value, then the shared defaults ([layout](../arch/layout/index.md#^ly-creation-display)). An explicitly supplied `false` takes precedence over `true` in the manifest. The [creation command](./cli.md#^cli-create-display) can supply values for any source; Toolbox uses the manifest values or defaults. These settings can be changed after creation; existing artifacts retain no link to manifest display options. ^artifact-template-display-options

## Starting data and schemas

A folder template may carry a starting store value in `data.json`. Caller data, including an explicit `null`, replaces that value entirely, with no merging. Otherwise creation uses `data.json` when present, or leaves the store unwritten. Optional manifest `dataSchema` describes the store value for agents and validates `data.json` during the scan and caller data on the server before anything is created; later store writes do not enforce it. The [schema contract](../arch/templates/index.md#^artifact-template-schema) owns the dialect and validation rules.

Pages treat missing data as their empty state and render defaults themselves for an empty or partial store. They must not write defaults on load: that could overwrite an agent write or fail for a read-only share viewer. Schema `default` annotations never supply starting values.

Creation writes any selected starting value in the same server request and succeeds only after every step completes and that value is durably saved. Once copying or registration starts, Television removes nothing it created. A failure or uncertain outcome is reported with enough information to inspect what remains before retrying; the [creation contract](../arch/templates/index.md#^artifact-template-copy) owns those details. The page uses the [resource SDK](../arch/resources/sdk.md), and an agent uses [`tv resource json`](./resources/json-store.md#^js-cli), to work with the store. ^artifact-template-data

## Access from the app and CLI

Agents use [`tv templates list`, `tv templates show <id>`, `tv create-artifact --template`, and `tv templates path`](./cli.md#artifact-template-commands). The list contains only ID, name, description, and optional `url`; `show` includes the installed folder path for either type of template, version, and any display options, icons, or `dataSchema`. The presence of `url` identifies a URL template.

People use the Toolbox popover in the navbar. Activation creates a copied folder artifact or URL artifact in the focused channel, to the right of the selected tab in that browser, and focuses it. With no tabs, the artifact becomes the only page in the channel. Toolbox uses the starting data from the template; without `data.json`, a folder artifact starts with an unwritten store. The [Toolbox UI spec](../ui/app/toolbox.mdx) owns its appearance and interaction. ^artifact-template-popover

## Bundled artifact templates

Television ships bundled artifact templates; [bundled template content](../arch/templates/bundled-templates.md) owns the inventory and links to each template's own specs. Each template has an architecture spec for its display options and store contract, and a UI spec for its page. On serving boot, Television installs an unhandled bundled template. A handled folder that the user deletes stays absent. A valid installed copy at or above the minimum version is preserved, including user edits; an invalid copy or one below the minimum is backed up and replaced at the same path. A routine bundled version change does not overwrite a usable installed copy. An interrupted replacement can leave the folder absent until the next serving boot restores it. [Bundled installation](../arch/templates/bundled-installation.md) owns the minimum-version, backup, and recovery contracts. ^artifact-template-bundled

## Scope

People and agents manage templates in their folders. Television provides no UI for editing, deleting, installing, or sharing templates between installations.

*Proves linked, copied and URL template use through built CLI commands and the real app, including data isolation and principal failures.*

# Artifact templates — proof

Proves [specs/product/templates.md](../../specs/product/templates.md).

## Coverage model

Acceptance walks use a built `tv` process, a running authenticated server in a temporary home, real files and stores, and a real browser where live pages matter.
Authored folder templates import the served resource SDK; URL-template fixtures point to a local HTTP page. Setup creates channels/artifacts through production commands or HTTP.
The linked-artifact walk and the [resource ownership walk](./resources/resources.md#^rs-ac-shared-folder) share one journey: two artifacts share files, keep separate data, and one can be detached without losing its store.
A copied-artifact walk proves the explicit copy choice and ordinary deletion. A URL walk proves the separate URL outcome without a store.
Refusal and partial-failure walks prove the principal unsuccessful outcomes at the same command boundary.
[Template architecture](../arch/templates/index.md) carries schema, icon, scan, cache-ordering, placement, display and failure-step breadth at cheaper boundaries.
[CLI architecture](../arch/cli/index.md) carries argv and flat list/show projection; [product CLI](./cli.md) carries process input and focus-failure output.
[Toolbox](../ui/app/toolbox.md) carries interaction, appearance and UI failure behavior; the creation journeys here prove its real server outcome.
[Reload/navigation](../arch/artifact-frame/reload-navigation.md) carries shared watcher mechanics, and [bundled installation](../arch/templates/bundled-installation.md) carries minimum-version recovery.
[Bundled Example](../arch/templates/bundled-templates.md) demonstrates page defaults without writes; compatibility of authored template revisions is reviewed, not enforced by a runtime migration system.
No mechanism is mocked in these walks except the standing CSS-motion override, which forfeits CSS motion only to the owning UI proofs.

## Test hooks

No production test hook is needed. Temporary homes, template files, caller data and a local URL target are fixtures.

## Discovery and creation

- **Acceptance** (spawned built CLI → real server/filesystem): under [discovery](../../specs/product/templates.md#finding-and-using-an-artifact-template) and [CLI access](../../specs/product/templates.md#access-from-the-app-and-cli), list immediately reflects added/repaired/edited folders and invalid-folder errors; show resolves the exact ID and returns the current full folder or URL record including its installed path and optional schema. The list contains only summaries and errors; show contains no app metadata. *(test to be written)* ^templates-ac-discovery
- **Acceptance** (built CLI and real browser → server, shared folder and SDK): under [linked results](../../specs/product/templates.md#^artifact-template-result), two default creations return distinct ordinary artifact IDs pointing at the installed folder, without an artifact-directory copy or origin field. The manifest name supplies one title and a caller supplies the other. Caller data is separate, an unseeded artifact stays unwritten, and both open pages update when the shared source is edited. Removing/moving the folder makes those paths unavailable without deleting records or stores; restoring it restores content. Share this walk with [resource ownership](./resources/resources.md#^rs-ac-shared-folder). *(test to be written)* ^templates-ac-cli-create
- **Acceptance** (built CLI → real server/filesystem and browser page): under [copying and detaching](../../specs/product/templates.md#finding-and-using-an-artifact-template), `--copy` creates a fresh independent folder; source edits do not alter it, and edits there do not alter the source. Retitling preserves its path. Copy an existing linked folder to a fresh location and use `update-artifact --path` to detach; the ID, store pointer and value survive, and later template edits affect only artifacts still linked. Deleting a created artifact removes its record while retaining its local folder and store. The detach/store portion is the same journey as [resource ownership](./resources/resources.md#^rs-ac-shared-folder). *(test to be written)* ^templates-ac-copy-detach
- **Acceptance** (spawned built CLI → real server; local HTTP target fixture): under [URL templates](../../specs/product/templates.md#finding-and-using-an-artifact-template), creation returns an ordinary URL artifact at the trimmed manifest address, with the chosen title, no store and no origin field. A later manifest address edit does not repoint it. URL page display follows [ordinary artifact coverage](./artifacts.md), not a separate external-site compatibility matrix. *(test to be written)* ^templates-ac-url-create
- **Acceptance** (real browser → Toolbox → authenticated server): under [Toolbox creation](../../specs/product/templates.md#^artifact-template-popover), activating a folder item creates a linked page immediately after the selected tab in the focused channel and focuses it; the page loads and its store is unwritten. In an empty channel it becomes the only page. A URL item creates and focuses an ordinary URL artifact. Observe unmodified requests: `source: "ui"`, selected-tab placement, no `copy`, `data` or `display`. *(test to be written)* ^templates-ac-ui-create

## Display values

The following pairs extend the CLI and browser journeys above rather than adding a full journey for each display field.

- **Acceptance** (built CLI → real server): under [display precedence](../../specs/product/templates.md#^artifact-template-display-options), command width and explicit false full-screen override only those manifest values; manifest height and other values remain. Later manifest edits leave the saved display settings unchanged. Existing `test/node/cli-acceptance.test.ts` “lets a template creation option override only its own display value” contains these checks but relies on automatic copying and needs adaptation. *(test to be written)* ^templates-ac-display-cli
- **Acceptance** (same CLI journey): under [transparency precedence](../../specs/product/templates.md#^artifact-template-display-options), `--no-transparent` overrides manifest true, get-artifact omits the false field, and an ordinary later transparency update survives a manifest edit. *(test to be written)* ^templates-ac-transparent-cli
- **Acceptance** (real browser → Toolbox → server): under [Toolbox display defaults](../../specs/product/templates.md#^artifact-template-display-options), a partial manifest determines width/full-screen while omitted height uses the shared default; the request omits display. *(test to be written)* ^templates-ac-display-ui
- **Acceptance** (same browser journey): under [transparency defaults](../../specs/product/templates.md#^artifact-template-display-options), manifest true creates a transparent frame with its title bar hidden at rest and true in metadata. Fade mechanics remain with [the frame proof](../ui/app/artifact-frame/index.md#^af-ui-ac-transparent-hover). *(test to be written)* ^templates-ac-transparent-ui

## Refusal and recovery

- **Acceptance** (spawned built CLI → real server, invalid folder and valid channel fixtures): under [discovery refusal](../../specs/product/templates.md#finding-and-using-an-artifact-template), invalid template creation reports its scan error without an artifact; removing that folder makes the same ID report not found. *(policy-grade test: `test/node/cli-acceptance.test.ts`, “rescans authored templates and refuses an invalid or removed folder”, refusal checks only)* ^templates-ac-cli-refusal
- **Acceptance** (built CLI → real server; schema-bearing folder and URL-template fixtures): under [starting data](../../specs/product/templates.md#starting-data-and-schemas), schema-invalid caller data is refused before creation with a field/reason and `tv templates show <id>` guidance; URL-template data or copying is refused before creation. Supplying valid data, including null where allowed, succeeds and is durably readable; no supplied data leaves the store unwritten despite required fields or schema defaults. Later ordinary store writes are not restricted by the template schema. *(test to be written)* ^templates-ac-data-refusal
- **Acceptance** (built CLI → real server; caller-supplied data and post-boot file at the resource-directory path as a real obstruction): under [creation failure](../../specs/product/templates.md#^artifact-template-data), first-write failure after registration exits 1 without success lines and identifies the installed/copied target, generated ID and unconfirmed store step. Earlier record/content remains inspectable. Exercise default linking and explicit copy; [architecture](../arch/templates/index.md#^templates-t-failure) covers other failing steps. *(test to be written)* ^templates-ac-cli-post-copy-failure

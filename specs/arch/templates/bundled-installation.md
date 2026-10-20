*Bundled artifact template installation: package validation, minimum-version replacement, backups, and handled IDs per Television home.*

# Bundled artifact template installation

Television ships its [bundled artifact templates](./bundled-templates.md) as folders in the server package and installs them into each serving home. This spec owns the server package source and validation, the minimum-version rule, the handled-IDs state file, and replacement and backup behavior. [Template architecture](./index.md) owns the installed folder validator and request-time scan; [bundled template content](./bundled-templates.md) owns the inventory, initial manifest and data, page, and README guidance; [CLI architecture](../cli/index.md#build-and-packaged-asset-layout) owns the standalone package copy and resolver.

## Bundled packages

The source folders live at `packages/server/assets/templates/<template-id>/` and follow the [installed folder contract](./index.md#^artifact-template-package). The server build checks that the tree contains exactly the [bundled IDs](./bundled-templates.md#^bundled-artifact-template-inventory), validates every folder with the same validator, and copies the complete tree into `packages/server/dist/templates/`. The [CLI build](../cli/index.md#build-and-packaged-asset-layout) carries that tree into the published package and resolves it for serving. A token-only store installs no templates.

Each bundled ID has the [minimum installed Semantic Version](./bundled-templates.md#^bundled-artifact-template-inventory) stated with its initial manifest. The bundled source's manifest version must meet its minimum. These values follow Semantic Versioning 2.0.0 precedence. Raising a minimum is for compatibility needs; a newer bundled source by itself does not replace a valid installed template that meets the minimum. The shape of the build configuration is code-governed. ^bundled-artifact-template-minimum

## Installation state

Each home may contain `<home>/state/bundled-templates.json`. Television writes:

```ts
interface BundledArtifactTemplateState {
  version: 1;
  installedTemplateIDs: string[];
}
```

The array contains unique, exact IDs in ascending `"en"` locale order. An ID means Television installed bundled content or recognized an existing valid folder it kept. An absent destination for a listed ID is treated as a user deletion. The state records neither the installed version nor the origin of a folder. A missing state file means no ID has been handled. Malformed JSON, a version other than 1, a non-string ID, a duplicate, an unsorted list, or an unknown field makes the file invalid. Television rewrites valid state through a temporary file in the same directory and renames that file into place. An unreadable or invalid state file produces a warning and leaves bundled-template handling and the file untouched for that boot. ^bundled-artifact-template-state

## Serving boot

On each serving boot, before ordinary template requests are served, Television handles each bundled ID. If its destination is absent and the ID is unhandled, it copies in the bundled folder. If its destination is absent and the ID is handled, it leaves it absent. When something exists at the ID, it keeps a valid artifact template whose version meets the minimum and replaces any other occupant. Keeping a pre-existing valid folder marks the ID handled, whether Television installed it or not. ^bundled-artifact-template-replacement

Before replacement, Television copies the existing content to an unused hidden sibling named `.<template-id>.backup.YYYY-MM-DD-HH-MM-SS`. The [scan](./index.md#^artifact-template-scan) ignores that sibling. Only after backup succeeds does Television replace the destination with the complete bundled folder; the previous content or the complete replacement remains at the destination after a failure or interruption. A warning reports a backup or replacement failure, and the next boot applies the same rules again. A failure for one ID does not prevent handling the others. After an install, keep, or replacement succeeds, Television records the handled ID. If the state write fails, a later boot repeats the rule. ^bundled-artifact-template-backup

Removing a template from the bundled set leaves already installed copies available as user-owned artifact templates.

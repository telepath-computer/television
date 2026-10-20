*Artifact template architecture: installed folder validation, request-time discovery, thumbnail delivery, and creation of an ordinary path artifact from a copy.*

# Artifact template architecture

Television reads artifact templates from the selected home's `templates/` directory. This spec defines the folder contract, the result of a scan, and how using a template produces an artifact. [Product behavior](../../product/templates.md) owns what people and agents can rely on; [bundled installation](./bundled-installation.md) owns how Television places its own templates in that directory; [bundled template content](./bundled-templates.md) owns the shipped templates.

## Installed folder contract

```text
<home>/templates/<template-id>/
  manifest.json       required
  index.html          required
  data.json           optional starting store value
  README.md           optional context for an agent adapting the copy
  thumbnail.png       optional image shown for the template
  ...                 supporting files
```

The immediate folder name is the artifact template ID. It is preserved exactly as the filesystem reports it, with no normalization, reserved-value check, or character-pattern rule. Every lookup and comparison uses exact string equality. The manifest display name is separate from that ID.

```ts
interface ArtifactTemplateManifest {
  name: string;        // non-empty
  description: string; // non-empty
  version: string;     // a valid Semantic Versioning 2.0.0 version
  display?: ArtifactDisplayOptions; // the layout type and its value rules
}
```

`ArtifactDisplayOptions` and its value rules are [the layout's](../layout/index.md#^ly-creation-display). An invalid `display`, or an invalid field in it, invalidates the folder, with an error naming that field. Unknown fields both at the manifest root and inside `display` are accepted and omitted from the validated record.

An artifact template is valid when `manifest.json` is readable JSON matching `ArtifactTemplateManifest`; `index.html` is a readable file at the folder root; and `data.json`, when present, parses as JSON and satisfies the store's [value rules](../resources/json-store.md#^js-arch-values) and [1 MiB limit](../resources/json-store.md#^js-arch-limits). If its parsed value exceeds that limit, the folder is invalid and its error says so. Presence of `data.json` alone determines `hasData`; the manifest has no data flag. An optional `thumbnail.png` is the template's image; it stays in this folder, and its absence, size, or shape never invalidates the template. `hasThumbnail` is true only when that file is readable and its real location is inside the template folder's real location; it does not validate the image contents. The [Templates UI spec](../../ui/app/skill-selector/index.md) owns how it is shown and its recommended dimensions. ^artifact-template-package

## Discovery

A scan reads every template folder and returns:

```ts
interface ArtifactTemplate extends ArtifactTemplateManifest {
  id: string;
  hasData: boolean;
  hasThumbnail: boolean;
  path: string; // absolute installed folder path
}

interface ArtifactTemplateScan {
  templates: ArtifactTemplate[];
  errors: { folder: string | null; error: string }[];
}
```

Every request to list artifact templates and every opening of the Templates popover scans folders directly inside `<home>/templates/` again. There is no stored registry. The scanner ignores dot-prefixed folders, including backups, and ordinary files at that level. Each other folder produces either one `ArtifactTemplate` or one error naming all defects found. Valid records sort by display name and then ID, using `localeCompare` with `"en"`; folder errors sort by folder name in the same locale. A failure to read the templates directory produces an error with `folder: null`. ^artifact-template-scan

The list request returns `ArtifactTemplateScan`, which the CLI prints as [its public output](../../product/cli.md#^cli-templates-list). The create request resolves the supplied exact ID from a fresh scan. An invalid folder is refused with its scan error. If a successful scan finds no folder with that ID, the request is refused with a plain not-found error naming the ID. A scan-wide read failure keeps its scan error. No watcher or stored list participates in discovery.

## Creating an artifact

The server accepts an authenticated creation request with this contract:

```ts
interface CreateTemplateArtifactRequest {
  templateID: string;
  channelID: string;
  title?: string;
  data?: JSONValue; // presence replaces data.json, including when the value is null
  display?: ArtifactDisplayOptions; // supplied fields override the template's display
  before?: string; // an artifact ID: place the new page immediately before it (layout placement)
  after?: string;  // an artifact ID: place the new page immediately after it; at most one of the two
  source: "cli" | "ui";
}

interface CreateTemplateArtifactResult {
  artifactID: string;
  path: string; // absolute path of the copied folder registered as the artifact
}
```

The authenticated `GET /templates` returns `ArtifactTemplateScan`; `POST /templates/artifacts` accepts `CreateTemplateArtifactRequest` and returns `CreateTemplateArtifactResult`. Authenticated `GET /templates/<template-id>/thumbnail.png` resolves the URL-encoded ID against a fresh scan and serves its readable `thumbnail.png` as `image/png`, or returns not found when the template is invalid or has no readable thumbnail. It does not serve a symbolic link whose real location is outside the template folder, following the [folder-artifact boundary](../../product/artifacts.md#^af-folder-files). The shared client exposes them as `TelevisionClient.templates`, one method per route, typed below. The app fetches thumbnail bytes through the shared client only when `hasThumbnail` is true, so the request carries the token. These routes use the server token and send no CORS headers, as other application control routes do ([isolation](../artifact-frame/isolation.md#^iso-routes)). ^artifact-template-thumbnail-route

```ts
interface TemplateClient {
  list(): Promise<ArtifactTemplateScan>; // GET /templates
  create(input: CreateTemplateArtifactRequest): Promise<CreateTemplateArtifactResult>; // POST /templates/artifacts
  thumbnail(id: string): Promise<Uint8Array>; // GET /templates/<id>/thumbnail.png
}
// On TelevisionClient: readonly templates: TemplateClient
```

For creation from the Templates popover, the client sends the artifact in that browser's selected tab as `after`. It omits placement when the channel has no tabs, so the new artifact becomes its only page ([tab pages](../../product/tab-pages.md#^tp-model)).

The create route checks request fields at runtime against `CreateTemplateArtifactRequest`, including `source` being exactly `cli` or `ui`. A different source or any other malformed field receives the same bad-request response as other application routes, HTTP `400` with `{ error: string }`, before any folder, artifact record, or store is created. A rejected source never reaches telemetry. ^artifact-template-request-validation

`JSONValue` is the [JSON store type](../resources/json-store.md#^js-arch-sdk). The CLI parses `--data` or `--data-file` before making its request. The server validates whichever starting value is selected against the store's [value rules](../resources/json-store.md#^js-arch-values) and [1 MiB limit](../resources/json-store.md#^js-arch-limits) before creating a folder, artifact record, or store. The server also checks that the channel and template are usable, that at most one of `before` and `after` is given, and that any named artifact is on that channel, following the [placement rule](../../product/cli.md#^cli-before-after), before it copies or seeds anything. The JSON text supplied to the CLI is checked for valid JSON and that size limit before it sends a request. ^artifact-template-preflight

The server checks a request's `display` against the [display options contract](../layout/index.md#^ly-creation-display) before copying or creating anything. It combines each supplied field with the template's validated `display` and the shared defaults according to the [product's precedence rule](../../product/templates.md#^artifact-template-display-options). The Templates popover omits `display` from its request.

Television copies the selected template folder into a fresh folder under `<home>/artifacts/`. It excludes `manifest.json`, `data.json`, and `thumbnail.png`; it copies `README.md` and other supporting files. It registers a normal folder path artifact pointing at the copy, with the template name or supplied title, and rechecks placement as it saves the channel layout. Once registration and placement succeed, the server sets any starting value at the root of the artifact's own store through the [resource layer's first-write path](../resources/index.md#^rs-first-write). Creation succeeds when these steps complete and any starting value is durably saved.

Once copying starts, Television removes nothing it created. If the copy or any later step fails or has an uncertain outcome—including artifact registration, saving the channel layout, and writing starting data under the [uncertain-save rule](../resources/index.md#^rs-arch-uncertain-save)—the request fails. Its error names the destination folder path, includes the generated artifact ID whenever registration was attempted, and says which step could not be confirmed. A successful response returns the generated ID and copied folder path. The artifact record carries no template ID or other origin field. [Ordinary path-artifact behavior](../../product/artifacts.md) governs it thereafter. ^artifact-template-copy

The destination folder name is made from the title at creation: lowercase the title, replace each run of characters other than ASCII letters and digits with `-`, trim leading and trailing `-`, and use `artifact` if the result is empty. Limit that slug to 60 characters, cutting at the last hyphen within that limit when possible, then trim any trailing hyphen. Append `-` and five random lowercase base-36 characters. If that path already exists, draw another suffix before copying. The artifact title itself is not shortened. Retitling the artifact does not rename the folder. ^artifact-template-copy-name

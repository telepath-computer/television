*Artifact template architecture: folder validation, starting data and manifest schemas, cached app discovery, fresh CLI scans, icon delivery, and creation of copied folder or URL artifacts.*

# Artifact template architecture

Television reads artifact templates from `templates/` in the selected home. This spec owns the installed folder contract, CLI records, watched app cache, and server operation that creates an artifact from a template. [Product behavior](../../product/templates.md) owns the feature promises; [bundled installation](./bundled-installation.md) owns installation; [bundled template content](./bundled-templates.md) owns the shipped inventory and pages.

## Installed folder contract

```text
<home>/templates/<template-id>/
  manifest.json       required
  index.html          required for a folder template
  data.json           optional starting store value for a folder template
  README.md           optional agent guidance
  ...                 supporting files, including icons
```

The immediate folder name is the artifact template ID. It is preserved exactly as the filesystem reports it, with no normalization, reserved-value check, or character-pattern rule. Every lookup and comparison uses exact string equality. The manifest display name is separate from that ID.

```ts
type JSONSchema = boolean | { [keyword: string]: JSONValue };

interface ArtifactTemplateIcon {
  src: string;
  sizes?: string;
  type?: string;
  purpose?: string;
}

interface ArtifactTemplateManifest {
  name: string;        // non-empty
  description: string; // non-empty
  version: string;     // Semantic Versioning 2.0.0
  display?: ArtifactDisplayOptions;
  url?: string;
  icons?: ArtifactTemplateIcon[];
  dataSchema?: JSONSchema;
}
```

`JSONValue` is the [JSON store type](../resources/json-store.md#^js-arch-sdk). A manifest must be a readable JSON object matching the fields above, with the forgiving [icon rules](#icon-delivery). `ArtifactDisplayOptions` and its value rules belong to [layout](../layout/index.md#^ly-creation-display). Invalid `display` or an invalid field in it invalidates the folder, with an error naming that field. Unknown fields at the manifest root and inside `display` are accepted and omitted from the validated record.

Without `url`, the template is a folder template and requires a readable root `index.html`. With `url`, the trimmed value must be an absolute HTTP or HTTPS URL; it defines a URL template even if `index.html` is present. A URL template with `data.json` or `dataSchema` is invalid, because URL artifacts have no store. The address field is `url`; adopting the Web App Manifest icon format does not adopt its other fields. ^artifact-template-package

Optional `data.json` at the root of a folder template supplies the starting store value. The scan requires it, when present, to be readable valid JSON satisfying the [store value rules](../resources/json-store.md#^js-arch-values), [limits including 1 MiB](../resources/json-store.md#^js-arch-limits), and any `dataSchema` below. Any failure invalidates the folder and is reported with its other scan errors. Caller data must satisfy the same value rules, limits, and schema.

### Store schema

Optional manifest `dataSchema` must be a valid [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12/json-schema-core) schema. A root `$async` declaration is rejected with `$async is not supported in dataSchema`. Omitting `$schema` selects that draft; a declared dialect must be `https://json-schema.org/draft/2020-12/schema`. References resolve only within `dataSchema` itself; Television never loads an external schema or reads the surrounding manifest. A `dataSchema` that fails to compile, including one whose evaluated references do not resolve, invalidates the folder. References inside subschemas that validation never reaches are not checked. Validation uses the [Draft 2020-12 validation vocabulary](https://json-schema.org/draft/2020-12/json-schema-validation); `format` and content-encoding keywords are annotations. Validation neither coerces values nor removes fields, and never derives starting values from `default`. Without a schema, only the store value rules and limits apply. ^artifact-template-schema

The schema describes a store value when one exists. An unwritten store is allowed even if the schema requires fields. The scan validates `dataSchema` and checks `data.json` against it when present; creation validates caller data against it before creating anything. A schema error names the failing schema field or data field (or root) and the reason, including the missing field for a `required` failure, and directs the agent to `tv templates show <id>` for that template. Later writes follow the [JSON store contract](../resources/json-store.md) without template-schema enforcement.

### Icon delivery

Optional manifest `icons` uses the [W3C Web App Manifest icons member](https://www.w3.org/TR/appmanifest/#icons-member) and [image-resource form](https://www.w3.org/TR/appmanifest/#manifest-image-resources): `{ src, sizes?, type?, purpose? }`. Both kinds of template may supply it. Television selects local SVG or PNG files for the small icon slot; neither the server nor the app fetches site favicons.

An entry needs a non-empty string `src`, relative to the template folder. Absolute URLs and root-relative paths are ignored. The file must be readable, and its real path must remain inside the real template folder, including through symbolic links, under the [folder-artifact boundary](../../product/artifacts.md#^af-folder-files). An unusable entry is ignored, never a folder-validation error. A non-array `icons` is treated as absent.

Supported types are `image/svg+xml` and `image/png`. An absent or unusable type hint is inferred from a `.svg` or `.png` extension, case-insensitively; an explicitly unsupported type makes the entry unusable. `sizes` uses space-separated `widthxheight` values or `any`; invalid size hints are ignored. Missing `purpose` means `any`; an entry whose declared purposes do not include `any` is ignored because Toolbox draws icons as supplied, without maskable or monochrome treatment. Unknown fields are ignored.

Selection for the approximately 20px slot prefers SVG or an entry with the `any` size token. Otherwise it chooses the smallest PNG at least 40px on both axes, or the largest PNG if none meets that target. Compare sizes by the shorter dimension; use the best fitting declared size for an entry with several sizes, or the PNG dimensions when no usable size hint exists. An unreadable PNG size ranks after sized PNGs. Ties use manifest order. `hasIcon` means a local file was selected; it does not promise that the browser can decode it or count the generated default icon.

Authenticated `GET /templates/<template-id>/icon` resolves the URL-encoded exact ID through the server cache, repeats selection and the real-path check, and serves the selected file with its SVG or PNG content type. While the watcher is unavailable, it validates that template directly from disk for this response only; an icon request neither changes the scan cache nor publishes an event. Responses use `Cache-Control: no-store`; the app keeps its own bytes under the [cache invalidation rules](#^artifact-template-cache). An invalid template or unavailable icon returns not found. The route accepts no file path from the caller. ^artifact-template-icon-route

The [icon-delivery contract](#^artifact-template-icon-route) owns the authenticated template image route. ^artifact-template-thumbnail-route

The app fetches icon bytes through the shared client when `hasIcon` is true, so the request carries the server token. It displays those bytes as an image with the supplied content type, without inserting SVG markup into the application document. The [Toolbox UI spec](../../ui/app/toolbox.mdx#icons) owns the supplied-icon treatment and default letter icon. The [authoring guidance](./authoring.md) teaches agents to save site icons in URL-template folders.

## Discovery

The agent-facing CLI contracts use these flat interfaces:

```ts
// tv templates list → { templates: TemplateSummary[]; errors: { folder: string | null; error: string }[] }
interface TemplateSummary {
  id: string;          // the folder name
  name: string;
  description: string;
  url?: string;        // only on URL templates
}

// tv templates show <id> → { template: Template }
interface Template extends TemplateSummary {
  version: string;
  path: string;        // installed folder, for inspecting and editing the template
  display?: ArtifactDisplayOptions;
  icons?: ArtifactTemplateIcon[]; // usable entries, in manifest order
  dataSchema?: JSONSchema;
}
```

The presence of `url` identifies a URL template; neither record has a `kind` field. `path` is the absolute installed folder path for both folder and URL templates. It is always available through `show`, even when creation registers a URL. Neither record includes starting data; agents read `<path>/data.json` using the `path` from `show`. `url` is the trimmed manifest address. Ignored icon fields and entries are omitted; with no usable entries, `icons` is omitted. `dataSchema` is present only when declared by a folder template.

The scanner reads folders directly inside `<home>/templates/`. It ignores dot-prefixed folders, including backups, and ordinary files at that level. Each other folder produces one valid record or one error naming all defects found. Records sort by display name then ID, using `localeCompare` with `"en"`; folder errors sort by folder name in the same locale. Failure to read the directory produces an error with `folder: null`. ^artifact-template-scan

### App route and fresh scans

The server route uses a separate, flat record containing the full template fields and app metadata. This is not the agent-facing contract:

```ts
interface AppTemplate {
  id: string;
  name: string;
  description: string;
  url?: string;
  version: string;
  path: string;
  display?: ArtifactDisplayOptions;
  icons?: ArtifactTemplateIcon[];
  dataSchema?: JSONSchema;
  hasIcon: boolean;
}

interface ArtifactTemplateScan {
  templates: AppTemplate[];
  errors: { folder: string | null; error: string }[];
  watching: boolean; // whether recursive observation is working
}
```

Authenticated `GET /templates` returns the cached `ArtifactTemplateScan`. `GET /templates?fresh=true` scans the whole directory immediately, without waiting for the watcher debounce, and returns the new scan. A fresh scan also replaces the server cache and publishes it under the rules below. When `watching` is false, even the default route returns a fresh scan.

The CLI [list command](../../product/cli.md#^cli-templates-list) requests a fresh scan and prints only `TemplateSummary` fields plus scan errors. [`show <id>`](../../product/cli.md#^cli-templates-show) requests a fresh scan, resolves the exact ID, and prints only `Template` fields. Neither prints `hasIcon` or `watching`. Creation also resolves against a fresh scan before creating anything, regardless of whether the caller is the CLI or Toolbox. These fresh scans ensure that an agent can edit a template and immediately list, inspect, or use the edited version without waiting for a watcher update.

An invalid folder is refused with its scan error. A successful scan with no such folder yields a not-found error naming the ID; an unreadable directory yields its read error.

### Server cache and app updates

On each serving boot, after bundled template handling, the server builds a full scan and keeps it in memory. It recursively watches `<home>/templates/` using the [shared content watcher](../artifact-frame/reload-navigation.md#^rn-shared-content-watcher). Watch setup and the initial scan must leave no gap in which an edit is missed. Token-only construction starts neither the scan cache nor the watcher; the [bootstrap sequence](../onboarding/installer.md#^bootstrap-sequence) owns placement in boot.

After a short debounce, the server refreshes its cached scan to reflect changes under `<home>/templates/`, including added, removed, or renamed template folders. A burst of writes produces one update. A full rescan is acceptable. Publication preserves scan order, so superseded work cannot replace a newer result. Changed or removed templates invalidate their cached icon bytes, even when the manifest and selected icon filename are unchanged. ^artifact-template-cache

After each update, the server pushes the complete new scan over the existing authenticated `/events` WebSocket, alongside channel-change and artifact-focus broadcasts. The [event connection contract](../updates/version-advertisement.md#^events-version) still sends `server-status` first. The template domain adds this message:

```ts
interface TemplatesChangedEvent {
  type: "templates-changed";
  scan: ArtifactTemplateScan;
  invalidatedIDs: string[]; // template IDs whose cached icon bytes must be replaced
}
```

Invalidation names exactly the templates added, removed, or changed since the previous scan, where a change is a different record or a different selected icon file, judged by its size and modification time. A scan that finds no change publishes nothing. A watcher-status change may publish the scan with no invalidated IDs. This event is a domain member of `ServerEvent`, not a change to `server-status`, and is sent only to connected app clients; it is not replayed. This spec owns the template payload and consumption. ^artifact-template-events

At app startup and after each reconnect, the app subscribes to template events, loads the current scan through the shared client, and preloads icons for entries with `hasIcon`. It retains the list and icon bytes per server connection, including while Toolbox is closed, and replaces the list on each push. A full fetch invalidates all cached icon bytes, including after reconnect when changes may have been missed. For a push, it fetches replacements for `invalidatedIDs` still carrying `hasIcon`; removed entries and entries no longer carrying `hasIcon` lose their icons. An invalidated icon keeps showing its previous bytes until the replacement arrives; a failed replacement falls back to the default icon. An old list or icon response must not overwrite a newer push, following the same [fetch-and-stream ordering rule](../channel-state/index.md#^cs-bootstrap-race) as channel state. After a successful list load, opening Toolbox uses this cache and does not fetch or scan while the watcher is working. If a startup or reconnect list request fails while the event connection remains usable, the next Toolbox opening retries that load through the cached server route; it keeps any previous list visible and does not wait for a filesystem event to recover. The [Toolbox spec](../../ui/app/toolbox.mdx#opening) owns the blank body before the first list arrives and interaction with live updates.

### Watcher failure

This template architecture owns the fallback. If the watcher cannot start or fails, the server logs a warning, sets `watching: false`, and publishes that state to connected clients. The app then requests a fresh scan whenever Toolbox opens, and once when it learns of the failure while already open. Further pushes with `watching: false` do not trigger another request. It keeps the last list visible while that request runs. A working watcher restores `watching: true` with a full scan; the app then resumes cached opening. Watcher failure is not a template-folder validation error and adds no Toolbox warning of its own. ^artifact-template-watch-fallback

## Creating an artifact

The server accepts this authenticated request:

```ts
interface CreateTemplateArtifactRequest {
  templateID: string;
  channelID: string;
  title?: string;
  data?: JSONValue; // presence replaces data.json, including when the value is null
  display?: ArtifactDisplayOptions; // supplied fields override manifest display
  before?: string; // artifact ID: place immediately before it
  after?: string;  // artifact ID: place immediately after it; at most one of the two
  source: "cli" | "ui";
}

type CreateTemplateArtifactResult = { artifactID: string } & (
  | { path: string; url?: never } // absolute registered folder path
  | { url: string; path?: never } // registered manifest URL
);

interface TemplateClient {
  list(options?: { fresh?: boolean }): Promise<ArtifactTemplateScan>; // GET /templates; fresh=true bypasses the cache
  create(input: CreateTemplateArtifactRequest): Promise<CreateTemplateArtifactResult>; // POST /templates/artifacts
  icon(id: string): Promise<{
    bytes: Uint8Array;
    contentType: "image/svg+xml" | "image/png";
  }>; // GET /templates/<id>/icon
}
// On TelevisionClient: readonly templates: TemplateClient
```

`POST /templates/artifacts` accepts `CreateTemplateArtifactRequest` and returns `CreateTemplateArtifactResult`. All template routes use the server token and send no CORS headers, like other application control routes ([isolation](../artifact-frame/isolation.md#^iso-routes)).

The CLI sends `source: "cli"`. Toolbox sends `source: "ui"` and omits `data` and `display`. It sends the artifact in the selected tab in that browser as `after`, or omits placement when the channel has no tabs ([Toolbox interaction](../../ui/app/toolbox.mdx#creating-an-artifact)).

The route checks request fields at runtime against the contract above. A malformed field receives HTTP `400` with `{ error: string }` before any folder, artifact record, or store is created. A rejected `source` never reaches telemetry. URL templates reject the presence of request `data`, including `data: null`, with the same bad-request response. ^artifact-template-request-validation

The CLI parses `--data` or `--data-file` and checks JSON syntax and the 1 MiB limit before sending the request. For a folder template, the server validates any supplied data against the store value rules, limits and optional `dataSchema` before creating a folder, artifact record, or store. Validation failures are bad requests. The server also checks that the channel and template are usable, that at most one of `before` and `after` is given, and that a named artifact is on that channel, following the [placement rule](../../product/cli.md#^cli-before-after), before creating anything. ^artifact-template-preflight

The server validates request `display` against the [display-options contract](../layout/index.md#^ly-creation-display) before creating anything. Each field takes the supplied value, manifest value, or shared default according to the [product precedence rule](../../product/templates.md#^artifact-template-display-options).

For a folder template, the server copies the page and supporting files into a fresh folder under `<home>/artifacts/` and registers an ordinary path artifact pointing at that copy. The copy excludes the root `manifest.json` and `data.json`; it includes `README.md` and supporting files, including icons that a page may also use. Copying uses file-system cloning where available (copy-on-write clone, falling back to an ordinary copy). For a URL template, it registers an ordinary URL artifact at the manifest URL. Each artifact takes the manifest name or supplied title.

For a folder template, supplied request `data`, including `null`, replaces `data.json` entirely, with no merging. Otherwise the server selects the value from `data.json` when present. The server rechecks placement as it saves the channel layout. Once registration and placement succeed, it writes any selected starting value at the root of the artifact store through the [resource first-write path](../resources/index.md#^rs-first-write), within this same request. Creation succeeds only when those steps complete and any starting value is durably saved. With neither source of starting data, the store stays unwritten; a URL artifact has no store. A page may load before seeding completes and must handle an empty store.

Once copying starts, Television removes nothing it created. For URL artifacts, this rule applies from the registration attempt onward. If copying or any later step fails or has an uncertain outcome, including registration, saving the channel layout, or writing starting data under the [uncertain-save rule](../resources/index.md#^rs-arch-uncertain-save), the request fails. Its error names the target: the destination folder for a copy, or the manifest URL. It includes the generated artifact ID whenever registration was attempted and says which step could not be confirmed, so the caller can inspect what remains before retrying. The artifact record carries no template ID or other origin field. [Ordinary artifact behavior](../../product/artifacts.md) governs it thereafter. ^artifact-template-copy

The destination folder name for a copy is made from the title at creation: lowercase the title, replace each run of characters other than ASCII letters and digits with `-`, trim leading and trailing `-`, and use `artifact` if the result is empty. Limit that slug to 60 characters, cutting at the last hyphen within that limit when possible, then trim any trailing hyphen. Append `-` and five random lowercase base-36 characters. If that path already exists, draw another suffix before copying. The artifact title itself is not shortened. Retitling the artifact does not rename the folder. ^artifact-template-copy-name

# ServerStore

`ServerStore` is the filesystem owner for Television server state. It manages the auth token, channel files, display singleton, artifact registry metadata, content watchers, and theme watcher under `<storagePath>`.

The implementation is [ServerStore](../src/server-store.ts). Its onboarding and serving-bootstrap contracts are authoritative in [specs/arch/onboarding/installer.md](../../../specs/arch/onboarding/installer.md).

## Construction

```ts
const store = new ServerStore({
  storagePath: "/path/to/.television",
  installOnboardingChannels: true,
});
```

Construction is synchronous and resolves `storagePath` to an absolute path. Serving construction uses `installOnboardingChannels: true`; the [installer spec](../../../specs/arch/onboarding/installer.md) defines its bootstrap sequence, including channel installation and display initialization.

Token-only construction uses `installOnboardingChannels: false` to create the storage directories and load or generate the token, leaving channels, display state, onboarding content, and watchers untouched. Persisted-daemon setup uses this mode before the first serving boot.

Malformed channel JSON files are skipped. Invalid artifact metadata is a startup failure.

## Artifact metadata

Artifact metadata uses the canonical `Artifact` type from `packages/artifact/src/model.ts`:

```ts
type Artifact =
  | { id: string; kind: "path"; title: string; path: string }
  | { id: string; kind: "url"; title: string; url: string };
```

Metadata files live at `state/artifacts/<id>.json`. The filename stem and body `id` must match.

Path artifacts point at existing readable markdown files, HTML files, or indexed HTML directories. URL artifacts point at `http(s)` URLs.

## Path helpers

Server-local path helpers in `packages/server/src/artifact-paths.ts` derive storage paths:

- state dir: `state/`
- channels dir: `state/channels/`
- artifact metadata dir: `state/artifacts/`
- display singleton: `state/display.json`
- token: `state/token`
- agent artifact convention dir: top-level `artifacts/`

Artifact content target paths come from artifact metadata and are not rewritten by storage helpers.

## Public API

```ts
readonly storagePath: string;
readonly authToken: string;

getChannel(id: string): { channel: Channel; artifacts: Artifact[] } | undefined;
getArtifact(id: string): Artifact | undefined;
listChannels(): Channel[];
listArtifacts(): Artifact[];
getActiveChannelID(): string | null;
getActiveThemeName(): string | null;
getDisplayState(): { activeChannelID: string | null; activeThemeName: string | null };

createArtifact(input:
  | { kind: "path"; title: string; channelID: string; path: string }
  | { kind: "url"; title: string; channelID: string; url: string }
): Artifact;
updateArtifact(input: { artifactID: string; fields: { title?: string; path?: string; url?: string } }): Artifact;
deleteArtifact(artifactID: string): ArtifactRemovalResult;

createChannel(input: { name: string; id?: string }): Channel;
updateChannel(input: { channelID: string; fields: { name?: string; layout?: TabPage[] } }): Channel;
patchDisplay(input: { activeChannelID?: string | null; activeThemeName?: string | null }): void;
focus(input: { artifactID: string }): { channelID: string; artifactID: string };
removeChannel(channelID: string): ChannelRemovalResult;
```

## Validation

Create validation:

- `kind` is `path` or `url`.
- `channelID` resolves to an existing channel.
- `path` and `url` are trimmed before validation and persistence.
- Path values must be absolute, existing, and readable.
- Paths are classified by statting the target; a trailing separator on the input is optional. The persisted path is normalized so directory paths always end with a trailing separator and file paths never do.
- File path artifacts must resolve to a regular file and have an allowed basename extension: `.md`, `.markdown`, `.htm`, `.html`.
- Directory path artifacts must resolve to a directory containing root `index.html` or `index.htm`.
- URL values must parse as `http:` or `https:`.

Update validation:

- `PATCH` accepts title metadata plus path changes for path artifacts and URL changes for URL artifacts.
- Artifact id and kind stay stable.

Startup validation:

- Channel files may be malformed and are skipped.
- Artifact metadata must parse as the canonical `ArtifactSchema`.
- Filename/body id mismatches fail startup.

## Watchers

Artifact content watchers follow the path artifact target selection rules:

- URL artifacts: no watcher.
- Markdown file path artifacts: watch the markdown file.
- HTML file path artifacts: watch the HTML file.
- Directory path artifacts: recursively watch the complete declared directory tree without filtering by filename, extension, or depth.

Watcher target selection uses shared path helpers and does not stat to classify file vs directory. The default watcher uses `fs.watch` on a file artifact's parent directory and matches its basename; a directory artifact uses one native recursive watch rooted at the declared directory. Relevant notifications are debounced before dispatching `artifact-content-changed`.

If a watch root or its ancestor disappears, the watcher reports the content change and polls for the missing root. It reattaches and reports another content change when the root returns. A runtime error is reported and closes only the failed watcher and its pending event. Delete and dispose close artifact watchers. Title-only updates do not restart watchers; path changes restart watchers for the new target. Callbacks from a closed or superseded watcher cannot emit or change the current target's debounce deadline.

A non-null active theme recursively watches its complete `themes/<name>/` package through the same content-watcher handoff as folder artifacts. Any descendant file notification, package-root loss, or same-path re-arm schedules the theme owner's debounced `theme-changed` event. Live loss keeps the selected ID and registry snapshot; restoring the root reapplies the package. Selection changes, null selection, refresh fallback, runtime watcher errors, and disposal close the active theme watcher and cancel its pending event.

## Events

`ServerStore` extends `EventTarget` with the shared domain-event union. Each mutation dispatches the corresponding typed event directly; the `/events` WebSocket server re-broadcasts those events verbatim.

Domain events:

- `artifact-created`
- `artifact-updated`
- `artifact-content-changed`
- `artifact-removed`
- `channel-created`
- `channel-updated`
- `channel-removed`
- `channel-changed`
- `artifact-focus`
- `theme-changed`

Shape notes:

- `artifact-created` carries `channelID` and the full wire `artifact`.
- `artifact-updated` carries the full wire `artifact`.
- `artifact-content-changed` carries `artifactID`.
- `artifact-removed` carries `artifactID` plus `channelID`.
- `channel-created` and `channel-updated` carry the full `channel`.
- `channel-removed` carries `channelID`.
- `channel-changed` carries `channelID: string | null`.
- `artifact-focus` carries `{ channelID, artifactID }`.
- `theme-changed` carries `themeName: string | null`; watched active-package changes, loss, and recovery may carry the currently selected non-null ID without a selection change.

Removal behavior:

- `deleteArtifact` removes the owning channel card, closes the watcher, deletes metadata, and emits one `artifact-removed` event for that channel.
- `removeChannel` deletes every referenced artifact, removes the channel metadata file, then emits `channel-removed`.

Reconnect/bootstrap does not synthesize replay events. Reads carry current state, and subsequent mutations or watcher activity emit events.

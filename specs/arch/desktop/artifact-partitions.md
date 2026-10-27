*Desktop artifact partitions: which Electron session each artifact webview uses, never the window's, how the served interface and the main process agree on it, the record of each server's partitions, and the reaper that deletes the partitions of deleted artifacts.*

**Plain english:** the desktop app keeps each artifact's browser data, such as what its page saves in `localStorage`, in a storage area of its own, apart from the app's page and from every other artifact, and gives websites and artifacts shared from other servers one storage area that they share. This governs how those storage areas, called partitions, are named and created, how the app remembers which belong to which server, and how it deletes the ones whose artifacts are gone.

# Desktop artifact partitions

## What this owns

This module owns the *artifact partitions*: which Electron session each artifact webview uses, the partition names the served interface and the main process agree on, the record of the partitions created for each server, and the reaper that deletes them. Why no artifact webview uses the window's session, how the main process rewrites the artifact proxy's headers in the partitions, and the permissions their webviews get are [isolation's](../artifact-frame/isolation.md#In the desktop app). The user-facing promise is [product/artifacts.md#^af-sandbox](../../product/artifacts.md#^af-sandbox).

## Sessions

The window, which shows the local page or the served interface, uses Electron's default session, and no webview does. Each artifact webview uses a persistent partition, chosen by the artifact it shows: ^dp-sessions

| The webview shows | Partition |
|---|---|
| an artifact the connected server serves from its own files: an HTML file, a folder, or a Markdown file in Television's editor | the artifact's own *artifact partition*, `persist:artifact-<key>` |
| an external page artifact or a shared artifact, from any server | the *URL-artifact partition*, `persist:url-artifacts` |
| any artifact, for a served interface that names no partition | the *fallback partition*, `persist:webview-fallback` |

`<key>` is the first 32 hexadecimal digits, in lowercase, of the SHA-256 digest of the UTF-8 text `<origin>\n<id>`: the served interface's origin as the URL standard serializes it, a newline, and the artifact's ID. Each server therefore has its own artifact partitions, and one URL-artifact partition serves every server, so a website login made in a URL artifact survives switching servers, moving the artifact or deleting and adding it again. A served interface built without partition support names none, and the fallback partition keeps its webviews out of the window's session.

A webview keeps its partition for its whole life, wherever its document navigates. Electron keeps a persistent partition's data in the app's `userData` directory under `Partitions/<name>`, where the name is the partition's without `persist:`.

## How the interface and the main process agree

The served interface and the desktop app ship separately. The window's native preload bridge, `__televisionNativeBridge`, tells the interface that the main process places artifact webviews in partitions by carrying `artifactPartitions` with the value `1`: ^dp-bridge-flag

```ts
interface NativePreloadBridge {
  // … the bridge's operations
  readonly artifactPartitions: 1;
}
```

When the bridge carries it, the served interface gives each artifact webview a `partition` attribute before the webview's first navigation, naming the partition the artifact needs: `tv-artifact:<id>`, with the artifact's ID unchanged, for an artifact the server serves from its own files, and `tv-url-artifact` for an external page artifact or a shared artifact. When an artifact's frame needs a partition other than its webview's, as when the artifact's kind changes, the interface replaces the webview with a new one. Without the flag, the interface gives webviews no `partition` attribute. ^dp-interface-names

When a webview attaches, the main process reads the partition it asks for, in `will-attach-webview`'s `webPreferences.partition`, and acts on it before Electron creates the webview's page: ^dp-attach

- `tv-artifact:<id>` with a nonempty ID, while the window shows an HTTP(S) page: it sets the artifact's partition, keyed by the window's page origin, sets up that partition's session as [isolation](../artifact-frame/isolation.md#In the desktop app) requires, and records the partition (below).
- `tv-url-artifact`: it sets the URL-artifact partition and sets up its session.
- none: it sets the fallback partition and sets up its session. A served interface without partition support creates webviews this way; the fallback partition keeps the sandbox header, so the documents such a server sandboxes stay sandboxed ([isolation.md#^iso-desktop-header](../artifact-frame/isolation.md#^iso-desktop-header)).
- anything else, including `tv-artifact:` while the window shows another page: it refuses the webview, so that no webview runs in a session the main process has not set up.

## The partition record

The main process records the artifact partitions it sets, by server, in `artifact-partitions.json` in the `userData` directory: ^dp-record

```ts
type ArtifactPartitionRecord = {
  version: 1;
  // By the served interface's origin, then by partition name without
  // `persist:`: the ID of the artifact the partition belongs to.
  servers: Record<string, Record<string, string>>;
};
```

It adds an entry when a webview attaches with an artifact partition the record lacks, writing a temporary sibling and renaming it over the record, as for [the saved connection](./connect-flow.md#^desktop-connect-persistence). A missing or malformed record is read as empty. The URL-artifact partition and the fallback partition have no entries.

## The reaper

The reaper deletes the artifact partitions of the server the app is connected to whose artifacts the server no longer has. It runs while the window shows the served interface of the [saved connection](./connect-flow.md#^desktop-connect-persistence)'s server: when that page finishes loading, and every hour after while it stays loaded. A reaping starts only when none is running. It: ^dp-reaper

1. takes the record's entries for the connection's origin;
2. requests `GET <origin>/artifacts`, with `Authorization: Bearer <token>` when the connection has a token;
3. stops, changing nothing, unless the answer is `200` with a JSON body whose `artifacts` is an array of objects that each have a string `id`;
4. for each taken entry whose artifact ID is not among those IDs, deletes the partition, by removing its directory and then its entry, unless Electron has opened the partition since the app started.

Electron keeps an opened partition's files open until the app quits, so a reaping leaves such a partition and its entry, and a reaping after the app's next start deletes it. Entries recorded after the first step wait for the next reaping, so a partition created while a reaping's request is in flight is never taken for a deleted artifact's. The reaper never deletes the URL-artifact partition, the fallback partition, or the partitions of a server the app is not connected to.

The reaper makes `GET /artifacts`, with the server's token, a cross-release contract: desktop releases rely on its answer listing every artifact the server has, in one response, as `{ "artifacts": [{ "id": "<artifact ID>", … }, …] }`, so a server keeps that answer whatever else the route gains. ^dp-artifacts-route

## Testing

Partition assignment and the reaper are proven in the real Electron app against a running Television server, with Electron's sessions and the filesystem real. The reaper's deletion of a partition crosses a restart of the app.

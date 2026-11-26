*Server storage: what the server keeps in the Television home it serves and which spec owns each file, the token file, the artifact, channel and display records, one server per home, and the order in which a serving boot brings a home up.*

# Server storage

A Television server keeps everything it knows in the [Television home](../../product/cli.md#^cli-home) it serves: its token, channels, artifact records, display state, installed themes, resources, and the state of each feature that installs or remembers something. Earlier releases wrote the same home, later releases read it, and people and agents read some of its files and write others. This spec maps the home, owns the records that no feature spec owns, and fixes the order in which a serving boot loads and prepares them. Paths below are relative to `<home>`.

## The home's layout

| Path | What it holds | Owner |
|---|---|---|
| `config.json` | The config file. | [product/cli.md](../../product/cli.md#^cli-config-file) |
| `state/token` | The server's token. | [below](#^srv-token-file) |
| `state/channels/<channel-id>.json` | One channel record per channel. | [below](#^srv-channel-record) |
| `state/artifacts/<artifact-id>.json` | One artifact record per artifact. | [below](#^srv-artifact-record) |
| `state/display.json` | The display record. | [below](#^srv-display-record) |
| `state/onboarding.json`, `state/onboarding-artifact.json` | The onboarding state file, and the legacy sentinel kept for older releases. | [arch/onboarding/installer.md](../onboarding/installer.md) |
| `state/bundled-themes.json` | Which bundled theme IDs have been handled, and the one-time default-theme decision. | [arch/themes/bundled-installation.md](../themes/bundled-installation.md#installation-state) |
| `state/telemetry.json` | The telemetry identity and opt-out flag. | [arch/telemetry/identity.md](../telemetry/identity.md) |
| `state/resource-bindings.json`, `resources/` | Resources and their explicit bindings. | [arch/resources/index.md](../resources/index.md#^rs-storage) |
| `themes/<theme-id>/` | Installed theme packages, which people and agents add and edit. | [arch/themes/index.md](../themes/index.md#installed-package-contract) |
| `artifacts/` | A place for artifact content: the `television` skill tells agents to keep HTML artifacts here, and the onboarding installer copies its content here. The server treats it as an ordinary folder and serves from it only what an artifact's path names. | this spec |
| `logs/tv.log` | The server's log. | [arch/server/lifecycle.md](./lifecycle.md#^srv-log) |

The pre-redesign directory `state/screens/` is read only by [the server migration](./migration.md). The CLI writes `config.json` and, for a persisted install, creates the token through a [token-only construction](#^token-only-boot) before the service first starts; while a server runs, it is the only writer of everything under `state/` and `resources/`.

**One server per home.** A home is served by one server process at a time, and the server assumes it is the only writer of its records. Nothing enforces this. A second server for the same home runs whenever it can bind its listeners, as under config port `0` or after the config file's port changes while the first still runs, and even a second server that fails to bind has already written to the home during its bootstrap. Two servers then overwrite each other's records. This is an accepted limitation. ^srv-one-server

## The token file

`state/token` holds the *server's token*, the bearer token that [authentication](./http.md#^srv-auth) checks: 256 bits from a cryptographic random source, written as 64 hexadecimal characters followed by a newline. A store construction that finds no token file creates one; the server never changes an existing token. Readers trim surrounding whitespace. The CLI reads this file to authenticate its requests and names it in its unauthorized message ([product/cli.md](../../product/cli.md#Connecting to the server)). ^srv-token-file

## The artifact record

Each artifact has one record, at `state/artifacts/<artifact-id>.json`, whose `id` is the file name's stem:

```ts
type StoredArtifactRecord =
  | ({ id: ArtifactID; kind: "path"; title: string; path: string } & ArtifactRecordResourceFields)
  | { id: ArtifactID; kind: "url"; title: string; url: string };
```

`ArtifactID` is the generated ID [product/artifacts.md](../../product/artifacts.md#^af-artifact-id) describes, and `ArtifactRecordResourceFields`, the store pointer and share link, are [the resource layer's](../resources/index.md#^rs-artifact-record). `title` is stored exactly as given ([product/artifacts.md](../../product/artifacts.md#^af-name)). `path` is stored in the canonical form [path artifact creation](../../product/cli.md#Path artifact creation) gives it, with a trailing separator exactly when it names a folder; `url` is the trimmed `http:` or `https:` URL. An artifact's ID and kind never change. The same shape is what the API and events carry and what `tv get-artifact` and `tv list-artifacts` print. ^srv-artifact-record

Every rewrite and deletion of a record follows [the resource layer's storage rule](../resources/index.md#^rs-storage), including [its rule for a save whose outcome is uncertain](../resources/index.md#^rs-arch-uncertain-save): an uncertain rewrite takes the record it reads back as current, and an uncertain deletion that finds the file gone takes the artifact as deleted. A record carries promises to the store's writers and the share link's holders, and any rewrite, such as a title change, replaces the whole record, so every record write needs the durability of the data ([product/artifacts.md](../../product/artifacts.md#^af-record-saved)). The server applies one artifact's record changes one at a time, each to the record as it stands after the last. ^srv-artifact-record-save

The record has no version field. Records an earlier release wrote, including those without the resource fields, remain valid.

At load, an artifact record that cannot be read, is not a valid record, or whose `id` differs from its file name stops the boot with an error naming the file. The server does not serve without an artifact whose ID, store and share link people rely on. ^srv-artifact-record-load

## The channel record

Each channel has one record, at `state/channels/<channel-id>.json`, composed of the fields its owners define:

```ts
type StoredChannelRecord = ChannelStateFields  // id and name: arch/channel-state/index.md
  & StoredChannelLayout                         // layoutVersion and layout: arch/layout/index.md
  & { onboarding?: OnboardingChannelMarker };   // arch/onboarding/installer.md
```

Pin state and focus are not channel fields; they live in the display record. ^srv-channel-record

At load, a channel record that is not valid JSON or not a valid record is skipped with a warning and left on disk as it is. The artifacts on its pages are then on no channel, as after a move that did not finish ([arch/layout/index.md](../layout/index.md#^ly-move)): their records, stores and share links keep working. ^srv-channel-record-load

## The display record

The display record, at `state/display.json`, holds the workspace state that every client shares:

```ts
type StoredDisplayRecord = ChannelDisplayState   // focusedChannelId, pinnedChannelIds: arch/channel-state/index.md
  & {
    activeThemeName: string | null;              // arch/themes/index.md
    appearanceMode: AppearanceMode;              // arch/themes/index.md
    themeJavaScriptConsentIds?: string[];        // arch/themes/index.md
  };
```

Each field keeps its owner's rules; this spec owns the file. ^srv-display-record

A serving boot loads the display record when it is valid JSON whose fields are all present and valid, apart from `themeJavaScriptConsentIds`, which may be absent. A record that exists but cannot be read stops the boot, as a [migration failure](./migration.md#^mig-record-atomic) does. A readable record that is malformed or invalid is replaced by fresh display state, in which one of the existing channels is focused, nothing is pinned, the null theme is selected, appearance is `system`, and no theme has JavaScript consent. ^srv-display-load

After loading, the boot keeps [the focus invariant](../channel-state/index.md#^cs-focus): when the stored focus is `null` or names no channel while channels exist, the boot focuses one of the existing channels and keeps every other field. This happens, for example, when the [default-channel invariant](#^default-screen) creates "Default" in a home whose last channel had been deleted. ^srv-boot-focus

> **Implementation note (transitional):** the serving bootstrap loads a `null` or dangling focus without repairing it, so a restart after the last channel is deleted leaves "Default" unfocused.

**Writing the channel and display records.** The server replaces a channel or display record atomically, so a crash leaves the complete previous record or the complete new one, never part of either. Unlike artifact records, these writes need not reach the disk before the change is reported: a crash can lose the latest change, but not the record. ^srv-record-replace

> **Implementation note (transitional):** the server rewrites the display record, and channel records outside a move, in place.

## The serving bootstrap

A *serving boot* is the store construction for a server that will serve the home, as `tv serve` makes. It prepares the home in this order, and completes it before the server accepts a connection: ^bootstrap-sequence

1. Capture whether the home holds no [prior serving evidence](../telemetry/identity.md#^prior-serving-evidence), before anything below writes state; telemetry's install detection needs it.
2. Run [the server migration](./migration.md#^one-migration). Then create the storage directories that are missing, load or create the token, load the channel and artifact records, and load the [resource layer](../resources/index.md#^rs-bootstrap), which the next steps write through.
3. Take the onboarding installer's [no-content snapshot](../onboarding/installer.md#^onboarding-focus-rule).
4. Run the [onboarding installer](../onboarding/installer.md): its state migration, then its install loop when a content root resolved and its config is usable.
5. Apply the [default-channel invariant](#^default-screen).
6. Run [bundled-theme installation](../themes/bundled-installation.md#serving-boot-installation), then scan the [theme registry](../themes/index.md#registry-scan).
7. Load the display record, or start fresh display state ([above](#^srv-display-load)), and repair its focus ([above](#^srv-boot-focus)). Complete a pending [default-theme decision](../themes/bundled-installation.md#default-theme-selection), then apply the registry's [invalid-theme fallback](../themes/index.md#selection-and-display-state), then the onboarding installer's [focus rule](../onboarding/installer.md#^onboarding-focus-rule).
8. Start watching artifacts' content and the active theme ([content watching](./local-content.md#^rn-shared-content-watcher)).

The store resolves the home to an absolute path when it is constructed, so every path it derives, including copy destinations, records, state files and watched paths, is independent of the process's working directory. ^storage-path-absolute

A *token-only construction* is a store construction that will not serve: the one `tv serve --persist` makes to create the token before installing the service, and any other. It captures step 1, then only creates the storage directories, loads or creates the token and loads the records; it runs no migration and creates no channel, display state or onboarding content. A home that has never served therefore holds no channel, and the first serving boot finds it as a fresh home. ^token-only-boot

**The default-channel invariant.** A serving boot ends with at least one channel: when none exists after the onboarding installer has run, or has been skipped because no content root resolved or its config is unusable, the boot creates an empty channel named "Default". This is the only code path that creates "Default", so a boot on which the installer created channels never creates it, and an existing empty "Default", whether an earlier boot without onboarding content left it or a person made it, is an ordinary channel. While the server runs, zero channels is a valid state ([arch/channel-state/index.md](../channel-state/index.md#^cs-focus)). ^default-screen


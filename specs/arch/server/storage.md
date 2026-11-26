*What the server keeps in a Television home: the layout of the home, the channel, artifact and display records, the token file, how stored formats change between releases, and the log.*

# Server storage

Everything a Television installation remembers is a file in its [Television home](../../product/cli.md#^cli-home). A later release has to read what an earlier one wrote there, and people and agents read some of these files directly, so the layout and the formats are a contract. This document gives the layout and says who owns each part. It owns the three records at the core of the server, the token file and the log; every other file is specified by the feature it belongs to.

## Layout

```text
<home>/
  config.json                      settings shared by the server and commands      product/cli.md
  state/
    token                          the bearer token                                this spec
    channels/<channel-id>.json     one record per channel                          this spec
    artifacts/<artifact-id>.json   one record per artifact                         this spec
    display.json                   the display record                              this spec
    onboarding.json                which onboarding channels were installed        arch/onboarding/installer.md
    onboarding-artifact.json       the earlier releases' onboarding record         arch/onboarding/installer.md
    bundled-themes.json            which bundled themes were installed             arch/themes/bundled-installation.md
    telemetry.json                 the telemetry identity and opt-out              arch/telemetry/identity.md
    resource-bindings.json         explicit resource bindings                      arch/resources/index.md
  resources/<type>/<resource-id>/  one directory per resource                      arch/resources/index.md
  themes/<theme-id>/               installed theme packages                        arch/themes/index.md
  artifacts/                       where agents keep files they author             below
  logs/tv.log                      the log                                         this spec
```

`artifacts/` is a convention, not a store. An artifact points at a path anywhere on the machine ([artifacts](./artifacts.md)), and the `television` skill tells agents to put the HTML artifacts they author here by default. The server creates the directory and otherwise treats files in it like files anywhere else. The onboarding installer [copies its content here](../onboarding/installer.md#Install loop).

## Records

Each record is one JSON file, and each field is owned by the spec that defines its meaning:

```ts
/** <home>/state/channels/<channel-id>.json */
type StoredChannel = ChannelStateFields      // id, name: arch/channel-state/index.md
  & StoredChannelLayout                      // layoutVersion, layout: arch/layout/index.md
  & { onboarding?: OnboardingChannelMarker }; // arch/onboarding/installer.md

/** <home>/state/artifacts/<artifact-id>.json */
type StoredArtifact = Artifact               // id, kind, title, path or url: artifacts.md
  & ArtifactRecordResourceFields;            // store, share: arch/resources/index.md

/** <home>/state/display.json */
type StoredDisplay = ChannelDisplayState     // focusedChannelId, pinnedChannelIds: arch/channel-state/index.md
  & {                                        // arch/themes/index.md
    activeThemeName: string | null;
    appearanceMode: AppearanceMode;
    themeJavaScriptConsentIds?: string[];
  };
```

A channel's or an artifact's file is named for its ID. The display record is one file for the whole home. ^srv-records

Which channel holds an artifact is not in the artifact's record. It is the channel's layout that names the artifact, and the server derives the artifact's channel from the layouts when it loads them ([artifacts](./artifacts.md#^srv-artifact-channel)).

The specs that own a record's fields also own how carefully it is saved. Artifact records follow the [resource storage rule](../resources/index.md#^rs-artifact-record), and the channel saves of a move are [each atomic](../layout/index.md#^ly-move).

## The token

`<home>/state/token` holds the server's bearer token as one line of text. The store creates it, from a cryptographic random source, the first time it is constructed for a home that has none, and never changes it afterwards. The `tv` commands read the file directly to authorize themselves ([product CLI](../../product/cli.md#Connecting to the server)), which is why its place and form are fixed. To anything but the server and the file's reader the token is an opaque string. ^srv-token-file

## Changing a stored format

A release must be able to serve a home that any earlier release wrote. It gets there in one of two ways, and nothing else changes a stored format:

- A change that an older record cannot express by omission is made by [the server migration](../layout/migration.md), which rewrites the home at the start of a serving start, before anything is loaded.
- A new optional field needs no migration when a record without it already means the right thing, as an artifact record without a store pointer means an artifact whose store has never been written.

Serving a home with an older release than the one that last wrote it is not supported, and has no promised behavior. ^srv-no-downgrade

The records under `state/` are the server's to write. A person or agent who edits one does so while the server is stopped, because a running server holds the state in memory and will overwrite the file with what it holds.

## The log

`<home>/logs/tv.log` is where the server and the `tv` commands record what they did and what went wrong: starts and stops, the addresses bound, a [failed start](./lifecycle.md#The fatal record), service installation. People and agents read it to diagnose an installation, and the [administrator guide](../cli/admin-guide.md) sends them there.

Each record is one line holding one JSON object, with the time, the process ID, a short message, and whatever fields the record adds. Records are appended synchronously, so a record written just before a process exits is in the file. The log rotates daily and keeps fourteen days. Several processes may append at once, because a `tv` command logs into the same file as the running server. ^srv-log

The wording and fields of individual records are not pinned unless the spec that owns the record says so.

*The Television home's durable records, serving bootstrap, and the changes the store reports to clients and telemetry.*

# The server store

A server reads the workspace from its Television home and writes changes back there. Resolve the home to an absolute path once so changing the working directory cannot redirect a later read, write or watch. The store assumes one serving process per home. ^storage-path-absolute

| Location within the home | What a later process reads |
|---|---|
| `state/token` | The opaque bearer token for this home. Reuse it across launches. Create a random token when the file is absent. |
| `state/channels/<id>.json` | The [channel fields](../channel-state/index.md#^cs-channel-shape), [stored layout version and pages](../layout/index.md#^ly-version), and optional [onboarding marker](../onboarding/installer.md#^marker-api-readonly). |
| `state/artifacts/<id>.json` | One [artifact record](artifacts.md#^rs-artifact-record). Channel membership comes from the pages in channel records. |
| `state/display.json` | Shared [focus and ordered pins](../channel-state/index.md), [theme selection, consent and appearance](../themes/index.md). |
| `artifacts/` | Agent and installer content. A registered path may also point elsewhere on the host. |

[Onboarding](../onboarding/installer.md), [bundled themes](../themes/bundled-installation.md), [resources](../resources/index.md#storage) and [telemetry identity](../telemetry/identity.md) own their additional files.

## Opening a home

Provisioning the token for an installed service can precede the first serving boot. This construction can create storage directories, load metadata and read or create the token. It skips the serving migration, resource loading, installation, default channel, display initialization and watches. The daemon must still recognize a first serve. ^token-only-boot

A serving boot observes the following dependencies. ^bootstrap-sequence

1. Before writing anything, capture whether the home has [evidence of prior service](../telemetry/identity.md). Include legacy screen metadata and the legacy onboarding sentinel. An empty directory structure, token, config or telemetry identity alone still permits a first install.
2. Run the [stored-data migration](migration.md) before creating or reading the current workspace. Load channels and artifact records, recover membership from their layouts, then open the [resource layer](../resources/index.md#^rs-bootstrap) so onboarding can write initial store values.
3. Take the installer's [content snapshot](../onboarding/installer.md#^onboarding-focus-rule) before installing starter channels. After installation, including when there is no bundle, create one empty channel named `Default` if the home has no channels. Deleting the last channel during service may leave the workspace empty until another boot. ^default-screen
4. Apply [bundled-theme installation](../themes/bundled-installation.md) before scanning the registry. Load or initialize display state against that registry. Apply the installer's one-time default-theme decision before invalid-selection fallback, then apply onboarding focus and start observing content.

An unreadable or invalid artifact record, including an ID that disagrees with its filename, stops startup. Identify the file and tell the operator how to correct it or unregister the artifact while preserving its content. Missing source content is a normal condition for a valid record. During ordinary loading, skip malformed channel records with a diagnostic. A failure converting a record in the migration follows the [migration failure rule](migration.md#^mig-record-atomic).

## Observing content

Watch the target of each path artifact. A file watch follows its name across file replacement. A folder watch covers the whole tree, including nested assets that the current document does not reference. Coalesce changes for the same artifact into an `artifact-content-changed` notification carrying its `artifactID`. Retargeting a path moves observation to the new source. Deletion ends observation. ^rn-local-content-change

Path artifacts and the [active theme package](../themes/index.md#^themes-active-package-watch) share a filesystem watcher. A folder uses one native recursive watch, independent of the number of descendants. Report loss of the root or an ancestor, watch for the root's return while absent, then reattach and report recovery. A runtime error on a present root is reported and closes the failed watch. A stopped or superseded watch and its pending notifications can no longer announce changes. The artifact and theme consumers publish their respective domain events. ^rn-shared-content-watcher

## Telemetry at commit

Bootstrap supplies the resolved server settings, actual port, version, launch mode and installation provenance to [boot derivation](../telemetry/derivation.md). Attach action reporting after store initialization. Boot events see the committed settings after theme validation and fallback. Installing starter content and initializing display state produce no user-action events. ^bootstrap-theme-telemetry

For the [actions telemetry counts](../telemetry/emitters.md), report a committed change with its originating client metadata and the prior and resulting state needed to classify it. Preserve the cause of deletion and distinguish explicit theme selection from registry fallback. A combined display patch takes effect in full before either action is reported. Same-value patches, automatic pin pruning and theme content refresh produce no spurious actions. Each event reads the current settings, including consent and registry state. Failure to report an action cannot fail the workspace change. ^store-theme-telemetry

## Testing

Exercise the shared watch on real temporary files and nested directories, including root loss, recovery, runtime error and close. Prove the two consumers translate its notifications into their respective events. [Artifact acceptance](../../product/artifacts.md#^af-folder-live-update) owns the running-server-to-client check.

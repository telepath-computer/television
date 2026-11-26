# Server spec changes

This experiment starts at Television commit `174e52ef`. It gives the server an architecture spec for the parts a replacement implementation would have to get right for existing homes, running clients, installed services and shared artifact links. The [server entry point](../../specs/arch/server/index.md) takes about a page to read.

## How the drafts were reviewed

I wrote the draft and asked one independent agent to compare it with the revised spec policy, the neighboring specs and the server implementation. Its first verdict was **fail**. It found that the control API described operations without enough detail for a separately running CLI, that the store spec omitted whole-record recovery for invalid display state, and that the migration spec called the intermediate field `activeChannelID` current.

I added the CLI request and response contracts, specified how display recovery handles pins and JavaScript consent, and distinguished the intermediate field from the final `focusedChannelId`. I also corrected stale ownership references and narrowed the testing guidance. The same reviewer read the revised specs and this overview and returned **pass**. I checked the generated spec index, links and block anchors separately.

## A reading path for the judge

| Read | A question the spec should answer |
|---|---|
| [Listener startup and discovery](../../specs/arch/server/index.md) | The machine starts before its Tailscale address exists. What happens to the loopback listener, what evidence reaches the operator, and who retries? The last part belongs to [CLI service recovery](../../specs/arch/cli/startup-bind-failure.md). |
| [Opening a home](../../specs/arch/server/store.md) | A daemon installer has already created the token. Which boot still counts as the first serve? Follow the ordering through resource loading, onboarding, theme selection and observation. |
| [Stored-data migration](../../specs/arch/server/migration.md) | Which directory wins when a home contains both screen and channel metadata? What happens if the upgrade stops after renaming the directory but before converting display state? |
| [Artifact registry and serving](../../specs/arch/server/artifacts.md) | A title edit rewrites a shared artifact’s record. What must survive the write, and what can a browser holding only the share URL learn from a redirect, a failed request or a cached document? |
| [Client connections](../../specs/arch/server/connections.md) | What can a separately running CLI send, when is an event subscription live, and how does an agent launched from chat reach the correct home? |

## Where authority moved

Serving bootstrap and the empty-home fallback came out of onboarding. The layout migration and channel-state display conversion now form one account of the on-disk upgrade. The startup bind-failure document retains the CLI exit and service-manager behavior. The server owns the bind attempt and the diagnostic record.

The telemetry buffer has been distributed across startup, store commits and client connections. The local watcher moved out of frame navigation. The frame owns its reaction to a content change, and the theme registry owns its reaction to a change in the selected package. The resource spec’s artifact-record, share-serving and event-stream buffers moved to the server. Resource access levels, write durability and event payloads still have one definition in the [resource architecture](../../specs/arch/resources/index.md).

## Where the policy affected the draft

The artifact record has a TypeScript shape because the next release must read it from disk. The difference between a missing source document and malformed registration metadata is explicit because silently skipping the latter can make a registered artifact disappear. A share URL has precise redirect and error behavior because an otherwise ordinary filename redirect can disclose the more powerful artifact ID.

The server’s in-memory indexes, watcher callback signatures, debounce intervals and handler registration sequence are implementation choices. The transport spec gives the routes and results used across processes. The served web bundle’s private event vocabulary retains the [channel-state boundary](../../specs/arch/channel-state/index.md#^cs-wire-carve-out). Artifact isolation, the desktop handshake, resource operations, theme delivery and update polling retain their feature owners.

The deliverable is the proposed spec tree and its [authority map](../../specs/spec-migration.md). Proof relocation, downstream citation repair and runtime conformance testing are outside this authoring pass.

# Server spec changes: overview for the judge

This document orients a reader comparing independent attempts at moving Television's server to spec authority. It describes this attempt's result, the judgments behind it, and where to look. It has no authority; the specs it describes do.

- **Branch:** `thopter/server-specs-opus55`, based on `origin/main` at `174e52ef`.
- **Author:** Claude Opus 5.5, in Claude Code.
- **See the change:** `git diff 174e52ef..thopter/server-specs-opus55 -- specs`. The new specs are under `specs/arch/server/`.
- **Working documents:** this overview; `server-notebook.md`, suspected server defects found while reading, none of them made into requirements; `server-specs-task.md`, the task record.

## The task as given

The repository owner asked for every spec touching server mechanics to be read, for the server to move from code authority to spec authority, and for `specs/spec-policy.md` to be followed rigorously on what belongs in a spec, because the existing specs run heavy. The owner expected reorganization, not only new files: buffers in other specs hold server content, and other server content may be specified in the wrong place. Later the owner said to finish the spec changes on the author's judgment and to skip moving proofs and code citations.

## The result in one paragraph

A new `specs/arch/server/` tree of six specs owns the mechanisms every server feature shares: starting and stopping, authentication and the route surface, the event stream, the home's storage and bootstrap, the boot-time migration, and serving and watching artifacts' local files. Requirements that the server carries out for one feature, such as themes, resources, telemetry, update notices and onboarding, stay with that feature's spec, which is how most of the tree already worked. Every buffer that another spec held for the server is gone: each statement in it went to its real owner, was merged with an equivalent statement already there, or was dropped as a restatement or as history. The specs describe the server as it is; where the author found behavior that looks like a defect, it went into the notebook instead of the specs.

## The server tree

| Spec | Lines | Owns | Where its content came from |
|---|---|---|---|
| `index.md` | 55 | What a server is; the module map; which feature specs own requirements the server carries out; what stays code-governed on purpose; the one-release stance and the contracts that cross releases; the ACP bridge's home context. | New, plus the ACP home-context buffer from `arch/cli/index.md`. |
| `lifecycle.md` | 66 | All-or-nothing listener binding; the fatal record of a failed start; what starts once listeners bind; the server's origins; `/health`; stopping; the log. | The server half of `arch/cli/startup-bind-failure.md`, the origins buffer from `arch/cli/index.md`, and new statements of existing behavior. |
| `http.md` | 56 | Authentication by token; the route table (token requirement and owner of each family); refusal statuses and error text; answers to unexpected failures; the `/events` stream and the two messages clients may send on it. | The authorization column of the isolation spec's route table, the resource layer's `/events` buffer, the event-stream part of the telemetry buffer, and new statements of existing behavior. |
| `storage.md` | 95 | The home's layout and each file's owner; one server per home; the token file; the artifact, channel and display records; the display record's loading rule; the serving bootstrap, token-only construction and the default-channel invariant. | The bootstrap, token-only and default-channel sections of `arch/onboarding/installer.md`, the general save rules of the resource layer's artifact-record buffer, and new statements. |
| `migration.md` | 105 | The one boot-time migration of a pre-redesign home. | Moved from `arch/layout/migration.md`, plus channel state's display-migration buffer. |
| `local-content.md` | 32 | The artifact proxy's addresses, redirects and answers, serving under a share ID, its own headers; content watching and the events it produces. | The resource layer's share-serving buffer, reload-navigation's content-watcher buffer, and new statements. |

`arch/cli/startup-bind-failure.md` keeps only the CLI's half: the exit status, the generated service definitions' restart cadence, and foreground behavior.

## Judgments a reader should check

**Feature requirements stay with features.** A buffer's usual framing was that a requirement "imposed on an unmigrated server module" belonged to a future server spec. Under the revised policy what matters is who owns a requirement, not which module runs it. The theme, resource, telemetry, update and onboarding specs already own server behavior for their features, so the server specs reference them rather than absorbing them. The root's table maps each feature to its specs.

**The telemetry buffer was deleted rather than moved.** Almost every statement in `arch/telemetry/server-telemetry-buffer.md` restated a rule already owned by `emitters.md`, `sessions.md`, `identity.md`, `client.md`, `client-signals.md` or `derivation.md`. Two statements were unique and moved to their telemetry owners: the definition of *prior serving evidence* (now `identity.md#^prior-serving-evidence`) and the exact acceptance rule for the activity signal (now `sessions.md#^activity-signal-acceptance`). The route list went to the server route table. Use `git show 174e52ef:specs/arch/telemetry/server-telemetry-buffer.md` to check that nothing with authority was lost.

**Moved text was re-judged, not copied.** Anchor IDs were kept so that citations can follow, but each statement was judged again under the policy. Removed in passing: history (a Discord announcement, how the browser's field names changed); backlog lists (the bind-failure spec's non-goals); an internal type (`ServerStoreOptions`, which only the CLI and tests construct and which both sides change together); an internal bootstrap step (rebuilding an index in memory); a claim about the cost of recursive folder watching that the author could not verify; and restatements of rules other specs own. The bind-failure rationale was shortened but kept, because it answers the objection an implementer would raise ("why not keep running on the addresses that did bind?").

**New authority is limited to contracts and decisions.** Statements that were code-governed before and are spec authority now:

- the stored artifact record's full shape, and the files and composition of the channel and display records, all of which later releases read and some of which `tv` prints to agents;
- the token file's location, strength and format, which the CLI and people read;
- the home's layout, including `artifacts/`, where the `television` skill tells agents to keep HTML artifacts;
- `/health`'s response, which `tv status` passes to agents;
- authentication mechanics, the token requirement per route family, refusal statuses, and the rule that the server's error text is the CLI's wording, which the CLI depends on;
- two security decisions the code carried silently: unexpected failures answer with standard status text, never the failure's message (an artifact ID can hide in it), and the app's page is served with `Referrer-Policy: no-referrer` because the connect link carries the token in the address;
- the artifact proxy's address shapes and answers, which other Television hosts rely on when they load shared artifacts;
- that a failed start emits no telemetry, so a server in a restart loop does not report a start each time;
- the log's bounds, and that a failed log write never fails the operation.

**Left code-governed on purpose.** The route and event vocabulary shared only with the same release's app and CLI, following the carve-out `arch/channel-state/index.md` already made; the Markdown editor's content protocol and the server's Markdown rendering, inside the frame-core carve-out; and the ACP bridge apart from its home context. The root states these.

**Left out pending the owner's decision.** The author found behavior that the specs would either have to bless or contradict, and left the specs silent instead (details in the notebook):

1. Channel and display records are rewritten in place, not atomically, so a crash mid-write can lose a channel from the list or reset pins, theme and consent. Artifact records, resource files and the onboarding state are atomic.
2. One unreadable artifact record stops the server from starting, while an unreadable channel record is skipped silently.
3. `POST /channels` accepts a caller-supplied ID without validation, so a request can overwrite an existing channel or write outside `state/channels/`. TV-549 records the caller-supplied ID gap but not these consequences.
4. The token file is created with default permissions, and an empty token file authorizes an empty token.
5. The Markdown editor's saves are not atomic and overwrite concurrent edits.

## What was not done

- **Proofs and code citations were not moved,** on the owner's instruction. Only the migration proof moved, with its spec. Proofs and code comments still cite moved anchors at their old paths, the new specs other than `migration.md` have no proof files, and the proof for the deleted telemetry buffer is orphaned, so `test/repo/spec-links.test.ts` fails. Inside `specs/`, every link and block reference resolves and every anchor is unique (checked with a script equivalent to that test's spec checks).
- **No product spec was added.** User-facing server behavior (the home, the config file, connect links, starting and stopping) is already owned by `product/cli.md`; this work changed one pointer there.
- **Neighbouring heavy specs were not trimmed** beyond the statements that moved. The installer, migration and resource specs remain dense; trimming them is a separate exercise.

## Review

This is the author's unreviewed output. The repository's workflow calls for independent agent review of spec changes before proofs are derived; the owner asked that this comparison use each author's result before any review, so none is applied here.

## Reading order

1. `specs/arch/server/index.md`, for the map and the ownership boundary.
2. `storage.md` and `http.md`, which hold most of the newly authoritative statements.
3. `lifecycle.md` beside `git show 174e52ef:specs/arch/cli/startup-bind-failure.md`, to compare the split and the trims.
4. `local-content.md` beside the removed resource and reload-navigation buffers.
5. The edits to `spec-migration.md`, `arch/resources/index.md`, `arch/onboarding/installer.md`, `arch/telemetry/identity.md` and `sessions.md`, and `arch/artifact-frame/isolation.md`.
6. `server-notebook.md`, for the defects left out of the specs.

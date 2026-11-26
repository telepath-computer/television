# Server spec changes: overview for the judge

This is the second of three independent attempts to move Television's server (`packages/server`) from code authority to spec authority. It was written by Claude Fable 5.2 on branch `thopter/server-specs-fable52`, from `origin/main` at `174e52ef`. Read this first; it says what changed, why the result has the shape it has, and where to look.

## What the task was

Before this change the server had no architecture spec of its own. Requirements on it were scattered across other specs in sections marked as "buffers" or "holding specs", each saying a future server spec should absorb it. The task was to create that server spec tree, move the buffered content into it, move other server content where it belonged, and follow the recently revised spec policy (`specs/spec-policy.md`) strictly on what belongs in a spec. The repository's existing specs are heavier than that policy wants, so the new specs were meant to be lighter than their neighbours.

## Scope limits you should know about

- **Specs only.** Josh waived moving proofs and code citations, as derivative work outside the experiment. `proofs/` is untouched. Proofs and code comments that cite a moved spec or anchor now point at the old location, so the repository's link test (`test/repo/spec-links.test.ts`) fails on them and on the missing mirror proofs for the six new specs. Links inside `specs/` are all valid; I checked every relative link and block ref there with a script.
- **No independent review.** The workflow calls for a second model to review spec changes. I did not run one, so that the result stays one author's work for the comparison.
- **No code, test or package-doc changes.** `packages/server/README.md` and `packages/server/docs/` still describe the server in their own words and are stale in places; I left them.
- I did not read the other two attempts.

## The result in one view

Six new specs under `specs/arch/server/`, 386 lines in total:

| Spec | Lines | What it owns |
|---|---|---|
| `index.md` | 67 | What the server is; four decisions it rests on; a table of who is on the other side of each boundary and what they rely on; a map of which spec owns each part of the server; the experimental agent bridge |
| `lifecycle.md` | 79 | The two ways a store is constructed; the order of a serving start; listening on every address or none, with one fatal log record; origins; stopping |
| `storage.md` | 80 | The layout of a home with the owner of each path; the channel, artifact and display records; the token file; how stored formats change between releases; the log |
| `http.md` | 61 | Authorization and the three classes of route; the health response; refusals; the event stream; what about the API is deliberately not pinned |
| `artifacts.md` | 54 | The artifact record and its two kinds; which channel holds an artifact; watching a path artifact's files |
| `artifact-proxy.md` | 45 | The proxy's addresses; what it adds to responses; serving under a share ID; caching |

Across the rest of `specs/`, 26 existing files changed, with 181 lines added and 314 removed. Two specs were deleted and one was moved.

## The judgment behind the shape

The revised policy says a spec holds what derivation cannot be trusted to get right: contracts with something outside the product's own running code, decisions a human wants to own, and knowledge that would otherwise be lost. I applied that as follows.

**The server's features already have owners, so the server tree is small.** Most server behavior belongs to themes, resources, telemetry, onboarding, layout, channel state or updates, and those specs already state it. I did not restate any of it. The server specs own only what no feature owns, and `index.md` maps the rest by link.

**What a spec pins depends on who is on the other side.** The central table in `index.md` lists each party the server meets and what it relies on. That drove what got written:

- A later release reads the files in the home, so `storage.md` pins the layout and the composition of the three core records.
- The web application ships with the server, so route names, bodies and event names are explicitly not pinned (`http.md`, "What is not pinned"). No spec lists the routes or the event types.
- Artifact documents and share links outlive any release, so `artifact-proxy.md` pins the address forms.
- The CLI reads the token file and the health response directly, so both are pinned.

**Ownership of composed things stays with each field's owner.** The stored channel, artifact and display records are written as intersections of types that other specs own, with a comment naming each owner. `storage.md` owns where the files are and how they compose, not what the fields mean.

**Buffers were dissolved by sending each statement to its real owner, which was not always the server.** The telemetry buffer is the clearest case: most of it described telemetry's own messages, hooks and routes, so it went back into the telemetry specs, and only the startup-order step came to the server.

**Mechanism was cut where any reasonable implementation would do.** Examples of what I removed while moving content: `ServerStoreOptions` field names, the function names `Server.getOrigins()` and `os.networkInterfaces()`, the watcher's internal handoff names, source file paths, and the long worked rationale in the bind-failure spec (kept as one paragraph). I kept mechanism only where getting it differently would plausibly go wrong, such as one recursive watch per folder instead of one per directory, and recovery when a watched folder is replaced.

**Suspected accidents in the code were not written into specs.** Where current behavior looked unintended, I left the specs silent and listed it below for a human to decide.

## Where each buffer and holding spec went

| Before | After |
|---|---|
| `arch/cli/startup-bind-failure.md` (whole "provisional holding spec") | Deleted. The all-or-nothing start, the fatal record and the error classes are in `server/lifecycle.md` ("Listening"). The exit status, foreground behavior and the service definitions' restart settings are in `arch/cli/index.md`. This is the split the old spec itself prescribed. Shortened from 89 lines to about 45 across both places. |
| `arch/telemetry/server-telemetry-buffer.md` (whole file) | Deleted. Activity-signal acceptance went to `telemetry/sessions.md`; hook and snapshot rules to `telemetry/emitters.md`; the control routes and the definition of "has served before" to `telemetry/identity.md`. The capture-first step is step 1 of `server/lifecycle.md`. |
| `arch/onboarding/installer.md`, "Bootstrap ordering and telemetry silence" | The serving start order and token-only construction moved to `server/lifecycle.md`. The installer keeps a short section saying where it runs in that order and why its installs are not reported to telemetry. |
| `arch/onboarding/index.md`, "Buffer: impositions on modules without specs" | Removed; nothing remains to buffer. |
| `arch/layout/migration.md` and `arch/channel-state/index.md`, the two "server buffer" paragraphs | The migration and the display-record mapping stay with their specs, which really own them. Only the "this is a buffer because the server has no spec" framing was removed, and both now link to the serving start order. |
| `arch/resources/index.md`, three buffers | The artifact-record buffer became resources' ownership of two fields of a record the server owns. Serving under a share ID moved to `server/artifact-proxy.md`. The event-stream buffer kept only what is about resource events; token transport and the `4401` close code moved to `server/http.md`. |
| `arch/artifact-frame/reload-navigation.md`, local path-content updates and the shared watcher | Moved to `server/artifacts.md` ("Watching content") and shortened. The client's reaction to the event stays in reload-navigation. |
| `arch/cli/index.md`, "Buffer: the server's origins" and "Buffer: ACP agent home context" | Moved to `server/lifecycle.md` ("Origins") and `server/index.md` ("The experimental agent bridge"). |
| `arch/artifact-frame/proxy-caching.md` (not a buffer, but a whole spec about a server module) | Moved to `server/artifact-proxy.md` and extended with the address forms and share-ID serving, so the proxy has one owner. |

Block refs kept their IDs when their statements moved (for example `^bootstrap-sequence`, `^all-or-nothing`, `^rs-share-serving`, `^rn-shared-content-watcher`), so whoever updates proofs and code citations later changes file paths only. New refs use a `srv-` prefix.

Supporting edits: `spec-migration.md` gained a Server entry and lost the absorbed buffers; `terms.md` gained a Server section; `product/artifacts.md` no longer says the artifact record is unspecified; `product/cli.md` and `product/telemetry.md` had links and one "while no server spec exists" phrase updated; `specs/index.md` was regenerated.

## What is newly stated, as opposed to moved

These statements did not exist in any spec before. A human should look at them hardest, because moved text was already reviewed and these were not.

- `index.md`: the four decisions (one store owns the state; one server per home, as an accepted limitation; state is ready before the server listens; features attach to the core).
- `index.md`: that a newer `tv` can meet an older running server after an upgrade, and that Television makes no compatibility promise for that interval (`^srv-cli-same-release`). This describes what the code does today; whether it is the intended stance is Josh's call.
- `storage.md`: the layout table, the composed record types, the token file, the two ways a stored format may change and that downgrade is unsupported server-wide (previously said only for layout and resources), and the log's shape.
- `http.md`: the three route classes and the default that a new route requires the token; refusals carry a message the CLI prints as written; the event stream's four rules; the statement that the API is not public, with the table of exceptions.
- `artifacts.md`: the `Artifact` type; that channel membership is stored only in layouts; the definition of a remote artifact by address shape.
- `artifact-proxy.md`: the address forms for folder, single-file and Markdown artifacts; `Referrer-Policy: no-referrer` and its reason.
- `lifecycle.md`: the "Stopping" section.

## Things found in the code that I deliberately did not specify

Each of these needs a human decision before it becomes a requirement or a bug report. Writing them into a spec as-is would have turned accidents into authority.

1. `POST /channels` accepts a caller-supplied channel ID without validating it, and uses it in a file path. An existing ID overwrites that channel. (The product spec already tracks the caller-supplied ID as a gap, TV-549, but not the path or overwrite risk.)
2. Channel records and the display record are written with a plain file write, while artifact records and resources get a temp file, flush and rename. A crash while writing `display.json` silently resets focus, pins, theme and consent.
3. Loading is uneven: an unreadable channel record is skipped with a warning, an unreadable display record is silently reset, and an unreadable artifact record stops the server from starting, including in token-only construction.
4. The token file is created with default permissions, and an empty token file makes an empty bearer token valid.
5. An artifact left on no channel after an interrupted move is never reported or repaired, and deleting it announces nothing.
6. A cross-channel move is announced to clients as an `artifact-created` event on the target with no removal event for the source.
7. The agent bridge's child process runs in `~/.television/acp` whatever home the server serves.

## Where I am least sure

- **Moving `proxy-caching.md` into the server tree.** It gives the proxy one owner, but it changes the artifact-frame module map and will move a proof. Leaving it in place and only linking to it was a defensible alternative.
- **Leaving the home resolver and config reader in the CLI spec.** That code lives in the server package, but the home and the config file are CLI product concepts and the server reads neither, so I left their contract with `arch/cli/index.md`. That section still pins internal function signatures, which the revised policy discourages; trimming it was outside this task.
- **Leaving the route table in `isolation.md`.** `http.md` defines the three route classes in prose and points to isolation's table for the cross-origin rules, so the list of routes has no single owner other than that table.
- **How much of the watcher to keep.** I kept three behavioral rules and dropped the rest. A reviewer could reasonably want fewer.
- **Existing neighbours are still heavy.** I shortened what I moved but did not rewrite specs I was only relinking, so the contrast between the new server specs and, say, `resources/index.md` is intended, not an oversight.

## How to read the change

1. `specs/arch/server/index.md`, then the other five in the order of its "Specs" table.
2. `git diff origin/main -- specs/spec-migration.md` for the before and after of the authority map.
3. `git diff origin/main --stat -- specs` for the footprint, then the diffs of `arch/cli/index.md`, `arch/resources/index.md`, `arch/onboarding/installer.md`, `arch/artifact-frame/reload-navigation.md` and the three telemetry specs to see how the buffers were dissolved.
4. `git show origin/main:specs/arch/cli/startup-bind-failure.md` and `git show origin/main:specs/arch/telemetry/server-telemetry-buffer.md` for the two deleted specs.

`docs/working/server-specs/task-record.md` is my working record: where requirements on the server lived before the change, and the list of proofs and code files that cite moved content.

# Server notebook

Possible defects, contradictions and refactoring concerns found while reading the server for the spec work. None of these is a requirement, and the specs stay silent on each: each needs the owner's decision before it becomes one, or a fix.

## Possible defects

1. **Caller-supplied channel IDs are trusted.** `POST /channels` accepts `id`, and `ServerStore.createChannel` uses it verbatim (`input.id ?? ulid()`). A supplied ID equal to an existing channel's replaces that channel in memory and overwrites its record with an empty layout, leaving its artifacts on no channel. The ID also becomes a file name (`state/channels/<id>.json`) without validation, so `../` segments write outside the directory. The route requires the token, but on a tokenless server any page that can reach the server can call it. `product/channels.md#^ch-identity` records the caller-supplied-ID gap as TV-549, but not these consequences.
2. **Channel and display records are not written atomically.** `persistChannel` uses plain `writeFileSync` except during a move, and `persistDisplayState` always does. A crash mid-write leaves a truncated file. On the next boot a truncated channel record is skipped with a console warning, so the channel disappears and its artifacts are left on no channel; a truncated `display.json` fails strict loading and display state starts fresh, losing pins, theme selection, appearance preference and JavaScript consent. Artifact records, resource files, the onboarding state file and the bundled-theme state file are all written atomically.
3. **One unreadable artifact record stops the server from starting, while an unreadable channel record is skipped.** `load()` throws on invalid artifact metadata, so the persisted service restarts forever until the file is repaired, but skips malformed channel files. The difference may be intended, since artifact records carry store pointers and share links.
4. **The token file is created with default permissions.** `loadOrCreateAuthToken` writes `state/token` with `writeFileSync` and no mode, so with a typical umask other local users can read it.
5. **An empty token file authorizes an empty token.** A token file that trims to `""` gives `authToken === ""`; `isAuthorizedBearer("Bearer ", "")` is true, and an empty `?token=` passes the `/events` check. The CLI treats an empty file as no token.
6. **Token comparison is not constant-time.** `isAuthorizedBearer` and `isAuthorizedQueryToken` compare with `===`. The practical risk is low for a service on loopback or a tailnet.
7. **A failed channel create leaves the channel in memory.** `createChannel` adds the channel to its map before `persistChannel`; when the write fails, the request fails but the channel stays listed until the server restarts.
8. **A channel record's ID is not checked against its file name.** When two files carry the same `id`, the last one read wins.
9. **Markdown editor saves are not atomic and overwrite concurrent edits.** `PUT /markdown/:id` writes the person's file with `fs.writeFile`. A crash mid-write truncates their Markdown file, and an agent's edit made between the editor's load and its save is lost. The content protocol is inside the frame-core carve-out, so no spec governs it.


## Contradictions and stale surfaces

10. **"The server does not mutate the target" is broader than the product.** `product/cli.md#^e5b85571` says the CLI and server "do not copy, own, delete, or mutate the file, directory, or URL target". The Markdown editor writes to the target file through the server. The sentence is true of the registry operations its context discusses.
11. **Two identical auth middlewares.** `Server` has `requireAuthorization` and `requireBearerAuthorization`, which do the same thing. A comment in `routes.ts` keeps the desktop connect check on the bearer-only one because its cross-release contract freezes `Authorization: Bearer`; both are bearer-only.
12. `ServerStore.getViews()` returns an empty array and nothing needs it.
13. `ServerOptions.host` is deprecated and kept for package-local test helpers.
14. `GET /display` returns `activeScreenID: null`. This looks vestigial but is not: desktop releases `0.1.145` to `0.1.206` identify Television through it (`arch/updates/desktop-upgrade-gate.md#^pre-gate-legacy-display`) until the TV-684 cutoff.

## Refactoring concerns

15. **The `Server` constructor defaults to tokenless** (`auth ?? false`), the opposite of the product default. The CLI passes `auth` explicitly for this reason (`arch/cli/index.md#^cli-serve-adapter`), but any other code that constructs a server and omits it gets one that requires no token.

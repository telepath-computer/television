# Server notebook

Possible defects, contradictions, accidental behavior and refactoring concerns found while reading the server. None of these is a requirement. Each needs a human decision before it becomes one, or a fix.

## Possible defects

1. **Caller-supplied channel IDs are trusted.** `POST /channels` accepts `id` and `ServerStore.createChannel` uses it verbatim (`input.id ?? ulid()`). A supplied ID equal to an existing channel's replaces that channel in memory and overwrites its record with an empty layout, leaving its artifacts on no channel. The ID also becomes a filename (`state/channels/<id>.json`) without validation, so `../` segments write outside the directory. Token-protected, but tokenless mode exposes it to any local page. The product spec records the caller-supplied-ID gap as TV-549 but not these consequences.
2. **Channel and display records are not written atomically.** `persistChannel` uses plain `writeFileSync` except during a move; `persistDisplayState` always does. A crash mid-write leaves a truncated file. On the next boot a truncated channel record is skipped with a console warning, so the channel disappears and its artifacts are left on no channel; a truncated `display.json` fails strict loading and display state is reinitialized, losing pins, theme selection, appearance preference and JavaScript consent. Artifact records, resource files and the onboarding state file are all written atomically with flushes.
3. **The token file is created with default permissions.** `loadOrCreateAuthToken` writes `state/token` with `writeFileSync` and no mode, so with a typical umask it is readable by other local users.
4. **An empty token file authorizes an empty bearer.** A token file that trims to `""` gives `authToken === ""`; `isAuthorizedBearer("Bearer ", "")` is true, and `?token=` with an empty value passes the `/events` check. The CLI treats an empty file as no token.
5. **Token comparison is not constant-time.** `isAuthorizedBearer` and `isAuthorizedQueryToken` use `===`. Low practical risk for a localhost or tailnet service.
6. **A failed channel create leaves the channel in memory.** `createChannel` adds to the map before `persistChannel`; a write failure throws with the channel still listed until restart.
7. **One unreadable artifact record stops the server from starting, while an unreadable channel record is skipped.** `load()` throws on invalid artifact metadata but skips malformed channel files. The asymmetry may be intended (artifact records carry store pointers and share links) but is not stated anywhere with authority.
8. **Channel record ID is not checked against its filename.** Two files with the same `id` field: the last read wins.

## Contradictions and stale surfaces

9. ~~`GET /display` returns `activeScreenID: null`.~~ Not a defect: desktop releases `0.1.145`–`0.1.206` identify Television through it, under `arch/updates/desktop-upgrade-gate.md#^pre-gate-legacy-display`, until the TV-684 cutoff.
10. `Server` has two identical middlewares, `requireAuthorization` and `requireBearerAuthorization`. The comment in `routes.ts` says the connect check is kept on the bearer-only one because the cross-release contract freezes `Authorization: Bearer`; today both are bearer-only.
11. `ServerStore.getViews()` returns an empty array and has no purpose.
12. `ServerOptions.host` is deprecated, kept for package-local test helpers.

14. **Markdown editor saves are not atomic and do not detect concurrent edits.** `PUT /markdown/:id` writes the user's file with `fs.writeFile`. A crash mid-write truncates the person's own Markdown file, and an agent's edit made between the editor's load and its save is overwritten. The content protocol is inside the frame-core carve-out, so no spec governs it.
15. **"The server does not mutate the target" is broader than the product.** `product/cli.md#^e5b85571` says the CLI and server "do not copy, own, delete, or mutate the file, directory, or URL target". The Markdown editor writes to the target file through the server. The sentence is true of registry operations, which is what its context discusses.

## Refactoring concerns

13. The `Server` constructor default is tokenless (`auth ?? false`), the opposite of the product default; the CLI passes `auth` explicitly for this reason (arch/cli/index.md). Any other embedder that omits it gets an unauthenticated server.

> **Archived 2026-10 from `thopter/artifact-isolation`.** This was the task record an agent kept while carrying TV-958 from the human's decisions to a verified change, and the change follows the calls it records. It preserves why each call was made and what was weighed against it, the Electron behavior checked by probe, the checks that showed each test fails without its protection, and the full measurements of partition cost, which the specs and the pull request state only as outcomes. The body below is its working state, less its status section, a closing note on a tool under evaluation, and references to branches, pull requests and commits outside this repository, and is a clue to the change, not a record of it.

# TV-958 task record

Working record for [TV-958](https://linear.app/telepath-computer/issue/TV-958): in the desktop app, artifact webviews run unsandboxed in Electron storage partitions apart from the window's session. It builds on TV-378's sandboxing. The human's decisions are the ticket's two comments of 2026-10-09; the human is away and reviews everything, specs included, on the final PR.

## Calls made without the human, and why

Each is a reasonable call under the decisions; each is open to the human's review on the PR.

1. **The interface names a logical partition; the main process sets the real one.** The served interface sets `partition="tv-artifact:<id>"` or `"tv-url-artifact"`; in `will-attach-webview` the main process replaces it with `persist:artifact-<32 hex of SHA-256(origin\nid)>` or `persist:url-artifacts`. The interface cannot hash synchronously in the page, the record and the server keying belong to the main process, and a hash keeps directory names short and case-safe whatever an artifact ID holds. Checked in Electron 43.7.6 that rewriting `webPreferences.partition` there takes effect.
2. **A bridge flag, `__televisionNativeBridge.artifactPartitions === 1`, gates partitions.** TV-378 desktop releases set permission handlers only on the default session. A newer interface that placed webviews in partitions on such an app would give artifacts every permission Electron grants by default (notifications, geolocation…). With the flag, older apps keep TV-378's arrangement.
3. **No partition means the fallback partition; an unknown partition name is refused.** The human's decision allows the shell to keep the default session only while no artifact webview uses it, so a webview from an interface without partition support (a TV-378-era or older server) goes to `persist:webview-fallback`, never the window's session. The fallback keeps the sandbox header, because removing it there would put every artifact of such an interface on the server's origin in one shared storage area; documents of a TV-378-era server stay sandboxed as that interface expects, and those of a pre-TV-378 server, which sends no header, run unsandboxed but apart from the app's storage, which is better than the window's session they would otherwise share with the token. It is persistent so websites shown through such an interface keep their logins across restarts, shared because the main process cannot tell those webviews' artifacts apart, and never reaped. Refusing unknown names keeps any webview out of a session the main process has not set up.
4. **Header removal is narrow.** Only in the partitions, only on responses that carry `X-TV-Version` to `/artifact/<id>…` paths, and only a `Content-Security-Policy` whose whole value is a `sandbox` directive. Sites that sandbox their own user content with CSP (raw-content hosts do) keep that protection inside the URL-artifact partition, where website logins live.
5. **The reaper reads `GET /artifacts` from the main process** with the saved token, rather than having the interface report its state. The server's answer is complete by construction, needs no new IPC from the window, and works whatever interface version is loaded. Cost: `GET /artifacts` becomes a cross-release contract (stated in the spec, `^dp-artifacts-route`); pagination would break it.
6. **The reaper deletes only partitions Electron has not opened since the app started.** Electron has no API to destroy a session and keeps an opened partition's files open until quit, so removing its directory in-run is unsafe. Such partitions are deleted by a reaping after the next start. Clearing them in-run with `clearData()` was considered and left out: the deleted artifact's partition is unreachable anyway, so it buys only earlier disk cleanup at the cost of a second code path.
7. **Race guards in the reaper.** It only considers entries recorded before its request, and runs one reaping at a time, so an artifact created during a reaping is never taken for a deleted one.
8. **Markdown file artifacts get partitions too.** "One partition per local artifact" applied uniformly; the editor uses no storage, so this costs a session per Markdown artifact. Simpler than a third rule.
9. **Pointer lock stays refused in the desktop app.** The ticket's description listed pointer lock among lifted limitations, but the decision keeps TV-378's permission handler, which refuses Electron's `pointerLock` permission (checked in Electron 43.7.6: the request reaches the handler and is refused). Granting it is a one-line handler change, left to the human (TV-957 covers richer browser features).
10. **Guidance unchanged; the guidance spec records the simplification.** `guidance.md` gains a paragraph saying browser storage works in the desktop app and the guidance still says it does not, and its "states nothing those specs do not promise" sentence names that exception.
11. **What is lost once.** TV-378 already left pre-TV-378 artifact storage unreachable in the default session. What TV-958 newly strands there is websites' data in URL artifacts, such as logins, and older producers' shared artifacts' storage. Recorded as isolation limitation 19.
12. **Product promise on deletion.** `^af-delete-semantics` gains one sentence: for an artifact the server serves from its own files, the desktop app later deletes that artifact's own browser storage once it sees, while connected, that the artifact is gone; the storage URL artifacts share stays (review round 1, finding 3). The product promise says the storage is kept apart from the app's and other artifacts', and promises nothing about the app reading it, since the trusted shell can inspect its webviews (finding 4).
13. **Referrers in the desktop partitions: `strict-origin-when-cross-origin`.** The proxy sends `Referrer-Policy: no-referrer` (code-governed since the first public snapshot), which survives the sandbox's removal and would keep map tiles and referrer-restricted API keys failing (spec review round 1, finding 2). On the same proxy responses where it removes the sandbox header, the main process sets `strict-origin-when-cross-origin`, Chromium's default. Requests to other sites carry only the server's origin, so the artifact ID or share ID in the document's address, a capability, never reaches another site; same-origin requests carry the full address to the server that already serves it; an `https:` document sends nothing to an `http:` address. `origin` (origin even to the own server) would also hide the ID but departs from the browser default for no gain; `origin-when-cross-origin` would send the origin on HTTPS-to-HTTP downgrades, which the browser default deliberately withholds. Origin-only referrers satisfy OpenStreetMap's tile policy and Google Maps key restrictions such as `http://host:port/*`. Artifact code can still choose a looser policy for its own requests with `<meta name="referrer">` or `referrerpolicy`, as it can send its address anywhere; the policy prevents accidental leaks, not deliberate ones. Checked in Electron 43.7.6: with the header replaced, a cross-origin image and `fetch` carried `Referer: http://<server>/`, a same-origin `fetch` the full address, and the unreplaced control nothing.
14. **New spec home.** The mechanism (names, flag, attach rules, record, reaper) is a desktop module, `specs/arch/desktop/artifact-partitions.md`; the isolation outcome (sessions, header removal, permissions, limitations) stays in `isolation.md`.

## Electron behavior checked (probe in Electron 43.7.6 under Xvfb, not committed)

- Rewriting `webPreferences.partition` in `will-attach-webview` sets the guest's session.
- Persistent partition data lives at `<userData>/Partitions/<name without persist:>` for these names.
- Removing the header in `onHeadersReceived` unsandboxes the document (origin is the server's, `localStorage` works), and stays removed on reload through a `304` revalidation.
- A webview with no partition stays in the default session and stays sandboxed (`origin` `"null"`).
- `requestPointerLock` from a click reaches the session's permission request handler as `pointerLock`.

## Proof design notes

- The fallback partition's real-Electron seam loads, through the e2e fixture hook, an authored page standing in for a served interface without partition support. The production interface never creates a webview without a partition once the bridge carries the flag, so only a stand-in can exercise that path.
- The reaper's hourly cadence is proven only on a fake clock; the real walk triggers reapings by reloading the served interface and by restarting the app, which the spec's "when that page finishes loading" covers without a test hook.
- Rewritten desktop tests are cited as "test to be written" because their assertions change materially: the desktop escalation walk, the desktop artifacts-load case, the permission seam (the microphone now reaches the handlers; pointer lock added) and the PDF walk.
- Known test fallout to handle in implementation (listed in the plan): `ipc-senders.test.ts` registers its compromised-renderer preload on the default session only; `all-webview-dispatcher.01.test.ts` observes downloads on the default session and comments on a sandboxed subframe's opaque origin; the escalation walk's `onCompleted` observer watches the default session.
- The referrer seam observes the same-origin request with Electron's `onSendHeaders` on the artifact's session, since the server keeps no request log; corrected in the proof at the plan stage.

## Implementation notes

- **Starting baseline**: `unit:desktop`, `packages/web/test/artifact-view.test.ts` and `packages/server/test/endpoints.test.ts` pass; the whole `e2e:desktop` surface passes locally (79 tests, 2.7 min). No failure predates the work.
- **Red/green.** The unit and contract tests were written first and seen to fail (the new module did not exist; the attach, header-installation, permission and wiring cases in `main.test.ts`; the preload flag; the host's partition names), then made to pass. The `GET /artifacts` contract passed at once, as the plan expected, since it pins the existing answer. The end-to-end tests were written after the production change; their failure without each protection is shown by the checks by hand.
- **The host reads the bridge flag on each source assignment**, not once per page as the plan said. The bridge never changes during a page's life, so the behavior is the same, and the jsdom tests can set the flag per case.
- **After a change of kind the view assigns the new webview more than one address** as it restores the artifact's recorded history. The host contract therefore asserts that every assignment to the new webview finds the partition in place, which is what the proof states, rather than exactly one assignment.
- **The desktop escalation walk no longer observes the `POST` through Electron.** The plan moved its `onCompleted` observer to the artifact's partition, but the artifact's session cannot be named before the artifact exists, and its first `POST` runs as soon as the webview loads. Under the partitions the request is same-origin, so the fixture reads the answer itself (`{ type: "basic", status: 401 }`), and the walk still checks that the server's channels and artifacts are unchanged, which is the stronger evidence.
- **The reaping walk observes each reaping through a seeded record entry** for an artifact the server never had, whose directory disappears when a reaping runs. The main process's request is made from Node, which no Electron session observes, and waiting a fixed time would be flaky. The proof's declaration says so.
- **`main.test.ts`'s filesystem mock** covers the record, because the module uses named `node:fs` imports like `connection-store.ts`.

### Existing tests that changed with the sessions

- `ipc-senders.test.ts` and `all-webview-dispatcher.01.test.ts` instrument the artifact webview's session, as the plan said; the latter's comment no longer speaks of a sandboxed subframe.
- `markdown-webview.test.ts` "stops receiving update-content messages after host runtime dispose": its fixture "disposed" the Markdown runtime by turning the artifact into a URL artifact, which now needs another partition, so the host rightly replaced the webview and the fixture's saved element was detached. The fixture now changes the same artifact's file from Markdown to HTML, which keeps its webview and partition while the runtime is disposed, so the test still proves what it set out to.
- `upgrade-gate.spec.ts`, six walks: they classified every `/display`, channel and artifact request as the renderer's and required none while gated. The reaper's main-process `GET /artifacts` now arrives on each load of the server's page, gated or not. The boot barrier governs only the served renderer ([desktop-upgrade-gate.md#^boot-barrier](../../specs/arch/updates/desktop-upgrade-gate.md#^boot-barrier)), so this is in scope of the specs. The test now tells the renderer's requests (Chromium's user agent) from the main process's (Node's `fetch`), and checks that the main process's only functional request is the reaper's. The product proof's gate assertion, `^ac-gate-blocks`, says the same.
- The desktop reaper's `GET /artifacts` is therefore visible to a gated server, though the gate halts the interface. Nothing in the specs forbids it; noted for the human because the gate exists for apps too old for the server, and the reaper relies on the frozen `^dp-artifacts-route` answer, so it is safe across that gap.

### Electron facts found while testing

- Electron's `webRequest.onCompleted` reports a document the server revalidated with `304` as the cached `200` (`fromCache: true`); checked with a probe whose server counted the `304`. The referrer seam observes the revalidation that way.

### Checks by hand (not committed)

Each change was made in the working tree, the named tests run, and the change reverted with `git checkout`:

| Protection removed | Result |
| --- | --- |
| The interface names no partition, so every webview takes the fallback | Sessions seam and reaping walk fail; all five desktop isolation tests that expect partitions fail (origin, storage) |
| No header rewriting in the partitions | Escalation, storage, loading, referrer and permission seams fail (documents sandboxed again) |
| Sandbox removed but `Referrer-Policy: no-referrer` kept | Referrer seam fails: both cross-origin requests carry no `Referer` |
| Header rewriting also on the fallback partition | Fallback seam fails |
| Permission handlers left off the partitions | Permission seam fails: notifications `granted`, microphone `stream`, pointer lock `locked`, geolocation not denied. This also shows the pointer-lock attempt reaches the handlers rather than failing for want of activation |
| Reaper ignores the opened set | Reaping walk fails before the restart: A's directory is gone |
| Reaper writes back the record it read before its request | Deletion contract fails (the in-flight entry) |
| Reaper checks the opened set before its request | Deletion contract fails (the partition opened during the request) |
| `App` leaves the reaper running when another origin's page loads | Wiring contract fails |

### Measuring the cost of partitions

One-off Playwright script in the real Electron app (Linux, Xvfb, software rendering) against a running server, with N HTML artifacts on separate tab pages of one channel and an empty second channel; each build measured twice for A and C, once for B. Channel switches are selected in the sidebar; "cold" is the first switch after launch, "warm" the return from the empty channel, both timed to every webview's `did-finish-load`. Memory is the sum of `app.getAppMetrics()` working sets once loaded.

| N | Build | Cold switch (ms) | Warm switch (ms) | Tab switch (ms) | Webviews created or reloaded by tab switches | Memory (MB) | `Partitions/` on disk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A, per-artifact partitions | 141 / 153 | 96 / 98 | n/a | n/a | 692 | 1.2 MB |
| 1 | B, one shared unsandboxed partition | 148 | 90 | n/a | n/a | 690 | 1.2 MB |
| 1 | C, fallback (sandboxed, one session) | 147 / 162 | 106 / 104 | n/a | n/a | 692 | 1.2 MB |
| 10 | A | 599 / 644 | 535 / 537 | 30–45 | 0 | 1,698 | 12 MB |
| 10 | B | 569 | 552 | 51 | 0 | 1,676 | 1.3 MB |
| 10 | C | 638 / 675 | 632 / 638 | 26–37 | 0 | 1,688 | 1.3 MB |
| 30 | A | 1,603 / 1,705 | 1,422 / 1,484 | 34–46 | 0 | 3,730 | 36 MB |
| 30 | B | 1,558 | 1,465 | 33–44 | 0 | 3,709 | 1.7 MB |
| 30 | C | 1,736 / 1,788 | 1,686 / 1,634 | 35–48 | 0 | 3,696 | 1.7 MB |

- **Time and memory:** per-artifact partitions cost nothing measurable against one shared partition (A against B), and the whole change is no slower than TV-378's single sandboxed session (A against C, where A is slightly faster). Memory is dominated by one renderer process per webview, about 100 MB each here, in every build.
- **Tab switches** create and reload no webview in any build, as the existing lifecycle promises, so partitions cost nothing there.
- **Disk** is the one real cost: each artifact partition holds about 1.2 MB of Chromium's preallocated cache files (HTTP cache index, GPU, Dawn and Graphite caches) before the artifact stores anything, so 100 artifacts that have been shown take about 120 MB. The reaper returns it when artifacts are deleted, after a restart for those opened in the session. Reported to the human with the PR rather than designed around; Electron offers per-session cache settings if it matters.
- Mac numbers will differ in absolute terms; the comparisons are the point.

## Known problems and expected failures

- None at the proof stage; `test/repo/spec-links.test.ts` passes.

## For the PR

- The desktop product spec's manual "Bridge and IPC" check is needed before `main` (native bridge and webview handling change).
- The performance of building webviews in partitions (decision: "try it… will be measured") is to be measured during implementation and recorded here.

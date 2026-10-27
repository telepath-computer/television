> **Archived 2026-10 from `thopter/artifact-isolation`.** This was the implementation plan for TV-958, and the work followed it as one slice, with the deviations its task record lists, such as how the desktop escalation walk observes its `POST` and how the reaping walk detects a reaping. It preserves the one view of how the work was divided and validated: which test carries each proof assertion, the existing tests the sessions changed, the measurement design and the checks by hand. The body below is its working state, less references to a branch and commits outside this repository, and is a clue to the change, not a record of it.

# TV-958 implementation plan

The result is what the specs describe for the desktop app:
- Every artifact webview runs in a persistent partition, never the window's session.
- An artifact the connected server serves from its own files has a partition of its own. Every URL artifact uses the one URL-artifact partition. A served interface without partition support gets the fallback partition, which keeps the sandbox.
- In the artifact and URL-artifact partitions, the main process removes the proxy's sandbox header and sets its referrer policy to `strict-origin-when-cross-origin`.
- Every session carries TV-378's permission handlers.
- The main process records each server's artifact partitions and reaps those whose artifacts the connected server no longer lists.

The browser is unchanged.

This plan derives from the specs at the spec gate (spec review round 2 PASS, with its two refinements and proof review round 1's refinement to isolation limitation 19 applied) and the proofs that passed proof review round 1, with that review's refinements applied. The [task record](./tv-958-task-record.md) records the calls made without the human and their reasons. The code baseline is the TV-378 work, which this branch contains unchanged.

The proofs determine the tests, their boundaries, mocks and forfeits. This plan assigns them to work and says how to build what they prove; it does not re-derive assertions. File names locate code as it stands, and the implementation may draw module boundaries differently where that is simpler.

## One slice

The work is one slice. It is one isolated feature in one area, desktop artifact webviews, touching four production files and one new module:
- the main process: partition assignment, session setup, the record and the reaper;
- the window preload's flag;
- the served interface's artifact host.

The partition mechanism and the isolation tests that prove it are one argument: the escalation and storage walks are how a reviewer judges whether the partitions isolate anything. Splitting them would leave the desktop isolation walks red, or prove a mechanism the reviewer could not yet see working.

The reaper is the one part that could stand alone, as a second slice. It stays in this one because it is small (a schedule, one request, a filtered deletion) and shares the record and the attach handler with the partition mechanism. A second slice would also add a slice review and an integrated-result review for that small part. The reviewer of this slice should still read the reaper as the riskier half for data loss, and the plan calls out its checks below.

## Starting baseline

`unit:desktop` passes locally. Before the first change, the implementer runs the other surfaces this slice touches, as narrowly as they allow:
- the desktop end-to-end files listed under Validation;
- `packages/web/test/artifact-view.test.ts`;
- `packages/server/test/endpoints.test.ts`.

Any failure that predates the work is recorded by test identity in the task record before red tests are written.

## Production changes

### Main process: `packages/desktop/src/artifact-partitions.ts` (new) and `index.ts`

- **Names.** A pure function classifies the partition a webview asks for, given the window's page URL:
  - `tv-artifact:<id>` on an HTTP(S) page gives an artifact partition, `persist:artifact-<32 hex>` from Node's `crypto` SHA-256 of `<origin>\n<id>`, together with the ID;
  - `tv-url-artifact` gives `persist:url-artifacts`;
  - none gives `persist:webview-fallback`;
  - anything else is refused.
- **Header rewriting.** A pure function takes Electron's `onHeadersReceived` details and returns the response headers to use, under [the header rule](../../specs/arch/artifact-frame/isolation.md#^iso-desktop-header). It is installed with the filter `*://*/artifact/*`, and checks the path's first two segments itself, so the rule holds whatever the filter admits. Header names are matched without regard to case. A `Content-Security-Policy` value is the sandbox header when it is one directive whose name is `sandbox`. `Referrer-Policy` is replaced, or added, with `strict-origin-when-cross-origin`.
- **Session setup.** `index.ts` gains a function that sets up a partition's session once per partition name, kept in a set of the names opened since start:
  - every session gets TV-378's permission handlers, refactored from `installPermissionHandlers` into a function taking a session;
  - the artifact and URL-artifact partitions also get the header function on `webRequest.onHeadersReceived`;
  - the window's session keeps the handlers it has today and gets no header function.
- **Attach.** `will-attach-webview` keeps setting the preload and context isolation, then classifies `webPreferences.partition` against `this.window.webContents.getURL()`:
  - a refused name: it calls `event.preventDefault()` and returns;
  - otherwise it sets `webPreferences.partition`, sets up the session, and for an artifact partition records it.

  Setup happens inside the event, so the session is ready before Electron creates the guest. This was checked in Electron 43.7.6, where `session.fromPartition` in the event returns the session the guest gets.
- **Record.** `readPartitionRecord(userData)` and `recordPartition(userData, origin, name, id)` take an optional filesystem peer, the same minimal shape `connection-store.ts` uses, so the atomic-write contract can record operations. Writes go to `artifact-partitions.json.tmp`, then `renameSync`. A record that cannot be read or parsed, or has the wrong shape, reads as empty. Recording a name already present for that origin writes nothing.
- **Reaper.** A class owned by `App`, constructed with:
  - the `userData` path;
  - `fetch`;
  - timer functions;
  - a predicate for "opened since start", which is the session-setup set;
  - a directory-removal function, defaulting to `fs.rmSync(dir, { recursive: true, force: true })`.

  It runs as follows:
  - `pageLoaded(connection)` starts a reaping now, unless one is running, and (re)arms an hourly timer;
  - `stop()` clears the timer;
  - a reaping takes the record's entries for the connection's origin, then requests `GET <origin>/artifacts` with the bearer token when there is one, under an `AbortController` that `stop()` aborts;
  - it validates the answer as the spec's step 3 requires;
  - it then, synchronously and in one turn, removes each absent and unopened partition's directory and its entry, re-reading the record just before writing it back, so that entries recorded during the request survive.

  The removal and the opened check run in one synchronous turn so that no webview can attach between them.
- **Reaper wiring.** The reaper runs only while the window shows the saved connection's server page, so `App` both starts and stops it from the window's own page events:
  - on the window's `did-start-navigation` for a cross-document navigation of its main frame, `App` calls `reaper.stop()`, which clears the timer and aborts a request in flight, whatever the destination, a reload of the same page included;
  - on the window's `did-finish-load`, `App` calls `reaper.pageLoaded(connection)` when the page's origin is the saved connection's, and `reaper.stop()` otherwise, so a page of another origin, the local page or a fixture page never leaves a timer running;
  - `loadConnectScreen`, `disconnect` and the window's `closed` also call `reaper.stop()`, for the paths that leave the page without a navigation event of their own.

  Fixture-hook launches have no connection and never reap.

### Window preload: `packages/desktop/src/connect-preload.ts`

- The native bridge object gains `artifactPartitions: 1`, beside its operations.

### Served interface: `packages/web/src/views/artifact-document-host.ts`

- The host reads the flag once per page from `globalThis.__televisionNativeBridge?.artifactPartitions === 1`, and only in Electron mode.
- The partition a source needs is:
  - `tv-artifact:<id>` for a path artifact;
  - `tv-url-artifact` for a URL artifact;
  - none without the flag.
- `#ensureFrame` takes it and treats a webview whose `partition` attribute differs as a different frame: it disposes the old frame's load subscription and Markdown runtime, as for a tag change, creates a new webview, and sets `partition` before `allowpopups` and before `#assignFrameRoute` sets `src`. A new frame has no `src`, so `#assignFrameRoute` already notifies the wrapper of the frame change before assigning it.
- Renderer routing, navigation and the iframe path are unchanged.

## Tests, by proof assertion

Red first. Each test is written, seen to fail for the stated reason, then made to pass.

| Proof assertion | Test | Notes |
| --- | --- | --- |
| [`^dp-t-names`](../../proofs/arch/desktop/artifact-partitions.md#^dp-t-names) | `packages/desktop/test/artifact-partitions.test.ts` (new) | Independent digests computed in the test with `crypto`. |
| [`^dp-t-record`](../../proofs/arch/desktop/artifact-partitions.md#^dp-t-record) | same file | Temporary `userData` on the real filesystem; one case with a recording filesystem peer, as `connection-store.test.ts` does. |
| [`^dp-t-reaper-schedule`](../../proofs/arch/desktop/artifact-partitions.md#^dp-t-reaper-schedule), [`^dp-t-reaper-deletes`](../../proofs/arch/desktop/artifact-partitions.md#^dp-t-reaper-deletes) | same file | Vitest fake timers and a fake `fetch`. The reaper's own cases (hourly cadence, one reaping at a time, the request's headers, every deletion rule) drive the reaper class. The wiring cases drive `App` in `main.test.ts` through the window's page events, with its existing Electron mocks given a `getURL` and the fake `fetch` and timers: the server page's load starts a reaping and the hourly timer; a navigation away, a later load of another origin, of the local page or of a fixture page, Disconnect from Server and closing the window each leave no timer running and abort a request in flight; and a launch without a saved connection never requests. Calling `reaper.stop()` directly would not catch a missing stop in `App`, so no wiring case does. |
| [`^dp-t-attach`](../../proofs/arch/desktop/artifact-partitions.md#^dp-t-attach), [`^iso-t-desktop-header-sessions`](../../proofs/arch/artifact-frame/isolation.md#^iso-t-desktop-header-sessions), [`^iso-t-permissions`](../../proofs/arch/artifact-frame/isolation.md#^iso-t-permissions) | `packages/desktop/test/main.test.ts` | Its Electron mock gains `session.fromPartition` returning recording sessions keyed by name. The existing permission case is extended to every session. |
| [`^iso-t-desktop-header`](../../proofs/arch/artifact-frame/isolation.md#^iso-t-desktop-header) | `packages/desktop/test/main.test.ts` or the new module's test | A pure function over authored details. |
| [`^dp-t-bridge-flag`](../../proofs/arch/desktop/artifact-partitions.md#^dp-t-bridge-flag) | `packages/desktop/test/connect-preload.test.ts` | |
| [`^dp-t-interface-names`](../../proofs/arch/desktop/artifact-partitions.md#^dp-t-interface-names) | `packages/web/test/artifact-view.test.ts` | Sets `__televisionNativeBridge` on the jsdom global per case and observes attribute order by wrapping `setAttribute`. |
| [`^dp-t-artifacts-route`](../../proofs/arch/desktop/artifact-partitions.md#^dp-t-artifacts-route) | `packages/server/test/endpoints.test.ts` | Expected to pass at once: it pins the existing answer. |
| [`^dp-t-sessions-seam`](../../proofs/arch/desktop/artifact-partitions.md#^dp-t-sessions-seam), [`^dp-t-fallback-seam`](../../proofs/arch/desktop/artifact-partitions.md#^dp-t-fallback-seam), [`^dp-t-reaper-acceptance`](../../proofs/arch/desktop/artifact-partitions.md#^dp-t-reaper-acceptance) | `packages/desktop/test/e2e/artifact-partitions.test.ts` (new) | Saved-connection launches through `launchDesktop({ connectTo })`, relaunched with the same `userDataDir` for the restart cases. The fallback seam's stand-in page and the external fixture pages come from a small local HTTP server in the test. |
| [`^iso-t-escalation-electron`](../../proofs/arch/artifact-frame/isolation.md#^iso-t-escalation-electron) | `packages/desktop/test/e2e/artifact-isolation.test.ts` | Reworked. See the fixture below. The `POST` observer moves from `session.defaultSession` to the artifact webview's own session. |
| [`^iso-t-desktop-storage`](../../proofs/arch/artifact-frame/isolation.md#^iso-t-desktop-storage), [`^iso-t-desktop-header-seam`](../../proofs/arch/artifact-frame/isolation.md#^iso-t-desktop-header-seam) | same file | New. The referrer seam's other origin is a local HTTP server recording `Referer`; the same-origin request's `Referer` is observed with `webRequest.onSendHeaders` on the artifact webview's session, an observer beside the main process's `onHeadersReceived`, as the escalation walk already observes requests with `onCompleted`. |
| [`^iso-t-artifacts-load`](../../proofs/arch/artifact-frame/isolation.md#^iso-t-artifacts-load) (Electron case), [`^iso-t-permissions-seam`](../../proofs/arch/artifact-frame/isolation.md#^iso-t-permissions-seam), [`^af-ac-native-pdf-electron`](../../proofs/product/artifacts.md#^af-ac-native-pdf-electron) | same file | Reworked: the origin is the server's; the microphone is refused by the handlers; pointer lock is added; the PDF test is renamed. |

### The isolation fixture

The fixture is `test/fixtures/artifact-isolation/attempts.js` with `test/helpers/artifact-isolation-fixture.ts`.

- **Desktop branch.** It reports values, not only error names:
  - storage reads and writes, including whether `localStorage` holds `store-television-electron` or the sentinel key;
  - a frame for `/`, now readable, and the same reads of the frame's `localStorage`;
  - the service worker's registration;
  - token routes as `readable:401`;
  - the `POST` as `{ type: "basic", status: 401 }`.
- **Browser branch.** Unchanged.
- **Assertion helpers.** `expectIsolationEnforced` splits into the browser expectations it states today and desktop expectations matching [the reworked walk](../../proofs/arch/artifact-frame/isolation.md#^iso-t-escalation-electron). Every attempt keeps a complete record, so a skipped attempt cannot look like a refusal.
- **After the walk.** The test checks that the window's page has no service worker registration and that its storage holds none of the artifact's keys.

### Existing tests that change with the sessions

- `packages/desktop/test/e2e/ipc-senders.test.ts` registers its compromised-renderer preload on `session.defaultSession` only. It also registers it on the artifact webview's own session before the reload, which is the same partition after the reload because the artifact is the same.
- `packages/desktop/test/e2e/all-webview-dispatcher.01.test.ts`:
  - It observes `will-download` on `session.defaultSession`. It observes the artifact webview's session instead.
  - Its comment about a sandboxed subframe's opaque origin is restated: the test reads the subframe through Electron.
- Any other desktop end-to-end test that fails because an artifact document now has the server's origin, or its webview a partition, is fixed without weakening what it proves, and listed in the task record.

## Measuring the cost of partitions

The decision asks that the cost of building webviews in partitions when switching channels and tab pages be measured. Once the slice is green, the implementer measures it in the real Electron app against a running server, with a channel of 1, 10 and 30 HTML artifacts on separate tab pages and a second, empty channel. Measuring is a one-off script run locally, not a committed test.

Three builds are compared, two of them through local edits that are not committed:
- **A, as built:** each artifact in its own partition, unsandboxed.
- **B, one shared partition, unsandboxed:** the interface names `tv-url-artifact` for every artifact, so every webview is in the URL-artifact partition with the same header rewriting as A. A against B isolates the cost of one partition per artifact.
- **C, one shared session, sandboxed:** the interface's flag check is forced off, so every webview is in the fallback partition, which keeps the sandbox, as TV-378's single session did. A against C is the cost of the whole change, partitions and unsandboxing together, and is reported as that, not as the cost of partitions alone.

For each build and channel size it records:
- **channel switches:** the time from selecting the channel to every webview's `did-finish-load`, cold after launch and warm on a return from the empty channel, which rebuilds every webview, as the stage does today;
- **tab-page switches:** the time from selecting another tab page to its page being shown, and whether any webview was created or reloaded. Switching tab pages keeps every webview alive ([product/artifacts.md#^af-tab-continuity](../../specs/product/artifacts.md#^af-tab-continuity)), so partitions are expected to cost nothing there, and the measurement checks it;
- the app's total working-set memory from `app.getAppMetrics()` once the channel has loaded;
- the size of `Partitions/` on disk.

The numbers go in the task record. A cost the human would likely not accept, such as seconds added to a channel switch, is reported to the supervisor rather than designed around inside this slice.

## Validation

- **Unit and contract tests.** `unit:desktop`, and the touched files of `unit:browser-app` and `unit:server`, pass in targeted local runs.
- **Desktop end-to-end.** These pass locally under Xvfb:
  - the new and reworked desktop files: `artifact-isolation.test.ts`, `artifact-partitions.test.ts`;
  - every desktop end-to-end file that shows artifacts in webviews: `ipc-senders`, `all-webview-dispatcher.01` and `.02`, `guerilla-artifact-sharing`, `artifact-navigation`, `artifact-navigation-external`, `markdown-webview`, `path-webview-content-reload`, `artifact-view-webview-wheel`, `isolated-webview-layout`, `webview-event-parity`, `native-navigation-key`, `popover-header-overlap`.

  The whole `e2e:desktop` surface then runs locally once, by `--surface`, since every desktop end-to-end test now runs its artifacts in partitions.
- **Browser walks.** The browser isolation walks in `packages/web/test/e2e/artifact-isolation.test.ts` still pass in Chromium and Firefox. The fixture's browser branch must be unchanged in effect.
- **Checks by hand, not committed.** Each shows once that a test fails without the protection it guards:
  - With the interface's partition attribute removed, so that every webview takes the fallback, the escalation walk's and storage walk's positive assertions fail (origin, working storage), and the sessions seam fails.
  - With the header rewriting removed from the partitions, the artifacts-load Electron case fails on the origin and the referrer seam on the `Referer`.
  - With the header rewriting also installed on the fallback partition, the fallback seam fails.
  - With the permission handlers left off the partitions, the permissions seam fails on notifications and geolocation.
  - With the reaper ignoring the opened set, the reaper acceptance fails before the restart, because A's directory is gone.
  - With the reaper reading the record only before its request, so that it writes back its stale copy, the in-flight entry case of the deletion contract fails.
  - With the reaper checking the opened set before its request instead of when it deletes, the case of a partition opened while the request is in flight fails.
  - With `App` leaving the reaper running when the window loads a page of another origin, the wiring case for that load fails.
- **Full verification.** `npm run verify` on Blaxel passes on the committed tree.

**Expected baseline after the slice:** green, full verification passing, every proof citation for this work naming its test, and no "test to be written" left among them.

## For the pull request

- **Spec deltas** for the human's line review: the spec delta lists `specs/arch/desktop/artifact-partitions.md` and every edited spec.
- **The manual "Bridge and IPC" check.** [The desktop product spec](../../specs/product/desktop-app.md#Testing) requires it before `main`, because the native bridge and webview handling change. It is recorded for the human on the PR, not run by an agent.
- **Docs prep.** The proposal-like design reasoning lives in the task record, so docs prep decides between archiving the task record's "calls made" section and this plan, and deleting the rest.

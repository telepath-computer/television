> **Archived 2026-10 from `thopter/artifact-isolation`.** This plan divided TV-378's implementation into four slices and gave each the tests its proofs call for, and the work followed it. It preserves which proofs each slice took, the baseline expected after each slice, and the checks by hand that showed a test fails without each protection, as one account of how the work was divided, which neither the final diff nor the pull request description reconstructs. TV-958, whose plan is archived in `desktop-partitions/` beside this folder, then changed how the desktop app isolates artifacts. The body below is its working state, less references to commits and a repository outside this one, and is a clue to the change, not a record of it.

# TV-378 implementation plan

The result is the isolation the specs describe:
- Every document Television serves from an artifact's files runs in the browser's sandbox, in the browser and the desktop app.
- The routes artifacts load allow any origin, and the token routes send no CORS headers.
- The interface reaches only the server that served it.
- Desktop webviews reach the main process only through the app's page.

This plan derives from the specs that passed the spec gate and the proofs that converged in proof review round 3. The approved [proposal](./tv-378-artifact-isolation-proposal.md) records intent, and the [task record](./tv-378-task-record.md) records placement decisions and implementation notes. The code baseline is public PR #29 at `8ca7ef4`, which this branch contains unchanged.

The converged proofs determine the tests, their boundaries, mocks and forfeits. The tables below assign their implementation to slices; they do not re-derive assertions. File names locate the current code and tests, and implementation may change those boundaries where that makes the result simpler.

## One origin for the dev server and the tests

The control routes lose their CORS headers and the client loses `?serverURL=`, so the interface must load from the server's own origin everywhere, including in development and in tests. Two mechanisms, one of which already exists, cover every case:

- **Tests use the existing development proxy.** `startDevelopmentProxy` in `test/helpers/product-server.ts` gives a test one origin: it sends Vite's module paths (`/`, `/packages/`, `/@vite/`, `/@id/`, `/@fs/`, `/node_modules/` and `/views/url-unsupported`) to the test Vite server and every other request, WebSocket upgrades included, to the Television server. `ProductServer.appURL(viteBaseURL)` already wraps it, and the real-stack and demo-mode tests already load the app this way. Each test that today opens `<vite>/…` with `serverURL=<server>` in its query, whether written into the URL or set through `searchParams`, instead starts a proxy for its own server and opens `<proxy>/…`. A test that starts several servers starts one proxy per server, so the single-target limit of a static proxy configuration does not arise. Tests that already open the app through a proxy, or from the server itself, only drop `?serverURL=`. Electron tests whose fixture URL points at the test Vite server do the same through a proxy. A request a test makes from inside the page, such as the authenticated `fetch` that `theme.test.ts` runs in `page.evaluate`, goes to the page's own origin, because the token routes no longer answer other origins. Requests a test makes from Node keep using the server's address. No new harness mechanism is needed; the proxy's reset handling is already specified in the testing policy.
- **`scripts/dev-server.sh` uses a Vite proxy.** The dev server's Vite root is `packages/web/src`, so the shell's source modules share the top of the path space with the server's routes: the shell loads `/theme.ts`, `/events.ts`, `/markdown.ts` and `/views/television-app.ts`, and its own `/views/url-unsupported/` page. The test proxy's list of Vite paths does not fit them. Instead, `packages/web/vite.config.ts` gains a `server.proxy` that forwards the server's routes, with WebSockets, to the server named by an environment variable the script sets. It matches whole path segments, so `/theme/…` goes to the server while `/theme.ts` stays with Vite, and under `/views` it forwards only the server's own views, `/views/markdown` and `/views/artifact-missing`, which the script already builds. The script prints `http://localhost:<vite-port>/`. A server route missing from the forwarded set, or a new source path that matches one, fails visibly in development, so the set needs no drift test.

The client then resolves its server from the page's own origin only. A leftover `?serverURL=` is ignored. The desktop shell's source has not sent the parameter since the repository's first public snapshot.

## Starting baseline

The code is PR #29's head unchanged. This plan assumes its suite is green, apart from the sidebar-view prototype's tests, which no slice touches. Slice 1's implementer first installs dependencies in the worktree and runs the surfaces the slice touches. Any failure that predates the work is recorded by test identity in the task record and assigned to a slice.

## Slice 1: one origin and the cross-origin route rules

**Deliverable.** The interface reaches only the server that served it, in development, tests and production. Each route sends the cross-origin headers [isolation's route table](../../specs/arch/artifact-frame/isolation.md#^iso-routes) gives it. No artifact is sandboxed yet.

**Implementation.**
- **Client.** Remove `?serverURL=` and the multi-server client code it fed (`packages/web/src/config.ts`, `main.ts`, the server-connection owner). The CLI keeps the `serverURL` field of its request errors ([task record](./tv-378-task-record.md#Notes for implementation)). The reload decision loses its origin-match input ([version advertisement](../../specs/arch/updates/version-advertisement.md#^reload-origin-rule)).
- **Server.**
  - Remove `CORS_HEADERS` and the `OPTIONS` handlers from the token routes, and the `X-TV-Version` expose clause.
  - Send `Access-Control-Allow-Origin: *` on the artifact proxy, with `Access-Control-Expose-Headers: ETag`, and on `/canonical`, `/theme`, `/sdk/v1` and `/views/artifact-missing/…`.
- **Tests and tooling.**
  - Move every test that uses `?serverURL=` onto a proxy, as above. That is about 45 files across `packages/web/test`, `packages/desktop/test/e2e` and `test/node`.
  - Rework the unit tests of the removed client code.
  - Delete the `^ac-reload-origin-only` case and its helper comment.
  - Change `scripts/dev-server.sh` and the Vite config as above.
- **Runbook.** Execute the UX-staging runbook's browser recipes against the rewritten staging server. Execute its real-Electron recipes where the host can show a window, and record what ran.

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [Cross-origin rules by route](../../proofs/arch/artifact-frame/isolation.md#^iso-t-routes) | New server contract over real HTTP, with `Origin: null` and another site's origin. |
| [Resource origins](../../proofs/arch/resources/index.md#^rs-arch-t-origin), [SDK serving](../../proofs/arch/resources/sdk.md#^sdk-t-serving) | Extend both with `Origin: null` and the SDK's CORS header. |
| [Theme control routes](../../proofs/arch/themes/index.md#^themes-t-http), [version header](../../proofs/arch/updates/version-advertisement.md#^t-version-header), [reload decision](../../proofs/arch/updates/version-advertisement.md#^t-reload-decision) | Rework the CORS and expose expectations to none, and drop the origin-match permutations. |
| [Demo-mode coverage note](../../proofs/product/artifacts.md#Acceptance criteria) | Replace the cross-origin `/demo-mode` cases in `packages/server/test/endpoints.test.ts` with the route contract above. |
| Every browser and Electron end-to-end test that loads the app | Load through a proxy with no `?serverURL=`, send requests made from the page to the page's origin, and pass unchanged otherwise. |

**Validation.** The server, web, desktop, node end-to-end and repository surfaces pass in targeted local runs. `scripts/dev-server.sh` serves a working app at its printed address, including artifacts, Markdown and live events. The runbook's executed recipes behave as written.

**Expected baseline after this slice.** Green, with no failure handed to a later slice. Artifacts are not yet sandboxed, so the sandbox's tests do not exist yet.

## Slice 2: the browser sandbox

**Deliverable.** Every document the artifact proxy and the theme route serve carries the sandbox header. Artifact iframes carry the `sandbox` and `allow` attributes the [isolation table](../../specs/arch/artifact-frame/isolation.md#^iso-iframe-sandbox) gives them. The bridge records navigation in sandboxed documents. Folder artifacts serve only their own visible files, and nothing that creates an artifact supplies its ID. The skills' guidance says browser storage does not work. The header also sandboxes desktop webviews from this slice on.

**Implementation.**
- **Server.**
  - Add the header to every proxy and theme response, error and redirect responses included (`artifact-proxy.ts`, `themes.ts`).
  - Resolve a folder artifact's folder and each requested file to their real locations. Serve a file only inside the folder, with no dot part below it, and answer anything else as a missing file.
  - Remove the `id` input from `ServerStore.createArtifact` and its callers, keeping existing IDs.
- **Client.** Set or clear the iframe `sandbox` attribute before every `src` assignment, and set the `allow` attribute on every artifact iframe (`artifact-view.ts`). The trusted channel's `leaving` fallback expects `"null"` for a frame the host sandboxes.
- **Bridge.** In `packages/artifact/src/browser/artifact-bridge.ts`:
  - Choose the fallback recorder when the Navigation API's entries are disabled.
  - Make its `click` and `submit` listeners act after the page's own handlers, and only on uncancelled events.
  - Act only on GET submissions to the frame itself, honoring the submit button's `formaction`, `formmethod`, `formtarget` and value.
- **Skills.** Update `resources.md` and `skill-intro.md` in the `television` skill, `tv-tasks`'s `SKILL.md`, and the `television` skill's map note on HTML artifacts.
- **Existing tests that change under the sandbox.** Rework them as the proofs record:
  - the proxy route case of `^rn-ac-current-route`;
  - the navigation seam in `artifact-navigation.01.test.ts`;
  - the PDF in `^af-ac-native`;
  - the storage line of the sharing walk;
  - the SDK test pages' opaque-origin check.

  Fix any other test that reads an artifact document's storage, or relies on its having the app's origin, without weakening what it proves.

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [Header](../../proofs/arch/artifact-frame/isolation.md#^iso-t-header), [attributes](../../proofs/arch/artifact-frame/isolation.md#^iso-t-attributes), [reused frame](../../proofs/arch/artifact-frame/isolation.md#^iso-t-reused-frame), [features](../../proofs/arch/artifact-frame/isolation.md#^iso-t-features) | New server contract, host contract, and two Chromium seams. |
| [Browser escalation](../../proofs/arch/artifact-frame/isolation.md#^iso-t-escalation-browser) | New acceptance walk in Chromium and Firefox. This is the human's testing directive for the browser. |
| [What a sandboxed artifact loads](../../proofs/arch/artifact-frame/isolation.md#^iso-t-artifacts-load) | All three runtimes. The Electron case proves the header alone in a webview. |
| [Fallback recorder](../../proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-fallback-recorder), [sandboxed recording seam](../../proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-sandboxed-recording-seam), [leaving origin](../../proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-stale), [current route](../../proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-current-route) | New bridge contract and Chromium/Firefox seam, plus the reworked host contracts. |
| [Supplied IDs](../../proofs/product/artifacts.md#^af-ac-no-supplied-id), [folder files](../../proofs/product/artifacts.md#^af-ac-folder-files) | New contract and HTTP acceptance over the real filesystem. |
| [Native documents](../../proofs/product/artifacts.md#^af-ac-native), [Electron PDF](../../proofs/product/artifacts.md#^af-ac-native-pdf-electron) | Drop the browser PDF, and add the Electron walk. |
| [Guidance purpose](../../proofs/arch/resources/guidance.md#^rg-t-purpose), [tv-tasks](../../proofs/arch/resources/guidance.md#^rg-t-tv-tasks), [map guidance](../../proofs/arch/artifact-frame/isolation.md#^iso-t-map-guidance) | Rework and add the built-skill checks. Guidance review judges the wording. |
| [SDK browser tests](../../proofs/arch/resources/sdk.md#Coverage model), [sharing walk](../../proofs/product/resources/resources.md#^rs-ac-sharing), [guidance example](../../proofs/arch/resources/guidance.md#^rg-t-example), [shared-artifact acceptances](../../proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-content-poll) | Pass with sandboxed pages. The SDK pages check their opaque origin. |

**Validation.** The server, web, artifact, view-markdown, desktop, node end-to-end and repository surfaces pass in targeted local runs, including the Firefox projects these tests add. A check by hand, not committed, shows once that a test fails without each protection:
- With the header removed, the escalation walk fails, through the popup it opens for its own address, which the frame's `sandbox` attribute does not reach.
- With the `sandbox` attribute removed, the reused-frame seam fails, through its shared artifact, whose producer sends no header. The escalation walk is not expected to catch this, because the header still sandboxes the document it shows.

**Expected baseline after this slice.** Green. The desktop's application links, IPC and permissions are unchanged. Their inherited tests still pass and are reworked in slice 3.

## Slice 3: desktop hardening

**Deliverable.** Artifact webviews run their preload with context isolation. Application links pass from the webview through the app's page to the main process. The main process ignores IPC from webviews, and the session grants webviews only the three permissions.

**Implementation.**
- **Webview preload.** In `packages/desktop/src/index.ts`, `will-attach-webview` enables context isolation. `webview-bridge-preload.ts` sends application-link requests to its host on their own channel with `sendToHost`.
- **Host renderer.** The host (`artifact-view.ts`) passes a request on only from a webview it currently shows whose URL has the host's own HTTP(S) origin. It passes it through a new function on the window's native preload bridge (`connect-preload.ts`).
- **Main process.**
  - Check every IPC handler's sender against the window's own web contents.
  - Accept application links only from the window, reclassifying the value.
  - Set the permission request and check handlers on the session.
- **The PR's manual check.** The desktop pull request needs the manual "Bridge and IPC" check in [the desktop product spec](../../specs/product/desktop-app.md). It is recorded for the human on the PR, not run by an agent.

**Proof-derived verification.**

| Evidence | Work in this slice |
| --- | --- |
| [Preload attachment](../../proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-preload-attachment), [preload link request](../../proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-application-link-preload), [host relay](../../proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-application-link-host), [main-process link](../../proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-application-link-main), [real-Electron link seam](../../proofs/arch/artifact-frame/artifact-bridge.md#^ab-ac-application-link-electron-seam) | Rework the inherited contracts, add the host contract, and rerun the existing seams over the relay. |
| [IPC senders](../../proofs/arch/desktop/index.md#^desktop-t-ipc-senders), [IPC from a webview's renderer](../../proofs/arch/desktop/index.md#^desktop-t-ipc-senders-seam) | New main-process contract and real-Electron seam, with the update runtime's simulation flag. |
| [Permission handlers](../../proofs/arch/artifact-frame/isolation.md#^iso-t-permissions), [permissions in a real webview](../../proofs/arch/artifact-frame/isolation.md#^iso-t-permissions-seam) | New contract and real-Electron seam. |
| [Desktop escalation](../../proofs/arch/artifact-frame/isolation.md#^iso-t-escalation-electron) | New real-Electron walk. This is the human's testing directive for the desktop app. |

**Validation.** The desktop and web surfaces pass in targeted local runs. The IPC-sender seam fails when a handler's sender check is removed. Check that once by hand, without committing the change. Because this is the last slice before integration, the integrated result then passes `npm run verify`, which runs on Blaxel on this host.

**Expected baseline after this slice.** Green, and full verification passes.

## Slice 4: the sidebar view's width, after the human decides

The sidebar-view prototype already catches storage errors. Under the sandbox, its width stops persisting rather than breaking, so slices 1–3 do not depend on this slice. Once the human decides what a viewer through a read-only share link can do with the sidebar, the sequence is:
1. The specs are settled if the decision differs from the current text.
2. The sidebar-view proofs are derived and reviewed.
3. `packages/skills/skills/tv-sidebar-view/sidebar.js` keeps the width at `tv-sidebar-view/width` in the artifact's JSON store, as [its spec](../../specs/arch/skills/sidebar-view.md#Storage) says.

The skill is unregistered, so this changes nothing shipped. The pull request is not marked ready until this slice converges or the human defers it.

## Integration and pull request

With more than one slice, the integrated result converges under [the workflow](../../specs/spec-workflow.md#Planning and slices). Specs, proofs, tests and code must agree, and every "test to be written" citation must name its test. Full verification must pass on the integrated tree.

The pull request to `main` carries:
- the spec deltas for the human's line review, including the administrator guide's storage check;
- the desktop manual check;
- the sidebar decision.

Docs prep archives the proposal and this plan, and removes the task record. The update-channel announcement of the release is a separate manual deploy at release time ([update channel](../../specs/arch/updates/update-channel.md#^channel-master-copy)).

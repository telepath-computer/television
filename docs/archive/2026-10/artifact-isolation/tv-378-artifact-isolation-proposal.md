> **Archived 2026-10 from `thopter/artifact-isolation`.** This proposal set out how TV-378 keeps artifact code away from Television's authority, and in the browser the change follows its decided points. It preserves the threat model, the reasons for each decision, how each known limitation was checked and why it was accepted, and the upgrade analysis as one statement, which the specs, holding only the outcomes, do not give together. In the desktop app, TV-958 superseded its sandboxing of artifact documents with Electron storage partitions, in which they run unsandboxed (`specs/arch/desktop/artifact-partitions.md`, and the documents archived in `desktop-partitions/` beside this folder); its decisions on IPC, the webview preload and permissions stand. Some of its rules sit in other specs than its last section names, such as which IPC senders the desktop main process accepts, and the tests it promised of resuming saved agent sessions were not written, so whether saved sessions carry over was checked by reading the code. The body below is its working state, less a reference to a branch outside this repository, and is a clue to the change, not a record of it.

# TV-378: Keeping artifact code away from Television's authority

*Proposal for [TV-378](https://linear.app/telepath-computer/issue/TV-378). It builds on the JSON resources work for [TV-942](https://linear.app/telepath-computer/issue/TV-942) as public Television pull request #29 delivers it, at head `8ca7ef4`. That work gives every local path artifact its own JSON store and gives onboarding artifacts generated IDs. It also adds the resource SDK at `/sdk/v1/resources.js` and the page connection at `/artifact-resources/<id>/v1/connection`. [Changes to the resources work](#changes-to-the-resources-work) lists what TV-378 changes in it. Specs and code named below are in this branch's tree.*

## Summary

An artifact's HTML, and every script it loads, may be hostile. A third party may have written it, or the person's own agent may have written it after a prompt injection told it to. Today that code runs on the same origin as the Television app, so it can read the server's token and use it to control the whole server.

This proposal sets one rule. **Artifact code reaches only three things.** It reaches what the ID in its own address gives it: its own files, its own store, and, with the resources work's bindings flag on, the stores its artifact is bound to. It reaches Television's public files. And it can send the shell a small set of bridge messages. Through them it can do what the navigation chord does, move its own frame through its history, and drive theme pointer effects. It never reaches the server's token, the shell's page or the shell's storage.

The rule costs one deliberate break with earlier releases. **HTML artifacts can no longer use browser storage**: those that kept data there lose it, and those that touch it without catching the exception stop running until they are fixed. The administrator guide's upgrade advice is the mitigation: it has the person's agent find these artifacts and remove that use or move it to the JSON store.

Below, the *shell* is the Television app page, in a browser tab or in the desktop app's window. Television's own pages are the shell, the Markdown editor, the error pages, and the browser's placeholder page for URL artifacts.

These points are decided:

- **Sandboxing.** Every HTML artifact document is sandboxed, in the browser and the desktop app alike. The server sends `Content-Security-Policy: sandbox`, without `allow-same-origin`, with everything the artifact proxy serves. The desktop app keeps the header. In the browser, artifact iframes also carry the `sandbox` attribute. Markdown path artifacts stay in Television's Markdown editor, unsandboxed, as do Television's other pages.
- **The token** stays in the shell's `localStorage` in both runtimes, as today. Sandboxed documents cannot reach storage.
- **No browser storage for HTML artifacts**, a deliberate break with earlier releases. HTML artifacts do not use browser storage, in either runtime, and Television offers them no storage that stays in one browser or app: no client-storage API and no in-memory stand-in for `localStorage`. This removes browser storage as a state store for HTML artifacts, and nothing else. PR #29's guidance on stateful work with the person stands: the agent creates either a Markdown artifact, whose document is the state, or an HTML artifact that keeps its state in a JSON store or in an external service it connects to.
- **CORS.** Routes that sandboxed artifacts load send `Access-Control-Allow-Origin: *` without credentials, and the artifact ID in the path is the capability. Routes that need the token send no CORS headers. The line is drawn route by route, not by URL prefix. The version-advertisement clause that exposes `X-TV-Version` to cross-origin clients is removed.
- **Websockets.** Origin checks on `/events` and `/acp` are out of scope. The token protects them, and an Origin check adds little on a server that requires the token. It can break proxies such as `tailscale serve`, and on a tokenless server DNS rebinding defeats it. Origin checks and `Host` header validation are deferred to [TV-379](https://linear.app/telepath-computer/issue/TV-379) (tokenless servers).
- **Artifact IDs.** New artifacts always get generated IDs, and no caller can supply one. Existing artifacts keep their IDs. Generated IDs stay unguessable.
- **Folder artifacts** stop serving dotfiles and contain symbolic links. For folder artifacts, on each request, resolve the artifact folder and the requested file to their real locations. Serve the file only if its real location is inside the folder's real location and no part of its path below that folder starts with a dot. Links above or at the folder keep working as today.
- **One server per client.** The remaining multi-server client code is removed.
- **Agent guidance** says plainly that `localStorage`, cookies and IndexedDB do not work in artifacts, because artifacts run under the CSP sandbox. Its advice on which kind of artifact to create for stateful work stays as it is.
- **Upgrade guidance**, the mitigation for the browser-storage break. The administrator guide's upgrade guidance tells the agent upgrading from an earlier version to look for artifacts that use `localStorage`, and to decide for each whether to remove that use or replace it with the JSON store.
- **Announcement.** The release that ships this work is announced on the update channel as an available server upgrade.
- **Desktop IPC hardening** ships with this work, in a desktop release. Artifact webviews run with context isolation on. An application-link request goes from the artifact's webview to the shell, which passes it to the main process, so artifact webviews never send to the main process. The main process accepts messages only from the shell's window, which shows the shell or the connect page, and refuses every webview. The sandbox itself needs no desktop change: the header applies to webviews as they are.
- **Browser features.** The sandbox tokens are `allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads`. The iframe `allow` attribute grants exactly `clipboard-write`, `fullscreen`, `autoplay`, `picture-in-picture`, `web-share` and `encrypted-media`, and nothing else. In the desktop app, a main-process permission handler gives artifact webviews the same features and refuses everything else; it ships in the same desktop release.
- **Mixed desktop and server versions.** An older desktop app keeps today's direct application-link route until it updates. An updated desktop app connected to an older server loses application links in artifacts and in the Markdown editor until the server upgrades; this is accepted. Whether to raise the desktop version the server requires is out of scope.
- **Known limitations.** The limitations under [Known limitations of the sandbox](#known-limitations-of-the-sandbox) are accepted.

Everything else here is derived from those decisions. [Deferred to other tickets](#deferred-to-other-tickets) lists what this work leaves to later tickets.

## What artifact code can do today

A path artifact's document loads at `/artifact/<id>/…`, on the same scheme, host and port as the shell. In the browser it loads in a plain iframe (`packages/web/src/views/artifact-document-host.ts`). In the desktop app it loads in a webview that shares the shell's Electron session (`packages/desktop/src/index.ts`, `createWindow`). Its scripts therefore share the shell's origin and storage:

- They can read the token from `localStorage` (`store-television-browser` or `store-television-electron`). In the browser they can also reach the shell's page through `window.parent`, for example `window.parent.__telepath`.
- With the token they can call every control route and open both websockets. That lets them change or delete channels and artifacts, and overwrite any Markdown file the server can write, by creating a path artifact for it and calling `PUT /markdown/<id>`. They can drive the configured agent through `/acp`, and read and write every store through `/api/resources/v1/`.
- With the IDs that the API returns, they can read every other artifact through the proxy. That includes every file under a folder artifact, dotfiles included (`dotfiles: "allow"` in `packages/server/src/artifact-proxy.ts`).

The control routes also send `Access-Control-Allow-Origin: *` (`CORS_HEADERS` in `packages/server/src/routes.ts`). A page on any site can therefore use a token it has obtained, and on a tokenless server it needs none.

## Scope

The threat is an artifact's HTML and everything it loads. The ticket's scenarios are a compromised script library, outside data inserted with `innerHTML`, content downloaded from an untrusted source, and an agent steered by prompt injection. The last includes the person's own agent. An agent that reads injected instructions, in a web page, a document or a tool's output, can be led to write malicious code into an artifact it creates. So Television does not trust an artifact because the person's agent wrote it.

Television's own pages are trusted. The Markdown editor is a CodeMirror editor (`packages/view-markdown`) that shows a file's text and never renders it as HTML, so nothing in the file runs there. A theme's main script runs in the shell with the shell's privileges once the person consents ([product/themes-and-appearance.md](../../specs/product/themes-and-appearance.md)). This proposal does not change that.

Artifacts are isolated from each other except through IDs. An artifact that knows another artifact's ID can read its files and use its store, as anyone holding the ID can.

## The goal state

### Who can reach what

The shell holds the token and reaches every route with it; it is the only Television page that uses the token. It does not reach into artifact documents today. It talks to them only through bridge messages (`postMessage` in the browser, IPC in the desktop app) and through the frame element's attributes. Its one read of a frame's document, `contentDocument.readyState` in `artifact-document-host.ts`, is guarded and falls back to the `load` event. Isolating artifacts therefore takes nothing away from the shell.

The answers are the same in both runtimes, except where a cell says otherwise.

| An artifact document can… | Answer |
|---|---|
| get the server token | No |
| reach the shell's page, scripts or memory | No. In the browser its origin is opaque, so `window.parent` is cross-origin. In the desktop app a webview is a separate top-level page in its own process. |
| read or change the shell's saved state, or keep data in browser storage | No. Touching browser storage throws. |
| use token-protected routes and websockets | No. Its requests lack the token, and in the browser their responses are unreadable. |
| load its own files and use its own store | Yes, through the ID in its address |
| load another artifact's files or use another store | Only with that artifact's ID or share ID, or, with the bindings flag on, through its own artifact's binding to that store |
| load Television's public files (`/canonical`, `/theme`, the resource SDK) | Yes |
| navigate the shell away | No |
| act through bridge messages | It can move the person between tabs and channels as the navigation chord does; a channel move changes the server's focused channel for every client. It can also move its own frame through its history and drive theme pointer effects. Filtering forged chord messages is deferred to [TV-955](https://linear.app/telepath-computer/issue/TV-955). |
| open a link in a new tab or window | Browser: a new tab, where a Television artifact page stays sandboxed by the header. Desktop: the system browser, where the header applies too. |
| hand an application link such as `obsidian:` to the operating system | Browser: through the browser, with user activation. Desktop: through the preload's activation check, then the shell's origin check, then the main process. |

CORS decides whether a page can read a response. It does not stop the request being sent, so an artifact can still send simple requests to any route. On a server that requires the token, the token refuses those requests. On a tokenless server they succeed, which is TV-379's subject.

### How artifact documents are sandboxed

#### The sandbox header, in both runtimes

Every response from the artifact proxy and from the theme file route carries `Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads`. Call this the *sandbox header*. It never includes `allow-same-origin` or any `allow-top-navigation` token.

- **Opaque origin.** The browser sandboxes the document wherever it loads: in the shell's iframe, in a desktop webview, in its own tab, in a popup, or in a frame that another page creates. The document gets an opaque origin, which matches no other origin and has no storage, and its requests carry `Origin: null`. Adding `allow-same-origin` would undo all of this: the document comes from the shell's origin, so it would get that origin back and could read the token.
- **Every way in.** That covers an artifact URL pasted into a tab, and links opened from the Markdown editor, which calls `window.open` (`packages/view-markdown/src/markers.ts`). It covers browser demo mode, where an external page that navigates its frame to an artifact URL gets a sandboxed document. For a theme package, it keeps an HTML file in the package sandboxed if someone opens that file as a page. Stylesheets, scripts and images loaded as subresources ignore the header.
- **Popups and application links.** `allow-popups-to-escape-sandbox` lets external sites opened from an artifact work normally in their own tab. `allow-popups` also keeps application links working in the browser, because Chromium lets a sandboxed frame launch an external protocol only when the frame has `allow-popups` or a top-navigation token.

#### In the browser

The shell also gives each iframe the `sandbox` attribute that fits the document it is about to load, with the same tokens. The attribute does not depend on the response, so it still holds if a later bug drops the header from a response.

| Document | Loaded from | Sandboxed |
|---|---|---|
| Path artifact: an HTML file, a folder, or a Markdown file that the proxy renders, as when a folder page links to one | `/artifact/<id>/…` | Yes |
| Shared artifact: another Television host's artifact or share link | the producer's URL | Yes |
| Markdown editor | `/views/markdown/` | No |
| Placeholder for a URL artifact, and the artifact-missing page when the shell shows it | `/views/url-unsupported/`, `/views/artifact-missing/` | No |
| External page in browser demo mode | the page's own URL | No |
| Theme background and foreground frames | `srcdoc` | `allow-scripts` only, as today |

Three rules keep the iframe sandbox in place:

1. **The sandbox follows the destination.** The browser applies an iframe's sandbox when a navigation starts. The shell reuses one iframe element across routes (`#ensureFrame` in `artifact-document-host.ts`), so it sets or clears `sandbox` before it assigns each `src`.
2. **A document's own navigation keeps its frame's sandbox.** A sandboxed artifact that navigates to one of Television's pages loads that page sandboxed, and gains nothing. Television's unsandboxed pages never navigate their own frame to artifact content. The Markdown editor asks the shell to navigate (`navigation-request`), and the shell chooses the frame for the destination.
3. **Nested frames inherit the sandbox.** An artifact cannot escape the sandbox by framing another page.

Permissions Policy features do not pass to a cross-origin frame unless the frame's `allow` attribute grants them. Today artifact frames are on the shell's origin, so they receive every feature the policy allows the same origin by default, including the camera and geolocation, subject to the browser's own prompts. Artifact iframes get `allow="clipboard-write; fullscreen; autoplay; picture-in-picture; web-share; encrypted-media"` and nothing else.

#### In the desktop app

Artifact documents load in `<webview>` elements as they do today, at their server URLs, in the shell's Electron session. Webviews do not support the `sandbox` attribute, so the header alone sandboxes them, and the desktop app needs no change to apply it. This was checked in Electron 43.7.6, the version the desktop app uses, with context isolation off as the app sets it: a document served with the header in a webview has an opaque origin, touching `localStorage`, `document.cookie` or IndexedDB throws `SecurityError`, the webview preload still runs, and bridge messages still travel both ways.

The token stays in `store-television-electron` in the shell's `localStorage`, out of reach of sandboxed documents. External web pages shown as URL artifacts load unsandboxed, as today; they come from other origins and cannot read the shell's storage. The native navigation chord and the main process's handling of new windows do not change.

Today `will-attach-webview` turns context isolation off for webviews (`packages/desktop/src/index.ts`), so artifact scripts share a JavaScript environment with the webview preload, which holds `ipcRenderer`. Electron's guidance is that a page can then reach privileged APIs through the preload's environment. The main process's handlers (`ipcMain` in `index.ts`) do not check which page sent a message, and its application-link handler accepts requests straight from webviews; the user-activation check runs only in the preload. Artifact code that obtained `ipcRenderer` could therefore launch application links without a click, or connect the app to a server of its choosing. No working exploit has been shown; the risk comes from page scripts and the preload sharing one JavaScript environment. The desktop app closes this:

- **Context isolation.** Artifact webviews run with context isolation on. Page scripts then reach only what the preload exposes through `contextBridge`, and the preload's activation check runs where page code cannot tamper with it. The preload already exposes its content bridge through `contextBridge` when `process.contextIsolated` is true. In Electron 43.7.6, under the sandbox header, an isolated preload runs, the page sees `__televisionContentBridge` but neither `require` nor `ipcRenderer`, and messages pass both ways.
- **Application links through the shell.** After its activation check, the preload sends an application-link request to the shell on an IPC channel of its own. Page code can reach only the bridge channel, through `postToHost`, so it cannot forge that request. The shell accepts it only from a webview it shows whose URL has the shell's own HTTP(S) origin, the check the main process makes today, and passes it to the main process through the window's preload. Artifact webviews send nothing to the main process. The desktop Markdown editor's application links take the same route.
- **Sender checks.** Every main-process handler accepts messages only from the window's own web contents, which show the connect page or the shell, and refuses every webview.
- **Permissions.** The iframe `allow` attribute does not govern webviews, which are top-level pages. The app sets no permission handler (`setPermissionRequestHandler` and `setPermissionCheckHandler` appear nowhere in `packages/desktop/src`), and Electron then approves permission requests. In Electron 43.7.6, a sandboxed artifact page in a webview with no handler was granted notification permission and saw geolocation reported as granted; with a handler that refuses, both were denied. A main-process permission handler, for both requests and checks, gives every webview the same six features as the browser's `allow` attribute, under Electron's names for them, and refuses everything else. Every webview shows an artifact, through its page, its URL or the Markdown editor.

**Desktop tests.** The unit tests that state today's design change with it. `packages/desktop/test/main.test.ts` expects webview context isolation off and accepts application-link messages from webviews whose URL shares the shell's origin; it comes to expect isolation on, the window as the only sender any handler accepts, and webviews refused. `webview-bridge-preload.test.ts` expects the request on the main-process channel and the bridge set on `window`; it comes to expect the shell channel and `contextBridge`. `connect-preload.test.ts` gains the window preload's pass-through, and the shell's handling of the request needs coverage of its own. The Electron tests in `test/e2e/all-webview-dispatcher.02.test.ts` keep their outcomes on the new route: application links need real user activation, and they reach the real operating-system handler. They and the other webview end-to-end tests, some of which call `__televisionContentBridge` from the page, show the preload working isolated. The proofs for application links in `proofs/arch/artifact-frame/artifact-bridge.md` follow the spec changes.

### CORS and websockets, route by route

Some routes serve artifact documents and the files those documents load. They send `Access-Control-Allow-Origin: *` and never `Access-Control-Allow-Credentials`. What they serve is either public or reached through an unguessable ID in the path, which is the capability. They need CORS because a sandboxed document's origin is opaque, in both runtimes. Its module scripts, fonts, the resource SDK import, `fetch` and `XMLHttpRequest` calls, and the bridge's freshness poll are all cross-origin requests from `Origin: null`, as are those of the artifact-missing page, which the proxy serves inside the artifact's sandboxed frame when a file is missing. Images, stylesheets and classic scripts load without CORS.

The other routes need the token, and they send no CORS headers. Only the shell, the CLI, agents and the desktop main process call them. The shell is on the same origin, and the rest are not browsers.

| Route | Loaded by | Authorization | CORS, Origin and sandbox header |
|---|---|---|---|
| `/artifact/<id>/…`, the artifact proxy (`GET`, `HEAD`) | artifact frames and webviews, the bridge's freshness poll, other Television hosts showing a shared artifact | the ID in the path | `Access-Control-Allow-Origin: *`, plus `Access-Control-Expose-Headers: ETag`, because the poll reads it. Also the sandbox header. Today the proxy sends no CORS headers. |
| `/canonical/v<n>/…` | artifact documents, Television's own pages, the shell | none | `*`, as today |
| `/theme/…` files | the shell, theme frames, artifact documents through the canonical stylesheet | none | `*`, as today, and the sandbox header |
| `/sdk/v1/resources.js` and its notices file | artifact pages, which import the SDK as a module | none | `*` (added) |
| files of the artifact-missing page | that page, when the proxy answers a missing file with it inside the artifact's sandboxed frame | none | `*` on whatever the page loads in CORS mode |
| WebSocket `/artifact-resources/<id>/v1/connection` | artifact pages, through the SDK | the ID in the path | No Origin check, as PR #29 has it (`^rs-any-origin`) |
| `/channels`, `/artifacts`, `/display`, `/themes`, `/markdown/<id>`, `/telemetry`, `/demo-mode` | the shell, the CLI | token | none. Their `OPTIONS` handlers are removed. |
| `/api/resources/v1/…` | the CLI and agents | token | none, and no Origin check, as PR #29 has it |
| `/desktop/connect-check` | the desktop main process | token | none, as today |
| WebSockets `/events`, `/acp` | the shell, the CLI | token, as a query parameter | No Origin check; deferred to TV-379 |
| `/health` | the CLI | none | none, as today |
| the shell's page and bundle, `/views/markdown/…`, `/views/url-unsupported/…` | the shell, on the same origin | none | none |

`X-TV-Version` stays on every response. Nothing reads it cross-origin, so the clause that exposes it through `Access-Control-Expose-Headers` is removed.

### Where the browser and the desktop app differ, and why

| | Browser | Desktop app | Why |
|---|---|---|---|
| What sandboxes artifact documents | The sandbox header and the iframe attribute | The sandbox header | Webviews do not support the `sandbox` attribute. |
| How bridge messages reach the shell | `postMessage` to the parent frame | The webview preload's content bridge, over IPC | A webview is a top-level page with no parent frame. |
| PDFs inside folder artifacts | Do not display in Chromium-based browsers ([TV-956](https://linear.app/telepath-computer/issue/TV-956)) | Unaffected by the iframe attribute, which webviews lack | Chromium does not display a PDF in a sandboxed iframe. |
| Browser features such as clipboard writing and fullscreen | Granted by the iframe `allow` attribute | Granted by a main-process permission handler | The `allow` attribute does not govern webviews. |
| External web pages | The placeholder, except in browser demo mode | Shown in the webview | Unchanged |
| Links opened outside the artifact | A new browser tab | The system browser | Unchanged |
| Application links | Handed to the operating system by the browser | Passed from the webview to the shell, then to the main process | The main process accepts messages only from the shell's window. |
| Navigation chord in documents without the bridge | Not available | Available, handled natively | Unchanged |

## Changes to the resources work

PR #29 already serves its resource routes to pages on any origin, with no Origin check and no CORS headers (`^rs-any-origin` in [the resource architecture](../../specs/arch/resources/index.md), `^rs-other-origins` in [the product spec](../../specs/product/resources/resources.md)). That is what sandboxed pages need, since every one of them sends `Origin: null`. Its SDK also connects with `wss:` on pages served over HTTPS, and it supports HTTPS fronts such as `tailscale serve` (`^rs-https-front`). TV-378 needs these further changes to it:

1. **The SDK is served with CORS** (`^sdk-serving`). A sandboxed page imports the module in CORS mode from `Origin: null`, so `/sdk/v1/resources.js` and its notices file send `Access-Control-Allow-Origin: *`. The resource routes themselves keep sending no CORS headers: CORS does not govern the page connection, which is a WebSocket, and only the CLI and agents call the administrative routes.
2. **The security limits change** (`^rs-limits` in the product spec).
   - Its opening statement that nothing in the model isolates the artifacts on one server from each other, and its bullet "Artifacts served by one server share its origin", become: each artifact document is sandboxed with an opaque origin, so on a server that requires the token, one artifact's code learns another artifact's ID only from content or data it is given.
   - `^rs-token-loophole` goes. Access levels then constrain every page, including pages in a browser that holds the token. The promise that a share viewer never learns the artifact's ID (`^rs-share-hides-id`) stops citing the loophole: it concerns the page and what the browser receives through the link, while a person who holds the producer's token can still read artifact records through the server's interface.
   - In the resource architecture, the sentence after `^rs-any-origin` that a shared artifact's document has the producer's origin becomes: its document is sandboxed, but its address is the producer's, so its SDK still connects to the producer's server.
3. **The guidance says that browser storage does not work** (`^rg-purpose` and `^rg-tv-tasks` in [the guidance spec](../../specs/arch/resources/guidance.md), which govern `resources.md` and `skill-intro.md` in the `television` skill and the `tv-tasks` skill).
   - The guidance says that localStorage "is also available to an artifact's page, but highly discouraged, because a future version of Television may remove it". With this work it says plainly that `localStorage`, cookies and IndexedDB do not work in artifacts, because artifacts run under the CSP sandbox. Touching them, or `sessionStorage`, throws `SecurityError` in both runtimes, so code that cannot avoid touching them, such as a library, must catch the exception. Television offers no storage that stays in one browser.
   - The guidance's advice on which kind of artifact to create for stateful work stays as it is: a Markdown artifact, whose document is the state, or an HTML artifact that keeps its state in a JSON store or in an external service it connects to. The guidance still informs the agent's judgment rather than setting rules, as `^rg-purpose` requires; only what it says about browser storage changes.
   - The `tv-tasks` skill's sentence about localStorage changes the same way.

## Supporting changes

**Artifact IDs.** The HTTP API and the CLI accept no artifact ID today (`POST /artifacts` uses a strict schema with no `id`). The internal create paths still accept one: `createArtifact` in `packages/artifact/src/model.ts` and in `packages/server/src/server-store.ts` take `input.id` when it is given. No production caller passes one; the onboarding installer generates IDs (`onboarding-installer.ts`). The goal is that creation always generates the ID and no input carries one. Today's IDs are ULIDs: 26 Crockford base32 characters, a 48-bit timestamp, and 80 random bits from `crypto.getRandomValues`. Any generator change keeps at least that randomness from a cryptographic source. [product/artifacts.md](../../specs/product/artifacts.md) makes the same promise (`^af-artifact-id`), and share IDs are generated the same way. Channel IDs can still be supplied ([TV-549](https://linear.app/telepath-computer/issue/TV-549)), but they grant nothing.

**Folder artifacts, dotfiles and symbolic links.** Today a folder artifact serves every file below its folder, hidden files included, and follows symbolic links wherever they point; `artifact-proxy.ts` never resolves real paths. A folder that contains `keys -> ~/.ssh` serves the keys at `/artifact/<id>/keys/id_ed25519`, and one that contains `public.json -> .env` serves a hidden file under a name without a dot. Downloaded archives and cloned repositories can carry such links, which is the ticket's scenario of content from an untrusted source.

For folder artifacts, on each request, the server resolves the artifact folder and the requested file to their real locations. It serves the file only if its real location is inside the folder's real location and no part of its path below that folder starts with a dot. Any other request gets 404, as for a missing file. Links above or at the folder keep working as today: a folder that lives inside a dot-directory, such as `~/.config/site/`, or whose own path is a link, is still served. A folder that links to files outside itself on purpose stops serving them. A single-file artifact serves only its own file, as today. The theme route already confines files to the package's real path (`themes.ts`).

**One server per client.** About 220 lines of client code remain from multi-server support. They include the per-origin token map in `packages/web/src/store.ts` and the `?serverURL=` override in `packages/web/src/config.ts`. They also include `serverURL` fields on events and errors, the split between `primaryServerURL` and `runtimeServerURL` in `main.ts`, and the agent-chat session map keyed by server URL. The goal is one connection whose server is the page's own origin. The stored token map and agent-chat session map keep their formats and keys, so the shell reads what people have already saved ([Saved state](#saved-state)), as [channel-state `^cs-token-carry`](../../specs/arch/channel-state/index.md) requires of upgrades.

Development and the browser tests depend on the cross-origin arrangement this removes. `scripts/dev-server.sh` opens the Vite-served shell with `?serverURL=` pointing at the server's port, and Vite has no proxy. About 32 browser end-to-end test files do the same, as does the UX staging runbook ([runbook-ux-staging.md](../../specs/arch/updates/runbook-ux-staging.md)). Once the control routes stop sending CORS headers, these need the shell and the server on one origin, for example by having the Vite dev server proxy the server's HTTP and websocket routes.

**Version advertisement.** Remove the `Access-Control-Expose-Headers` sentence from `^version-header` in [version-advertisement.md](../../specs/arch/updates/version-advertisement.md). With `?serverURL=` gone, the page's origin is always its server, which simplifies `^reload-origin-rule` there and the matching rule in [update-channel.md](../../specs/arch/updates/update-channel.md).

**Skills.** Besides the resource guidance (change 3 above), `tv-sidebar-view` keeps its sidebar width in the artifact's JSON store instead of `localStorage`, as a to-do list keeps its tasks there. The width is then shared by everyone viewing that artifact: resizing the sidebar in one browser resizes it for all. Its comment that artifacts share an origin goes. The `television` skill's guidance on HTML artifacts notes that the sandbox strips the referrer and other information that third-party map services depend on, so Leaflet with known coordinates is the best choice for simple maps.

## Edge cases

1. **Navigation reporting in a sandboxed browser document.** The bridge uses the Navigation API whenever `window.navigation` exists (`artifact-bridge.ts`), and current releases of Chromium, Firefox (from 147) and Safari (from 26.2) ship it. In an opaque-origin document the HTML standard disables the API's entries and events: in Chromium `navigation.currentEntry` is `null` and no `navigate` event fires, not even for a link to a fragment (checked in Playwright's Chromium; Firefox 147 and Safari were not checked). So the bridge treats the API as unavailable when its entries are disabled, and uses its fallback recorder, which earlier Firefox and Safari releases use today. The browser-compatibility exception in [artifact-bridge.md](../../specs/arch/artifact-frame/artifact-bridge.md), which says only Chromium ships the API, predates those releases. The desktop app is unaffected: the bridge does not install in a webview.

   The fallback's `click` and `submit` listeners run in the capture phase and cancel the event before the page's own handlers run. As they stand, a form that the page's script handles, such as the chores example in the `television` skill, reloads its page with the form's fields in the address; a `<form method="dialog">` leaves its dialog open; a link that a client-side router handles reloads the frame; and a submit button's `formtarget` and `formmethod` are ignored. The listeners instead act after the page's own handlers, and only on events the page has not cancelled. The submit listener leaves submissions other than GET to the browser, and takes the submit button's `formaction`, `formmethod`, `formtarget` and value into account. With that change each of these cases behaved as it does today (checked with the bridge under the sandbox in Playwright's Chromium and Firefox 146).

2. **Origins the bridge compares.** `self.origin` and the `origin` of the bridge's messages are `"null"`, while `location.origin` still reports the origin of the document's URL, so the bridge's own comparisons keep working. The browser host also accepts a `leaving` message when `event.origin` equals the frame's expected origin (`artifact-trusted-channel.ts`); that fallback has to accept `"null"` for sandboxed frames or be dropped. Messages from the host to a sandboxed frame have to use `"*"` as their target, as they already do. Tests that read a frame's `contentDocument` or `contentWindow` directly have to change.

## Known limitations of the sandbox

These follow from sandboxing artifact documents. Unless an item says otherwise, each applies in both runtimes, since the desktop app shows artifacts with Chromium's engine under the same header, and each item about browser behavior was checked in Playwright's Chromium and Firefox. They are accepted. The spec changes carry each into the spec that owns the behavior.

1. **Browser storage.** Touching `localStorage`, `sessionStorage`, `document.cookie` or IndexedDB throws `SecurityError`. Merely reading `window.localStorage` throws, so an unguarded read near the top of a script stops the rest of it (checked in Playwright's Chromium and Firefox and in Electron 43.7.6). What artifacts saved there before the upgrade stays in the shell's origin, out of their reach. Nothing records which artifact wrote which key, so it cannot be moved for them.
2. **Workers.** Web workers started from the artifact's own files fail, classic and module (`SecurityError` in Chromium, an error event in Firefox), and service workers cannot register. Libraries that run code in workers, such as PDF viewers and code editors, can break.
3. **Canvas readback.** Reading pixels back (`getImageData`, `toDataURL`) from a canvas on which the artifact drew one of its own images throws `SecurityError`, unless the image was loaded with `crossorigin="anonymous"`, which the proxy's CORS headers then allow.
4. **Download links to the artifact's own files.** Browsers ignore a link's `download` attribute when the link leads to another origin, and the artifact's files are on another origin than its opaque one, so the link works as an ordinary link. A file the browser can display, such as an image or a text, JSON, SVG or HTML file, replaces the artifact's page in its frame or webview. Other files, such as CSV and ZIP files, download under their own names, not the link's. A PDF shows Chromium's error page and downloads in Firefox. Checked in Playwright's Chromium 145 and Firefox 146 and, for images, text, CSV and ZIP files, in Electron 43.7.6. A page can still offer one of its files under a name of its choosing by fetching it and linking to a blob; blob links keep their names.
5. **Moves the bridge cannot see in advance**, in a browser. The fallback recorder sees link clicks and GET form submissions. It does not see a script that assigns `location`, or a form that posts. The desktop app learns of every move from webview events, as today.
   - A script that moves the frame to another of the artifact's own pages loads that page twice: the shell learns of the move only when the new page reports its address, and then loads it again. Firefox before 147 and Safari before 26.2 do this today. Checked with the bridge and a host page that acts on bridge messages as the shell does.
   - A script move, or a form that posts, to another site loads that site inside the artifact's frame, still sandboxed, and the artifact's history does not record it. Today the bridge reports such a move, and the shell records it and shows its placeholder for external pages in the frame. [reload-navigation.md](../../specs/arch/artifact-frame/reload-navigation.md) already limits interception to "where the platform allows cancellation".
6. **Links that target the whole tab.** Today a link with `target="_top"` or `target="_parent"` replaces the Television tab with the linked page. Under the sandbox the browser blocks it, and nothing happens. In the desktop app such a link already stays in its webview.
7. **Requests to external services send `Origin: null`** when they send an `Origin` header, as `fetch` calls do. Services that accept any origin keep working; those that allow only listed origins, such as one configured to allow the Television address, refuse them. This matters for HTML artifacts that keep their state in an external service.
8. **Third-party embeds** inside an artifact, such as video players, inherit the sandbox and run with opaque origins and no storage, so many may fail or degrade. Not tested, apart from maps.
9. **Maps.** Mapping services such as Google Maps and OpenStreetMap may not work correctly in artifacts, because the sandbox strips the referrer and other information they expect. Leaflet, with OpenStreetMap's tiles, works for simple maps, with markers, popups, panning and zooming.
10. **Pointer lock**, which games use, is not among the sandbox tokens. Requests for it fail with `pointerlockerror`.
11. **PDFs inside folder artifacts** do not display in Chromium-based browsers ([TV-956](https://linear.app/telepath-computer/issue/TV-956)). This comes from the iframe `sandbox` attribute, which desktop webviews lack, so it applies only in the browser.
12. **Browser features** beyond the six that artifacts are granted, such as notifications, geolocation, the camera, the microphone, reading the clipboard and MIDI, do not work ([TV-957](https://linear.app/telepath-computer/issue/TV-957)).
13. **Shared artifacts from producers on an older release**, in a browser, lose their module scripts and live updates. Fragment and history changes inside them also stop reaching their navigation history, because the older bridge relies on the Navigation API; each page they load is still recorded.
14. **An updated desktop app connected to an older server** loses application links in artifacts and in the Markdown editor until the server upgrades ([Open pages and running apps](#open-pages-and-running-apps)).
15. **Application links in HTML artifacts ask each time**, in Chromium. Chromium asks before it opens an application link, and its prompt offers to always allow that app for the server's address, but it does not apply that approval to an opaque-origin document, so every application link clicked in an HTML artifact asks again. Checked by hand in headed Chromium under a virtual display: with `allow-same-origin` added, the approval applies, so the opaque origin is the cause. Firefox was not checked. The Markdown editor's application links and the desktop app are unaffected. Passing browser application links through the app's page, as the desktop app does, would let a saved approval apply, but one click in artifact code could then open, without asking, any app the person has approved for Television's address; asking each time was accepted instead.
16. **`javascript:` links in HTML artifacts do nothing**, in a browser. A link whose address is a `javascript:` URL runs nothing in an iframe that has the `sandbox` attribute, while a script that runs from the link's click handler, such as an `onclick` attribute, still runs. Checked in Playwright's Chromium and Firefox with a page and no bridge: the same link runs in a document sandboxed only by the header, as in desktop webviews, which have no `sandbox` attribute. Accepted as a limitation.

## Upgrading from an earlier version

The aim is that, apart from HTML artifacts that rely on browser storage, people notice no difference when their server or desktop app upgrades. This section checks the proposal against that aim. With [Known limitations of the sandbox](#known-limitations-of-the-sandbox), it lists every difference a person could notice.

### Saved state

The shell's saved state survives the upgrade, and removing the multi-server code changes no stored format:

- **The token.** The shell keeps tokens in `store-television-browser` or `store-television-electron` as `{"authTokens": {"<origin>": "<token>"}}`. The key is the server URL reduced to its origin (`normalizeServerURL` in `packages/web/src/store.ts`). The server URL is the page's own origin unless the page was opened with `?serverURL=` (`resolveServerURL` in `config.ts`). The desktop app loads the server's own address with `?mode=electron&token=…&desktopAppVersion=…` (`buildRemoteURL` in `packages/desktop/src/connect-url.ts`) and never uses `?serverURL=`. With the override gone, the shell keys the same map by its page's origin, the key it already uses. On first launch an upgraded browser reads `authTokens[location.origin]` and stays signed in. The desktop app's shell stores the launch token under the same key, as it does today.
- **Agent-chat sessions.** `television.acpMappedSessions` holds `{"version": 1, "entries": {"[\"<origin>\",\"<logical session key>\"]": "<session id>"}}`. The first part of each key is the connection's URL reduced to its origin (`StorageMappedSessionStore` in `acp-session-store.ts`, created in `server-connection.ts`). The shell keeps this format and builds the key from its page's origin, so it finds the same entries and resumes the same sessions.
- **The shell's other saved state** depends on nothing the proposal changes: the agent-chat client ID, the telemetry client ID, `tv-nav:<artifact-id>` navigation history, the dismissed update notices, the channel sidebar's width and collapsed state, the appearance cache, and the reload marker in session storage.
- **The desktop app** keeps its saved connection (`connection-store.ts`) and its Electron session. The IPC changes and the permission handler save nothing.
- **The server** keeps artifact records, stores and IDs as they are. Nothing on disk migrates.

Two kinds of saved data become unreachable. Entries saved by a shell opened with `?serverURL=`, which only development uses, stay under the other origin. Data that artifacts saved in browser storage stays in the shell's origin, where they can no longer read it ([Known limitations](#known-limitations-of-the-sandbox)).

### Open pages and running apps

- **Browser tabs** open during the server upgrade reload once when they reconnect, as after any upgrade ([version-advertisement.md](../../specs/arch/updates/version-advertisement.md)), and boot the new shell with the saved state above.
- **An older desktop app with the new server.** A desktop app runs its installed release until it updates itself. Against the new server:
  - its artifact webviews are sandboxed by the header, as checked in Electron 43.7.6 with the app's current settings;
  - bridge messages and the preload's freshness check work, the check through the proxy's CORS headers;
  - application links keep working by today's route, because the older main process checks the webview's URL, which the sandbox does not change;
  - artifacts keep the browser features Electron approves today until the app updates, apart from the camera and microphone, which Electron 43.7.6 refused to a sandboxed page even with no permission handler;
  - the IPC exposure described under [In the desktop app](#in-the-desktop-app) remains until the app updates.
- **A newer desktop app with an older server.** After the desktop release that ships with this work, apps update themselves in the background, while a server upgrades only when the person's agent upgrades it. For a while, an updated app against an older server is the common case. Then:
  - application links in artifacts and in the Markdown editor stop working in the desktop app. The updated preload sends them to the shell on a channel of its own, which the older shell does not handle, and the updated main process refuses them from webviews;
  - the permission handler limits artifacts to the six features, although the older server does not sandbox them;
  - everything else works: the isolated preload exposes the same `__televisionContentBridge` that the older shell, artifact pages and Markdown editor use.

  The first point departs from the aim; the decided list accepts it.

### Differences people could notice

Every item under [Known limitations of the sandbox](#known-limitations-of-the-sandbox) is a difference people can notice after the upgrade. Browser storage is the expected one: HTML artifacts that touch it lose what they saved, and those that touch it without catching the exception stop running until fixed. The administrator guide has the person's agent look for them.

The upgrade brings these further differences, each following from a decision above:

1. Folder artifacts no longer serve hidden files, or files reached through links that lead outside the folder or to hidden files.
2. In a browser, artifacts lose the browser features beyond the six at the server upgrade. In the desktop app they lose them when the app updates, apart from the camera and microphone, which the sandbox stops at the server upgrade.
3. Artifacts that used the server's token, its control routes or the shell's page stop working. No artifact or skill that Television ships does this.
4. Pages on other sites that called the control routes with a token stop working, because those routes send no CORS headers. The CLI and agents are unaffected.
5. Developers lose `?serverURL=`; the dev server and the browser tests move to one origin.

**Not noticeable.** The connection and all saved state carry over. Open tabs reload as after any upgrade. The CLI and agents work as before. The shell's own requests are same-origin, so removing CORS headers and `OPTIONS` handlers does not affect them. `X-TV-Version`, artifact IDs and the desktop app's own update proceed as before, and older desktop apps keep their application links.

### Tests that prove the upgrade behavior

- **Saved state carries over.** `packages/web/test/e2e/token-only-persistence.test.ts` proves `^cs-token-carry` for the token: it seeds records in the formats earlier releases saved and shows that the connection authenticates against a real server. It runs the store and connection code in a fixture page that takes its own `?serverURL=` parameter, so it moves to one origin with the other browser tests. New tests cover what it does not: the shell itself booting from a saved token, with no token in its URL; the shell resuming an agent session from an entry saved in `television.acpMappedSessions`; and both in the real desktop app, with `store-television-electron`.
- **Open tabs across a server upgrade.** The existing reload tests, such as `packages/web/test/e2e/reload-after-reconnect.01.test.ts`, keep proving the reload, and the saved-state test proves the boot after it.
- **What keeps working in sandboxed artifacts**, in a browser and in the desktop app: the onboarding Company To-dos page (module scripts, the SDK and its live store), canonical fonts and components, fetching the artifact's own files, the freshness check, navigation history through the fallback recorder, the form and link cases in [edge case 1](#edge-cases), popups, blob downloads, dialogs, and application links through the new desktop route.
- **What stops, as decided:** browser storage throws; hidden files and links leading outside a folder answer 404; artifact frames get exactly the six features, and the desktop handler refuses the rest.
- **Mixed desktop releases, if the human brings them into scope:** the previous desktop release against the new server, and the new desktop release against the previous server, in the real app, covering application links, the bridge and the freshness check. This needs the previous release in the test environment, which the proposal does not plan.

## Deferred to other tickets

These problems are real but outside TV-378. Origin checks on `/events` and `/acp` and `Host` validation are deferred to TV-379, as the decided list says.

- **Navigation-history limits: [TV-954](https://linear.app/telepath-computer/issue/TV-954).** A page reports its navigations over the bridge, and the shell saves each web URL it reports in `tv-nav:<artifact-id>` in its `localStorage` (`handleNavigationRequest` in `artifact-view.ts`). A report marked as a same-document navigation is saved without any navigation happening. The history keeps at most 100 entries ([reload-navigation.md](../../specs/arch/artifact-frame/reload-navigation.md)) but does not limit their length. Artifacts could therefore fill the shell's storage, which holds about 5 million UTF-16 code units in Chromium and Firefox and as few as 2.6 million in Safari, and make the shell's own writes fail. That is denial of service, not access to Television's authority.
- **Forged `navigation-key` messages: [TV-955](https://linear.app/telepath-computer/issue/TV-955).** The host acts on a `navigation-key` message from any frame that passes source validation, with no evidence that a key was pressed ([artifact-bridge.md](../../specs/arch/artifact-frame/artifact-bridge.md), Host-side handling). An artifact can therefore move the person between tabs and channels, and a channel move changes the server's focused channel for every client. This is a nuisance on its own, at most a small link in a larger exploit.
- **PDFs inside folder artifacts: [TV-956](https://linear.app/telepath-computer/issue/TV-956).** In Chromium, a PDF does not display in a sandboxed iframe: the frame shows Chromium's error page. The same PDF served with the sandbox header displays in an unsandboxed frame and at top level (checked with Playwright's Chromium; Firefox and Safari are unchecked). The browser keeps both the iframe attribute and the header: PDF display is not a guaranteed feature, and the sandbox is not weakened to show PDFs. A path artifact's own file must be HTML or Markdown (`isAllowedArtifactFilePath` in `server-store.ts`), so this affects only PDFs inside folder artifacts.
- **Richer browser features: [TV-957](https://linear.app/telepath-computer/issue/TV-957).** Granting artifacts features beyond the six above, such as the camera or geolocation, and research into how each browser treats them.

## Where this lands in the specs

The desktop IPC hardening and the permission handler are the only changes in `packages/desktop`. They ship in a desktop release with this work and need the real-host checks in [product/desktop-app.md](../../specs/product/desktop-app.md#testing). Everything else ships with the server.

- **One new architecture spec** owns the isolation contract: the sandbox header and the iframe attribute, the features artifact frames and webviews get, what the shell accepts over the bridge, the artifact proxy's rules for folder artifacts, the route-by-route CORS, Origin and sandbox-header rules above, and the known limitations. A home under `specs/arch/artifact-frame/` fits. The frame-core carve-out in [artifact-frame/index.md](../../specs/arch/artifact-frame/index.md) keeps renderer routing code-governed but points to this contract. [spec-migration.md](../../specs/spec-migration.md) lists the new spec.
- **[product/artifacts.md](../../specs/product/artifacts.md):** the document section says an artifact's document runs sandboxed, without access to Television's authority or to browser storage. It also covers generated IDs, and folder artifacts' dotfiles and symbolic links.
- **The resources specs from PR #29**, for the changes listed above:
  - in [the product resources spec](../../specs/product/resources/resources.md), `^rs-limits` (its opening statement, the shared-origin bullet and `^rs-token-loophole`) and `^rs-share-hides-id`;
  - in [the resource architecture](../../specs/arch/resources/index.md), the sentence on a shared artifact's origin after `^rs-any-origin`;
  - in [the SDK spec](../../specs/arch/resources/sdk.md), `^sdk-serving` (CORS);
  - in [the guidance spec](../../specs/arch/resources/guidance.md), `^rg-purpose` and `^rg-tv-tasks`.
- **[artifact-bridge.md](../../specs/arch/artifact-frame/artifact-bridge.md):**
  - the fallback recorder for sandboxed documents in every browser, with its listeners acting after the page's own handlers, and the browser-compatibility exception, which predates Firefox's and Safari's Navigation API;
  - the iframe `leaving` origin fallback;
  - the cross-origin freshness poll;
  - the Electron application-link route in Link handling: the preload running isolated, the request passing through the shell, and the shell's origin check on the webview's URL in place of the main process's.

  This spec is reviewed adversarially between models rather than line by line by the architect.
- **[connect-flow.md](../../specs/arch/desktop/connect-flow.md):** the main process's sender checks.
- **[The administrator guide](../../docs/guides/television-admin-guide.md)**, section 7 (Upgrades): the check for artifacts that use `localStorage`, with its two options, removing that use or moving it to the JSON store. [Its spec](../../specs/arch/cli/admin-guide.md) requires human review of changes to its instructions, and publishing it to `https://television.run/install.md` is a separate step after the change merges.
- **[The update channel's master copy](../../specs/arch/updates/update-channel.json)**, at release: the announcement of the release as an available server upgrade, written and published by the manual deploy in [update-channel.md](../../specs/arch/updates/update-channel.md) (`^ops-deploy`). Its prompt sends the person's agent to the administrator guide, which carries the `localStorage` check. Its `desktop` block does not change.
- **Updates:** [version-advertisement.md](../../specs/arch/updates/version-advertisement.md) (`^version-header` and `^reload-origin-rule`), [update-channel.md](../../specs/arch/updates/update-channel.md), and [runbook-ux-staging.md](../../specs/arch/updates/runbook-ux-staging.md).
- **Themes:** [themes/index.md](../../specs/arch/themes/index.md) says the registry control routes send no CORS headers. [themes/delivery.md](../../specs/arch/themes/delivery.md) adds the sandbox header to theme file responses.

---
description: Artifact work — markdown files, HTML files/directories, URL pointers, create/update/delete flows, browser-only tab-page reordering, and the quality bar.
---

# Artifact workflow

Read this document for Television artifact work: creating files, registering path or URL artifacts, browser-only tab-page reordering, deleting, and updating titles.

If you need bundled Television authoring skills installed first, copy them into the agent harness skills folder with `tv skills install <path>` (for example `~/.openclaw/skills`, `~/.hermes/skills`, or `~/.agents/skills`) or use `tv skills install -i`.

If you are authoring a specialized HTML artifact, read the matching skill after this one — for example `tv-calendar` or `tv-table`.

## Choosing the artifact kind

Television has three artifact shapes. Pick the one that fits the result:

- **Single file** — one self-contained markdown (`.md`) or HTML (`.html`) file on disk. Use when the artifact needs no dependent CSS, JS, images, or additional pages.
- **Directory** — a folder on disk containing `index.html` plus sibling assets (CSS, JS, images, additional pages). Use when the artifact needs richer structure: custom stylesheets, scripts, images, or multi-page navigation.
- **URL** — an external `http(s)://` web page or web app, or a locally running web server (e.g. `http://localhost:3000`). Use for remote pages, local web apps the agent does not manage, or any live web resource. Do not use URL artifacts for content Television should manage the lifecycle of — use a path artifact instead.

Single files and directories are both registered with `tv create-path-artifact`. URL artifacts use `tv create-url-artifact`.

Within path artifacts, choose the content shape:

- **HTML file or directory** — default for most artifacts. HTML gives Television its best rendering: styled layout, hierarchy, visual structure, and the canonical stylesheet. Use HTML whenever the result is a presentation, summary, dashboard, comparison, reference, or anything the user will primarily read rather than edit.
- **Markdown file** — use when the result is a document the user will want to edit directly: notes, drafts, working documents, or content that will be revised outside Television.

If you are unsure between HTML and markdown, default to HTML.

## Where to place new artifact files

Television registers pointers — the file lifecycle is yours, not Television's. Deleting an artifact removes the registry record, not the underlying file or folder, regardless of where it lives.

**Default for HTML (single file or directory): `<home>/artifacts/`**, the `artifacts` folder in the Television home your `tv` commands use. `tv config show` prints that home as `home`. HTML artifacts are pure presentation — Television is where they live and get used, so the default folder is the right place. Put them there unless the user has told you otherwise. Create the directory if it does not exist.

**Markdown is different.** A markdown artifact is usually a user-owned document — a note, draft, write-up — that has a life outside Television. Putting one in `<home>/artifacts/` is suspect: the user will likely want it alongside their other documents. For markdown, co-locate with the project, repo, notes folder, or workspace where a new document of that kind would naturally belong if the user had asked for one outside Television. If no such place is obvious from context, ask the user where it should go rather than dropping it in the default folder.

For HTML, put the file somewhere else only when the user has explicitly directed you to — either in this request, or via a durable instruction (project `AGENTS.md`/`CLAUDE.md`, a standing preference, an earlier "from now on…" in this session). Examples of explicit direction: "save it in the repo", "put it in my notes folder", "drop it in the agent workspace".

Do not co-locate HTML artifacts with project files, repo trees, notes folders, or agent workspaces on your own initiative — even when it seems natural. The default for HTML is `<home>/artifacts/`.

### File and folder naming

Use durable, descriptive names that capture the artifact's subject specifically — favor `q3-revenue-by-region.html` over `report.html`. For HTML artifacts in the default folder, good names are how you'll find one again later among the others.

For directory artifacts the folder name is the primary identifier — files inside are typically generic (`index.html`, `styles.css`).

Always tell the user where you put the file.

## Accepted path targets

`tv create-path-artifact` accepts three path shapes:

- **Single markdown file** ending in `.md` or `.markdown`
- **Single HTML file** ending in `.htm` or `.html`
- **HTML directory** — a directory whose root contains `index.html` or `index.htm`, plus any sibling assets

The path must be absolute, existing, and readable by the server. A trailing separator is optional — the server checks the path on disk to decide whether it is a file or a directory.

## Authoring quality

Build artifacts that are durable, truthful, and maintainable by later agents.

Required standards:

- be faithful to source material
- do not invent missing facts to make the artifact look complete
- do not silently truncate a dataset and pretend it is comprehensive
- prefer truth over completeness when those goals conflict
- make limitations, sampling, gaps, and freshness visible when they matter
- avoid unnecessary layout or styling churn during simple refreshes

Anti-patterns to avoid:

- cursory or low-effort data collection
- fake completeness — padding to look thorough
- brittle one-off hacks that a later agent cannot reproduce
- hidden dependencies that are not documented next to the artifact

## Before creating artifacts

Before starting artifact creation, briefly tell the user what you are about to make. Artifact creation can be time-consuming; the user should be kept informed. Think about how to work expediently and avoid unnecessary extra steps without compromising the outcome.

## In-flight narration style

While a multi-step artifact workflow is running, narrate concisely so the user knows you are still working.

Required style:

- verbalize key actions and decisions as they happen
- keep updates short — a sentence per beat, not a paragraph
- prefer the user's framing over Television's internal machinery
- optimize for speed and token efficiency

Good examples:

- "Starting the artifact now."
- "Reviewing the draft and source material."
- "Writing the HTML and checking it in the browser."
- "Registering the artifact on your channel."
- "Done."

Avoid:

- multi-paragraph progress reports or long retrospective narration during execution
- verbose bullet lists for routine workflow steps (use bullets only when the user explicitly asks)
- workflow jargon ("calling create-path-artifact", "registering the path artifact") unless the user is debugging Television itself

## Markdown path artifacts

1. Write the markdown file.
2. Register it:

   ```bash
   tv create-path-artifact --channel "<channel-id>" --title "Artifact title" --path /absolute/path/to/file.md --focus-artifact
   ```

Rules:

- The file must already exist and be readable.
- Television's markdown editor reads and writes the pointed-to file.
- Deleting the artifact removes the registry record, not the markdown file.

## HTML path artifacts

HTML can be a single file or a directory bundle.

Single-file example:

```bash
tv create-path-artifact --channel "<channel-id>" --title "Artifact title" --path /absolute/path/to/report.html --focus-artifact
```

Directory example (trailing slash optional):

```bash
tv create-path-artifact --channel "<channel-id>" --title "Artifact title" --path /absolute/path/to/dashboard --focus-artifact
```

A directory artifact needs root `index.html` or `index.htm`. Keep sibling assets relative so they resolve through the artifact proxy:

```html
<link rel="stylesheet" href="./styles.css" />
<script type="module" src="./main.js"></script>
```

Use Television's canonical artifact stylesheet and record the app version whose canonical surface you authored against:

```html
<link rel="stylesheet" href="/canonical/v2/styles.css?authoredForAppVersion=<version>" />
```

Replace `<version>` with the target Television app version. For a running server, read the exact release `version` from `tv status`; when working in a Television checkout, read the exact version from the checkout root `package.json`. Copy that exact release version unchanged into `authoredForAppVersion`. A missing version or the `0.0.0` development sentinel does not identify a release, so omit the metadata.

`authoredForAppVersion` is advisory authoring context for a future agent. The server ignores it when serving the stylesheet, so it neither asserts compatibility nor controls whether the artifact loads. Set it when creating an artifact or deliberately re-authoring one against that app surface. Preserve an existing `authoredForAppVersion` value during unrelated maintenance. If you cannot establish the target app version, omit the query parameter; the canonical URL remains valid without it.

Third-party mapping services such as Google Maps and OpenStreetMap may not work correctly in an artifact, because the CSP sandbox the artifact runs under strips the referrer and other information they expect. For a map, use Leaflet with Esri's street or satellite tiles (World Street Map or World Imagery), which work in a sandboxed artifact.

### Suggested HTML file set

For durable HTML artifacts, write nearby documentation so a future agent can maintain the work:

- `index.html` — rendered page
- `artifact.md` — purpose, user intent, data sources, rendering notes, update workflow, non-goals
- `memory.md` — maintenance log
- data source file when the artifact has non-trivial underlying data

For single-file artifacts, keep these files in the same directory. For directory artifacts, put `index.html` at the registered root and keep supporting files next to it unless the user's workspace convention says otherwise.

### Data before presentation

Before authoring the final HTML, think through the underlying data in a pure-data way.

Ask yourself:

- what facts exist?
- what structure do they have?
- what is missing?
- what separation between data and presentation would help the next agent?

Capture this reasoning in a supporting document or data file before the presentation work.

## Updating an artifact

To update markdown or HTML content, edit the pointed-to file or directory in place. Television watches supported path targets and refreshes connected clients.

To retitle an artifact:

```bash
tv update-artifact --id "<artifact-id>" --title "New title"
```

To repoint an artifact at different content (same kind only — a path artifact takes `--path`, a URL artifact takes `--url`):

```bash
tv update-artifact --id "<artifact-id>" --path /absolute/path/to/new-target
tv update-artifact --id "<artifact-id>" --url "https://example.com/next"
```

The new path follows the same rules as creation (file or indexed directory, trailing separator optional). Rendering follows the new pointer immediately, and for path artifacts the content watcher retargets with it. Prefer repointing over delete-and-recreate when the artifact should keep its identity and channel placement.

Reordering an artifact's tab page on its current channel is a browser UI tab-drag gesture; the CLI does not expose layout mutation today.

To move the same underlying path or URL to another channel, delete the existing artifact and create a new one on the target channel with the same `--path` or `--url`.

To delete the registry record and remove its tab page from the channel:

```bash
tv delete-artifact --id "<artifact-id>"
```

## URL artifacts

URL artifacts point at external `http(s)://` pages.

```bash
tv create-url-artifact --channel "<channel-id>" --title "Artifact title" --url https://example.com --no-focus
```

Rules:

- `--url` must be `http://` or `https://`.
- Electron displays the URL in a webview.
- Browser clients show a local unsupported placeholder for ordinary web URLs.
- Browser clients render Television artifact proxy URLs (`http://<host>:<port>/artifact/<id>/...`) inline and live-reload them when the producer's ETag changes.
- Television does not fetch or watch ordinary remote pages from the consumer server.

### Sharing Television artifacts

To share a path artifact from one Television server with someone else, create its share link on the producer:

```bash
tv share-artifact --id <artifact-id>
```

It prints the link once for each address the server can be reached at, in the form `http://<host>:<port>/artifact/<share-id>/`. A server listening on every interface (`0.0.0.0`) gives each of the machine's addresses, never `0.0.0.0` itself. Never share the artifact's own address, `/artifact/<artifact-id>/`: anyone who can load it can read and write the artifact's store. The share link reaches the artifact without revealing its ID, at `read` unless you give `--access read-write`. Run the command again with `--access` and the other level to change the link's level, and revoke the link with `tv unshare-artifact --id <artifact-id>`.

**CRITICAL — the share link carries NO token.** Do not append the server's main `tv` bearer token (or any `?token=`/`Authorization` value) to a share link, and never include it when telling the recipient how to reach the artifact. The `/artifact/<id>/*` proxy is bearerless: the unguessable share ID in the path *is* the capability. Leaking the main token would hand over full read/write control of the entire producer server. A correct share link is exactly the form above and nothing else.

Choose the line whose host the recipient can actually reach:

- Prefer a Tailscale CGNAT address (`100.64.0.0/10`) when one is present.
- Otherwise use a non-loopback bind address.
- Never emit a loopback host (`127.0.0.1` or `localhost`) for sharing; that points at the recipient's own machine.
- If no line has a host the recipient can reach, tell the user so instead of inventing a share link.

The recipient adds the link with `tv create-url-artifact`; Television recognizes the `/artifact/<id>/...` shape, renders it inline, and reloads it from the producer when the producer content changes.

Markdown artifacts shared this way render as read-only HTML. Anyone with the share link can read the artifact's content with no token at all, because the share ID alone authorizes the read.

A URL artifact has no share link. To "share" one, pass along the underlying URL and let the recipient create their own URL artifact.

If the browser placeholder for an ordinary non-Television URL is not sufficient, create a markdown or HTML path artifact that links to the page and summarizes what the user needs from it.

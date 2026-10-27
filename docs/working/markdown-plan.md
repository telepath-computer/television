# Bundled Markdown plan

Markdown is being added as a bundled artifact template. Its page is the existing interactive Markdown editor, with the document stored in the artifact's JSON store instead of a Markdown file. The architecture changes in this branch are draft prose for Rupert to decide.

## Decisions not settled by the existing sources

- Seed every new document with exactly `{"markdown":""}` rather than leaving the store unwritten. This gives agents a stable field immediately, distinguishes a valid blank document from missing data, and avoids a write-on-load race.
- Omit `display` so Markdown uses the shared artifact size and full-screen defaults, as the existing Markdown file editor does within its frame.
- Use `Markdown` as the manifest name and `A Markdown document you and an agent can edit together.` as its Toolbox description.
- Subscribe at the store root to validate the complete `{ markdown: string }` value, but save only the `markdown` child so future extra root fields survive.
- Reuse the editor's current 500 ms save pause. The template does not add save-on-blur or a separate save button.
- Keep concurrent behavior deliberately simple: each page or agent save replaces the complete string and the latest store write wins. There is no text merge in this version.
- Keep the existing editor's save-echo suppression. A matching store value after a local save causes no CodeMirror transaction, preserving the caret, scroll and undo history. A different value is a live remote edit and replaces the open document without being saved back.
- Emit one versioned classic script and stylesheet at `/views/markdown/v1/` from the existing `packages/view-markdown` build. The file editor keeps its self-contained inline HTML, while the template links the same compiled editor bytes. A classic script works in the artifact's opaque-origin sandbox without adding cross-origin module headers. Versioning protects copied artifacts from a later incompatible mount API.
- Keep the copied template page as the artifact document and put the store adapter there. Do not nest `/views/markdown/` in another frame: that would create a second document and bridge lifecycle, and would need new relays for content, navigation, keyboard and pointer behavior. Do not copy CodeMirror into each template: that would duplicate a large dependency and licensing surface in every artifact and let file and store editors drift.
- Expose a narrow global mount interface from the classic shared script. The template receives only the editor operations it needs; resource handles, artifact identity and access state stay in the copied page.
- Make the editor read-only until the page has both valid data and known read-write access. A valid blank first value then focuses the editor for immediate typing. Read shares see the same editor and document without editing.
- Follow resource guidance rather than inventing offline editing: while disconnected, show `Reconnecting…`, disable editing, retain the latest known stored document, discard an edit that has not started a write, and wait for the current store value before re-enabling. The SDK still owns rollback and uncertain outcomes for a write already sent.
- On loss of write access, restore the latest stored string and keep it visible read-only. Revocation also keeps that last string visible. If access later returns, only the then-current stored string resumes editing; discarded typing is not replayed.
- Use the standard bundled-template unreadable-data copy, adapted to “document”. Missing, invalid or unavailable data hides the editor, produces no repair write, and recovers live after an agent repairs it.
- Treat the loading, status and unreadable-data chrome as a narrow template-owned shell. The architecture spec governs its behavior; its exact appearance remains code-authoritative in this version. The editor itself keeps the existing UI authority: colours and table interactions in `specs/ui/markdown-editor/index.md`, with the rest code-authoritative under the frame-core carve-out. No Markdown-template MDX spec or stories are added.
- Use a small first-party Markdown icon, so the template adds no third-party asset, licensing inventory or folder notice. The editor dependencies remain on the existing `view:markdown` licensing surface.
- Clarify the Television resource skill's state-choice paragraph: a Markdown *file* artifact is file-backed and read-only through a share link, while the bundled Markdown template is store-backed and follows its store access. This prevents the new template from making the old generic wording misleading.

## Open questions for Rupert

- Is the recommended explicit `{"markdown":""}` seed preferable to an unwritten store? I recommend the explicit seed for immediate agent discoverability and an unambiguous blank state.
- After the first version, should simultaneous person and agent edits stay last-save-wins or gain merge/conflict behavior? I recommend shipping the settled last-save-wins behavior first and designing text merging only from observed collaboration needs.
- Should disconnected editors instead retain offline typing and save it after reconnect, like Sticky note? I recommend the drafted no-offline behavior for the first version because it matches the resource guidance and the existing editor's rollback model; offline draft ownership can be designed separately if it is important.
- When read-write access is removed, should unsaved local typing be discarded as drafted, or remain visible locally? I recommend discarding it and showing the latest stored string so a read-only document never implies that unsavable text is shared.
- Is retaining the latest stored document after share revocation the desired privacy behavior? I recommend matching Sticky note and Table: keep what was already delivered visible, make it read-only, and deliver nothing newer.
- Does the loading/error/status shell need a future MDX UI spec? I recommend leaving it code-authoritative for this narrow reuse page unless review identifies a distinctive visual surface; the editor itself already has the intended authority split and no new editing UI is being designed here.
- Is `A Markdown document you and an agent can edit together.` the right Toolbox description? It states the distinguishing behavior without exposing the store mechanism.
- Is `/views/markdown/v1/` the preferred compatibility promise? I recommend it because copied artifacts can outlive the template and installation version; a later incompatible editor mount can add `v2` while retaining `v1`.

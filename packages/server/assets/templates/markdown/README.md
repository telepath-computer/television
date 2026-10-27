# Markdown

The page and your agent share the JSON store owned by this artifact. The root
object has one required `markdown` string, and a new document starts blank as
`{"markdown":""}`. Spaces and line breaks are kept exactly. Other root fields
are ignored by the page and preserved when it saves.

The commands below require `jq`. Set `ARTIFACT_ID` to the ID of the document.
Read the current Markdown again immediately before replacing it, even if you
read it earlier while preparing the change:

```sh
tv resource json get --artifact "$ARTIFACT_ID" markdown | jq -j .value > document.md
```

This keeps every line break exactly as stored. If the field is absent, the
command writes `null` instead; do not replace the document from that file.

To replace the complete Markdown from a file, JSON-encode it and write it to
the field while leaving other root fields alone:

```sh
jq -Rs . document.md | tv resource json set --artifact "$ARTIFACT_ID" markdown --file -
```

Clear the document:

```sh
tv resource json set --artifact "$ARTIFACT_ID" markdown '""'
```

The page saves the complete document after a short pause in typing. Agent
changes appear live in an open editor, and the page's changes appear live to
agents and other viewers. Concurrent replacements use last-write-wins order;
this first version does not merge simultaneous text edits. A full-string agent
write replaces anything the person saved since the agent last read, as well as
their unsaved typing if the write arrives while they are typing. There is no
offline queue, so the editor becomes read-only while it reconnects.

Invalid or missing data shows an error and is not repaired by the page. Restore
a root object with a `markdown` string to recover it.

Each copied artifact contains `editor.js`, `editor.css`, and
`THIRD-PARTY-NOTICES.txt`. It keeps those exact editor files: a Television
update does not replace them, and a later installed template does not replace
them. Tables, links, task lists and the editor's other Markdown gestures remain
available.

`page.js` adapts the packaged editor to the artifact store. `editor.css` owns
the editor treatment, while `styles.css` owns the page layout and the loading,
status and error shell. For visual adaptations, change `styles.css` unless you
intend to replace the editor. Keep the `#editor` mount element. If you replace
the editor deliberately, update `page.js`, `editor.js`, `editor.css`, and
`THIRD-PARTY-NOTICES.txt` together.

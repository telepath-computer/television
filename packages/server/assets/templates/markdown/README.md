# Markdown

The page and your agent share the JSON store owned by this artifact. The root
object has one required `markdown` string, and a new document starts blank as
`{"markdown":""}`. Spaces and line breaks are kept exactly. Other root fields
are ignored by the page and preserved when it saves.

Set `ARTIFACT_ID` to the ID of the document. Read the current Markdown again
immediately before replacing it, even if you read it earlier while preparing
the change:

```sh
tv resource json get --artifact "$ARTIFACT_ID" markdown | jq -r .value > document.md
```

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

The Markdown editing implementation and its styles are the shared editor that
Television serves. `page.js` adapts that editor to this artifact's store, while
`styles.css` owns the template page's layout and its loading, status and error
shell. Tables, links, task lists and the editor's other Markdown gestures
remain available. If you adapt the page, keep the `#editor` mount element; the
shared colour rules depend on it. Copied page files and stores are independent
of the installed template and of other copies. Each copy loads the compatible
v1 editor served by Television, so it receives compatible updates while that
version remains live.

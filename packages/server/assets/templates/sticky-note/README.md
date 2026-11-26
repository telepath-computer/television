# Sticky note

The page and your agent share the JSON store owned by this artifact. Changes appear live.
The root object has a `text` string. A note starts with `{"text":""}`; the typing hint
is never saved. Spaces and line breaks are kept exactly. Other root fields are
ignored by the page and preserved when it saves.

Set `ARTIFACT_ID` to the ID of the note. Replace the text, leaving other fields alone:

```sh
tv resource json set --artifact "$ARTIFACT_ID" /text '"Buy milk\nCall the plumber"'
```

Clear the note:

```sh
tv resource json set --artifact "$ARTIFACT_ID" /text '""'
```

The page saves the complete text after a 400 ms pause in typing or when you leave
the field. Each keystroke restarts the pause. While typing is unsent, incoming text
does not replace it. Once sent, incoming stored values appear unless you have typed
another unsent change. Concurrent saves use last-write-wins ordering. A confirmation
for an earlier save leaves newer typing pending. Ordinary saving is silent.

While disconnected, typing remains in the open page if write access and readable
data were already established. No save starts offline. Keep the page open until it
saves: closing or reloading loses unsent typing. After reconnecting, the page checks
current access and reads the whole store before saving the latest retained text.
It saves immediately if the pause or leaving-field condition was already met;
otherwise it waits for that condition. A write sent before disconnection may have
reached the server even if confirmation was lost.

Confirmed loss of access or unreadable data discards pending typing. A save refused
for another reason also discards pending typing, including newer changes, and shows
the stored value with an error message. Invalid or missing data shows an error;
the page does not repair it. An agent must restore a root object with a `text` string.

Adapt the look in `styles.css`. The transparent document background works with the
manifest `display.transparent` setting, which is applied at artifact creation.
Copied artifacts are independent of the installed template: changes to one copy
leave the others alone.

The bundled Caveat Medium font (`Caveat-Medium.woff2`) remains under the
[SIL Open Font License 1.1](https://raw.githubusercontent.com/google/fonts/5571d84c0d8c70ec1af4f64072d8c5cf1e4e9643/ofl/caveat/OFL.txt).
When adapting or sharing the page, retain the font notice in `THIRD-PARTY-NOTICES.txt`.
That file also carries the licence for the warning icon.

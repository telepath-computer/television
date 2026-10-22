# Artifact templates

A folder template supplies page files shared by ordinary path artifacts. Using one links the new artifact to the installed template folder by default. Every artifact has its own JSON store, even when its page files are shared. Editing that folder updates every linked artifact live. A URL template instead supplies a web address and creates an ordinary URL artifact, without a store on this server.

Run `tv templates list` to choose a template. Its compact JSON contains summaries with only `id`, `name`, `description`, and optional `url`; the presence of `url` identifies a URL template. Invalid folders are listed with their errors. Before preparing or writing data, run `tv templates show <id>` to read the full validated record: the summary fields, `version`, the installed folder `path` for either type of template, and any `display`, usable `icons`, or `dataSchema`. App metadata such as `hasIcon` is omitted from both commands. Both commands rescan the installed folders immediately, so a preceding edit is visible without waiting for the watcher. The app keeps its own watched list and icons so Toolbox opens immediately. Run `tv templates path` to find those folders. If you select a home with `--home`, use the same absolute `--home` for all later commands.

## Choose a link or a copy

Link when the request only needs data changes. Create with `tv create-artifact --template <id> --channel <channel-id> --focus-artifact`, or choose `--no-focus` to leave attention where it is. The title defaults to the template name; `--title` overrides it.

When the request requires changing page files for one artifact, add `--copy`. Television copies the page and supporting files, including the README, into a fresh folder under `<home>/artifacts/`, then registers that copy. The manifest stays with the installed template; icon assets are copied with supporting files because the page may use them too. Edit the copied files.

**Never edit an installed template folder for a request about one artifact.** When asked to change a template, tell the person that every artifact linked to that folder receives the change.

### Detach an existing linked artifact

1. Inspect `tv get-artifact --id <id>` to find the current path.
2. Copy that folder and its supporting files into a fresh location. Keep internal symbolic links pointing within the copy.
3. Run `tv update-artifact --id <id> --path <copy>`, using the absolute copy path.
4. Edit the copied page files.

The existing artifact keeps its ID and store. There is no detach command and no need to recreate the artifact or copy its data.

## Supply data

After inspecting `tv templates show <id>`, use `--data '<json>'` to supply starting data or `--data-file <path>` to read it from a file; `-` reads standard input. Choose one. The caller supplies the only optional starting value, including an explicit `null`; without one, the store starts unwritten. Templates supply no starting data. The CLI checks JSON syntax and the 1 MiB compact-JSON size limit. The server checks the supplied value against the store rules and optional `dataSchema` before creating anything. Schema errors name the failing field and direct you to `tv templates show <id>`.

Starting data is written by the server within the creation request. Success means creation and any starting write completed. A failed request may leave copied files or an artifact: its error names the target, gives the generated artifact ID whenever registration was attempted, and says which step could not be confirmed. Inspect what remains before retrying. Later writes with `tv resource json` do not enforce the template schema; keep writing data the page can use. The [resource guidance](./resources.md) covers store reads and writes.

URL templates accept neither data options nor `--copy`, and cannot declare `dataSchema`. They retain the usual limits on displaying external pages in a browser.

## Author a template

Put each template in a separate folder directly inside the directory from `tv templates path`. Follow the Artifact workflow naming guidance in `SKILL.md`; the folder name is the exact template ID. Required manifest fields are non-empty `name` and `description` strings and a Semantic Version `version` string. The Toolbox lists names and icons and searches names; descriptions remain required for agents. The manifest name is also the default artifact title.

For a folder template, include a readable root `index.html` and any supporting files. This is an HTML artifact page, so follow the Artifact workflow and HTML artifact style sections of `SKILL.md`. Alternatively, manifest `url` supplies an absolute HTTP or HTTPS address: `index.html` is then unnecessary. Use the field `url`, not Web App Manifest `start_url`.

Add an optional `display` object when the default starting size, full-screen state, or opaque frame does not suit the template. Optional `width` and `height` are finite positive numbers of reference pixels; `fullScreen` and `transparent` are optional booleans. `transparent: true` enables artifact transparency; false or omission defaults to opaque. Each `tv create-artifact` display option overrides its corresponding manifest value, including `--no-transparent` overriding true. These values are chosen at creation; later edits to manifest `display` leave existing artifacts unchanged, even when their page files are linked.

Write a `README.md` when an agent needs context about the data or adapting the page. Describe field types and which values the page and agents write, and point to manifest `dataSchema` when present. Copies include the README with supporting files. Artifacts record no template origin; the path of a linked artifact identifies the installed folder.

### Fix templates with errors

The Toolbox does not offer a folder that fails validation. It shows a summary instead, such as “3 templates had errors”, and asks the person to have you fix them. When asked:

1. Run `tv templates list`. Each entry in `errors` names a folder and every problem found in it.
2. Fix each folder in place. Do not delete a folder to clear its error unless the person asks.
3. Run `tv templates list` again, and repeat until `errors` is empty or only holds folders the person has told you to leave.
4. Tell the person which templates are fixed and which are not, and why.

### Icons

Optional manifest `icons` uses [W3C Web App Manifest form](https://www.w3.org/TR/appmanifest/#icons-member). Each entry has `src` and optional `sizes`, `type`, and `purpose`, for example:

```json
"icons": [
  { "src": "assets/calendar.svg", "sizes": "any", "type": "image/svg+xml" },
  { "src": "assets/calendar-48.png", "sizes": "48x48", "type": "image/png" }
]
```

Use paths relative to the template folder. A file must remain inside that folder after symbolic links are followed. SVG and PNG are supported; unusable entries, including missing files and paths outside the folder, are ignored. There is no required icon filename. For the 20px slot, Television prefers SVG or `sizes: "any"`, then the smallest PNG at least 40px on both axes, then the largest available. It draws the image as-is, with no circle or background. A missing or failed icon displays the uppercase first character of the name, white in a filled circle with a colour determined by the template ID.

When creating a URL template, fetch the best site icon once. Look for an SVG or large PNG declared by `<link rel="icon">`, `apple-touch-icon`, or the web app manifest linked by the page. Resolve relative icon URLs against the page or manifest that declares them. If none is available, fetch `/favicon.ico` from the site origin and convert it to PNG. Save the chosen SVG or PNG inside the template folder and list that local file in `icons`. The server and app never fetch site favicons.

### Schema and compatibility

Optional manifest `dataSchema` embeds a JSON Schema Draft 2020-12 schema describing the store value. It is a schema object or boolean, not a file path. References must resolve within that embedded schema; external references are not loaded. An invalid `dataSchema` makes the template invalid. The server validates caller-supplied starting data against it before creation, without deriving values from `default` annotations. Later store writes do not enforce it, so keep the page and agent guidance consistent with the schema.

Treat a missing store value as the empty state and render defaults for missing fields in partial data. **Do not write defaults on load:** such a write can race with an agent write or fail for a read-only share viewer.

When changing a linked template, the new schema must accept every value the previous schema accepted, and the page must still render those values. Existing artifacts keep their data while receiving the changed files. Adding an optional field can still break compatibility if the old schema accepted values that the new field constraints reject. Compatibility is an authoring responsibility; Television neither compares schema versions nor migrates stores.

Television preserves a valid installed bundled template at or above its minimum version on later boots, even when the bundled source has a newer version. An invalid or older folder is backed up and replaced at the same path. An interrupted replacement can leave that path absent until the next serving boot restores it. Detecting local changes is deferred. Run `tv templates list` after editing to check validity. Deleting or moving an installed folder breaks its linked artifacts; their records and stores remain.

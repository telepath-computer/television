# Artifact templates

A folder template supplies page files and optional starting data. Using one copies its page and supporting files into a fresh folder under `<home>/artifacts/` and creates an ordinary path artifact with its own JSON store. A URL template supplies a web address and creates an ordinary URL artifact, without a store on this server.

Run `tv templates list` to choose a template. Its compact JSON contains summaries with only `id`, `name`, `description`, and optional `url`; the presence of `url` identifies a URL template. Invalid folders are listed with their errors. Before preparing or writing data, run `tv templates show <id>` to read the full validated record: the summary fields, `version`, the installed folder `path` for either type of template, and any `display`, usable `icons`, or `dataSchema`. App metadata such as `hasIcon` is omitted from both commands. Both commands rescan the installed folders immediately, so a preceding edit is visible without waiting for the watcher. The app keeps its own watched list and icons so Toolbox opens immediately. Run `tv templates path` to find those folders. If you select a home with `--home`, use the same absolute `--home` for all later commands.

## Use a template

Create with `tv create-artifact --template <id> --channel <channel-id> --focus-artifact`, or choose `--no-focus` to leave attention where it is. The title defaults to the template name; `--title` overrides it.

The root `manifest.json` and `data.json` stay with the installed template. The copy includes the README and supporting files, including icons a page may use. Edit the copied page files directly to change one artifact. Editing the page files or `data.json` in an installed template changes only artifacts created afterwards.

## Supply data

After inspecting `tv templates show <id>`, read `data.json` from the folder `path` reported by show to see any template starting data; list and show omit that value. Use `--data '<json>'` to supply a value or `--data-file <path>` to read it from a file; `-` reads standard input. Choose one. Caller data, including explicit `null`, replaces the template starting value entirely, with no merging. Otherwise creation uses `data.json` when present. With neither source, the store starts unwritten.

The CLI checks JSON syntax and the 1 MiB compact-JSON size limit. The server checks starting data against the store rules and optional `dataSchema` before creating anything. Schema errors name the failing field and direct you to `tv templates show <id>`.

Starting data is written by the server within the creation request. Success means creation and any starting write completed. A failed request may leave copied files or an artifact: its error names the target, gives the generated artifact ID whenever registration was attempted, and says which step could not be confirmed. Inspect what remains before retrying. Later writes with `tv resource json` do not enforce the template schema; keep writing data the page can use. The [resource guidance](./resources.md) covers store reads and writes.

URL templates reject data options, `data.json`, and `dataSchema`. They retain the usual limits on displaying external pages in a browser.

## Add an artifact to the toolbox

Take a snapshot of the artifact so it can be reused. Inspect `tv get-artifact --id <id>` to find its files or URL, then create a new folder under the templates folder reported by `tv templates path`. The folder name becomes the template ID. Write `manifest.json` with a name, description, and version as described below.

For a folder artifact, copy its page and supporting files into that folder. For a single-file HTML artifact, save the page as `index.html` and include its supporting files. Read the current artifact store through the [resource guidance](./resources.md) and save its value as `data.json`, including `null`; omit the file when the store has no value. A URL artifact becomes a URL template using its URL, with no `data.json` or `dataSchema`.

Leave the original artifact as it is. Run `tv templates list` to check the snapshot before using it.

## Author a template

Put each template in a separate folder directly inside the directory from `tv templates path`. Follow the Artifact workflow naming guidance in `SKILL.md`; the folder name is the exact template ID. Required fields in `manifest.json` are non-empty `name` and `description` strings and a Semantic Version `version` string. The Toolbox lists names and icons and searches names; descriptions remain required for agents. The manifest name is also the default artifact title.

For a folder template, include a readable root `index.html` and any supporting files. Optional `data.json` supplies a starting store value; the scan checks its JSON, store limits including 1 MiB, and any manifest schema. This is an HTML artifact page, so follow the Artifact workflow and HTML artifact style sections of `SKILL.md`. Alternatively, manifest `url` supplies an absolute HTTP or HTTPS address: `index.html` is then unnecessary. Use the field `url`, not Web App Manifest `start_url`.

Add an optional `display` object when the default starting size, full-screen state, or opaque frame does not suit the template. Optional `width` and `height` are finite positive numbers of reference pixels; `fullScreen` and `transparent` are optional booleans. `transparent: true` enables artifact transparency; false or omission defaults to opaque. Each `tv create-artifact` display option overrides its corresponding manifest value, including `--no-transparent` overriding true. These values are chosen at creation; later edits to manifest `display` leave existing artifacts unchanged.

Write a `README.md` when an agent needs context about the data or adapting the page. Describe field types and which values the page and agents write, and point to manifest `dataSchema` when present. Copies include the README with supporting files.

### Start from a blank store

Toolbox uses template starting data. A folder template without `data.json` must be usable from an unwritten store.

For a template people fill in, let them add content from the page. Write to the store only when they act. If content comes from an agent, show that nothing is there yet and suggest asking the agent.

Treat a missing store value as the empty state and render defaults for missing fields in partial data. **Do not write defaults on load:** such a write can race with an agent write or fail for a read-only share viewer.

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

### Store schema

Optional manifest `dataSchema` embeds a JSON Schema Draft 2020-12 schema describing the store value. It is a schema object or boolean, not a file path. References must resolve within that embedded schema; external references are not loaded. An invalid `dataSchema` makes the template invalid. The server validates caller-supplied starting data against it before creation, without deriving values from `default` annotations. Later store writes do not enforce it, so keep the page and agent guidance consistent with the schema.

Television preserves a valid installed bundled template at or above its minimum version on later boots, even when the bundled source has a newer version. An invalid or older folder is backed up and replaced at the same path. An interrupted replacement can leave that path absent until the next serving boot restores it. Run `tv templates list` after editing to check validity. Deleting or moving an installed folder leaves existing artifacts intact.

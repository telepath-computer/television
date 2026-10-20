# Artifact templates

An artifact template is a reusable folder that Television copies to create an ordinary path artifact. Run `tv templates list` to see the templates in the selected home. The list also reports folders that are invalid and why, so run it again after editing a template.

Run `tv templates path` to find the template folder in the selected home. If you select a home with `--home`, use the same absolute `--home` for listing, creating, and later commands. Put each template in a separate folder directly inside that directory. The folder name is its template ID.

Each folder needs a `manifest.json` object with three non-empty fields: `name` and `description` strings, and a Semantic Version `version` string. It also needs a readable `index.html`. The folder may contain supporting files. An optional `data.json` contains the starting value for the JSON store of each new artifact. An optional `thumbnail.png` gives the Templates picker an image; an image is not required.

Add an optional `display` object to `manifest.json` when the default starting size or full-screen state does not suit the template. The optional `width` and `height` are finite positive numbers of reference pixels; `fullScreen` is an optional boolean. A `tv create-artifact` display option overrides the corresponding manifest value for that creation.

The `index.html` in a template is an HTML artifact page: write it by the Artifact workflow and HTML artifact style sections of `SKILL.md`. Name the folder using the naming guidance in that workflow, since the folder name is the template ID. The `name` in the manifest is the title people see in the Templates picker and the default title of each created artifact.

Write a `README.md` when the adapting agent needs context. When the template has starting data, describe the store shape there: the type of each field and whether the page or an agent writes it. The [resource guidance](./resources.md) covers the store itself. The README.md is copied into each new artifact. The `manifest.json`, `data.json`, and `thumbnail.png` stay with the template. The created artifact is an ordinary folder artifact and does not record where its contents came from.

Television installs its bundled templates into each serving home. If an installed bundled copy is valid and its version meets the minimum version, editing that copy preserves it on later boots, even when Television ships a newer source. A folder below the minimum version or an invalid folder is backed up and replaced with bundled content on a later serving boot. After editing, run `tv templates list` to check that the folder remains valid.

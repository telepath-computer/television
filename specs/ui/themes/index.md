*UI spec: the bundled theme inventory and the design source for each theme ID.*

# Bundled themes

Television ships a curated set of themes. Each has a stable ID that connects its design to its installed package.

[Bundled theme inventory](./bundled.yml) is the authoritative YAML sequence of bundled theme records. Each record contains a unique `id` and its `minimumVersion`; no other fields are defined. Each ID names the matching directory under `specs/ui/themes/`; that directory’s `index.md` and `styles.css` own its design. `None` is the unthemed choice, not a package in this list.

[Bundled installation](../../arch/themes/bundled-installation.md) owns how this inventory becomes runtime data and shipped packages.

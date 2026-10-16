# Starting sizes for new artifacts and templates — proposal

**Status:** draft for Rupert, October 16, 2026 (TV-970). Part of the artifact templates change; the branch does not merge without it.

Today every new artifact starts at the shared default size, 760 by 770 reference pixels, and can only be resized afterwards with `tv reposition-artifact --width/--height` or by dragging. This proposal lets the creation itself choose the size, and lets a template declare the size its artifacts start at. A sticky note wants a small square; a table wants something wide.

## Proposed

**1. `tv create-artifact` takes a starting size.** `--width <px>` and `--height <px>`, for every source (`--path`, `--url`, `--template`), with the same meaning and checks as `tv reposition-artifact`: reference pixels, each a finite positive number, either may be given alone. An invalid size is an error and nothing is created.

**2. A template can declare a size in `manifest.json`.**

```json
{
  "name": "Sticky note",
  "description": "A short note to keep in view.",
  "version": "1.0.0",
  "size": { "width": 360, "height": 360 }
}
```

`size` is optional. When present it must be an object with `width` and `height`, both finite positive numbers in reference pixels.

**3. Which size wins.** Each side is settled on its own, in this order: the command's `--width` or `--height`, then the template's `size`, then the shared default. So `tv create-artifact --template sticky-note --width 500` gives 500 by 360. The Templates popover has no size options, so it always uses the template's size or the default.

**4. Limits.** The same as a dragged or repositioned size: a size larger than the stage is saved as given and limited where the artifact is drawn, and the artifact's own minimums still apply. No new rule.

**5. An invalid `size` makes the template invalid.** The folder appears in `tv templates list` and the popover's error box with an error naming the field, as an invalid `version` does today. The alternative, ignoring a bad `size` and using the default, would hide the agent's mistake.

**6. Guidance.** The authoring guide and the `television` skill tell an agent to give a template a `size` when the shared default doesn't suit it, and to pass `--width`/`--height` on `tv create-artifact` rather than creating and then repositioning.

## To settle

1. **Full screen as a starting state.** Should `tv create-artifact` also take `--full-screen`, and a manifest `"fullScreen": true`? Useful for dashboards; it adds one more option to each. Recommendation: leave it out for now; `tv reposition-artifact --full-screen` already covers it.
2. **Partial manifest sizes.** Should a manifest be allowed to give only `width` or only `height`? Recommendation: no, both or neither, which keeps the field easy to read; the CLI still allows one side.
3. **Field name.** `size`, matching the layout model's name for it, or something more explicit such as `defaultSize`?

## Specs it touches

- Product: `cli.md` (the create command's options and errors), `templates.md` (that templates can set a starting size).
- Architecture: `templates/index.md` (the manifest field and validity), `layout/index.md` (a new page's size can come from the creation), `templates/authoring.md`.
- The bundled Example template keeps the default size. The real templates (TV-973) each choose one.

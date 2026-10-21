# Starting sizes for new artifacts and templates — proposal

**Status:** draft for Rupert, October 16, 2026 (TV-970). Rupert settled the manifest field's name and shape, partial sizes and full screen on October 16. Part of the artifact templates change; the branch does not merge without it.

Today every new artifact starts at the shared default size, 760 by 770 reference pixels, and out of full screen. It can only be changed afterwards, with `tv reposition-artifact` or by hand. This proposal lets the creation itself choose how the artifact starts, and lets a template declare how its artifacts start. A sticky note wants a small square; a table wants something wide; a dashboard may want full screen.

## Proposed

**1. `tv create-artifact` takes a starting size and full-screen state.** `--width <px>`, `--height <px>`, and `--full-screen` or `--no-full-screen`, for every source (`--path`, `--url`, `--template`). They mean what they mean on `tv reposition-artifact`: sizes in reference pixels, each a finite positive number, and either dimension may be given alone. Giving both `--full-screen` and `--no-full-screen`, or a size that is not a finite positive number, is an error and nothing is created.

**2. A template can declare how its artifacts are displayed, in a `display` object in `manifest.json`.**

```json
{
  "name": "Sticky note",
  "description": "A short note to keep in view.",
  "version": "1.0.0",
  "display": { "width": 360, "height": 360 }
}
```

`display` and each of its fields are optional:

- `width` and `height`: the starting size in reference pixels, each a finite positive number;
- `fullScreen`: `true` to start full screen. The artifact still has a size, which it returns to when the person leaves full screen.

These are starting values only: the person or an agent can change them afterwards, and the artifact keeps no link to them. `display` is also where later properties of how an artifact looks can go, such as transparency; the spec says for each field whether it is a starting value or stays with the artifact.

**3. Which value wins.** Each of the three values is settled on its own, in this order: the command's option, then the template's `display` field, then the default (760 wide, 770 high, not full screen). So `tv create-artifact --template sticky-note --width 500` gives 500 by 360, and a template that gives only `width` gets the default height. The Templates popover has no such options, so it always uses the template's `display` or the defaults. Path and URL artifacts use the command's options or the defaults.

**4. Limits.** The same as a dragged or repositioned size: a size larger than the stage is saved as given and limited where the artifact is drawn, and the artifact's own minimums still apply. No new rule.

**5. An invalid `display` makes the template invalid.** If `display` is not an object, or `width` or `height` is not a finite positive number, or `fullScreen` is not `true` or `false`, the folder appears in `tv templates list` and the popover's error box with an error naming the field, as an invalid `version` does today. Ignoring a bad value would hide the agent's mistake. Unknown fields inside `display` are accepted and ignored, as unknown manifest fields already are, so a template using a later field such as transparency still works on an older Television.

**6. Guidance.** The authoring guide and the `television` skill tell an agent to give a template a `display` when the defaults don't suit it, and to pass `--width`, `--height` or `--full-screen` to `tv create-artifact` rather than creating and then repositioning.

## Specs it touches

- Product: `cli.md` (the create command's options and errors), `templates.md` (that templates can set how their artifacts start).
- Architecture: `templates/index.md` (the manifest field and validity), `layout/index.md` (a new artifact's size and full-screen state can come from its creation), `templates/authoring.md`, and the `television` skill's guidance.
- The bundled Example template declares no `display`. The real templates (TV-973) each choose one.

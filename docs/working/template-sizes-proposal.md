# Starting sizes for new artifacts and templates — proposal

**Status:** the October 16, 2026 proposal (TV-970) was approved and implemented. This working account includes the later transparency option and the October 22 linked-template model. The authoritative [display-options contract](../../specs/arch/layout/index.md#^ly-creation-display) governs the result.

Creation can choose the starting size, full-screen state, and transparency of an artifact. A template can supply defaults for those options: a sticky note may use a small square, a table a wide page, and a dashboard full screen. Each option is chosen once at creation, including for linked artifacts.

## Display options

**1. `tv create-artifact` takes starting display options.** `--width <px>`, `--height <px>`, `--full-screen` or `--no-full-screen`, and `--transparent` or `--no-transparent`, for every source (`--path`, `--url`, `--template`). Width, height, and full-screen options have the same meaning as on `tv reposition-artifact`: sizes are reference pixels, each a finite positive number, and either dimension may be given alone. The transparency flags enable or turn off artifact transparency. Giving both forms of either boolean option, or a size that is not a finite positive number, is an error and nothing is created.

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
- `fullScreen`: `true` to start full screen. The artifact still has a size, which it returns to when the person leaves full screen;
- `transparent`: `true` to enable artifact transparency; false or omission defaults to opaque.

These are starting values only: the person or an agent can change them afterwards. Linked artifacts share page files with the installed template; later edits to manifest `display` do not change their display settings.

**3. Which value wins.** Each of the four values is settled on its own, in this order: the command option, then the manifest `display` field, then the default (760 wide, 770 high, not full screen, opaque). So `tv create-artifact --template sticky-note --width 500` gives 500 by 360, and a template that gives only `width` gets the default height. The Toolbox has no such options, so it always uses manifest `display` or the defaults. Path and URL artifacts use the command options or the defaults.

**4. Limits.** The same as a dragged or repositioned size: a size larger than the stage is saved as given and limited where the artifact is drawn, and the minimum artifact dimensions still apply. No new rule.

**5. An invalid `display` makes the template invalid.** If `display` is not an object, or `width` or `height` is not a finite positive number, or `fullScreen` or `transparent` is not `true` or `false`, the folder appears in `tv templates list` and the Toolbox error box with an error naming the field, as an invalid `version` does today. Ignoring a bad value would hide the agent's mistake. Unknown fields inside `display` are accepted and ignored, as unknown manifest fields already are, so a template using an unknown later field can still work on an older Television.

**6. Guidance.** The authoring guide and the `television` skill tell an agent to give a template a `display` when the defaults don't suit it, and to pass `--width`, `--height`, `--full-screen`, or `--transparent` to `tv create-artifact` rather than creating and then repositioning.

## Specs it touches

- Product: `cli.md` (creation options and errors), `templates.md` (that templates can set how their artifacts start).
- Architecture: `templates/index.md` (the manifest field and validity), `layout/index.md` (the size and full-screen state of a new artifact can come from its creation), `templates/authoring.md`, and guidance in the `television` skill.
- The [bundled template spec](../../specs/arch/templates/bundled-templates.md) owns the display declarations of the current bundled set. Later templates each choose defaults suited to their pages.

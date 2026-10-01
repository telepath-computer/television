# Blueprint

Authored by an agent (Claude) on 2026-09-17 as part of a batch of "fun themes" testing the theme system. Covers the brief's "single-mode theme" and "creative CSS" cases.

## Intent

A cyanotype engineering drawing. One fixed look with no `data-theme` blocks. The manifest declares `"colorScheme": "dark"`, so Television applies the dark appearance wherever this theme is active, whatever the appearance preference says. The theme sets no CSS `color-scheme` anywhere; Television supplies it. White-line edges, square corners, monospace lettering, a drafting grid.

## Choices

- Role tokens (`--color-surface`, `--color-text`, …) are stated at `:root` so they beat both foundation mode tables.
- `--alpha-active: 12%` is restated in `theme.css`. It dates from when a fixed look could run under light appearance; with `colorScheme: "dark"` the foundation's dark table always applies, so the restatement is now redundant but harmless. Hue slots (`--red`, …) are *not* restated: in light appearance they keep the slightly more saturated light-table values. Acceptable.
- Shadows are replaced: a blueprint has no depth. Panels get a 4px surface-coloured halo (`--shadow-md`) so popovers separate from the grid.
- `--font-sans` is monospace and unprefixed, so live-canonical artifacts are lettered the same way. Intentional cross-document reach.

## Selector rules (all app-scoped)

- **Grid wallpaper** — four `linear-gradient` layers in `--app-wallpaper`; no image asset.
- **Part numbers** — `counter-reset` on `.sidebar-body`, `counter-increment` on `.channel-row`, shown in `.channel::before`. Numbering runs continuously through Pinned and Recent. Pure decoration; the DOM is untouched.
- **Selection callout** — selected channel is a dashed cyan outline with cyan text (`--channel-background-selected: transparent`), not a fill. Outline is on `.channel`, separate from the keyboard focus ring.
- **Uppercase lettering** — `.tab-label`, `.channel-group-label`, `.artifact-title`.
- **Dimension line** — `.page[selected]::before`, positioned in the gap above the frame. Relies on `.page` being a positioned, unclipped box; if a release changes that, the mark simply disappears or misplaces — delete the rule.
- **Title block** — `#foreground-overlay::after`, bottom-left, width derived from `--sidebar-width`. It sits above the interface without taking input. With a very long channel list it overlaps the last rows (85% opaque); accepted.

## Files

`theme.css`, `manifest.json`. No assets, no JavaScript.

## Maintenance

`.channel::before`, `.page[selected]::before` and `#foreground-overlay::after` were confirmed unused by Television 1.3.1 (computed `content: none`) before being claimed. Re-check on upgrade.

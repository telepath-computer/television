# CRT Phosphor

Authored by an agent (Claude) on 2026-09-17 as part of a batch of "fun themes" testing the theme system. Covers "single-mode (dark)" and "CSS-only effects on `#foreground-overlay`".

## Intent

A green P1 phosphor terminal: monochrome green on near-black, monospace, glowing type, scanlines, vignette, a rolling refresh band and faint mains flicker. Fixed look with no mode blocks. The manifest declares `"colorScheme": "dark"`, so Television applies the dark appearance wherever this theme is active, whatever the appearance preference says. The theme sets no CSS `color-scheme` anywhere; Television supplies it.

## Choices

- A private `--phosphor` custom property holds the green; documented tokens point at it. (It is theme-owned, not a Television token.)
- Shadows become glows.
- `text-shadow` on `:root` inherits everywhere, including live-canonical artifacts (the iframe documents load the same stylesheet, so each gets its own `:root` rule). Removed on the reversed selected channel row.
- `--color-danger` stays amber instead of going green: destructive actions must remain distinguishable.
- Selected tab is an outlined phosphor box rather than a fill, so the cursor glyph reads.

## Effects and cost

All on `#foreground-overlay`, CSS only, no scripts:

- Base: two repeating gradients (scanlines, grille) + radial vignette. Static.
- `::before` refresh band: one `transform` animation, 7s loop, compositor-only.
- `::after` flicker: stepped opacity, 4s loop — deliberately `steps(1)` so it repaints a handful of times per cycle rather than every frame.
- Cursor blink on the selected tab label: stepped.
- All animation stops under `prefers-reduced-motion: reduce`.

The overlay does not cover native modal dialogs (they sit above it), so dialogs appear "in front of the glass". Accepted.

## Files

`theme.css`, `manifest.json`. No assets, no JavaScript.

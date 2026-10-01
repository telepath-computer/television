# Aquarium

Authored by an agent (Claude) on 2026-09-17 as part of a batch of "fun themes" testing the theme system. Covers "background iframe" and "light and dark modes".

## Intent

A fish tank behind the interface. Light appearance: sunlit lagoon, colourful fish, sun shafts. Dark appearance: deep sea, bioluminescent fish outlines, drifting jellyfish and plankton. Interface controls are frosted glass so the tank shows through without hurting legibility.

## Why a script

Fish that flee the pointer and bubbles that burst where the user presses cannot be done in CSS. No application DOM access is needed, so the effect lives in the sandboxed background frame (`iframe-background.js`), not `main.js`.

## How it works

- `manifest.json` declares `enableIframeBackgroundJS: true`.
- The wallpaper paints on `.app-main`, which is in front of the background frame. `theme.css` therefore sets `--app-wallpaper: transparent` — but only under `:root:has(#theme-iframe-background)`. Without the frame (script gate closed, loading) the CSS water gradient is the fallback.
- The script draws the water itself on a full-viewport canvas.
- Appearance: read once from the frame root's `data-theme` (see "Frame appearance and transparency" below).
- Pointer: accepts only `event.source === parent` and the five documented `television-theme-pointer-*` types. Move → fish within 150px steer away. Down → bubble burst + nearby fish startle. Cancel → stop fleeing.

## Resource cost

One 2D canvas, capped at 30fps and devicePixelRatio 1.5; 22 fish, ≤90 bubbles, 5 jellyfish, 70 plankton points. Skips frames while `document.hidden`. Under `prefers-reduced-motion: reduce` it draws a single still frame and redraws only on resize. `shadowBlur` (dark mode glow) is the most expensive part; reduce fish count first if it ever matters.

## Selector rules

- `:root:has(#theme-iframe-background)` — wallpaper fallback switch described above.
- `.sidebar { backdrop-filter }` with an 82%-opaque `--sidebar-background` lets water colour tint the sidebar.

## Files

`theme.css`, `manifest.json`, `iframe-background.js`. No assets.

## Maintenance

Every save in this folder destroys and recreates the frame, so fish positions reset — expected. Manifest changes need a registry refresh (`tv set-theme aquarium` does one).

## Frame appearance and transparency

Television generates the frame document. It stamps `data-theme="light"` or `"dark"` on the document's root, supplies full size, zero margin, hidden overflow and a transparent ground, and keeps the document's `color-scheme` matched to the frame element. That match is what keeps the frame transparent. Television recreates the frame and reruns the script when appearance changes.

So the scripts here read `data-theme` from the root once at startup when they need it, install no appearance listener, and do not style the root element at all. Never set `color-scheme` on the frame document's root: a mismatch with the frame element makes the frame opaque, and an opaque overlay frame hides the whole application.

History: 1.0.0 predated this contract and, in dark appearance, rendered the frame as a solid white sheet. 1.0.1 worked around it from inside the script. 1.0.2 removes the workaround and follows the contract above.

## Manifest colour scheme

`"colorScheme": "light dark"`: the theme adapts and follows the Light / Dark / System preference through its `[data-theme]` blocks. The theme sets no CSS `color-scheme`; the manifest is the only place the scheme is stated.

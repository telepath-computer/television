---
name: tv-sidebar-view
description: Create master–detail HTML artifacts for Television — a navigation sidebar of items that switches between views authored in the same artifact.
---

# Authoring a sidebar view

Know the main `television` skill first (re-read only if it's not in context or
changed) — it covers the Television workflow, artifact registration, and the
canonical HTML house style. This skill adds the master–detail vocabulary: a
sidebar of items, in groups, beside a detail pane of views. Pressing an item
shows its view.

Use it when one artifact holds several views the user will switch between —
a review surface over a dataset, a project browser, anything list-navigates-content.

## Load these

Every artifact is self-contained. Carry `sidebar.css` and `sidebar.js` from
this skill folder into the output (don't reference `/skills/tv-sidebar-view/…`
URLs).

For a directory artifact, copy both next to `index.html` and load them with
the canonical boilerplate:

```html
<link rel="stylesheet" href="/canonical/v2/styles.css?authoredForAppVersion=<version>" />
<script type="module" src="/canonical/v2/components.js"></script>
<link rel="stylesheet" href="./sidebar.css" />
<script type="module" src="./sidebar.js"></script>
```

For a running server, read the exact release `version` from `tv status`; when working in a Television checkout, read the exact version from the checkout root `package.json`. Copy that exact release version unchanged into `authoredForAppVersion`. A missing version or the `0.0.0` development sentinel does not identify a release, so omit the metadata.

For a single-file artifact, inline them into `<style>` and
`<script type="module">` tags instead. `sidebar.js` makes the sidebar work —
selection, view switching, and the draggable sidebar width, which everyone
viewing the artifact shares. It keeps the width at `tv-sidebar-view/width` in
the artifact's own JSON store, so keep any other data the artifact stores
there under other paths.

Leave the body at zero padding: the sidebar and views supply their own gutters.

## Markup

Author this shape — the sidebar and its views, keyed to each other by the
`item` identity:

```html
<div class="sidebar-view">
  <tv-sidebar>
    <tv-sidebar-group>
      <tv-sidebar-item item="all-tasks" selected><label>All tasks</label></tv-sidebar-item>
    </tv-sidebar-group>
    <tv-sidebar-group>
      <h2>Projects</h2>
      <tv-sidebar-item item="riso-zine"><label>Launch riso zine issue 3</label></tv-sidebar-item>
      <tv-sidebar-item item="studio-move"><label>Move studio to carriage works</label></tv-sidebar-item>
    </tv-sidebar-group>
  </tv-sidebar>
  <main class="detail">
    <tv-view item="all-tasks" shown>
      <!-- free-form content for this view -->
    </tv-view>
    <tv-view item="riso-zine">…</tv-view>
    <tv-view item="studio-move">…</tv-view>
  </main>
</div>
```

## Rules

- **Items always live in groups.** For ungrouped items, use a group with no
  `h2` — that is the idiom; never place an item directly in `tv-sidebar`.
- **Labels go in a `<label>`.** No icons in items or group titles for now.
- **Every item names a view.** The `item` attribute is the identity; each
  `tv-view` carries the same identity, and the one matching the selection is
  shown. One view per item, views only inside `.detail`.
- **Author the initial state**: exactly one item `selected`, and `shown` on
  its view.
- **Never attach your own click handlers** to sidebar parts — `sidebar.js`
  owns selection, view switching, and the resizable sidebar edge. Wire
  nothing.
- **View content is free-form.** Anything can go inside a `tv-view` —
  markup, task lists, even an `<iframe>`. Style your content; the skill
  styles the sidebar and the frame.

---
name: tv-table
description: Author dense Airtable-style HTML record tables using the shared Television house style.
---

# Authoring a record table

Know the main `television` skill first. Re-read it only if it is not already in your context or you know it changed. It defines the general Television workflow and the canonical HTML house style (`<link rel="stylesheet" href="/canonical/v2/styles.css?authoredForAppVersion=<version>" />`). This skill only adds table-specific guidance.

For a running server, read the exact release `version` from `tv status`; when working in a Television checkout, read the exact version from the checkout root `package.json`. Copy that exact release version unchanged into `authoredForAppVersion`. A missing version or the `0.0.0` development sentinel does not identify a release, so omit the metadata.

A dense, Airtable-style table of records. Lots of cells, mixed cell types,
structured rows. It should look crisp at a glance and read like real software,
not a styled spreadsheet.

## Required content

- `<h1>` heading with a short title naming the table
- one paragraph describing what the table contains and how many rows it has
- a `<table>` with:
  - a `<thead>` row of column labels
  - 8–15 `<tbody>` rows of data
  - 4–6 columns covering a mix of cell types
  - realistic-looking values, not placeholders

At minimum include:

- one **text** column
- one **status** column rendered as a pill
- one **date** column
- one **person** column
- one **numeric** or **tag** column

## Page layout

The artifact is a full-width table view, not a centered prose document.
Do not wrap the content in `<main>` or any other width-constraining container.

Use this page structure:

```html
<body>
  <header class="lead">
    <h1>...</h1>
    <p class="lede">...</p>
  </header>
  <table class="records">
    ...
  </table>
</body>
```

Use `--color-surface` for the page background and `--color-text` for its text.
Hairline borders using `--color-border` around the thead and between rows do the visual work.

## Styling guidance

Follow the base spacing-token rule: use only listed spacing tokens, and include
pixel fallbacks whenever you use them.

- `header.lead` padding: `var(--space-32, 32px) var(--space-32, 32px) var(--space-16, 16px)`
- `table.records`: `width: 100%; border-collapse: collapse;`
- use `font-variant-numeric: tabular-nums;`
- pad the first and last cells so the table aligns with the page gutter
- keep header text small, muted, and uppercase
- right-align numeric and date columns
- make the title cell slightly heavier than surrounding cells

## Borders

- thead gets a top and bottom hairline border
- tbody rows get muted bottom borders
- the last tbody row gets the stronger final border
- no vertical column rules

## Status pills

Status pills should be inline, rounded, and subtle. Use calm background accents rather than loud badges.

## Sections (optional)

A single ungrouped table is the default. Only break into sections when a categorical field is genuinely the main way the user scans the data and each section has enough rows to matter.

If you do use sections:

- render each group as its own `<table>` inside `<section class="group">`
- repeat the same `<colgroup>` and `<thead>` in every grouped table
- order active states before terminal states

## Non-goals

- no filtering, sorting, search, or selection UI
- no nested tables or expandable rows
- no sticky headers
- no decorative icon spam

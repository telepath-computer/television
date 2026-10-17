*UI spec: the Templates navbar popover, whose spec is piloted as Storybook stories and a stylesheet in `storybook/spec/templates-popover/`, with its MDX prose page beside this file.*

# Templates popover (UI)

The navbar's Templates control opens a popover for [artifact templates](../../../product/templates.md). Its UI spec is piloted in a new format: the stories and stylesheet in `storybook/spec/templates-popover/`, and the prose page [templates-popover.mdx](./templates-popover.mdx) beside this file, are the authority for its interaction, markup and styling. Each story is one state; the prose page states the behaviour stories cannot show. Production popover styles are derived from the pilot's `styles.css` by hand and checked against the stories by eye. No automated stylesheet-copy or conformance check applies to this pilot in this change. The existing `skill-selector.frame`, `content.yml` and `thumbnails/` in this folder belong to the retired skills popover and do not specify the Templates surface. ^artifact-template-ui-interaction

The [product spec](../../../product/templates.md#^artifact-template-popover) owns the feature promise and [template architecture](../../../arch/templates/index.md#^artifact-template-scan) owns the scan result.

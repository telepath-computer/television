*UI spec: the Templates navbar popover, specified by Storybook stories, an MDX page and a stylesheet in `storybook/spec/templates-popover/`.*

# Templates popover (UI)

The navbar's Templates control opens a popover for [artifact templates](../../../product/templates.md). The stories, prose page and stylesheet in `storybook/spec/templates-popover/` are the authority for its interaction, markup and styling. Each story is one state; the prose page states the behaviour stories cannot show. Production popover styles are derived from `storybook/spec/templates-popover/styles.css` by hand and checked against the stories by eye. No automated stylesheet-copy or conformance check applies to this surface. The existing `skill-selector.frame`, `content.yml` and `thumbnails/` in this folder belong to the retired skills popover and do not specify the Templates surface. ^artifact-template-ui-interaction

The [product spec](../../../product/templates.md#^artifact-template-popover) owns the feature promise and [template architecture](../../../arch/templates/index.md#^artifact-template-scan) owns the scan result.

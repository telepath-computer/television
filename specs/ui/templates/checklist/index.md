*UI spec: the bundled Checklist template page, whose interaction, markup, and styling are piloted in Storybook.*

# Checklist template (UI)

The [bundled Checklist template](../../../arch/templates/bundled-templates.md) creates an editable list. Its UI spec is piloted in Storybook: the stories and `styles.css` in `storybook/spec/templates/checklist/`, and the prose page [checklist.mdx](./checklist.mdx) beside this file, are the authority for the page's interaction, markup, and styling. Each story shows one state; the prose page states behaviour the stories cannot show. Production page styles are derived from the pilot's `styles.css` by hand and checked against the stories by eye. The pilot has no automated stylesheet-copy or conformance check. ^bundled-checklist-ui

The [store contract](../../../arch/templates/bundled-templates.md#^bundled-artifact-template-checklist-store) owns the data and write scope, and the [resource SDK](../../../arch/resources/sdk.md#^sdk-access) owns how the page learns its access level.

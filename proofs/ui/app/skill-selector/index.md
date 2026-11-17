*Routes proof coverage for the navbar artifact-template popover to Toolbox.*

# Toolbox routing — proof

Proves [specs/ui/app/skill-selector/index.md](../../../../specs/ui/app/skill-selector/index.md).

This routing spec orders no separate tests. [The Toolbox proof](../toolbox.md) carries appearance, interaction and accessibility under the [Toolbox spec](../../../../specs/ui/app/toolbox.mdx). The retained skill-selector files and dated templates-popover experiments specify no current Toolbox behavior. The old Skill Selector assertions for its thumbnail grid, description search, horizontal navigation and scan-on-every-open are retired; standing tests for those behaviors are not cited as evidence for Toolbox. The new Toolbox Left and Right rule is covered by [the state contract](../toolbox.md#^toolbox-t-search-state) and [real-browser input contract](../toolbox.md#^toolbox-t-browser-input).

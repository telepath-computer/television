*A narrow buffer for interactive Markdown tables: source preservation, intentional editing, link navigation, and rendering without source normalization.*

# Markdown tables — buffer

**Plain English:** viewing or navigating a table must not rewrite the Markdown file. Editing a cell keeps untouched content and formatting; explicit changes to the table structure can still reformat the table. Links work like other Markdown links, and rendering does not depend on first changing the source.

## Authority

This buffer owns only the interactive table contracts below in the bundled Markdown view. The remaining Markdown renderer/editor behavior stays code-authoritative under [the frame-core boundary](index.md#^frame-core-carve-out); editor colors remain owned by [the Markdown UI spec](../../ui/markdown-editor/index.md). Server-rendered read-only Markdown is outside this buffer. A future Markdown-editor spec absorbs these contracts and their proof relationships. ^mt-buffer-boundary

## Source preservation

Table loading, rendering, scrolling, cursor movement, selection, and cell navigation must leave the document source unchanged and emit no save. Navigation at a table edge must not create a row. Applying remote content or rolling back a rejected save must not cause the table editor to normalize that content or emit a replacement save. Undo and redo apply the user's editing history without an additional table-formatting edit. ^mt-source-preservation

## Intentional edits

A table-source write requires an intentional table edit. Ordinary cell-content edits replace only changed cell spans and preserve untouched source, including other cells, padding, separator formatting, overflow cells, and edge `<br>` content. Alignment edits may rewrite the table's separator. Table edits preserve surrounding text and the line breaks separating the table from that text. Cursor placement and editing must address the intended source cell even when rows are ragged or contain escaped pipes. ^mt-intentional-edits

Explicit structural edits, such as adding or deleting rows or columns, and full-table paste may serialize the table canonically. Preservation of the table's internal formatting, overflow cells, and edge `<br>` content is not promised for those operations. They still preserve surrounding text and table boundaries. ^mt-structural-limit

## Links

Table links use the same destination classification and navigation handlers as links outside tables. Link display and activation must not change the document source. Their display and editing gestures are owned by [the Markdown UI buffer](../../ui/markdown-editor/index.md#^md-table-interaction-buffer). ^mt-links

## Discovery

A table recognized by the Markdown parser must be eligible for rendering without first rewriting its source into canonical table formatting or requiring a caret move. Incremental parsing may briefly leave raw source visible while parsing catches up; this contract does not extend the parser's supported table syntax or nested-table support. ^mt-discovery

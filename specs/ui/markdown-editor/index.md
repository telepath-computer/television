*UI spec: the Markdown editor’s color treatment across rendered Markdown, source-reveal states, editing affordances, and interactive tables.*

# Markdown editor color (UI)

The Markdown editor presents source as readable document content while remaining directly editable. This spec keeps every visible part of that editor legible as the surrounding artifact changes between light, dark, and themed appearances.

## Authority and boundary

This spec owns the Markdown editor’s color styling. [styles.css](./styles.css) is the exact styling authority for foreground, fill, border, outline, and caret colors contributed by the editor and its currently installed CodeMirror extensions. It covers rendered and source-reveal Markdown, editor focus and cursor affordances, task checkboxes, and every ordinary, hover, active, selected, and editing state of the interactive table.

The editor’s markup, editing behavior, typography, spacing, layout, and effects outside that color boundary remain code-authoritative under the [frame-core carve-out](../../arch/artifact-frame/index.md#^frame-core-carve-out). The canonical foundation remains authoritative for the tokens, document background, inherited text color, native color scheme, and browser-native selection treatment that this stylesheet consumes.

Server-rendered read-only Markdown is a separate, code-authoritative surface outside this spec. It is neither a production copy nor a declaration-by-declaration mirror of this stylesheet; shared appearance intent does not create a stylesheet-sync contract. ^md-editor-color-scope

## Appearance

Editor styling follows the current foundation and theme roles rather than assuming a light page. Visible foregrounds, boundaries, state indicators, and surface fills use inherited color or a named foundation role. A translucent editor color derives from one of those values. Transparent layout borders carry no visible pigment.

Plain Markdown text and formats that alter only weight, emphasis, or decoration inherit the document text role. Source punctuation, list bullets, and quoted text use the muted role. Links use the link role; tags use the primary role; separators and structural boundaries use the border role; and code regions use the muted surface role. Focus, caret, task-control, and table states use the corresponding foundation roles stated in [styles.css](./styles.css).

The document’s foundation-owned `color-scheme` supplies browser-native selection and checkbox contrast. A dependency’s light-only foreground, fill, border, outline, or caret default may remain installed only where the current editor cannot render that state; this stylesheet overrides each such default reachable through the installed editor extensions. ^md-editor-color-states

## Production crossing

The stylesheet crosses byte-identically into the Markdown view package and is imported after the view’s implementation-owned layout sheet. The canonical foundation and active theme still load before both view sheets, so this surface consumes their resolved tokens without preventing a theme from setting those tokens. The stylesheet-copy and delivery mechanism is owned by [foundation architecture](../../arch/ui/foundation.md#distribution). ^md-editor-color-crossing

## Testing

The production copy and import route participate in the existing byte-identity and delivery checks. Their crossing registry and completeness scan include this standalone UI surface rather than limiting discovery to the foundation, app, and theme trees. Exact visual styling remains the stylesheet’s authority and is judged in implementation and visual review under the [TV-649 release exception](../../arch/ui/conformance.md#release-exception-for-tv-649); tests do not duplicate its declaration values.

/*
 * Styling for server-rendered read-only Markdown documents.
 *
 * This code-authoritative surface is separate from the editable CodeMirror
 * view. It links the canonical stylesheet and adds the document treatment the
 * server-rendered markup needs; it is not a copy of the editor color sheet.
 *
 * Authored as a `/* css *​/`-tagged template literal (not a real `.css` file)
 * so it bundles unchanged in dev and in the shipped binary; a `.css` asset
 * would not be reachable from the packaged server.
 */
export const MARKDOWN_DOC_CSS = /* css */ `
/*
 * The canonical stylesheet intentionally leaves page-level padding to each
 * artifact's own HTML. Server-rendered markdown has no authored wrapper, so
 * supply the editor's document padding here. The editor sets no
 * letter-spacing; the canonical body sets 0.015em — reset it to match.
 */
body {
  padding: 1.5rem 1rem;
  letter-spacing: normal;
}

/*
 * Headings: the editor renders heading bodies at the host line-height
 * (--leading-base), not the canonical 1.25. Markdown spacing is the normal
 * collapsed-blank-line rhythm; the canonical sheet already gives block
 * elements a top/bottom margin and an h*-adjacent-sibling top margin, so we
 * only add the heading's OWN top margin and zero the first child's so the doc
 * doesn't open with a gap.
 */
h1, h2, h3, h4, h5, h6 {
  line-height: var(--leading-base);
  margin-top: var(--space-16);
}

:is(h1, h2, h3, h4, h5, h6):first-child {
  margin-top: 0;
}

/* Links: muted grey + underline, matching the editor's rendered link ink. */
a {
  color: rgba(0, 0, 0, 0.55);
  text-decoration: underline;
}

/* Bold text: the editor uses 600, not the browser-default 700. */
strong, b {
  font-weight: 600;
}

/*
 * List markers — a two-column layout. The editor draws bullets / numbers as
 * muted-grey glyphs and a task checkbox. Rupert's spec: render every list as a
 * fixed-width MARKER column (a left gutter) plus a single TEXT column, where
 *   - bullets, ordered numbers AND task checkboxes all sit HORIZONTALLY CENTRED
 *     within the gutter, forming one clean aligned column regardless of glyph
 *     width (bullet vs 1. vs 10. vs a checkbox), and
 *   - ALL item text starts at the same x — across bullet, numbered and task
 *     lists, tight AND loose (blank-line-separated), incl. multi-digit numbers.
 *
 * Mechanism. Suppress native markers (list-style: none) and zero the engine's
 * list padding, then give each <li> a left padding of GUTTER (the marker
 * column width). The glyph markers are hand-drawn on li::before as an
 * inline-block of the FULL gutter width, pulled back into the gutter with an
 * equal negative left margin and centred (text-align: center). Because the
 * pseudo is the full column width, its glyph centres in the column no matter
 * how wide the glyph is; because it's inline it baseline-aligns with the first
 * text line for free (no vertical hack). The content always begins at the
 * padding edge — one shared x for every list type.
 *
 * Ordered numbers come from a CSS counter (counter-reset on the ol,
 * counter-increment per li) rather than native ::marker, so they obey the same
 * ::before centring. start=N is deliberately NOT honoured — a plain counter
 * renumbering from 1 is fine per spec; the simplicity is worth it.
 *
 * GUTTER is the --md-gutter custom property below; defined once and reused for
 * the li padding, the ::before column width and pull-back margin, and the
 * checkbox offset. 1.8em is wide enough for a checkbox plus its gap and a
 * two-digit number without overflow or collision.
 */
ul, ol {
  --md-gutter: 1.8em;
  padding-left: 0;
  list-style: none;
}

ol {
  counter-reset: md-ol;
}

li {
  position: relative;
  padding-left: var(--md-gutter);
}

li::before {
  content: "•";
  display: inline-block;
  width: var(--md-gutter);
  margin-left: calc(-1 * var(--md-gutter));
  text-align: center;
  color: var(--color-text-muted);
}

ol > li {
  counter-increment: md-ol;
}

ol > li::before {
  content: counter(md-ol) ".";
}

/*
 * Loose lists: marked wraps each item's body in a <p>. Rendering that leading
 * <p> inline keeps the item's first line of text on the marker's baseline row
 * (a block <p> establishes its own line box that the inline ::before marker
 * would otherwise sit above, on its own line). Inlining it makes loose items
 * lay out exactly like tight ones. Only the first paragraph is inlined; a
 * genuinely multi-paragraph item keeps its later <p>s as blocks.
 */
li > p:first-child {
  display: inline;
}

/*
 * Inline code only (:not(pre) > code). The canonical sheet styles all
 * <code>; the editor tones inline code to a lighter wash at 0.92em. Fenced
 * pre code is handled below.
 */
:not(pre) > code {
  background: rgba(0, 0, 0, 0.06);
  font-size: 0.92em;
  padding: 1px 4px;
  border-radius: 3px;
}

/*
 * Fenced code. The editor renders code blocks on a faint wash. Keep it a
 * normal box (the editor doesn't render a bordered block, but a plain padded
 * box reads cleanly for the static doc). Reset pre code font-size to inherit
 * so the 0.92em on <pre> doesn't compound with the canonical <code> 0.9em.
 */
pre {
  background: rgba(0, 0, 0, 0.04);
  font-size: 0.92em;
}

pre code {
  font-size: inherit;
}

/* Blockquote: editor's grey border + muted text, with its indent. */
blockquote {
  border-left: 3px solid var(--color-border);
  color: var(--color-text-muted);
  padding-left: 1rem;
  margin-left: 0.25rem;
}

/* Horizontal rule: a single hairline in the same grey as the rest of the ink. */
hr {
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.2);
}

/*
 * Task lists. marked 17 emits a disabled native checkbox with no class, so we
 * match on structure. The checkbox is the first child of the <li> when the list
 * is tight (<li><input>…) and the first child of the wrapping <p> when it's
 * loose (<li><p><input>…); the two :has() selectors cover both. Suppress the
 * hand-drawn ::before glyph on those items so only the checkbox shows in the
 * marker column.
 *
 * The checkbox is a REPLACED element, so the ::before inline-block trick (width
 * = full column, glyph centred) can't apply — sizing an <input> resizes the
 * box. Instead take it out of inline flow (position: absolute against the
 * relative <li>) and CENTRE it in the gutter geometrically: anchor its centre
 * at half the gutter width from the left (left: calc(var(--md-gutter) / 2)) and
 * at the vertical centre of the first text line (top: 0.5lh — half the actual
 * computed line box, so it tracks any line-height/theme change rather than
 * assuming the canonical 1.5), then pull it back onto those points with
 * translate(-50%, -50%). Out of flow, it never occupies the content box, so
 * task text still starts at the shared padding edge; its centre lands on the
 * same column as the bullet / number markers and on its own first text line.
 */
li:has(> input[type="checkbox"])::before,
li:has(> p > input[type="checkbox"])::before {
  content: none;
}

li input[type="checkbox"] {
  position: absolute;
  left: calc(var(--md-gutter) / 2);
  top: 0.5lh;
  transform: translate(-50%, -50%);
  margin: 0;
}
`;

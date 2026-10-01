import { syntaxTree } from "@codemirror/language";
import { classifyLinkTarget } from "@telepath-computer/television-artifact/link-target";
import {
  Annotation,
  ChangeSet,
  EditorState,
  Prec,
  Transaction,
  type ChangeSpec,
  type Extension,
  type Range,
} from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import {
  type Command,
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

// Render markdown source as actual markup.
//
// Three categories of decoration, all emitted by a single `ViewPlugin`:
//
//   1. Marker hiding (the disappearing-markers trick from iter 02 phase 1).
//      Markdown markers (`**`, `*`, `` ` ``, `[`, `]`, `(`, `)`, URL, `#`,
//      `> `, fence ``` `) are wrapped in a span with class `cm-md-hidden`
//      whose CSS shrinks the characters to ~0 width when the caret isn't
//      on or near them. Source bytes are unchanged.
//
//   2. Block-level visual rendering. List item lines, blockquote lines,
//      fenced-code lines each get a `Decoration.line` adding a class so
//      the editor's theme can style them as actual list items / quote
//      blocks / code blocks. Inline-code body text gets a styled mark.
//
//   3. Replace widgets. `HorizontalRule` and task-list `TaskMarker`
//      replace their source range with an interactive DOM widget — a
//      visual `<hr>` for horizontal rules, a real `<input
//      type="checkbox">` for task list checkboxes that toggles the
//      source `[ ]` ↔ `[x]` on click.
//
// CodeMark and EmphasisMark have dual contexts in the lezer-markdown
// grammar — a CodeMark inside an InlineCode is inline, inside a
// FencedCode is block; EmphasisMark is the same node name in both italic
// (parent Emphasis) and bold (parent StrongEmphasis), but always inline.
// The marker classifier resolves these by inspecting the parent node.
//
// Block markers `ListMark`, `TaskMarker`, and `HorizontalRule`
// intentionally do not appear in BLOCK_MARK_NODES — list bullets/numbers
// stay visible regardless of caret position; horizontal rules and task
// markers are replaced by widgets entirely.

// Class on revealed markers (caret on/near the marker's range). When
// the marker is hidden we use `Decoration.replace` and the chars are
// removed from rendered DOM entirely — no class, no span. The two
// states (`replace` when hidden, `mark` when revealed) are mutually
// exclusive: a marker is in exactly one of them per render.
const MARK_CLASS = "cm-md-mark";
const INLINE_CODE_CLASS = "cm-md-inline-code";
const LIST_ITEM_LINE_CLASS = "cm-md-list-item";
const LIST_BULLET_LINE_CLASS = "cm-md-list-bullet";
const BLOCKQUOTE_LINE_CLASS = "cm-md-blockquote-line";
const FENCED_LINE_CLASS = "cm-md-fenced-line";
const HR_CLASS = "cm-md-hr";
const TASK_CHECKBOX_CLASS = "cm-md-task-checkbox";
const HEADING_1_LINE_CLASS = "cm-md-heading-1";
const HEADING_2_LINE_CLASS = "cm-md-heading-2";
const LINK_CLASS = "cm-md-link";
const TAG_CLASS = "cm-md-tag";
const LIST_INDENT_SOURCE_CLASS = "cm-md-list-indent-source";
const BULLET_HANG_WIDTH = "1.2em";
const LIST_INDENT_COLUMN_WIDTH = "0.62em";

// Hidden state: chars vanish from rendered DOM via empty-widget replace.
// Non-atomic by default — the proximity gate swaps to `markerMark` before
// the caret needs to traverse the range.
const hiddenReplace = Decoration.replace({});
const markerMark = Decoration.mark({ class: MARK_CLASS });
const listIndentSourceMark = Decoration.mark({ class: LIST_INDENT_SOURCE_CLASS });
const inlineCodeMark = Decoration.mark({ class: INLINE_CODE_CLASS });
const listBulletLineDeco = Decoration.line({ class: LIST_BULLET_LINE_CLASS });
const blockquoteLineDeco = Decoration.line({ class: BLOCKQUOTE_LINE_CLASS });
const fencedLineDeco = Decoration.line({ class: FENCED_LINE_CLASS });
const heading1LineDeco = Decoration.line({ class: HEADING_1_LINE_CLASS });
const heading2LineDeco = Decoration.line({ class: HEADING_2_LINE_CLASS });
const tagMark = Decoration.mark({ class: TAG_CLASS });

class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement("hr");
    hr.className = HR_CLASS;
    return hr;
  }
  eq(_other: HrWidget): boolean {
    return true;
  }
  ignoreEvent(): boolean {
    return true;
  }
}
// HR replace is intentionally non-block. Block replace on a markdown
// horizontal rule line caused CM's view to silently truncate rendering
// of all subsequent lines — the renderer was unable to reconcile a
// block-level decoration whose range did not span exactly across line
// boundaries the way it expects. The widget's `<hr>` element styles to
// `display: block` via the theme, achieving the same visual effect
// without the fragility of block decorations.
const hrReplace = Decoration.replace({ widget: new HrWidget() });

class TaskCheckboxWidget extends WidgetType {
  readonly checked: boolean;
  readonly from: number;
  readonly to: number;

  constructor(checked: boolean, from: number, to: number) {
    super();
    this.checked = checked;
    this.from = from;
    this.to = to;
  }
  eq(other: TaskCheckboxWidget): boolean {
    return (
      other.checked === this.checked &&
      other.from === this.from &&
      other.to === this.to
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = TASK_CHECKBOX_CLASS;
    input.tabIndex = -1;
    input.addEventListener("mousedown", (event) => {
      // Prevent the editor stealing focus / moving the caret to the
      // widget's position when the checkbox is clicked.
      event.preventDefault();
    });
    input.addEventListener("change", () => {
      const insert = this.checked ? "[ ]" : "[x]";
      view.dispatch({
        changes: { from: this.from, to: this.to, insert },
      });
    });
    return input;
  }
  ignoreEvent(event: Event): boolean {
    // Let click / change through; ignore everything else (key events
    // shouldn't move caret onto the widget).
    return event.type !== "click" && event.type !== "change" && event.type !== "mousedown";
  }
}

const INLINE_MARK_NODES = new Set([
  "EmphasisMark",
  "LinkMark",
  "URL",
]);
const BLOCK_MARK_NODES = new Set([
  "HeaderMark",
  "QuoteMark",
]);
const TAG_CANDIDATE = /(^|\s)(#[\p{L}\p{N}_/-]+)/gu;
const TAG_TRAILING = /[/.,;:!?]+$/u;
const TAG_HAS_LETTER = /\p{L}/u;
const TAG_EXCLUDED_ANCESTORS = new Set(["InlineCode", "FencedCode", "URL", "Link"]);

type MarkerKind = "inline" | "block";
interface MarkerInfo {
  kind: MarkerKind;
  /** The range to test against the selection for reveal eligibility. */
  contextFrom: number;
  contextTo: number;
}

function classifyMarker(
  nodeName: string,
  parentName: string | null,
  parentFrom: number | null,
  parentTo: number | null,
  selfFrom: number,
  selfTo: number,
): MarkerInfo | null {
  if (BLOCK_MARK_NODES.has(nodeName)) {
    return { kind: "block", contextFrom: selfFrom, contextTo: selfTo };
  }
  if (nodeName === "CodeMark") {
    if (parentName === "InlineCode" && parentFrom !== null && parentTo !== null) {
      return { kind: "inline", contextFrom: parentFrom, contextTo: parentTo };
    }
    // CodeMark inside FencedCode is handled in a dedicated branch in
    // the iteration so it can use the *effective* fenced range
    // (including the closing ``` line) rather than per-line context.
    return null;
  }
  if (INLINE_MARK_NODES.has(nodeName)) {
    if (parentFrom === null || parentTo === null) {
      return null;
    }
    return { kind: "inline", contextFrom: parentFrom, contextTo: parentTo };
  }
  return null;
}

function selectionTouchesRange(
  selFrom: number,
  selTo: number,
  rangeFrom: number,
  rangeTo: number,
): boolean {
  return selFrom <= rangeTo && selTo >= rangeFrom;
}

function selectionTouchesLine(
  state: EditorState,
  selFrom: number,
  selTo: number,
  pos: number,
): boolean {
  const line = state.doc.lineAt(pos);
  return selectionTouchesRange(selFrom, selTo, line.from, line.to);
}

function shouldHide(
  state: EditorState,
  marker: MarkerInfo,
  selFrom: number,
  selTo: number,
): boolean {
  if (marker.kind === "inline") {
    return !selectionTouchesRange(
      selFrom,
      selTo,
      marker.contextFrom,
      marker.contextTo,
    );
  }
  return !selectionTouchesLine(state, selFrom, selTo, marker.contextFrom);
}

interface VisibleRange {
  from: number;
  to: number;
}

interface ListLineState {
  indentColumns: number;
  prefixRevealed: boolean;
}

/** Walk the children of a `ListItem` to detect a task-list `TaskMarker`. */
function itemIsTask(item: SyntaxNode): boolean {
  let cur = item.firstChild;
  while (cur) {
    if (cur.name === "TaskMarker") return true;
    if (cur.name === "Task") {
      let inner = cur.firstChild;
      while (inner) {
        if (inner.name === "TaskMarker") return true;
        inner = inner.nextSibling;
      }
    }
    cur = cur.nextSibling;
  }
  return false;
}

/** Find the enclosing `ListItem` ancestor of an arbitrary node. */
function findListItemAncestor(node: SyntaxNode): SyntaxNode | null {
  let cur: SyntaxNode | null = node.parent;
  while (cur) {
    if (cur.name === "ListItem") return cur;
    cur = cur.parent;
  }
  return null;
}

/** Find a direct-child node by name. */
function findChild(node: SyntaxNode, name: string): SyntaxNode | null {
  let cur = node.firstChild;
  while (cur) {
    if (cur.name === name) return cur;
    cur = cur.nextSibling;
  }
  return null;
}

/**
 * Compute the visible range of a `FencedCode` block. When the fence
 * is properly closed, this is the FencedCode's own span (open through
 * close `\`\`\``). When unclosed, lezer extends the FencedCode node to
 * end of doc, but visually we want only the line containing the
 * opening fence to read as code — so the range collapses to that one
 * line.
 */
function effectiveFencedRange(
  state: EditorState,
  fenced: SyntaxNode,
): { from: number; to: number; closed: boolean } {
  const codeMarks: SyntaxNode[] = [];
  let cur = fenced.firstChild;
  while (cur) {
    if (cur.name === "CodeMark") codeMarks.push(cur);
    cur = cur.nextSibling;
  }
  if (codeMarks.length >= 2) {
    return {
      from: fenced.from,
      to: codeMarks[codeMarks.length - 1].to,
      closed: true,
    };
  }
  // Unclosed fence — only the opening fence line counts as code.
  const openLine = state.doc.lineAt(fenced.from);
  return { from: openLine.from, to: openLine.to, closed: false };
}

/**
 * Range of a list-marker node (`-`, `*`, `1.`) extended through its
 * trailing space. Selection-touches checks against this range gate the
 * `•` ↔ `-` swap on caret proximity to the marker itself, so a caret
 * in the body of a list item leaves the bullet rendered.
 */
function markerRangeWithTrailingSpace(
  state: EditorState,
  listMark: SyntaxNode,
): { from: number; to: number } {
  let to = listMark.to;
  while (
    to < state.doc.length &&
    state.doc.sliceString(to, to + 1) === " "
  ) {
    to += 1;
  }
  return { from: listMark.from, to };
}

function markerLinePrefixRange(
  state: EditorState,
  listMark: SyntaxNode,
): { from: number; to: number } {
  const line = state.doc.lineAt(listMark.from);
  return {
    from: line.from,
    to: markerRangeWithTrailingSpace(state, listMark).to,
  };
}

function markerSourceRange(
  state: EditorState,
  listMark: SyntaxNode,
): { from: number; to: number } {
  return markerRangeWithTrailingSpace(state, listMark);
}

function taskPrefixRange(
  state: EditorState,
  listItem: SyntaxNode,
  taskMarker: SyntaxNode,
): { from: number; to: number } {
  const listMark = findChild(listItem, "ListMark");
  const markerFrom = listMark
    ? state.doc.lineAt(listMark.from).from
    : taskMarker.from;
  let markerTo = taskMarker.to;
  while (
    markerTo < state.doc.length &&
    state.doc.sliceString(markerTo, markerTo + 1) === " "
  ) {
    markerTo += 1;
  }
  return { from: markerFrom, to: markerTo };
}

function pushRevealedIndentRange(
  state: EditorState,
  listMark: SyntaxNode,
  ranges: Range<Decoration>[],
): void {
  const line = state.doc.lineAt(listMark.from);
  if (line.from < listMark.from) {
    ranges.push(listIndentSourceMark.range(line.from, listMark.from));
  }
}

function indentationColumns(
  state: EditorState,
  from: number,
  to: number,
): number {
  let columns = 0;
  for (let pos = from; pos < to; pos += 1) {
    columns += state.doc.sliceString(pos, pos + 1) === "\t" ? 2 : 1;
  }
  return columns;
}

function listItemLineDecoration(state: ListLineState): Decoration {
  return Decoration.line({
    class: LIST_ITEM_LINE_CLASS,
    attributes: {
      style: `--cm-md-list-indent: ${state.prefixRevealed ? 0 : state.indentColumns};`,
    },
  });
}

/**
 * Push a `Decoration.line` for every line whose start is within
 * `[from, to]`. Uses the doc's line API so multi-line ranges (e.g. a
 * Blockquote spanning two lines) emit one decoration per line.
 */
function pushLineRange(
  state: EditorState,
  from: number,
  to: number,
  deco: Decoration,
  ranges: Range<Decoration>[],
): void {
  let pos = from;
  while (pos <= to) {
    const line = state.doc.lineAt(pos);
    ranges.push(deco.range(line.from));
    if (line.to >= to) break;
    pos = line.to + 1;
  }
}

/**
 * Emit `cm-md-list-item` for the lines of a ListItem that should
 * carry the list indent — namely the line with the actual `ListMark`
 * plus any subsequent line whose source begins with whitespace
 * (a properly indented continuation). Lazy-continuation lines (no
 * leading whitespace inside the ListItem's range) are skipped, so
 * they un-indent visually even though they're still inside the AST
 * node. See spec.md#list-editing for the rationale.
 *
 * The recorded indent comes from the marker's source column. Ancestor
 * ListItems also see nested item lines as whitespace-starting lines, so
 * the map keeps the deepest/largest indent recorded for each rendered line.
 * Marker lines additionally record whether their source prefix is revealed;
 * in that state the literal source whitespace carries nesting by itself.
 */
function emitListItemLineRanges(
  state: EditorState,
  item: SyntaxNode,
  lineStates: Map<number, ListLineState>,
  prefixRevealed: boolean,
): void {
  const listMark = findChild(item, "ListMark");
  const markerLineStart = state.doc.lineAt(
    listMark ? listMark.from : item.from,
  ).from;
  const markerIndent = listMark
    ? indentationColumns(state, markerLineStart, listMark.from)
    : 0;
  let pos = item.from;
  while (pos <= item.to) {
    const line = state.doc.lineAt(pos);
    const isMarkerLine = line.from === markerLineStart;
    const startsWithWhitespace = /^\s/.test(line.text);
    if (isMarkerLine || startsWithWhitespace) {
      const existing = lineStates.get(line.from);
      const nextState = {
        indentColumns: markerIndent,
        prefixRevealed: isMarkerLine && prefixRevealed,
      };
      if (existing === undefined || markerIndent > existing.indentColumns) {
        lineStates.set(line.from, nextState);
      } else if (markerIndent === existing.indentColumns && nextState.prefixRevealed) {
        lineStates.set(line.from, { ...existing, prefixRevealed: true });
      }
    }
    if (line.to >= item.to) break;
    pos = line.to + 1;
  }
}

function hasTagExcludedAncestor(tree: Tree, from: number): boolean {
  let cur: SyntaxNode | null = tree.resolveInner(from, 1);
  while (cur) {
    if (TAG_EXCLUDED_ANCESTORS.has(cur.name) || cur.name.startsWith("Table")) return true;
    cur = cur.parent;
  }
  return false;
}

function isHeadingMarkerPosition(lineText: string, offset: number): boolean {
  const heading = /^( {0,3})(#{1,6})(?:\s|$)/.exec(lineText);
  if (!heading) return false;
  const markerIndent = heading[1] ?? "";
  const marker = heading[2] ?? "";
  const markerFrom = markerIndent.length;
  const markerTo = markerFrom + marker.length;
  return offset >= markerFrom && offset < markerTo;
}

function emitTagRanges(
  state: EditorState,
  tree: Tree,
  ranges: Range<Decoration>[],
): void {
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    TAG_CANDIDATE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG_CANDIDATE.exec(line.text)) !== null) {
      const boundary = match[1] ?? "";
      const rawTag = match[2] ?? "";
      const tag = rawTag.replace(TAG_TRAILING, "");
      if (tag.length <= 1 || !TAG_HAS_LETTER.test(tag)) continue;

      const from = line.from + match.index + boundary.length;
      const to = from + tag.length;
      if (isHeadingMarkerPosition(line.text, from - line.from)) continue;
      if (hasTagExcludedAncestor(tree, from)) continue;

      ranges.push(tagMark.range(from, to));
    }
  }
}

function computeDecorations(
  state: EditorState,
  _visibleRanges: readonly VisibleRange[],
  tree: Tree,
  focused: boolean,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const listLineStates = new Map<number, ListLineState>();
  const bulletLines = new Set<number>();
  const sel = state.selection.main;
  // When the editor isn't focused, treat the selection as "nowhere" so
  // every marker is hidden and the doc reads like rendered prose. The
  // sentinel range `[-1, -1]` doesn't intersect any positive position,
  // so all `selectionTouchesRange/Line` checks return false.
  const selFrom = focused ? Math.min(sel.from, sel.to) : -1;
  const selTo = focused ? Math.max(sel.from, sel.to) : -1;

  // Iterate the whole document. Using CM's `view.visibleRanges` here can
  // miss nodes whose lines aren't yet in the layout viewport — block
  // widgets (HR) and per-line block decorations (fenced code body)
  // emitted from such nodes wouldn't be rendered, which causes CM's own
  // viewport estimation to never grow to include them. For docs at the
  // size we expect (a single artifact note), iterating the full tree is
  // cheap; the visibleRanges optimisation can come back later if it
  // becomes a real bottleneck.
  {
    tree.iterate({
      from: 0,
      to: state.doc.length,
      enter: (node) => {
        if (node.name === "Table" || node.name.startsWith("Table")) {
          return false;
        }

        const parent = node.node.parent;
        const parentName = parent?.name ?? null;

        // 1. Marker hiding.
        let selfTo = node.to;
        if (
          (node.name === "HeaderMark" || node.name === "QuoteMark") &&
          state.doc.sliceString(selfTo, selfTo + 1) === " "
        ) {
          selfTo += 1;
        }
        const marker = classifyMarker(
          node.name,
          parentName,
          parent?.from ?? null,
          parent?.to ?? null,
          node.from,
          selfTo,
        );
        if (marker) {
          const deco = shouldHide(state, marker, selFrom, selTo)
            ? hiddenReplace
            : markerMark;
          ranges.push(deco.range(node.from, selfTo));
        }

        // 1b. ListMark handling.
        // - Task items: handled in the TaskMarker branch (leading `- `
        //   always hides because the checkbox is the affordance).
        // - Ordered lists: keep the `N.` text visible always.
        // - Unordered (bullet) non-task: hide the indentation + `- `
        //   prefix when the caret is NOT adjacent to / selecting the
        //   marker itself. A `cm-md-list-bullet` line decoration renders
        //   a `•` via CSS in its place. The `•` ↔ source-prefix swap is
        //   gated on caret proximity to the prefix, not the whole line —
        //   so a caret in the body text leaves the bullet rendered
        //   (Obsidian-like).
        if (node.name === "ListMark") {
          const item = node.node.parent;
          if (item && item.name === "ListItem") {
            const isTask = itemIsTask(item);
            const isOrdered = item.parent?.name === "OrderedList";
            if (!isTask && !isOrdered) {
              const prefixRange = markerLinePrefixRange(state, node.node);
              const sourceRange = markerSourceRange(state, node.node);
              if (selectionTouchesRange(selFrom, selTo, prefixRange.from, prefixRange.to)) {
                pushRevealedIndentRange(state, node.node, ranges);
                ranges.push(markerMark.range(sourceRange.from, sourceRange.to));
              } else {
                ranges.push(hiddenReplace.range(prefixRange.from, prefixRange.to));
              }
            } else if (isOrdered) {
              const line = state.doc.lineAt(node.node.from);
              const range = markerLinePrefixRange(state, node.node);
              if (line.from < node.node.from) {
                if (selectionTouchesRange(selFrom, selTo, range.from, range.to)) {
                  pushRevealedIndentRange(state, node.node, ranges);
                } else {
                  ranges.push(hiddenReplace.range(line.from, node.node.from));
                }
              }
              // Ordered list `N.` — always visible per spec, tinted
              // muted-grey and rendered in monospace so the digit and
              // dot read as markup ink.
              ranges.push(markerMark.range(node.node.from, node.node.to));
            }
          }
        }

        // 2. Inline code body styling. Lezer-markdown's InlineCode node
        //    contains CodeMark children for the backticks but no separate
        //    body node — the body is implicit text between the marks.
        //    Walk the children to find the range between first and last
        //    CodeMark.
        if (node.name === "InlineCode") {
          const first = node.node.firstChild;
          const last = node.node.lastChild;
          if (
            first &&
            last &&
            first !== last &&
            first.name === "CodeMark" &&
            last.name === "CodeMark" &&
            first.to < last.from
          ) {
            ranges.push(inlineCodeMark.range(first.to, last.from));
          }
        }

        // 3. Block-level line decorations.
        if (node.name === "ListItem") {
          const listMark = findChild(node.node, "ListMark");
          const task = findChild(node.node, "Task");
          const taskMarker = findChild(node.node, "TaskMarker") ??
            (task ? findChild(task, "TaskMarker") : null);
          const isTask = taskMarker !== null;
          const isOrdered = node.node.parent?.name === "OrderedList";
          let prefixRevealed = false;
          if (listMark) {
            const range = taskMarker
              ? taskPrefixRange(state, node.node, taskMarker)
              : markerLinePrefixRange(state, listMark);
            prefixRevealed = selectionTouchesRange(selFrom, selTo, range.from, range.to);
          }
          emitListItemLineRanges(state, node.node, listLineStates, prefixRevealed);
          // Unordered, non-task items get a `•` bullet rendered via
          // CSS — gated on the same caret-proximity-to-marker condition
          // as the ListMark hide above, so source indentation/`- ` and
          // visual `•` never overlap. Padding-left on `cm-md-list-item`
          // carries the source nesting column only while the source
          // prefix is hidden, so revealed source whitespace and rendered
          // nesting do not stack.
          if (!isTask && !isOrdered && listMark && !prefixRevealed) {
            const firstLine = state.doc.lineAt(node.from);
            bulletLines.add(firstLine.from);
          }
        } else if (node.name === "Blockquote") {
          // Per-line emit of the border + padding decoration. With the
          // hide implemented as `Decoration.replace`, the source `> ` is
          // gone from layout when caret is off and present at full width
          // when on; padding-left alone keeps wrap continuation aligned
          // with the marker column in either state. No separate source
          // class needed.
          pushLineRange(state, node.from, node.to, blockquoteLineDeco, ranges);
        } else if (node.name === "ATXHeading1") {
          // Line-level decoration so the size lives on `.cm-line`, not
          // on a tag-styled inline span. The `# ` mark stays inside
          // `.cm-md-hidden` at 1px and renders zero-width regardless
          // of the heading's body size.
          const line = state.doc.lineAt(node.from);
          ranges.push(heading1LineDeco.range(line.from));
        } else if (node.name === "ATXHeading2") {
          const line = state.doc.lineAt(node.from);
          ranges.push(heading2LineDeco.range(line.from));
        } else if (node.name === "FencedCode") {
          // Use the *effective* range so an unclosed fence (where lezer
          // extends FencedCode to end of doc) only styles the opening
          // fence line, not every subsequent line.
          const range = effectiveFencedRange(state, node.node);
          pushLineRange(state, range.from, range.to, fencedLineDeco, ranges);
        }

        // Link label → real `<a>`. Find the first/last LinkMark
        // children (the `[` and `]`) and the URL child for the href;
        // emit a `Decoration.mark` with `tagName: "a"` over the label
        // range. The `cm-md-link` class is themed to underline + muted
        // grey. The mousedown/click handlers in `linkActivation`
        // route plain, edit-modified, and external-open clicks.
        if (node.name === "Link") {
          let openMark: SyntaxNode | null = null;
          let closeMark: SyntaxNode | null = null;
          let urlNode: SyntaxNode | null = null;
          let cur = node.node.firstChild;
          while (cur) {
            if (cur.name === "LinkMark") {
              if (openMark === null) openMark = cur;
              else closeMark = cur;
            } else if (cur.name === "URL") {
              urlNode = cur;
            }
            cur = cur.nextSibling;
          }
          if (openMark && closeMark && urlNode && openMark.to < closeMark.from) {
            const href = state.doc.sliceString(urlNode.from, urlNode.to);
            // Use `data-href` rather than a real `href` attribute. A
            // real `<a href>` triggers the browser's default
            // navigation on click — even inside a contenteditable
            // CodeMirror view, even with `event.preventDefault()` in
            // a click handler, it's racy enough that some Chromium
            // builds will follow the link before our handler runs.
            // Storing the URL in a data attribute removes the
            // navigation surface entirely; cmd/ctrl-click is handled
            // explicitly in `linkActivation` via `data-href`.
            const linkMark = Decoration.mark({
              class: LINK_CLASS,
              tagName: "a",
              attributes: { "data-href": href },
            });
            ranges.push(linkMark.range(openMark.to, closeMark.from));
          }
        }

        // CodeMark inside a FencedCode: hide unless the caret is
        // anywhere within the effective fenced range. Whole-block
        // proximity (not per-line) — caret on a body line of the
        // fence reveals BOTH the opening and closing ``` markers.
        // Exception: an unclosed fence has only the lone opening
        // ``` as visible content; hiding it would leave the line
        // looking empty, so always keep it visible.
        if (node.name === "CodeMark" && parentName === "FencedCode") {
          const fenced = node.node.parent;
          if (fenced) {
            const range = effectiveFencedRange(state, fenced);
            if (range.closed) {
              const deco = selectionTouchesRange(
                selFrom,
                selTo,
                range.from,
                range.to,
              )
                ? markerMark
                : hiddenReplace;
              ranges.push(deco.range(node.from, node.to));
            } else {
              // Unclosed fence: keep the lone opening ``` source visible
              // so the line isn't blank — emit `markerMark` rather than
              // hide.
              ranges.push(markerMark.range(node.from, node.to));
            }
          }
        }

        // 4. Replace widgets — both with caret-on-line / on-marker
        // revert so the source text becomes editable when the caret is
        // adjacent.
        if (node.name === "HorizontalRule") {
          // HorizontalRule is added as a leaf node in lezer-markdown
          // with a zero-length range. Replace the entire line content
          // (the `---` characters) with the HR widget. The widget
          // itself styles to `display: block` via the theme.
          const line = state.doc.lineAt(node.from);
          if (
            line.to > line.from &&
            !selectionTouchesRange(selFrom, selTo, line.from, line.to)
          ) {
            ranges.push(hrReplace.range(line.from, line.to));
          }
        }
        if (node.name === "TaskMarker") {
          // A task line is in exactly one of two visual states:
          //   1. Raw mode (full source `- [ ] body`) — when the caret
          //      is adjacent to / inside the `- [ ] ` prefix range.
          //   2. Checkbox mode — leading `- ` hidden AND `[ ]` replaced
          //      by a checkbox widget. Body text follows directly.
          // Both decisions (hide `- `, replace `[ ]`) share the same
          // condition so we never get an intermediate state with `-`
          // visible but `[ ]` hidden, or vice versa.
          const listItem = findListItemAncestor(node.node);
          const listMark = listItem ? findChild(listItem, "ListMark") : null;
          // The combined marker range covers from the start of line
          // indentation through the trailing space after `]`.
          const markerRange = listItem
            ? taskPrefixRange(state, listItem, node.node)
            : { from: node.from, to: node.to };
          const inRawMode = selectionTouchesRange(
            selFrom,
            selTo,
            markerRange.from,
            markerRange.to,
          );

          if (!inRawMode) {
            // Hide indentation + leading `- ` (with trailing space) —
            // replaced out of the rendered DOM entirely.
            if (listMark) {
              const sourceRange = markerSourceRange(state, listMark);
              const listMarkFrom = state.doc.lineAt(listMark.from).from;
              ranges.push(hiddenReplace.range(listMarkFrom, sourceRange.to));
            }
            // Replace `[ ]` / `[x]` with the checkbox widget.
            const text = state.doc.sliceString(node.from, node.to);
            const checked = text === "[x]" || text === "[X]";
            const widget = Decoration.replace({
              widget: new TaskCheckboxWidget(checked, node.from, node.to),
            });
            ranges.push(widget.range(node.from, node.to));
          } else {
            // Raw mode: indentation, leading `- ` and `[ ]` are visible
            // source. The visible indentation uses the mono source-indent
            // width; only the marker glyphs get muted-grey `cm-md-mark`
            // styling.
            if (listMark) {
              const sourceRange = markerSourceRange(state, listMark);
              pushRevealedIndentRange(state, listMark, ranges);
              ranges.push(markerMark.range(sourceRange.from, sourceRange.to));
            }
            ranges.push(markerMark.range(node.from, node.to));
          }
        }
      },
    });
  }

  for (const [lineFrom, lineState] of listLineStates) {
    ranges.push(listItemLineDecoration(lineState).range(lineFrom));
  }
  for (const lineFrom of bulletLines) {
    ranges.push(listBulletLineDeco.range(lineFrom));
  }

  emitTagRanges(state, tree, ranges);

  return Decoration.set(ranges, true);
}

const renderingPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = computeDecorations(
        view.state,
        view.visibleRanges,
        syntaxTree(view.state),
        view.hasFocus,
      );
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = computeDecorations(
          update.state,
          update.view.visibleRanges,
          syntaxTree(update.state),
          update.view.hasFocus,
        );
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

const renderingTheme = EditorView.theme({
  // Inherit the view stylesheet's typography — it sets `--font-sans`,
  // and `--text-base` on the document. CodeMirror's
  // baseTheme pins `font-family: monospace` on
  // `.cm-scroller`, so we have to override `.cm-scroller` directly —
  // setting font on `.cm-editor` alone doesn't reach the content.
  "&": {
    fontFamily: "var(--font-sans)",
    // Base text bumped +0.5px relative to the host `--text-base` so prose
    // reads a hair larger inside the markdown surface; mono markers and
    // headings, sized in `em` off this base, scale with it.
    fontSize: "calc(var(--text-base) + 0.5px)",
    lineHeight: "1.5",
  },
  ".cm-scroller": {
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
  },
  ".cm-content": {
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
    // Document-level padding so content doesn't sit flush against the
    // editor edges. Padded on all sides; lines render inside this box.
    padding: "1.5rem 1rem",
  },
  // Visible source indentation before list markers. The spaces have no ink;
  // the monospace font gives source mode the same substantial per-column
  // width as rendered nested list indentation.
  [`.${LIST_INDENT_SOURCE_CLASS}`]: {
    fontFamily: "var(--font-mono)",
  },
  // Visible markup characters when the caret is on/near them — `#`,
  // `>`, `**`, `*`, `` ` ``, `[`, `]`, `(`, `)`, URL, ` ``` `, `- `,
  // `1.`, task `[ ]`. Uses the theme's muted text color and renders in
  // monospace so multi-glyph markers like `[ ]` line up correctly with
  // column expectation (the bracketed space stays visually balanced).
  [`.${MARK_CLASS}`]: {
    fontFamily: "var(--font-mono)",
    // Mono fonts visually read larger than proportional sans at the
    // same point size — pull down a hair so the marker glyphs sit
    // optically inside the body text's x-height.
    fontSize: "0.9em",
  },
  [`.${HEADING_1_LINE_CLASS}`]: {
    fontSize: "1.3em",
  },
  [`.${HEADING_2_LINE_CLASS}`]: {
    fontSize: "1.1em",
  },
  [`.${INLINE_CODE_CLASS}`]: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.92em",
    padding: "1px 4px",
    borderRadius: "3px",
  },
  [`.${TAG_CLASS}`]: {
    borderRadius: "var(--radius-pill)",
    padding: "0 0.35em",
    fontWeight: "600",
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
  },
  // List-item lines get a left padding so the body has room. Nested
  // list-item source columns add to that padding through the per-line
  // unitless `--cm-md-list-indent` variable. The multiplier approximates
  // one monospace source column, so each two-space nesting level is
  // clearly visible while still landing near the source dash column.
  // When a line's source
  // prefix is revealed, the variable is set to 0 and the literal source
  // whitespace carries the nesting by itself. Rendered unordered bullets
  // add a transparent border-left to push wrapped rows to the body column;
  // the bullet itself is pulled back with a negative margin on
  // `::before`. Do not use negative `text-indent` — it breaks caret
  // hit-testing in wrapped CodeMirror lines.
  [`.${LIST_ITEM_LINE_CLASS}`]: {
    paddingLeft: `calc(0.5rem + var(--cm-md-list-indent, 0) * ${LIST_INDENT_COLUMN_WIDTH})`,
  },
  [`.${LIST_ITEM_LINE_CLASS}.${LIST_BULLET_LINE_CLASS}`]: {
    borderLeft: `${BULLET_HANG_WIDTH} solid transparent`,
  },
  // Gap between the CSS-rendered bullet and the body text. Visible
  // source markers (`- `, `1.`, `[ ]`) keep their literal source spacing.
  [`.${LIST_BULLET_LINE_CLASS}::before`]: {
    content: "'•'",
    marginLeft: `calc(-1 * ${BULLET_HANG_WIDTH})`,
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    paddingRight: "0.5rem",
  },
  [`.${BLOCKQUOTE_LINE_CLASS}`]: {
    borderLeft: "3px solid transparent",
    paddingLeft: "1rem",
    marginLeft: "0.25rem",
  },
  [`.${FENCED_LINE_CLASS}`]: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.92em",
    paddingLeft: "0.75em",
  },
  [`.${HR_CLASS}`]: {
    // No margin — the .cm-line wrapping the widget has its own
    // line-height (same as the `---` source line). Adding margin
    // would make the widget-mode line taller than source-mode and
    // cause a vertical jump when the caret swaps between them.
    // The 1px border draws inside that natural line height.
    display: "inline-block",
    verticalAlign: "middle",
    border: "none",
    borderTop: "1px solid transparent",
    margin: 0,
    width: "100%",
  },
  [`.${TASK_CHECKBOX_CLASS}`]: {
    margin: "0 0.4em 0 0",
    cursor: "default",
    verticalAlign: "middle",
  },
  // Link labels rendered through `Decoration.mark({ tagName: "a" })`.
  // The authoritative color sheet supplies the current link role.
  // Links are clickable by default now: plain click navigates inside
  // Television, Alt/Option-click edits, and Cmd/Ctrl-click opens
  // externally.
  [`a.${LINK_CLASS}`]: {
    textDecoration: "underline",
    textUnderlineOffset: "0.15em",
    cursor: "pointer",
  },
});

const LINK_DRAG_THRESHOLD_PX = 4;

interface PendingLinkClick {
  anchor: HTMLElement;
  url: string;
  openExternally: boolean;
  x: number;
  y: number;
}

function findAnchor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`a.${LINK_CLASS}`) as HTMLElement | null;
}

function resolvedLinkURL(anchor: HTMLElement): string | null {
  const href = anchor.getAttribute("data-href");
  if (href === null) return null;
  try {
    return new URL(href, window.document.baseURI).href;
  } catch {
    return null;
  }
}

interface TelevisionContentBridge {
  postToHost(message: unknown): void;
  openApplicationLink?(url: string): boolean;
}

function contentBridge(): TelevisionContentBridge | undefined {
  return (window as Window & {
    __televisionContentBridge?: TelevisionContentBridge;
  }).__televisionContentBridge;
}

function postNavigationRequest(url: string): void {
  const message = { type: "navigation-request", url };
  const bridge = contentBridge();
  if (bridge) {
    bridge.postToHost(message);
    return;
  }
  window.parent.postMessage(message, "*");
}

function openApplicationLink(url: string): void {
  const bridge = contentBridge();
  if (bridge?.openApplicationLink) {
    // A rejected privileged handoff stays inert. Falling back to browser
    // navigation here would bypass Electron's activation policy.
    bridge.openApplicationLink(url);
    return;
  }
  // Application handoff has no browser document to place in a new tab.
  // Navigate this context just as a native <a href="custom-scheme:"> does;
  // Chromium leaves the document in place after invoking the handler.
  window.location.href = url;
}

function isDragFromPendingClick(
  pending: PendingLinkClick,
  event: MouseEvent,
): boolean {
  return Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >
    LINK_DRAG_THRESHOLD_PX;
}

let pendingLinkClick: PendingLinkClick | null = null;

function activatePendingLink(event: MouseEvent): boolean {
  const anchor = findAnchor(event.target);
  if (!anchor) {
    pendingLinkClick = null;
    return false;
  }
  if (event.altKey) {
    pendingLinkClick = null;
    return false;
  }

  const pending = pendingLinkClick;
  pendingLinkClick = null;
  if (!pending || pending.anchor !== anchor) return false;

  event.preventDefault();
  if (isDragFromPendingClick(pending, event)) return true;

  const target = classifyLinkTarget(pending.url, window.document.baseURI);
  if (target.kind === "application") {
    openApplicationLink(target.url);
  } else if (target.kind === "web" && pending.openExternally) {
    window.open(target.url, "_blank", "noopener,noreferrer");
  } else if (target.kind === "web") {
    postNavigationRequest(target.url);
  }
  return true;
}

const linkActivation = EditorView.domEventHandlers({
  mousedown(event) {
    const anchor = findAnchor(event.target);
    pendingLinkClick = null;
    if (!anchor) return false;
    if ((event.button !== 0 && event.button !== 1) || event.altKey) return false;

    const url = resolvedLinkURL(anchor);
    if (url === null) return false;
    if (
      event.button === 1 &&
      classifyLinkTarget(url, window.document.baseURI).kind !== "application"
    ) {
      return false;
    }

    pendingLinkClick = {
      anchor,
      url,
      openExternally: event.metaKey || event.ctrlKey,
      x: event.clientX,
      y: event.clientY,
    };
    event.preventDefault();
    return true;
  },
  click(event) {
    if (event.button !== 0) return false;
    return activatePendingLink(event);
  },
  auxclick(event) {
    if (event.button !== 1) return false;
    return activatePendingLink(event);
  },
});

// Renumber every contiguous run of ordered-list lines so they count
// `1, 2, 3, …`. Out-of-sequence numbers appear after the user deletes
// an item or types a non-1 starter; the follow-up transaction below
// snaps them back into sequence.
//
// The pass is regex-based over the doc lines rather than tree-based
// because the lezer parser runs as an idle task — reading
// `syntaxTree(state)` synchronously inside an updateListener can
// return a stale tree (positions remapped, structure unchanged).
//
// Run boundaries:
//   - An item starter (`^\d+[.)]\s`) opens a run if no run is active.
//   - A blank line ends the run.
//   - A non-item, non-blank line continues the run (lazy continuation
//     of the previous item — matches lezer's CommonMark interpretation
//     and gives the right answer for `1. one\ntwo\n3. three` being
//     a single 2-item list rather than two 1-item lists).
const ITEM_STARTER = /^(\d+)([.)])(\s|$)/;
function computeOrderedListRenumberChanges(state: EditorState): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  let inRun = false;
  let expected = 1;
  for (let i = 1; i <= state.doc.lines; i += 1) {
    const line = state.doc.line(i);
    const match = ITEM_STARTER.exec(line.text);
    if (match) {
      if (!inRun) {
        inRun = true;
        expected = 1;
      }
      const current = parseInt(match[1], 10);
      if (current !== expected) {
        changes.push({
          from: line.from,
          to: line.from + match[1].length,
          insert: String(expected),
        });
      }
      expected += 1;
    } else if (line.text === "") {
      inRun = false;
    }
    // Non-blank, non-starter line: continuation, no boundary change.
  }
  return changes;
}

// Marker annotation: lets the filter short-circuit on transactions
// it has already extended.
const renumberAnnotation = Annotation.define<boolean>();

// `EditorState.transactionFilter` so the renumber rides inside the
// user's transaction. CM6's history merges adjacent transactions only
// when their changes are *position-adjacent* — and the renumber
// touches the third item's marker, far from the caret on the second
// item. Two separate transactions would land as two undo steps; one
// combined transaction is a single undo step.
const renumberOrderedLists = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(renumberAnnotation)) return tr;
  // Skip undo/redo: re-running the renumber on an undo cancels the
  // user's undo by re-applying our changes.
  const userEvent = tr.annotation(Transaction.userEvent);
  if (userEvent === "undo" || userEvent === "redo") return tr;

  const renumberChanges = computeOrderedListRenumberChanges(tr.state);
  if (renumberChanges.length === 0) return tr;

  // Bundle the user's changes with the renumber as one atomic
  // transaction. The renumberChanges positions are in tr.state.doc
  // (post-tr.changes); compose them onto tr.changes so the resulting
  // ChangeSet maps oldDoc → renumbered-doc in one step.
  const renumberSet = ChangeSet.of(renumberChanges, tr.state.doc.length);
  const composed = tr.changes.compose(renumberSet);
  return tr.startState.update({
    changes: composed,
    selection: tr.selection,
    scrollIntoView: tr.scrollIntoView,
    effects: tr.effects,
    annotations: [
      renumberAnnotation.of(true),
      ...(userEvent ? [Transaction.userEvent.of(userEvent)] : []),
    ],
    filter: false,
  });
});

// Backspace at body-start of any list item deletes just the trailing
// whitespace (1 char) instead of the whole marker prefix. Combined with
// the renumber filter, this gives a uniform "delete the space, line
// dedents, list-as-a-whole survives" rule for ordered, unordered, and
// task lists. Bound at `Prec.highest` so it beats `markdownKeymap`'s
// `deleteMarkupBackward` (which strips the entire marker).
//
// Body-start detection: regex match on the line text from line.from
// up to the caret. Pattern is a list-marker prefix (indent + bullet
// or number, optional task marker, trailing space).
const LIST_MARKER_PREFIX = /^(\s*)([-*]|\d+[.)])(\s\[[ xX]\])?\s$/;

const listBackspace: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  if (sel.from !== sel.to) return false;
  const line = state.doc.lineAt(sel.from);
  const before = line.text.slice(0, sel.from - line.from);
  if (!LIST_MARKER_PREFIX.test(before)) return false;
  view.dispatch({
    changes: { from: sel.from - 1, to: sel.from, insert: "" },
    selection: { anchor: sel.from - 1 },
    userEvent: "delete.backward",
    scrollIntoView: true,
  });
  return true;
};

const listBackspaceKeymap = Prec.highest(
  keymap.of([{ key: "Backspace", run: listBackspace }]),
);

export const disappearingMarkers: Extension = [
  renderingPlugin,
  renderingTheme,
  renumberOrderedLists,
  listBackspaceKeymap,
  linkActivation,
];

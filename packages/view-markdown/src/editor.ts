import type { ArtifactContextLike } from "@telepath-computer/television-artifact/browser";
import { Annotation, Compartment, EditorSelection, EditorState, Prec, Transaction, type Extension, type StateCommand } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { insertNewlineContinueMarkupCommand, markdown } from "@codemirror/lang-markdown";
import { Table, TaskList } from "@lezer/markdown";
import { tags } from "@lezer/highlight";
import { markdownTables, TableStyle, TableTheme } from "./vendor/markdown-tables/index.js";
import { disappearingMarkers } from "./markers.ts";
import { tableLinks } from "./table-links.ts";

const DEFAULT_DEBOUNCE_MS = 500;

// Annotation tagged on transactions applied from remote `content-updated`
// notifications so the save listener can skip them — otherwise an incoming
// remote edit would round-trip back as a save.
const Remote = Annotation.define<true>();

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "600" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
]);

function toggleWrap(delimiter: string): StateCommand {
  const delimiterLength = delimiter.length;
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      if (range.empty) {
        return {
          changes: { from: range.from, insert: delimiter + delimiter },
          range: EditorSelection.cursor(range.from + delimiterLength),
        };
      }

      const selectedText = state.sliceDoc(range.from, range.to);
      if (
        selectedText.length >= delimiterLength * 2 &&
        selectedText.startsWith(delimiter) &&
        selectedText.endsWith(delimiter)
      ) {
        return {
          changes: [
            { from: range.from, to: range.from + delimiterLength },
            { from: range.to - delimiterLength, to: range.to },
          ],
          range: EditorSelection.range(range.from, range.to - delimiterLength * 2),
        };
      }

      const hasLeadingDelimiter =
        range.from >= delimiterLength &&
        state.sliceDoc(range.from - delimiterLength, range.from) === delimiter;
      const hasTrailingDelimiter =
        range.to + delimiterLength <= state.doc.length &&
        state.sliceDoc(range.to, range.to + delimiterLength) === delimiter;
      if (hasLeadingDelimiter && hasTrailingDelimiter) {
        return {
          changes: [
            { from: range.from - delimiterLength, to: range.from },
            { from: range.to, to: range.to + delimiterLength },
          ],
          range: EditorSelection.range(range.from - delimiterLength, range.to - delimiterLength),
        };
      }

      return {
        changes: [
          { from: range.from, insert: delimiter },
          { from: range.to, insert: delimiter },
        ],
        range: EditorSelection.range(range.from + delimiterLength, range.to + delimiterLength),
      };
    });

    dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

const markdownEditingKeymap = Prec.highest(
  keymap.of([
    { key: "Mod-b", run: toggleWrap("**") },
    { key: "Mod-i", run: toggleWrap("*") },
    { key: "Enter", run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
  ]),
);

const televisionTableStyle = TableStyle.default.with({
  "--tbl-style-font-family": "var(--font-sans)",
  "--tbl-style-font-size": "inherit",
  "--tbl-style-menu-font-family": "var(--font-sans)",
  "--tbl-style-menu-font-size": "var(--text-sm, 0.875rem)",
  "--tbl-style-default-header-alignment": "left",
});

const markdownTablesExtension = markdownTables({
  theme: TableTheme.light,
  style: televisionTableStyle,
  selectionType: "native",
  handlePosition: "outside",
  lineWrapping: "wrap",
  extensions: [keymap.of(defaultKeymap)],
  globalKeyBindings: [...historyKeymap],
});

/**
 * Shared editor extensions — the markdown grammar, our custom highlight,
 * line wrapping, history, default keymap, and the disappearing-markers
 * decoration plugin. Used by both the production ctx-wired path
 * (`installEditor`) and the dev-mode standalone bootstrap in `main.ts`.
 */
export const editorExtensions: Extension = [
  history(),
  indentUnit.of("  "),
  markdownEditingKeymap,
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
  markdown({ extensions: [TaskList, Table, { remove: ["SetextHeading"] }] }),
  syntaxHighlighting(markdownHighlight),
  EditorView.lineWrapping,
  disappearingMarkers,
  markdownTablesExtension,
  tableLinks,
];

export interface EditorHooks {
  parent: HTMLElement;
  ctx: ArtifactContextLike;
  debounceMs?: number;
  editable?: boolean;
  onSaveError?: (error: unknown) => void;
}

export interface Editor {
  view: EditorView;
  setEditable(editable: boolean): void;
  dispose(): void;
}

/**
 * Bidirectional wiring between an `EditorView` and an `ArtifactContext`:
 *
 * - **Outgoing.** `docChanged` updates from local edits are debounced; on
 *   flush we send the current doc text via `ctx.updateContent`.
 * - **Incoming.** A notification matching a save still in flight is its echo
 *   and is suppressed, so the caret stays put. Any other notification wins
 *   over an unsent local debounce and replaces the doc as a `Remote`-
 *   annotated transaction that's excluded from history and skipped by the
 *   save listener.
 * - **Error.** A rejected `updateContent` rolls the doc back to the last
 *   known-good (initial content or last successful save).
 *
 * The first `content-updated` after mount seeds both the doc and the
 * last-known-good baseline.
 */
export function installEditor(hooks: EditorHooks): Editor {
  const { parent, ctx } = hooks;
  const debounceMs = hooks.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let lastKnownGood: string | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let isEditable = hooks.editable ?? true;
  let incomingRevision = 0;
  const activeSaves = new Set<{ content: string; incomingRevision: number }>();
  const editable = new Compartment();

  const replaceDoc = (next: string): void => {
    if (view.state.doc.toString() === next) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      annotations: [Remote.of(true), Transaction.addToHistory.of(false)],
    });
  };

  const flushSave = async (): Promise<void> => {
    saveTimer = null;
    const content = view.state.doc.toString();
    const save = { content, incomingRevision };
    activeSaves.add(save);
    try {
      await ctx.updateContent(content);
      if (incomingRevision === save.incomingRevision) lastKnownGood = content;
    } catch (error) {
      if (incomingRevision === save.incomingRevision) replaceDoc(lastKnownGood ?? "");
      hooks.onSaveError?.(error);
    } finally {
      activeSaves.delete(save);
    }
  };

  const readOnlyGuard = EditorState.transactionFilter.of((transaction) => {
    if (isEditable || !transaction.docChanged || transaction.annotation(Remote)) return transaction;
    return [];
  });

  const saveListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const isRemote = update.transactions.some((tr) => tr.annotation(Remote));
    if (isRemote) return;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flushSave();
    }, debounceMs);
  });

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "",
      extensions: [
        editorExtensions,
        editable.of([
          EditorState.readOnly.of(!isEditable),
          EditorView.editable.of(isEditable),
        ]),
        readOnlyGuard,
        saveListener,
      ],
    }),
  });

  const syncEmbeddedControls = (): void => {
    for (const checkbox of parent.querySelectorAll<HTMLInputElement>(".cm-md-task-checkbox")) {
      checkbox.disabled = !isEditable;
    }
    for (const cell of parent.querySelectorAll<HTMLElement>(".tbl-cell-view")) {
      cell.contentEditable = isEditable ? "true" : "false";
    }
  };
  const embeddedControls = new MutationObserver(syncEmbeddedControls);
  embeddedControls.observe(parent, { childList: true, subtree: true });
  syncEmbeddedControls();

  const handleContentUpdated = (event: { content: string }): void => {
    const incoming = event.content;
    if ([...activeSaves].some((save) => save.content === incoming)) return;
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    incomingRevision += 1;
    replaceDoc(incoming);
    lastKnownGood = incoming;
  };

  ctx.addEventListener("content-updated", handleContentUpdated);

  return {
    view,
    setEditable(next: boolean): void {
      if (next === isEditable) return;
      isEditable = next;
      if (!isEditable && saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      view.dispatch({
        effects: editable.reconfigure([
          EditorState.readOnly.of(!isEditable),
          EditorView.editable.of(isEditable),
        ]),
      });
      syncEmbeddedControls();
    },
    dispose(): void {
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      embeddedControls.disconnect();
      ctx.removeEventListener("content-updated", handleContentUpdated);
      view.destroy();
    },
  };
}

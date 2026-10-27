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

// Annotation tagged on authoritative document replacements so the save
// listener does not round-trip them back through the persistence boundary.
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
 * decoration plugin. Used by the shared mount, the file-artifact adapter and
 * the dev-mode standalone bootstrap in `main.ts`.
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
}

export interface MarkdownEditorMountOptions {
  parent: HTMLElement;
  value: string;
  editable: boolean;
  onSave(value: string): Promise<void>;
}

export interface MarkdownEditorHandle {
  setValue(value: string): void;
  setEditable(editable: boolean): void;
  focus(): void;
  dispose(): void;
}

interface InternalEditor {
  handle: MarkdownEditorHandle;
  view: EditorView;
}

interface InternalOptions extends MarkdownEditorMountOptions {
  debounceMs?: number;
}

/**
 * Store-neutral wiring between an `EditorView` and an authoritative string:
 *
 * - **Outgoing.** `docChanged` updates from local edits are debounced; on
 *   flush we send the complete current text through `onSave`.
 * - **Incoming.** `setValue` records an authoritative value. A save
 *   confirmation updates the stored baseline without replacing a newer local
 *   edit; other values cancel an unsent edit and replace a different document
 *   without creating a save or history entry.
 * - **Error.** A rejected save that still awaits confirmation cancels any
 *   scheduled save and restores the string last recorded as stored, unless a
 *   newer stored value arrived while the rejected save was pending.
 */
function createEditor(options: InternalOptions, editabilityCanChange: boolean): InternalEditor {
  const { parent } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let lastKnownGood = options.value;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let isEditable = options.editable;
  let incomingRevision = 0;
  const activeSaves = new Set<{ content: string; revision: number; awaitingEcho: boolean }>();
  let lastCompletedSave: { content: string; revision: number } | null = null;
  const editable = new Compartment();

  const editability = (enabled: boolean): Extension => [
    EditorState.readOnly.of(!enabled),
    EditorView.editable.of(enabled),
  ];

  const cancelScheduledSave = (): void => {
    if (saveTimer === null) return;
    clearTimeout(saveTimer);
    saveTimer = null;
  };

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
    const save = { content, revision: incomingRevision, awaitingEcho: true };
    activeSaves.add(save);
    try {
      await options.onSave(content);
      if (incomingRevision === save.revision) {
        lastKnownGood = content;
        lastCompletedSave = { content, revision: incomingRevision };
      }
    } catch {
      if (incomingRevision === save.revision && save.awaitingEcho) {
        cancelScheduledSave();
        incomingRevision += 1;
        lastCompletedSave = null;
        for (const activeSave of activeSaves) activeSave.awaitingEcho = false;
        replaceDoc(lastKnownGood);
      }
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
    if (update.transactions.some((tr) => tr.annotation(Remote))) return;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flushSave();
    }, debounceMs);
  });

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.value,
      extensions: [
        editorExtensions,
        editable.of(editability(isEditable)),
        readOnlyGuard,
        saveListener,
      ],
    }),
  });

  const syncTaskCheckboxes = (): void => {
    for (const checkbox of parent.querySelectorAll<HTMLInputElement>(".cm-md-task-checkbox")) {
      if (checkbox.disabled !== !isEditable) checkbox.disabled = !isEditable;
    }
  };
  const embeddedControls = editabilityCanChange
    ? new MutationObserver(syncTaskCheckboxes)
    : null;
  embeddedControls?.observe(parent, { childList: true, subtree: true });
  if (editabilityCanChange) syncTaskCheckboxes();

  return {
    view,
    handle: {
      setValue(incoming: string): void {
        const confirmedSave = [...activeSaves].find(
          (save) => save.content === incoming && save.revision === incomingRevision,
        );
        lastKnownGood = incoming;
        if (confirmedSave && isEditable) {
          confirmedSave.awaitingEcho = false;
          return;
        }
        if (
          isEditable &&
          lastCompletedSave?.content === incoming &&
          lastCompletedSave.revision === incomingRevision
        ) {
          return;
        }
        incomingRevision += 1;
        lastCompletedSave = null;
        for (const save of activeSaves) save.awaitingEcho = false;
        cancelScheduledSave();
        replaceDoc(incoming);
      },
      setEditable(next: boolean): void {
        if (next === isEditable) return;
        isEditable = next;
        if (!isEditable) {
          cancelScheduledSave();
        }
        view.dispatch({
          effects: editable.reconfigure(editability(isEditable)),
        });
        if (editabilityCanChange) syncTaskCheckboxes();
      },
      focus(): void {
        view.focus();
      },
      dispose(): void {
        cancelScheduledSave();
        embeddedControls?.disconnect();
        view.destroy();
      },
    },
  };
}

/** The public v1 editor boundary used by copied Markdown template pages. */
export function mountMarkdownEditor(options: MarkdownEditorMountOptions): MarkdownEditorHandle {
  return createEditor(options, true).handle;
}

/** Adapts the file-artifact host protocol to the store-neutral editor. */
export function installEditor(
  hooks: EditorHooks,
  exposeView?: (view: EditorView) => void,
): MarkdownEditorHandle {
  const editor = createEditor({
    parent: hooks.parent,
    value: "",
    editable: true,
    debounceMs: hooks.debounceMs,
    onSave: (content) => hooks.ctx.updateContent(content),
  }, false);
  const handleContentUpdated = (event: { content: string }): void => {
    editor.handle.setValue(event.content);
  };
  hooks.ctx.addEventListener("content-updated", handleContentUpdated);
  exposeView?.(editor.view);

  return {
    ...editor.handle,
    dispose(): void {
      hooks.ctx.removeEventListener("content-updated", handleContentUpdated);
      editor.handle.dispose();
    },
  };
}

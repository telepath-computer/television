import "./styles.css";
import "./editor.css";
import "./colors.css";
import {
  ArtifactContext,
  installBridge,
  WebviewArtifactContext,
} from "@telepath-computer/television-artifact/browser";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorExtensions, installEditor } from "./editor.ts";
import seed from "../fixtures/seed.md?raw";

// Live-preview markdown view.
//
// In production the view loads inside a Television iframe or Electron
// webview. We construct the matching host context (which posts `ready`
// synchronously) and hand the editor mount point to `installEditor`, which
// builds the CodeMirror view,
// debounces `docChanged` → `ctx.updateContent`, suppresses save echoes,
// replaces the doc on remote edits, and rolls back on save errors.
//
// In dev (`npm run dev`) the page loads standalone with no parent host.
// The fixture seed is loaded directly into a plain EditorView so the e2e
// suite has a deterministic doc to drive without needing a host stub.

const parent = document.getElementById("editor");

const testHookEnabled = import.meta.env.DEV
  && document.body.hasAttribute("data-television-markdown-test-hook");

function exposeTestEditor(view: EditorView): void {
  if (!testHookEnabled) return;
  // Expose the EditorView for e2e tests. Inline-code body text is a bare
  // text node inside `.cm-line` (lang-markdown's CodeText tag has no rule
  // in `markdownHighlight`), so Playwright's `getByText` can't locate it.
  (window as Window & { __cmView?: EditorView }).__cmView = view;
}

const hosted = document.body.hasAttribute("data-television-markdown-hosted");
if (hosted) {
  if (!parent) throw new Error("Editor mount point #editor not found");
  mountHostedEditor(parent);
}

function mountHostedEditor(parent: HTMLElement): void {
  const isWebview = !!(window as Window & { __televisionContentBridge?: unknown }).__televisionContentBridge;
  const isFramed = window.parent !== window;
  const standalone = !isWebview && !isFramed;

  if (isFramed) {
    installBridge(window);
  }

  const context = standalone
    ? null
    : isWebview ? new WebviewArtifactContext() : new ArtifactContext();
  let styleRevision = 0;
  context?.onStylesChanged(() => {
    const current = document.querySelector<HTMLLinkElement>(
      'link[data-television-style="canonical"]',
    );
    if (!current) return;
    const next = new URL(current.href);
    styleRevision += 1;
    next.searchParams.set("tv-styles", `${Date.now()}-${styleRevision}`);
    current.href = next.href;
  });

  if (context === null) {
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: seed, extensions: editorExtensions }),
    });
    exposeTestEditor(view);
    return;
  }

  installEditor({ parent, ctx: context }, exposeTestEditor);
}

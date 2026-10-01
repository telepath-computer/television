import { ArtifactContext, installBridge } from "@telepath-computer/television-artifact/browser";

type EventRecord = { type: string; content?: string; at: number };

type PendingResult = { ok: true } | { ok: false; message: string };

interface ViewHarnessWindow extends Window {
  __artifact: ArtifactContext;
  __events: EventRecord[];
  __updateContent: (content: string) => number;
  __poll: (requestId: number) => PendingResult | "pending";
  __disposeArtifact: () => void;
  __postSelfContentUpdated: (content: string) => void;
  __postGarbageToParent: () => void;
}

const viewWindow = window as unknown as ViewHarnessWindow;

const context = new ArtifactContext();
viewWindow.__artifact = context;
viewWindow.__events = [];

context.addEventListener("content-updated", (event) => {
  viewWindow.__events.push({ type: "content-updated", content: event.content, at: Date.now() });
});

const pending = new Map<number, PendingResult>();
let nextRequestId = 1;

viewWindow.__updateContent = (content: string): number => {
  const id = nextRequestId++;
  context
    .updateContent(content)
    .then(() => {
      pending.set(id, { ok: true });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      pending.set(id, { ok: false, message });
    });
  return id;
};

viewWindow.__poll = (requestId: number): PendingResult | "pending" => {
  const result = pending.get(requestId);
  return result ?? "pending";
};

viewWindow.__disposeArtifact = () => {
  context.dispose();
};

// Post a content-updated notification into *this* window (not via parent).
// Used to prove that ArtifactContext's source check filters out self-posts.
viewWindow.__postSelfContentUpdated = (content: string) => {
  viewWindow.postMessage({ type: "content-updated", content }, "*");
};

// Post garbage from the view side to the host.
viewWindow.__postGarbageToParent = () => {
  viewWindow.parent.postMessage({ type: "banana" }, "*");
  viewWindow.parent.postMessage("not-an-object", "*");
  viewWindow.parent.postMessage({ type: "update-content" }, "*");
};

// Scroll-bridge mode. Exercised by the scroll-bridge spec: installs the
// bridge and replicates the iframe-overflow layout that view-markdown uses
// (body is fixed-height flex; an inner #editor div is the actual
// `overflow: auto` scroller). Without `?scroll=1` the harness retains its
// existing surface for the artifact-view-client tests.
if (new URLSearchParams(viewWindow.location.search).get("scroll") === "1") {
  installBridge(viewWindow);
  document.body.style.cssText = "display: flex; height: 100vh; margin: 0;";
  const editor = document.createElement("div");
  editor.id = "editor";
  editor.style.cssText = "flex: 1; overflow: auto;";
  const inner = document.createElement("div");
  inner.id = "editor-content";
  inner.style.cssText = "height: 4000px; background: linear-gradient(red, blue);";
  editor.appendChild(inner);
  document.body.appendChild(editor);
}

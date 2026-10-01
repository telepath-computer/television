import { missingArtifactDescription, missingArtifactRecoveryHint, missingArtifactTitle } from "@telepath-computer/television-artifact/missing-artifact-page";
import {
  ARTIFACT_MISSING_REQUEST_MESSAGE_TYPE,
  installBridge,
  isArtifactMissingNotification,
} from "@telepath-computer/television-artifact/browser";

interface ArtifactMissingElements {
  title: HTMLElement;
  description: HTMLElement;
  pathBlock: HTMLElement;
  path: HTMLElement;
  recovery: HTMLElement;
}

interface ContentBridge {
  postToHost(message: unknown): void;
  onHostMessage(callback: (message: unknown) => void): () => void;
}

declare global {
  interface Window {
    __televisionContentBridge?: ContentBridge;
  }
}

installBridge(window, { reportNavigation: false });
if (document.getElementById("missing-title") !== null) {
  renderMissingArtifact(null);
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  if (!isArtifactMissingNotification(event.data)) return;
  renderMissingArtifact(event.data);
});

window.__televisionContentBridge?.onHostMessage((message) => {
  if (!isArtifactMissingNotification(message)) return;
  renderMissingArtifact(message);
});

const request = { type: ARTIFACT_MISSING_REQUEST_MESSAGE_TYPE };
window.parent.postMessage(request, "*");
window.__televisionContentBridge?.postToHost(request);

export function renderMissingArtifact(
  artifact: { title: string; path: string } | null,
  doc: Document = document,
): void {
  const elements = getElements(doc);
  elements.title.textContent = missingArtifactTitle();
  elements.description.textContent = missingArtifactDescription();
  elements.recovery.textContent = missingArtifactRecoveryHint();

  doc.title = artifact?.title || missingArtifactTitle();
  if (artifact === null) {
    elements.path.textContent = "";
    elements.pathBlock.hidden = true;
    return;
  }

  elements.path.textContent = artifact.path;
  elements.pathBlock.hidden = false;
}

function getElements(doc: Document): ArtifactMissingElements {
  const title = doc.getElementById("missing-title");
  const description = doc.getElementById("missing-description");
  const pathBlock = doc.getElementById("path-block");
  const artifactPath = doc.getElementById("missing-path");
  const recovery = doc.getElementById("missing-recovery");
  if (!(title instanceof HTMLElement)) throw new Error("Missing #missing-title");
  if (!(description instanceof HTMLElement)) throw new Error("Missing #missing-description");
  if (!(pathBlock instanceof HTMLElement)) throw new Error("Missing #path-block");
  if (!(artifactPath instanceof HTMLElement)) throw new Error("Missing #missing-path");
  if (!(recovery instanceof HTMLElement)) throw new Error("Missing #missing-recovery");
  return { title, description, pathBlock, path: artifactPath, recovery };
}

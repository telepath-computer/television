import {
  URL_TARGET_REQUEST_MESSAGE_TYPE,
  installBridge,
  isURLTargetNotification,
} from "@telepath-computer/television-artifact/browser";

interface URLUnsupportedElements {
  targetBlock: HTMLElement;
  targetLink: HTMLAnchorElement;
  addressLabel: HTMLElement;
  plainAddress: HTMLElement;
  desktopApp: HTMLElement;
}

installBridge(window, { reportNavigation: false });

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  if (!isURLTargetNotification(event.data)) return;
  renderTarget(event.data.url);
});

window.parent.postMessage({ type: URL_TARGET_REQUEST_MESSAGE_TYPE }, "*");

export function renderTarget(url: string | null, doc: Document = document): void {
  const elements = getElements(doc);
  resetTarget(elements);

  if (url === null) {
    elements.targetBlock.hidden = true;
    elements.desktopApp.hidden = false;
    return;
  }

  const parsed = parseWebURL(url);
  elements.targetBlock.hidden = false;
  elements.desktopApp.hidden = false;

  elements.addressLabel.textContent = "This is the URL you're trying to visit:";
  if (parsed) {
    elements.targetLink.textContent = url;
    elements.targetLink.href = parsed.href;
    elements.targetLink.hidden = false;
    return;
  }

  elements.plainAddress.textContent = url;
  elements.plainAddress.hidden = false;
}

function resetTarget(elements: URLUnsupportedElements): void {
  elements.targetLink.removeAttribute("href");
  elements.targetLink.textContent = "";
  elements.targetLink.hidden = true;
  elements.addressLabel.textContent = "";
  elements.plainAddress.textContent = "";
  elements.plainAddress.hidden = true;
}

function parseWebURL(url: string): URL | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

function getElements(doc: Document): URLUnsupportedElements {
  const targetBlock = doc.getElementById("target-block");
  const addressLabel = doc.getElementById("address-label");
  const targetLink = doc.getElementById("target-link");
  const plainAddress = doc.getElementById("plain-address");
  const desktopApp = doc.getElementById("desktop-app");
  if (!(targetBlock instanceof HTMLElement)) throw new Error("Missing #target-block");
  if (!(addressLabel instanceof HTMLElement)) throw new Error("Missing #address-label");
  if (!(targetLink instanceof HTMLAnchorElement)) throw new Error("Missing #target-link");
  if (!(plainAddress instanceof HTMLElement)) throw new Error("Missing #plain-address");
  if (!(desktopApp instanceof HTMLElement)) throw new Error("Missing #desktop-app");
  return { targetBlock, addressLabel, targetLink, plainAddress, desktopApp };
}

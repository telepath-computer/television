import { connectErrorMessage, type ConnectResult } from "./connect-error.ts";
import type { ConnectScreenIntent } from "./connect-screen.ts";
import { parseDesktopConnectURL } from "./connect-url.ts";

export interface ConnectPageAPI {
  getConnectScreenIntent(): Promise<ConnectScreenIntent>;
  getConnection(): Promise<{ serverURL: string; token: string } | null>;
  connect(serverURL: string, token: string): Promise<ConnectResult>;
}

export interface ConnectPageElements {
  form: HTMLFormElement;
  errorEl: HTMLElement;
  submitButton: HTMLButtonElement;
  submitLabel: HTMLElement;
  serverInput: HTMLInputElement;
  tokenInput: HTMLInputElement;
}

export const MIN_CONNECT_MS = 500;

export function bindConnectPage(api: ConnectPageAPI, elements: ConnectPageElements): () => void {
  let busy = false;

  function setBusy(next: boolean): void {
    busy = next;
    if (next && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    elements.submitButton.disabled = next;
    elements.submitButton.dataset.connecting = next ? "true" : "false";
    elements.submitLabel.textContent = next ? "Connecting…" : "Connect";
    elements.serverInput.disabled = next;
    elements.tokenInput.disabled = next;
  }

  async function waitForMinConnect(started: number): Promise<void> {
    const remaining = MIN_CONNECT_MS - (Date.now() - started);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }

  async function runConnect(serverURL: string, token: string): Promise<void> {
    if (busy) return;
    elements.errorEl.textContent = "";
    if (!serverURL.trim()) return;
    setBusy(true);
    const started = Date.now();
    try {
      const result = await api.connect(serverURL, token);
      if (!result.ok) {
        await waitForMinConnect(started);
        elements.errorEl.textContent = result.message;
        setBusy(false);
      }
    } catch (err) {
      await waitForMinConnect(started);
      elements.errorEl.textContent = connectErrorMessage(err);
      setBusy(false);
    }
  }

  function applyConnectURL(input: string): void {
    let parsed: ReturnType<typeof parseDesktopConnectURL>;
    try {
      parsed = parseDesktopConnectURL(input);
    } catch {
      return;
    }
    elements.serverInput.value = parsed.serverURL;
    if (parsed.token !== null) {
      elements.tokenInput.value = parsed.token;
    }
  }

  const onPasteServerURL = (event: ClipboardEvent): void => {
    const text = event.clipboardData?.getData("text");
    if (!text) return;
    try {
      parseDesktopConnectURL(text);
    } catch {
      return;
    }
    event.preventDefault();
    applyConnectURL(text);
  };

  const onSubmit = (event: Event): void => {
    event.preventDefault();
    applyConnectURL(elements.serverInput.value);
    void runConnect(elements.serverInput.value, elements.tokenInput.value);
  };

  elements.serverInput.addEventListener("paste", onPasteServerURL);
  elements.form.addEventListener("submit", onSubmit);

  void (async () => {
    const intent = await api.getConnectScreenIntent();
    const saved = await api.getConnection();
    if (saved) {
      elements.serverInput.value = saved.serverURL;
      elements.tokenInput.value = saved.token;
    }
    if (intent === "bootstrap" && saved) {
      await runConnect(saved.serverURL, saved.token);
    }
  })();

  return () => {
    elements.serverInput.removeEventListener("paste", onPasteServerURL);
    elements.form.removeEventListener("submit", onSubmit);
  };
}

export function initConnectPage(api: ConnectPageAPI): void {
  const form = document.getElementById("connect-form");
  const errorEl = document.getElementById("error");
  const submitButton = document.getElementById("submit");
  const serverInput = document.getElementById("serverURL");
  const tokenInput = document.getElementById("token");
  const submitLabel = submitButton?.querySelector(".button-label");

  if (!(form instanceof HTMLFormElement)) throw new Error("connect form missing");
  if (!(errorEl instanceof HTMLElement)) throw new Error("connect error element missing");
  if (!(submitButton instanceof HTMLButtonElement)) throw new Error("connect submit button missing");
  if (!(serverInput instanceof HTMLInputElement)) throw new Error("connect server input missing");
  if (!(tokenInput instanceof HTMLInputElement)) throw new Error("connect token input missing");
  if (!(submitLabel instanceof HTMLElement)) throw new Error("connect submit label missing");

  bindConnectPage(api, { form, errorEl, submitButton, submitLabel, serverInput, tokenInput });
}

declare global {
  interface Window {
    television: ConnectPageAPI;
  }
}

if (typeof window !== "undefined" && window.television) {
  initConnectPage(window.television);
}

import "../../web/src/foundation/index.css";
import "../../web/src/foundation/app.css";
import "../../web/src/global.css";
import { render } from "lit-html";
import { SystemModalView } from "../../web/src/views/system-modal.ts";
import { connectErrorMessage, type ConnectResult } from "./connect-error.ts";
import type { ConnectScreenState } from "./connect-screen.ts";
import { setupTemplate, type SetupState } from "./setup.ts";
import "./connect-page.css";

export interface ConnectPageAPI {
  getState(): Promise<ConnectScreenState>;
  onState(callback: (state: ConnectScreenState) => void): () => void;
  connect(link: string): Promise<ConnectResult>;
  completeConnect(attempt: number): Promise<void>;
  disconnect(): Promise<void>;
}

export function initConnectPage(api: ConnectPageAPI, host: HTMLElement = document.getElementById("app")!): () => void {
  let connection: ConnectScreenState | null = null;
  let state: SetupState = "ready";
  let link = "";
  let error = "";
  let disposed = false;
  const appearance = window.matchMedia("(prefers-color-scheme: dark)");
  const applyAppearance = () => document.documentElement.setAttribute("data-theme", appearance.matches ? "dark" : "light");
  applyAppearance();
  appearance.addEventListener("change", applyAppearance);

  const paint = () => {
    render(connection?.kind === "setup"
      ? setupTemplate(state, link, error, submit)
      : connection ? SystemModalView(connection, { context: "local", dragStrip: true, onDisconnect: () => void api.disconnect() }) : null, host);
  };
  const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (state === "connecting" || state === "connected") return;
    link = host.querySelector<HTMLInputElement>(".setup-link input")!.value;
    if (!link.trim()) return;
    state = "connecting";
    error = "";
    paint();
    try {
      const result = await api.connect(link);
      if (disposed) return;
      if (!result.ok) {
        state = "error";
        error = result.message;
        paint();
        return;
      }
      state = "connected";
      paint();
      // Wait for the authored fade when it runs. Reduced motion has no
      // animations; paint Connected once before handing navigation to main.
      const done = host.querySelector<HTMLElement>(".setup-done")!;
      await nextFrame();
      await Promise.all(done.getAnimations().map(animation => animation.finished.catch(() => {})));
      await nextFrame();
      if (!disposed) await api.completeConnect(result.attempt);
    } catch (failure) {
      if (disposed) return;
      state = "error";
      error = connectErrorMessage(failure);
      paint();
    }
  }
  const unsubscribe = api.onState(next => { connection = next; paint(); });
  void api.getState().then(initial => {
    if (disposed || connection !== null) return;
    connection = initial;
    paint();
  });
  return () => {
    disposed = true;
    unsubscribe();
    appearance.removeEventListener("change", applyAppearance);
    render(null, host);
  };
}

declare global {
  interface Window { television: ConnectPageAPI; }
}
if (typeof window !== "undefined" && window.television) initConnectPage(window.television);

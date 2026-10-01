import {
  dialogTemplate,
  presentDialog,
  type DialogPresentation,
} from "./dialog.ts";
import { View, view } from "@telepath-computer/utils/lit-view";
import { html, render as renderTemplate } from "lit-html";
import type { InterruptingApplicationState } from "./application-state.ts";
import "../elements/icon.ts";
import "./system-modal.css";
import "./system-modal.host.css";

const COUNTDOWN_TICK_MS = 250;
const ONE_SECOND_MS = 1000;

export type SystemModalState = Exclude<InterruptingApplicationState, { kind: "needs-upgrade" }>;

export interface SystemModalOptions {
  context: "browser" | "desktop" | "local";
  dragStrip?: boolean;
  onDisconnect?: () => void;
}

/** Connection owners supply state; this shared presentation owns its countdown. */
export class SystemModal extends View<[SystemModalState, SystemModalOptions]> {
  readonly #host = createSystemModalHost();
  #presentation: DialogPresentation | null = null;
  #presentScheduled = false;
  #ticker: ReturnType<typeof setInterval> | null = null;

  disconnected(): void {
    this.#stopTicker();
    this.#presentation?.withdraw();
    this.#presentation = null;
    this.#presentScheduled = false;
    renderTemplate(null, this.#host);
  }

  template(
    state: SystemModalState,
    options: SystemModalOptions,
  ): unknown {
    this.#syncTicker(state);

    renderTemplate(
      dialogTemplate(this.#standardInterior(state, options), windowDragStripTemplate(options.dragStrip)),
      this.#host,
    );
    this.#schedulePresentation();
    return this.#host;
  }

  #standardInterior(
    state: SystemModalState,
    options: SystemModalOptions,
  ): unknown {
    switch (state.kind) {
      case "connecting":
        return html`
          <div class="system-modal" role="status" aria-live="polite">
            <tv-icon name="spinner" size="xl" spinning></tv-icon>
            <h2>Connecting</h2>
          </div>
        `;
      case "disconnected":
        return html`
          <div class="system-modal" role="status" aria-live="polite">
            <tv-icon name="spinner" size="xl" spinning></tv-icon>
            <h2>Disconnected</h2>
            <p>${formatReconnect(state.nextRetryAt)}</p>
          </div>
        `;
      case "unauthorized":
        return html`
          <div class="system-modal">
            <tv-icon name="locked" size="xl"></tv-icon>
            <h2>Access token required</h2>
            <p>${{
              browser: "This server requires a valid access token to connect. Ask your agent for the current link, and paste the whole link into the address bar.",
              desktop: "This server requires a valid access token to connect. Choose Television › Disconnect from Server, then try again.",
              local: "This server requires a valid access token to connect. Disconnect from Server, then paste the current link from your agent.",
            }[options.context]}</p>
            ${this.#disconnectButton(options)}
          </div>
        `;
      case "error":
        return html`
          <div class="system-modal">
            <h2>Can’t connect with server</h2>
            <p class="server-url">${state.serverURL}</p>
            <p>Check your internet connection and that the server is running. ${formatReconnect(state.nextRetryAt)}</p>
            ${this.#disconnectButton(options)}
          </div>
        `;
    }
  }

  #disconnectButton(options: SystemModalOptions): unknown {
    return options.context === "local"
      ? html`<button intent="danger" class="system-modal-disconnect" @click=${options.onDisconnect}>Disconnect from Server</button>`
      : null;
  }

  #syncTicker(state: SystemModalState): void {
    const running = (state.kind === "disconnected" || state.kind === "error") && state.nextRetryAt !== null;
    if (running && this.#ticker === null) {
      this.#ticker = setInterval(() => this.render(), COUNTDOWN_TICK_MS);
    } else if (!running) {
      this.#stopTicker();
    }
  }

  #stopTicker(): void {
    if (this.#ticker === null) return;
    clearInterval(this.#ticker);
    this.#ticker = null;
  }

  #schedulePresentation(): void {
    if (this.#presentation !== null || this.#presentScheduled) return;
    this.#presentScheduled = true;
    queueMicrotask(() => {
      this.#presentScheduled = false;
      if (!this.isConnected || !this.#host.isConnected || this.#presentation !== null) return;
      const dialog = this.#host.querySelector<HTMLDialogElement>("dialog");
      if (dialog === null) return;
      this.#presentation = presentDialog(dialog, () => undefined);
    });
  }
}

export const SystemModalView = view(SystemModal);

function createSystemModalHost(): HTMLElement {
  const host = document.createElement("section");
  host.className = "system-modal-host";
  return host;
}

function formatReconnect(nextRetryAt: number | null): string {
  if (nextRetryAt === null) return "Reconnecting now…";
  const remainingMs = nextRetryAt - Date.now();
  if (remainingMs <= 0) return "Reconnecting now…";
  return `Reconnecting in ${Math.ceil(remainingMs / ONE_SECOND_MS)}s…`;
}

/** Inside the native dialog so modality leaves the drag region interactive. */
export function windowDragStripTemplate(enabled = false): unknown {
  return enabled ? html`<div class="window-drag-strip" electron-draggable aria-hidden="true"></div>` : null;
}

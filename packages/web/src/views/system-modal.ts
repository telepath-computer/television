import {
  dialogTemplate,
  presentDialog,
  type DialogPresentation,
} from "./dialog.ts";
import { View, view } from "@telepath-computer/utils/lit-view";
import { html, nothing, render as renderTemplate } from "lit-html";
import type { InterruptingApplicationState } from "./application-state.ts";
import { DesktopUpgradeGateView } from "./desktop-upgrade-gate.ts";
import type { DesktopUpdateState } from "../services/desktop-update.ts";
import "../elements/icon.ts";
import "./system-modal.css";
import "./system-modal.host.css";

const COUNTDOWN_TICK_MS = 250;
const ONE_SECOND_MS = 1000;

export type SystemModalState = InterruptingApplicationState;

export interface SystemModalApplication {
  authenticate(token: string): Promise<void>;
}

/**
 * The app's one interrupting surface. It owns only view-local form and
 * countdown state; connection and gate state remain application inputs.
 */
export class SystemModal extends View<[
  SystemModalState,
  SystemModalApplication,
  DesktopUpdateState?,
]> {
  readonly #host = createSystemModalHost();
  #presentation: DialogPresentation | null = null;
  #presentScheduled = false;
  #ticker: ReturnType<typeof setInterval> | null = null;
  #token = "";
  #application: SystemModalApplication | null = null;

  disconnected(): void {
    this.#stopTicker();
    this.#presentation?.withdraw();
    this.#presentation = null;
    this.#presentScheduled = false;
    renderTemplate(null, this.#host);
  }

  template(
    state: SystemModalState,
    application: SystemModalApplication,
    desktopUpdate?: DesktopUpdateState,
  ): unknown {
    this.#application = application;
    this.#syncTicker(state);

    if (state.kind === "needs-upgrade") {
      this.#presentation?.withdraw();
      this.#presentation = null;
      renderTemplate(
        DesktopUpgradeGateView(state.instructions, desktopUpdate),
        this.#host,
      );
      return this.#host;
    }

    renderTemplate(
      dialogTemplate(this.#standardInterior(state)),
      this.#host,
    );
    this.#schedulePresentation();
    return this.#host;
  }

  #standardInterior(
    state: Exclude<SystemModalState, { kind: "needs-upgrade" }>,
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
            <p>${formatReattempt(state.nextRetryAt)}</p>
          </div>
        `;
      case "unauthorized": {
        const invalid = Boolean(state.invalid);
        if (invalid) this.#token = "";
        return html`
          <form class="system-modal auth-form" @submit=${this.#handleSubmit}>
            <tv-icon name="locked" size="xl"></tv-icon>
            <h2>Enter access token</h2>
            <p>This server requires an access token to connect.</p>
            <input
              class="auth-token"
              type="password"
              name="token"
              placeholder="paste token here"
              aria-label="Access token"
              aria-invalid=${invalid ? "true" : nothing}
              aria-describedby=${invalid ? "auth-token-error" : nothing}
              .value=${this.#token}
              @input=${this.#handleInput}
              autofocus
              required
            />
            ${invalid
              ? html`<p id="auth-token-error" class="tv-error" role="alert">
                  The previous token was rejected. Try again.
                </p>`
              : null}
            <button type="submit" intent="primary" class="auth-submit">
              Connect
            </button>
          </form>
        `;
      }
      case "error":
        return html`
          <div class="system-modal">
            <h2>Can’t connect with server</h2>
            <p class="server-url">${state.serverURL}</p>
            <p>${state.message}</p>
          </div>
        `;
    }
  }

  readonly #handleInput = (event: Event): void => {
    this.#token = (event.currentTarget as HTMLInputElement).value;
  };

  readonly #handleSubmit = (event: Event): void => {
    event.preventDefault();
    const token = this.#token.trim();
    if (token.length === 0 || this.#application === null) return;
    void this.#application.authenticate(token);
  };

  #syncTicker(state: SystemModalState): void {
    const running = state.kind === "disconnected" && state.nextRetryAt !== null;
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

function formatReattempt(nextRetryAt: number | null): string {
  if (nextRetryAt === null) return "Reattempting now…";
  const remainingMs = nextRetryAt - Date.now();
  if (remainingMs <= 0) return "Reattempting now…";
  return `Reattempting in ${Math.ceil(remainingMs / ONE_SECOND_MS)}s…`;
}

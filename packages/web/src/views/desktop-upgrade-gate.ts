import {
  dialogTemplate,
  presentDialog,
  type DialogPresentation,
} from "./dialog.ts";
import { View, view } from "@telepath-computer/utils/lit-view";
import type { DesktopUpgradeInstructions } from "@telepath-computer/television-shared";
import { html, nothing, type TemplateResult } from "lit-html";
import { createRef, ref, type Ref } from "lit-html/directives/ref.js";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { selectGateInstructions } from "../services/desktop-gate.ts";
import type { DesktopUpdateState } from "../services/desktop-update.ts";
import { renderMarkdown } from "../markdown.ts";
import "./desktop-upgrade-gate.css";

/** Fixed interface copy authored by specs/ui/app/desktop-upgrade-gate/content.yml. */
export const DESKTOP_UPGRADE_GATE_COPY = {
  restart_to_update: "Restart to update",
  restarting: "Restarting…",
} as const;

/**
 * The blocking desktop-upgrade surface. With a reported download it shows the
 * downloaded-update message and the restart button, its only control
 * (^gate-restart); otherwise the channel's instructions or the fallback.
 */
export class DesktopUpgradeGate extends View<[DesktopUpgradeInstructions | null, DesktopUpdateState?]> {
  #presentation: DialogPresentation | null = null;
  #rootRef: Ref<HTMLElement> = createRef();
  #desktopUpdate: DesktopUpdateState | null = null;

  connected(): void {
    queueMicrotask(() => {
      if (!this.isConnected || this.#presentation !== null) return;
      const dialog = this.#rootRef.value?.querySelector<HTMLDialogElement>("dialog") ?? null;
      if (dialog === null) throw new Error("Desktop upgrade gate requires its composed dialog");

      // This surface is the explicit blocking exception. The shared edge still
      // prevents native Escape closure and discriminates real backdrop input;
      // the gate consumes either intent without requesting withdrawal.
      this.#presentation = presentDialog(dialog, () => undefined);
    });
  }

  disconnected(): void {
    this.#presentation?.withdraw();
    this.#presentation = null;
    this.#desktopUpdate?.removeEventListener("change", this.#onDesktopUpdateChange);
    this.#desktopUpdate = null;
  }

  template(instructions: DesktopUpgradeInstructions | null, desktopUpdate?: DesktopUpdateState): TemplateResult {
    this.#follow(desktopUpdate ?? null);
    const version = this.#desktopUpdate?.version ?? null;
    const restarting = this.#desktopUpdate?.restarting ?? false;
    return html`
      <div class="desktop-upgrade-gate" ${ref(this.#rootRef)}>
        ${dialogTemplate(
          html`<div class="upgrade-gate-body" data-testid="upgrade-gate-body">${unsafeHTML(
            renderMarkdown(selectGateInstructions(instructions, version !== null)),
          )}</div>${version === null
            ? nothing
            : html`<div class="upgrade-gate-actions"><button
                intent="primary"
                class="upgrade-gate-restart"
                ?disabled=${restarting}
                @click=${this.#restart}
              >${restarting
                ? DESKTOP_UPGRADE_GATE_COPY.restarting
                : DESKTOP_UPGRADE_GATE_COPY.restart_to_update}</button></div>`}`,
        )}
      </div>
    `;
  }

  // The gate subscribes when it renders the screen, and a download reported
  // while the screen is shown changes it in place (^gate-instructions).
  #follow(desktopUpdate: DesktopUpdateState | null): void {
    if (desktopUpdate === this.#desktopUpdate) return;
    this.#desktopUpdate?.removeEventListener("change", this.#onDesktopUpdateChange);
    this.#desktopUpdate = desktopUpdate;
    desktopUpdate?.addEventListener("change", this.#onDesktopUpdateChange);
    desktopUpdate?.subscribe();
  }

  readonly #onDesktopUpdateChange = (): void => {
    this.render();
  };

  readonly #restart = (): void => {
    this.#desktopUpdate?.restart();
  };
}

export const DesktopUpgradeGateView = view(DesktopUpgradeGate);

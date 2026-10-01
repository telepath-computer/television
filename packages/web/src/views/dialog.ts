import "./dialog.css";
import "./dialog.host.css";
import { html, type TemplateResult } from "lit-html";

export type DialogDismissReason = "backdrop" | "escape";
export type DialogDismissCallback = (reason: DialogDismissReason) => void;

export interface DialogPresentation {
  withdraw(): void;
}

/** Compose caller-authored contents into the shared native dialog markup. */
export function dialogTemplate(
  content: unknown,
): TemplateResult {
  return html`<div class="dialog-overlay"><dialog open><div class="dialog-content">${content}</div></dialog></div>`;
}

/**
 * Present a composed dialog through the browser's modal-dialog mechanism.
 *
 * The caller owns withdrawal, including withdrawal in response to
 * `onDismiss`.
 */
export function presentDialog(
  dialog: HTMLDialogElement,
  onDismiss: DialogDismissCallback,
): DialogPresentation {
  let withdrawn = false;

  const onCancel = (event: Event): void => {
    event.preventDefault();
    onDismiss("escape");
  };

  const onClick = (event: MouseEvent): void => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    const insidePanel =
      event.clientX >= bounds.left &&
      event.clientX <= bounds.right &&
      event.clientY >= bounds.top &&
      event.clientY <= bounds.bottom;
    if (!insidePanel) onDismiss("backdrop");
  };

  dialog.addEventListener("cancel", onCancel);
  dialog.addEventListener("click", onClick);

  // The authored markup is open for direct rendering and smoke inspection.
  // showModal() rejects a non-modal open dialog, so clear that initial state
  // without close() (which would queue a false close event), then enter the
  // platform modal state synchronously.
  for (const panel of dialog.ownerDocument.querySelectorAll("tv-popover[open], tv-menu[open], tv-select[open]")) {
    panel.removeAttribute("open");
  }
  dialog.removeAttribute("open");
  dialog.showModal();

  return {
    withdraw(): void {
      if (withdrawn) return;
      withdrawn = true;
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("click", onClick);
      if (dialog.open) dialog.close();
    },
  };
}

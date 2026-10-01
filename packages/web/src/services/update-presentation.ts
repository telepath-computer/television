import { EventTarget } from "@rupertsworld/event-target";
import { ChangeEvent } from "@telepath-computer/television-shared";

// The shared presentation state for the update surfaces
// (specs/arch/updates/desktop-upgrade-gate.md ^gate-precedence): the
// explicitly owned suppression contract between the desktop upgrade gate and
// the toast/bell. The toast surface SUBSCRIBES to this state; the gate's only
// interaction is flipping the suppress switch — it never reaches into toast
// internals. The switch is one-way for a page lifetime: every gate exit is a
// reload (^gate-reevaluation), so nothing ever un-suppresses in place.

export class UpdatePresentationState extends EventTarget<ChangeEvent> {
  #toastsSuppressed = false;

  /** True once the gate has superseded the toast and bell for this page. */
  get toastsSuppressed(): boolean {
    return this.#toastsSuppressed;
  }

  /** Flip the one-way suppress switch (idempotent). */
  suppressToasts(): void {
    if (this.#toastsSuppressed) return;
    this.#toastsSuppressed = true;
    this.dispatchEvent(new ChangeEvent("change"));
  }
}

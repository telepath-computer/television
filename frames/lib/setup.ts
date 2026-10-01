// Workshop wiring for the setup screen ([[specs/ui/setup/index.md]], Interaction):
// the forward-only steps, Copy, and Connect's hand-off to the host. Staging
// only; it binds nothing. At rest the markup matches the spec frame's render
// for the resulting state.

// The copy button's confirmation dwell, stated in its spec's prose
// ([[specs/ui/app/copy-button/index.md]], Testing); no data file carries it.
const COPY_CONFIRM_MS = 1400;

export interface SetupWiringOptions {
  /** Connect submitted a non-empty link; the screen is already connecting. */
  onConnect?: () => void;
}

const writeClipboard = (text: string): void => {
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(text).catch(() => {});
    return;
  }
  // Plain HTTP has no clipboard API; copy a selected textarea within the press.
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } catch {
    // Copying is best-effort in the workshop.
  }
  textarea.remove();
};

/** Pose the connected state on a wired screen, as its render would. */
export const showConnected = (screen: HTMLElement): void => {
  const pasteStep = screen.querySelectorAll<HTMLElement>(".setup-step")[1];
  pasteStep?.removeAttribute("aria-current");
  pasteStep?.classList.add("done");
  const setupDocument = screen.querySelector<HTMLElement>(".setup-document");
  if (setupDocument) setupDocument.inert = true;
  screen.querySelector(".setup-done")?.removeAttribute("aria-hidden");
  screen.dataset.step = "connected";
};

/**
 * Wire one rendered setup screen. The steps only move forward: Copy, or
 * releasing a press in step 2, or moving keyboard focus into it, makes step 2
 * current and checks step 1. Returns a disposer.
 */
export const setupPrototype = (screen: HTMLElement, options: SetupWiringOptions = {}): (() => void) => {
  const steps = [...screen.querySelectorAll<HTMLElement>(".setup-step")];
  const copyButton = screen.querySelector<HTMLButtonElement>(".setup-prompt .copy-button");
  const form = screen.querySelector<HTMLFormElement>(".setup-link");
  if (steps.length !== 2 || !copyButton || !form) {
    throw new Error("The setup screen needs its two steps, its copy button and its link form");
  }
  const [copyStep, pasteStep] = steps;
  const status = copyButton.nextElementSibling as HTMLElement | null;
  const field = form.querySelector<HTMLInputElement>("input");
  const submit = form.querySelector<HTMLButtonElement>(".setup-submit");
  const confirmation = copyButton.querySelector(".copy-button-done")?.textContent?.trim() ?? "";
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  const advance = (): void => {
    if (!copyStep.hasAttribute("aria-current")) return;
    copyStep.removeAttribute("aria-current");
    copyStep.classList.add("done");
    pasteStep.setAttribute("aria-current", "step");
    screen.dataset.step = "paste";
  };

  // A press activates on release. Focus that arrives during a press (a field
  // focuses on pointer down) waits for the release; focus without a press is
  // the keyboard, and activates at once.
  let pressing = false;
  const onPress = (): void => {
    pressing = true;
  };
  const onRelease = (): void => {
    pressing = false;
    advance();
  };
  const onFocus = (): void => {
    if (!pressing) advance();
  };
  const onPressEnd = (): void => {
    pressing = false;
  };

  const onCopy = (): void => {
    writeClipboard(copyButton.getAttribute("prompt") ?? "");
    copyButton.toggleAttribute("copied", true);
    if (status) status.textContent = confirmation;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      copyButton.toggleAttribute("copied", false);
      if (status) status.textContent = "";
    }, COPY_CONFIRM_MS);
    advance();
  };

  const onSubmit = (event: Event): void => {
    event.preventDefault();
    if (screen.dataset.step !== "copy" && screen.dataset.step !== "paste" && screen.dataset.step !== "error") return;
    if (!field?.value.trim()) return;
    advance();
    screen.dataset.step = "connecting";
    field.disabled = true;
    if (submit) submit.disabled = true;
    options.onConnect?.();
  };

  pasteStep.addEventListener("pointerdown", onPress);
  pasteStep.addEventListener("pointerup", onRelease);
  pasteStep.addEventListener("focusin", onFocus);
  // A press released outside step 2 ends without activating anything.
  document.addEventListener("pointerup", onPressEnd);
  copyButton.addEventListener("click", onCopy);
  form.addEventListener("submit", onSubmit);

  return () => {
    clearTimeout(confirmTimer);
    pasteStep.removeEventListener("pointerdown", onPress);
    pasteStep.removeEventListener("pointerup", onRelease);
    pasteStep.removeEventListener("focusin", onFocus);
    document.removeEventListener("pointerup", onPressEnd);
    copyButton.removeEventListener("click", onCopy);
    form.removeEventListener("submit", onSubmit);
  };
};

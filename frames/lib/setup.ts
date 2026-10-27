// Workshop wiring for the setup screen ([[specs/ui/setup/index.md]], Interaction):
// Copy, and Connect's hand-off to the host. Staging only; it binds nothing. At
// rest the markup matches the spec frame's render for the resulting state.

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
  const setupDocument = screen.querySelector<HTMLElement>(".setup-document");
  if (setupDocument) setupDocument.inert = true;
  screen.querySelector(".setup-done")?.removeAttribute("aria-hidden");
  screen.dataset.state = "connected";
};

/** Wire one rendered setup screen. Returns a disposer. */
export const setupPrototype = (screen: HTMLElement, options: SetupWiringOptions = {}): (() => void) => {
  const copyButton = screen.querySelector<HTMLButtonElement>(".setup-prompt .copy-button");
  const form = screen.querySelector<HTMLFormElement>(".setup-link");
  if (!copyButton || !form) {
    throw new Error("The setup screen needs its copy button and its link form");
  }
  const status = copyButton.nextElementSibling as HTMLElement | null;
  const field = form.querySelector<HTMLInputElement>("input");
  const submit = form.querySelector<HTMLButtonElement>(".setup-submit");
  const confirmation = copyButton.querySelector(".copy-button-done")?.textContent?.trim() ?? "";
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  const onCopy = (): void => {
    writeClipboard(copyButton.getAttribute("prompt") ?? "");
    copyButton.toggleAttribute("copied", true);
    if (status) status.textContent = confirmation;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      copyButton.toggleAttribute("copied", false);
      if (status) status.textContent = "";
    }, COPY_CONFIRM_MS);
  };

  const onSubmit = (event: Event): void => {
    event.preventDefault();
    if (screen.dataset.state !== "ready" && screen.dataset.state !== "error") return;
    if (!field?.value.trim()) return;
    // Connecting renders without the error treatment: the hint returns and
    // the field is no longer invalid.
    field.removeAttribute("aria-invalid");
    field.removeAttribute("aria-describedby");
    const error = screen.querySelector<HTMLElement>("#setup-link-error");
    if (error) {
      const hint = document.createElement("p");
      hint.className = "setup-hint";
      hint.innerHTML = 'The link looks like <code>http://…:32848/?token=…</code>';
      error.replaceWith(hint);
    }
    screen.dataset.state = "connecting";
    field.disabled = true;
    if (submit) submit.disabled = true;
    options.onConnect?.();
  };

  copyButton.addEventListener("click", onCopy);
  form.addEventListener("submit", onSubmit);

  return () => {
    clearTimeout(confirmTimer);
    copyButton.removeEventListener("click", onCopy);
    form.removeEventListener("submit", onSubmit);
  };
};

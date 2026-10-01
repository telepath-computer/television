import { html, nothing, type TemplateResult } from "lit-html";
import "../elements/icon.ts";
import "./copy-button.css";

export interface CopyButtonTemplateOptions {
  label: string;
  prompt?: string;
  intent?: string;
  size?: "sm" | "default" | "lg";
  copied?: boolean;
  onActivate?: () => void;
}

export type CopyButtonClipboardSink = (
  text: string,
  button: HTMLButtonElement,
) => void;

export interface CopyButtonScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CopyButtonDependencies {
  writeClipboard: CopyButtonClipboardSink;
  scheduler: CopyButtonScheduler;
}

interface ActiveTimer {
  handle: unknown;
  scheduler: CopyButtonScheduler;
}

const DWELL_MS = 1_400;
const activeTimers = new WeakMap<HTMLButtonElement, ActiveTimer>();

/** Copy through the available browser path without moving a rejected write outside its gesture. */
function writeClipboard(text: string, button: HTMLButtonElement): void {
  const document = button.ownerDocument;
  const clipboard = document.defaultView?.navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    void clipboard.writeText(text).catch(() => {});
    return;
  }

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
    // Clipboard access is best-effort; confirmation remains optimistic.
  }
  textarea.remove();
}

const defaultDependencies: CopyButtonDependencies = {
  writeClipboard,
  scheduler: {
    setTimeout(callback, delayMs): ReturnType<typeof setTimeout> {
      return globalThis.setTimeout(callback, delayMs);
    },
    clearTimeout(handle): void {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  },
};

function activate(
  event: Event,
  dependencies: CopyButtonDependencies,
  onActivate: () => void,
): void {
  const button = event.currentTarget as HTMLButtonElement | null;
  if (!button) return;
  dependencies.writeClipboard(button.getAttribute("prompt") ?? "", button);
  button.toggleAttribute("copied", true);

  const sibling = button.nextElementSibling;
  const status = sibling?.classList.contains("copy-button-status")
    ? sibling
    : null;
  if (status) {
    status.textContent = "";
    status.textContent = "Copied";
  }

  const previous = activeTimers.get(button);
  if (previous) previous.scheduler.clearTimeout(previous.handle);

  const timer: ActiveTimer = {
    handle: undefined,
    scheduler: dependencies.scheduler,
  };
  timer.handle = dependencies.scheduler.setTimeout(() => {
    if (activeTimers.get(button) !== timer) return;
    activeTimers.delete(button);
    button.toggleAttribute("copied", false);
    if (status) status.textContent = "";
  }, DWELL_MS);
  activeTimers.set(button, timer);
  onActivate();
}

/** Render the reusable native copy-button surface. */
export function copyButtonTemplate(
  {
    label,
    prompt = "",
    intent,
    size = "sm",
    copied = false,
    onActivate = () => {},
  }: CopyButtonTemplateOptions,
  dependencies: CopyButtonDependencies = defaultDependencies,
): TemplateResult {
  return html`
    <button
      class="copy-button"
      size=${size === "default" ? nothing : size}
      aria-label=${label}
      intent=${intent ?? nothing}
      ?copied=${copied}
      prompt=${prompt}
      @click=${(event: Event): void => activate(event, dependencies, onActivate)}
    >
      <span class="copy-button-idle"><tv-icon name="copy"></tv-icon>${label}</span>
      <span class="copy-button-done"><tv-icon name="check"></tv-icon>Copied</span>
    </button>
    <span
      class="copy-button-status"
      role="status"
      aria-live="polite"
      >${copied ? "Copied" : nothing}</span
    >
  `;
}

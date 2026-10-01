import { EventTarget } from "@rupertsworld/event-target";
import { ChangeEvent } from "@telepath-computer/television-shared";

// The downloaded desktop app's update, as the served interface learns it
// through the native preload bridge (specs/arch/desktop/updates.md
// #^desktop-updates-ops). One state per page, shared by the desktop
// self-update notice (specs/arch/updates/desktop-self-update-notice.md) and the
// upgrade gate (specs/arch/updates/desktop-upgrade-gate.md#^gate-instructions).

/**
 * Fixed body authored by
 * specs/ui/app/update-notification/content.yml#desktop_self_update_notice.
 * Production does not import spec content; this constant conforms verbatim,
 * `{version}` placeholder included.
 */
export const DESKTOP_SELF_UPDATE_NOTICE_MARKDOWN =
  "### Desktop app update ready\n" +
  "\n" +
  "Television updates its desktop app automatically. Version {version} has downloaded and installs when you restart the app.";

/** The dismissed downloaded version, independent from the other notices' keys. */
export const DESKTOP_SELF_UPDATE_DISMISSED_VERSION_KEY = "tv-desktop-self-update-dismissed";

/** The notice body for a reported version. */
export function desktopSelfUpdateNoticeMarkdown(version: string): string {
  return DESKTOP_SELF_UPDATE_NOTICE_MARKDOWN.replace("{version}", version);
}

/**
 * The bridge's update operations. Both are optional: a shell released
 * before them has neither, and the page uses them only when present.
 */
export interface DesktopUpdateBridge {
  onDesktopUpdateDownloaded?(callback: (version: string) => void): void;
  restartToInstallUpdate?(): void;
}

export interface DesktopUpdateStateOptions {
  /** The page runs in the desktop app (^electron-context). */
  electron: boolean;
  bridge: DesktopUpdateBridge | null | undefined;
}

/**
 * The reported downloaded version and whether a restart is under way. The
 * bridge has no unsubscribe, so the state subscribes once, when a surface
 * first asks, and keeps the subscription for the page's life.
 */
export class DesktopUpdateState extends EventTarget<ChangeEvent> {
  readonly #electron: boolean;
  readonly #bridge: DesktopUpdateBridge | null;
  #subscribed = false;
  #version: string | null = null;
  #restarting = false;

  constructor({ electron, bridge }: DesktopUpdateStateOptions) {
    super();
    this.#electron = electron;
    this.#bridge = bridge ?? null;
  }

  /** The downloaded version the bridge reported; null before any report. */
  get version(): string | null {
    return this.#version;
  }

  /** True once a restart has been requested; the page unloads when the app quits. */
  get restarting(): boolean {
    return this.#restarting;
  }

  subscribe(): void {
    if (this.#subscribed) return;
    this.#subscribed = true;
    const bridge = this.#bridge;
    if (!this.#electron || typeof bridge?.onDesktopUpdateDownloaded !== "function") return;
    bridge.onDesktopUpdateDownloaded((version: unknown) => {
      if (typeof version !== "string" || version.length === 0 || version === this.#version) return;
      this.#version = version;
      this.dispatchEvent(new ChangeEvent("change"));
    });
  }

  /** Ask the app to restart and install, once (^desktop-self-update-notice-restart). */
  restart(): void {
    if (this.#version === null || this.#restarting) return;
    this.#restarting = true;
    this.#bridge?.restartToInstallUpdate?.();
    this.dispatchEvent(new ChangeEvent("change"));
  }
}

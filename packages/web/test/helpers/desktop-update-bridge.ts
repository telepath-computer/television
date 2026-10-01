import type { DesktopUpdateBridge } from "../../src/services/desktop-update.ts";

/**
 * A stand-in for the native preload bridge's update operations
 * (specs/arch/desktop/updates.md#^desktop-updates-ops): a subscription hears
 * the reported version at once and every later report, as the real preload
 * behaves, and restart requests are counted instead of reaching a runtime.
 */
export class StandInDesktopUpdateBridge implements Required<DesktopUpdateBridge> {
  subscriptions = 0;
  restarts = 0;
  #version: string | null = null;
  readonly #callbacks: Array<(version: string) => void> = [];

  onDesktopUpdateDownloaded(callback: (version: string) => void): void {
    this.subscriptions += 1;
    this.#callbacks.push(callback);
    if (this.#version !== null) callback(this.#version);
  }

  restartToInstallUpdate(): void {
    this.restarts += 1;
  }

  /** Report a downloaded version, as the main process does after the runtime's event. */
  report(version: string): void {
    this.#version = version;
    for (const callback of this.#callbacks) callback(version);
  }
}

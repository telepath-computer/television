// The update operations' IPC channels, shared by the main process and the
// preload (specs/arch/desktop/updates.md#^desktop-updates-ops).
export const DESKTOP_UPDATE_DOWNLOADED_CHANNEL = "television:desktop-update-downloaded";
export const GET_DESKTOP_UPDATE_CHANNEL = "television:get-desktop-update";
export const RESTART_TO_INSTALL_UPDATE_CHANNEL = "television:restart-to-install-update";

/** A downloaded update's version as the bridge passes it: a non-empty string. */
export function isDesktopUpdateVersion(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

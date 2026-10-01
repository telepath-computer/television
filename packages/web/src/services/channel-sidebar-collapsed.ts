/** Browser-local persistence for the channel-sidebar collapsed state. */

export const CHANNEL_SIDEBAR_COLLAPSED_STORAGE_KEY =
  "tv-channel-sidebar-collapsed";

/** Owns the standalone local-storage record for whether the sidebar is closed. */
export class ChannelSidebarCollapsedPreference {
  readonly #storage: Storage;

  constructor(storage: Storage) {
    this.#storage = storage;
  }

  read(): boolean {
    return this.#storage.getItem(CHANNEL_SIDEBAR_COLLAPSED_STORAGE_KEY) ===
      "true";
  }

  setCollapsed(collapsed: boolean): void {
    try {
      if (collapsed) {
        this.#storage.setItem(CHANNEL_SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
      } else {
        this.#storage.removeItem(CHANNEL_SIDEBAR_COLLAPSED_STORAGE_KEY);
      }
    } catch {
      // The live state still changes when browser persistence is denied.
    }
  }
}

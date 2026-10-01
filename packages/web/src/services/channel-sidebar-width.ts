/** Browser-local persistence for the application channel-sidebar width. */

export const CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY = "tv-channel-sidebar-width";

// Restated from specs/ui/app/measures.yml#sidebar. The client, rather than a
// stylesheet fallback, owns the current value of --sidebar-width.
export const CHANNEL_SIDEBAR_MIN_WIDTH_PX = 160;
export const CHANNEL_SIDEBAR_MAX_WIDTH_PX = 350;
export const CHANNEL_SIDEBAR_DEFAULT_WIDTH_PX = 260;

const baseTenInteger = /^-?\d+$/;

/** Owns the standalone local-storage record for the committed sidebar width. */
export class ChannelSidebarWidthPreference {
  readonly #storage: Storage;

  constructor(storage: Storage) {
    this.#storage = storage;
  }

  /** Read a valid committed width, or null when no committed width exists. */
  read(): number | null {
    const raw = this.#storage.getItem(CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw === null || !baseTenInteger.test(raw)) return null;

    const width = BigInt(raw);
    if (width < BigInt(CHANNEL_SIDEBAR_MIN_WIDTH_PX)) {
      return CHANNEL_SIDEBAR_MIN_WIDTH_PX;
    }
    if (width > BigInt(CHANNEL_SIDEBAR_MAX_WIDTH_PX)) {
      return CHANNEL_SIDEBAR_MAX_WIDTH_PX;
    }
    return Number(width);
  }

  /** Round, clamp, and attempt to persist a committed width. */
  commit(width: number): number {
    const committedWidth = clampSidebarWidth(Math.round(width));
    try {
      this.#storage.setItem(
        CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY,
        String(committedWidth),
      );
    } catch {
      // The live client value still commits when browser persistence is denied.
    }
    return committedWidth;
  }

  /** Clear the committed record without changing unrelated browser storage. */
  clear(): void {
    try {
      this.#storage.removeItem(CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY);
    } catch {
      // Clearing still restores the live default when persistence is denied.
    }
  }
}

/** Constrain a live or committed sidebar width to the product bounds. */
export function clampSidebarWidth(width: number): number {
  return Math.min(
    Math.max(width, CHANNEL_SIDEBAR_MIN_WIDTH_PX),
    CHANNEL_SIDEBAR_MAX_WIDTH_PX,
  );
}

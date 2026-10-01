import { describe, expect, test } from "vitest";
import { CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY } from "./channel-sidebar-width.ts";
import {
  CHANNEL_SIDEBAR_COLLAPSED_STORAGE_KEY,
  ChannelSidebarCollapsedPreference,
} from "./channel-sidebar-collapsed.ts";

class RecordingStorage implements Storage {
  readonly writes: Array<readonly [string, string]> = [];
  readonly removals: string[] = [];
  readonly #values = new Map<string, string>();

  throwOnWrite = false;
  throwOnRemove = false;

  constructor(entries: Readonly<Record<string, string>> = {}) {
    for (const [key, value] of Object.entries(entries)) this.#values.set(key, value);
  }

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.removals.push(key);
    if (this.throwOnRemove) throw new DOMException("denied", "SecurityError");
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.writes.push([key, value]);
    if (this.throwOnWrite) throw new DOMException("denied", "QuotaExceededError");
    this.#values.set(key, value);
  }
}

describe("channel-sidebar collapsed storage (^ui-t-sidebar-collapsed-storage)", () => {
  test("reads only the literal true value as collapsed", () => {
    for (const [raw, expected] of [
      [undefined, false],
      ["true", true],
      ["false", false],
      ["TRUE", false],
      ["1", false],
      ["", false],
    ] as const) {
      const storage = new RecordingStorage(
        raw === undefined ? {} : { [CHANNEL_SIDEBAR_COLLAPSED_STORAGE_KEY]: raw },
      );

      expect(new ChannelSidebarCollapsedPreference(storage).read(), String(raw))
        .toBe(expected);
    }
  });

  test("stores collapsed, removes open, and preserves the width record", () => {
    const storage = new RecordingStorage({
      [CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY]: "00260",
    });
    const preference = new ChannelSidebarCollapsedPreference(storage);

    preference.setCollapsed(true);
    expect(storage.writes).toEqual([
      [CHANNEL_SIDEBAR_COLLAPSED_STORAGE_KEY, "true"],
    ]);
    expect(storage.getItem(CHANNEL_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe("true");
    expect(storage.getItem(CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY)).toBe("00260");

    preference.setCollapsed(false);
    expect(storage.removals).toEqual([CHANNEL_SIDEBAR_COLLAPSED_STORAGE_KEY]);
    expect(storage.getItem(CHANNEL_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY)).toBe("00260");
  });

  test("silences failed collapsed-state writes and removals", () => {
    const storage = new RecordingStorage({
      [CHANNEL_SIDEBAR_COLLAPSED_STORAGE_KEY]: "true",
      [CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY]: "291",
    });
    const preference = new ChannelSidebarCollapsedPreference(storage);

    storage.throwOnWrite = true;
    expect(() => preference.setCollapsed(true)).not.toThrow();
    storage.throwOnRemove = true;
    expect(() => preference.setCollapsed(false)).not.toThrow();
    expect(storage.getItem(CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY)).toBe("291");
  });
});

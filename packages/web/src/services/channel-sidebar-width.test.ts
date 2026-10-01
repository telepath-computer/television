import { describe, expect, test } from "vitest";
import {
  CHANNEL_SIDEBAR_DEFAULT_WIDTH_PX,
  CHANNEL_SIDEBAR_MAX_WIDTH_PX,
  CHANNEL_SIDEBAR_MIN_WIDTH_PX,
  CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY,
  ChannelSidebarWidthPreference,
} from "./channel-sidebar-width.ts";

const IN_RANGE_WIDTH_PX = Math.floor(
  (CHANNEL_SIDEBAR_MIN_WIDTH_PX + CHANNEL_SIDEBAR_MAX_WIDTH_PX) / 2,
);

class RecordingStorage implements Storage {
  readonly reads: string[] = [];
  readonly writes: Array<readonly [string, string]> = [];
  readonly removals: string[] = [];
  readonly #values = new Map<string, string>();

  throwOnWrite = false;

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
    this.reads.push(key);
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.removals.push(key);
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.writes.push([key, value]);
    if (this.throwOnWrite) throw new DOMException("denied", "QuotaExceededError");
    this.#values.set(key, value);
  }
}

describe("channel-sidebar width storage (^ui-t-sidebar-width-storage)", () => {
  test("reads only base-10 integer strings and clamps stored widths", () => {
    const absent = new RecordingStorage();
    expect(new ChannelSidebarWidthPreference(absent).read()).toBeNull();
    expect(absent.reads).toEqual([CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY]);

    for (const [raw, expected] of [
      [String(IN_RANGE_WIDTH_PX), IN_RANGE_WIDTH_PX],
      ["-100", CHANNEL_SIDEBAR_MIN_WIDTH_PX],
      ["999", CHANNEL_SIDEBAR_MAX_WIDTH_PX],
    ] as const) {
      const storage = new RecordingStorage({
        [CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY]: raw,
      });
      expect(new ChannelSidebarWidthPreference(storage).read(), raw).toBe(expected);
    }

    for (const raw of ["", " 260", "260 ", "260px", "260.5", "0x104", "NaN"]) {
      const storage = new RecordingStorage({
        [CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY]: raw,
      });
      expect(new ChannelSidebarWidthPreference(storage).read(), raw).toBeNull();
    }
  });

  test("rounds and clamps commits into the standalone key as decimal strings", () => {
    const storage = new RecordingStorage();
    const preference = new ChannelSidebarWidthPreference(storage);

    expect(preference.commit(IN_RANGE_WIDTH_PX + 1 / 10)).toBe(IN_RANGE_WIDTH_PX);
    expect(preference.commit(IN_RANGE_WIDTH_PX + 1 - 1 / 10)).toBe(
      IN_RANGE_WIDTH_PX + 1,
    );
    expect(preference.commit(CHANNEL_SIDEBAR_MIN_WIDTH_PX - 100)).toBe(
      CHANNEL_SIDEBAR_MIN_WIDTH_PX,
    );
    expect(preference.commit(CHANNEL_SIDEBAR_MAX_WIDTH_PX + 100)).toBe(
      CHANNEL_SIDEBAR_MAX_WIDTH_PX,
    );
    expect(storage.writes).toEqual([
      [CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY, String(IN_RANGE_WIDTH_PX)],
      [CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY, String(IN_RANGE_WIDTH_PX + 1)],
      [CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY, String(CHANNEL_SIDEBAR_MIN_WIDTH_PX)],
      [CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY, String(CHANNEL_SIDEBAR_MAX_WIDTH_PX)],
    ]);
  });

  test("silences failed writes without leaving a persisted result", () => {
    const storage = new RecordingStorage();
    storage.throwOnWrite = true;
    const preference = new ChannelSidebarWidthPreference(storage);

    expect(() => preference.commit(CHANNEL_SIDEBAR_DEFAULT_WIDTH_PX + 10)).not.toThrow();
    expect(storage.getItem(CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();
  });

  test("clears only the channel-sidebar width key", () => {
    const storage = new RecordingStorage({
      [CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY]: "300",
      unrelated: "kept",
    });
    const preference = new ChannelSidebarWidthPreference(storage);

    preference.clear();

    expect(storage.removals).toEqual([CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY]);
    expect(storage.getItem(CHANNEL_SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();
    expect(storage.getItem("unrelated")).toBe("kept");
  });
});

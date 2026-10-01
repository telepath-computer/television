import { describe, expect, it, vi } from "vitest";
import {
  LocalStore,
  clearAuthToken,
  getAuthToken,
  setAuthToken,
  type LocalState,
  type StorageLike,
} from "../src/store.ts";

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const backing = new Map(Object.entries(initial));
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => {
      backing.set(key, value);
    },
  };
}

function createInitialState(): LocalState {
  return { authTokens: {} };
}

describe("LocalStore", () => {
  it("get() returns the initial token state when storage is empty", () => {
    const store = new LocalStore("television-test", createInitialState(), {
      storage: createMemoryStorage(),
    });

    expect(store.get()).toEqual({ authTokens: {} });
  });

  it.each([
    {
      spelling: "screen",
      retired: {
        servers: [{ url: "http://retired.example", name: "Retired" }],
        activeServerURL: "http://retired.example",
        activeScreenID: "screen-local",
        tabs: { "http://example.com": ["screen-local"] },
        screens: { "screen-local": { scrollPosition: 42, lastActivatedAt: 1234 } },
        promotedOnboardingScreens: { "http://example.com": ["tv-guide"] },
      },
    },
    {
      spelling: "channel",
      retired: {
        servers: [{ url: "http://retired.example", name: "Retired" }],
        activeServerURL: "http://retired.example",
        activeChannelID: "channel-local",
        tabs: { "http://example.com": ["channel-local"] },
        channels: { "channel-local": { scrollPosition: 7, lastActivatedAt: 5678 } },
        promotedOnboardingChannels: { "http://example.com": ["calendar"] },
      },
    },
  ])("reads only normalized auth tokens from a pre-redesign $spelling record", ({ retired }) => {
    const persisted = {
      ...retired,
      authTokens: { "http://example.com/some/path": "secret" },
    };
    const store = new LocalStore("television-test", createInitialState(), {
      storage: createMemoryStorage({
        "store-television-test": JSON.stringify(persisted),
      }),
    });

    expect(store.get()).toEqual({ authTokens: { "http://example.com": "secret" } });
  });

  it("constructor writes the initial state to storage when empty", () => {
    const storage = createMemoryStorage();
    const setItem = vi.spyOn(storage, "setItem");
    new LocalStore("television-test", createInitialState(), { storage });

    expect(setItem).toHaveBeenCalledWith(
      "store-television-test",
      JSON.stringify(createInitialState()),
    );
  });

  it("constructor does not overwrite an existing record", () => {
    const persisted = {
      activeScreenID: "retired",
      authTokens: { "http://example.com": "secret" },
    };
    const bytes = JSON.stringify(persisted);
    const storage = createMemoryStorage({ "store-television-test": bytes });
    const setItem = vi.spyOn(storage, "setItem");

    new LocalStore("television-test", createInitialState(), { storage });

    expect(setItem).not.toHaveBeenCalled();
    expect(storage.getItem("store-television-test")).toBe(bytes);
  });

  it("set() persists token state and dispatches one change event", () => {
    const storage = createMemoryStorage();
    const store = new LocalStore("television-test", createInitialState(), { storage });
    const listener = vi.fn();
    store.addEventListener("change", listener);

    const next = { authTokens: { "http://example.com": "secret" } };
    store.set(next);

    expect(store.get()).toEqual(next);
    expect(storage.getItem("store-television-test")).toEqual(JSON.stringify(next));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("set() allows listeners to read the new token state via get()", () => {
    const store = new LocalStore("television-test", createInitialState(), {
      storage: createMemoryStorage(),
    });
    const seen: LocalState[] = [];
    store.addEventListener("change", () => seen.push(store.get()));

    store.set({ authTokens: { "http://example.com": "secret" } });

    expect(seen).toEqual([{ authTokens: { "http://example.com": "secret" } }]);
  });

  it("stores, reads, and clears auth tokens per normalized server origin", () => {
    const withToken = setAuthToken(
      createInitialState(),
      "http://example.com/path?x=1",
      "secret",
    );

    expect(getAuthToken(withToken, "http://example.com")).toBe("secret");
    expect(getAuthToken(withToken, "http://other.example")).toBeNull();
    expect(clearAuthToken(withToken, "http://example.com/path")).toEqual({ authTokens: {} });
  });

  it("throws if no storage adapter is supplied without localStorage", () => {
    const original = (globalThis as { localStorage?: unknown }).localStorage;
    try {
      delete (globalThis as { localStorage?: unknown }).localStorage;
      expect(() => new LocalStore("television-test", createInitialState())).toThrow();
    } finally {
      if (original !== undefined) {
        (globalThis as { localStorage?: unknown }).localStorage = original;
      }
    }
  });
});

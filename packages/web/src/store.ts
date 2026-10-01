import { EventTarget } from "@rupertsworld/event-target";
import { ChangeEvent } from "@telepath-computer/television-shared";

const STORAGE_KEY_PREFIX = "store-";

export interface LocalState {
  authTokens: Record<string, string>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LocalStoreOptions {
  storage?: StorageLike;
}

export function normalizeServerURL(url: string): string {
  return new URL(url).origin;
}

export function createDefaultLocalState(): LocalState {
  return { authTokens: {} };
}

/**
 * Browser-local persistent application state backed by `localStorage`.
 *
 * Authentication tokens are the only persisted application state. Existing
 * records may contain retired fields; reads ignore those fields rather than
 * translating them into another browser-local model.
 */
export class LocalStore extends EventTarget<ChangeEvent> {
  readonly #key: string;
  readonly #storage: StorageLike;
  #state: LocalState;

  constructor(id: string, initialState: LocalState, options: LocalStoreOptions = {}) {
    super();
    this.#key = `${STORAGE_KEY_PREFIX}${id}`;
    this.#storage = options.storage ?? resolveDefaultStorage();

    const raw = this.#storage.getItem(this.#key);
    if (raw === null) {
      this.#state = initialState;
      this.#storage.setItem(this.#key, JSON.stringify(initialState));
    } else {
      this.#state = normalizeLocalState(JSON.parse(raw), initialState);
    }
  }

  get(): LocalState {
    return this.#state;
  }

  set(nextState: LocalState): void {
    this.#state = nextState;
    this.#storage.setItem(this.#key, JSON.stringify(nextState));
    this.dispatchEvent(new ChangeEvent("change"));
  }
}

export function getAuthToken(state: LocalState, serverURL: string): string | null {
  return state.authTokens[normalizeServerURL(serverURL)] ?? null;
}

export function setAuthToken(state: LocalState, serverURL: string, token: string): LocalState {
  return {
    authTokens: {
      ...state.authTokens,
      [normalizeServerURL(serverURL)]: token,
    },
  };
}

export function clearAuthToken(state: LocalState, serverURL: string): LocalState {
  const normalizedURL = normalizeServerURL(serverURL);
  if (!(normalizedURL in state.authTokens)) return state;
  const authTokens = { ...state.authTokens };
  delete authTokens[normalizedURL];
  return { authTokens };
}

function resolveDefaultStorage(): StorageLike {
  const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
  if (!storage) {
    throw new Error(
      "LocalStore: no storage adapter supplied and window.localStorage is unavailable",
    );
  }
  return storage;
}

function normalizeLocalState(raw: unknown, fallback: LocalState): LocalState {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fallback;
  }

  const rawTokens = (raw as Record<string, unknown>).authTokens;
  if (typeof rawTokens !== "object" || rawTokens === null || Array.isArray(rawTokens)) {
    return fallback;
  }

  const authTokens: Record<string, string> = {};
  for (const [url, token] of Object.entries(rawTokens)) {
    if (typeof token !== "string") continue;
    try {
      authTokens[normalizeServerURL(url)] = token;
    } catch {
      // Ignore malformed token entries rather than blocking browser boot.
    }
  }
  return { authTokens };
}

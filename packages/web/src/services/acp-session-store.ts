import { ulid } from "ulid";
import type { ACPMappedSessionStore } from "./acp-client.ts";

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const CLIENT_GUID_STORAGE_KEY = "television.acpClientGUID";
export const MAPPED_SESSION_STORAGE_KEY = "television.acpMappedSessions";

const MAPPED_SESSION_STORAGE_VERSION = 1;

interface MappedSessionStorageEnvelope {
  version: number;
  entries: Record<string, string>;
}

export class MemoryMappedSessionStore implements ACPMappedSessionStore {
  readonly #entries = new Map<string, string>();

  getActualSessionId(logicalSessionKey: string): string | null {
    return this.#entries.get(logicalSessionKey) ?? null;
  }

  setActualSessionId(logicalSessionKey: string, actualSessionId: string): void {
    this.#entries.set(logicalSessionKey, actualSessionId);
  }

  clearActualSessionId(logicalSessionKey: string): void {
    this.#entries.delete(logicalSessionKey);
  }
}

// Scoping: localStorage is per-origin, not per-user. A future multi-user mode
// would need per-user scoping in the storage key (e.g. by clientGUID) so two
// users sharing a browser profile don't see each other's sessions.
export class StorageMappedSessionStore implements ACPMappedSessionStore {
  readonly #storage: StorageLike;
  readonly #serverURL: string;

  constructor(storage: StorageLike, serverURL: string) {
    this.#storage = storage;
    this.#serverURL = serverURL;
  }

  getActualSessionId(logicalSessionKey: string): string | null {
    const value = this.#readEntries()[this.#key(logicalSessionKey)];
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  setActualSessionId(logicalSessionKey: string, actualSessionId: string): void {
    const entries = this.#readEntries();
    entries[this.#key(logicalSessionKey)] = actualSessionId;
    this.#writeEntries(entries);
  }

  clearActualSessionId(logicalSessionKey: string): void {
    const entries = this.#readEntries();
    delete entries[this.#key(logicalSessionKey)];
    this.#writeEntries(entries);
  }

  // Compose the lookup key as a JSON-encoded tuple so neither component can
  // collide with the other through a separator character.
  #key(logicalSessionKey: string): string {
    return JSON.stringify([this.#serverURL, logicalSessionKey]);
  }

  #readEntries(): Record<string, string> {
    const raw = this.#storage.getItem(MAPPED_SESSION_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const envelope = parsed as Partial<MappedSessionStorageEnvelope>;
    if (envelope.version !== MAPPED_SESSION_STORAGE_VERSION) {
      return {};
    }
    if (typeof envelope.entries !== "object" || envelope.entries === null || Array.isArray(envelope.entries)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(envelope.entries).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  }

  #writeEntries(entries: Record<string, string>): void {
    const envelope: MappedSessionStorageEnvelope = {
      version: MAPPED_SESSION_STORAGE_VERSION,
      entries,
    };
    this.#storage.setItem(MAPPED_SESSION_STORAGE_KEY, JSON.stringify(envelope));
  }
}

export function getBrowserLocalStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function loadClientGUID(storage: StorageLike): string {
  const existing = storage.getItem(CLIENT_GUID_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const next = ulid().toLowerCase();
  storage.setItem(CLIENT_GUID_STORAGE_KEY, next);
  return next;
}

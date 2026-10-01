import { EventTarget } from "@rupertsworld/event-target";
import { ChangeEvent } from "@telepath-computer/television-shared";

export interface ArtifactNavigationEntry {
  url: string;
}

export interface ArtifactNavigationRecord {
  v: 1;
  entries: ArtifactNavigationEntry[];
  cursor: number;
  lastWritten: number;
}

export const artifactNavigationStorageKeyPrefix = "tv-nav:";
export const PROXY_RELOAD_PARAM = "tv-reload";
const maxEntries = 100;
const millisecondsPerSecond = 1000;
const secondsPerMinute = 60;
const minutesPerHour = 60;
const hoursPerDay = 24;
const staleHistoryAgeDays = 30;
const staleHistoryAgeMs = staleHistoryAgeDays * hoursPerDay * minutesPerHour * secondsPerMinute * millisecondsPerSecond;

export function convertURL(url: string): string {
  try {
    const parsed = new URL(url, window.location.href);
    const hadProxyReloadParam = parsed.searchParams.has(PROXY_RELOAD_PARAM);
    parsed.searchParams.delete(PROXY_RELOAD_PARAM);
    if (parsed.origin === window.location.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return hadProxyReloadParam ? parsed.toString() : url;
  } catch {
    return url;
  }
}

export class ArtifactNavigationState extends EventTarget<ChangeEvent> {
  readonly #artifactId: string;
  readonly #canonicalURL: string;
  #entries: ArtifactNavigationEntry[] = [];
  #cursor = -1;
  #lastWritten = 0;

  constructor(artifactId: string, canonicalURL: string) {
    super();
    this.#artifactId = artifactId;
    this.#canonicalURL = convertURL(canonicalURL);
    this.#hydrate();
  }

  get currentURL(): string | null {
    if (this.#cursor === -1) return null;
    return this.#entries[this.#cursor]?.url ?? null;
  }

  get canGoBack(): boolean {
    return this.#cursor > -1;
  }

  get canGoForward(): boolean {
    return this.#cursor < this.#entries.length - 1;
  }

  get entries(): readonly ArtifactNavigationEntry[] {
    return this.#entries.map((entry) => ({ ...entry }));
  }

  get cursor(): number {
    return this.#cursor;
  }

  navigate(url: string): void {
    const nextURL = convertURL(url);
    if (nextURL === this.#canonicalURL) {
      if (this.#cursor === -1) return;
      this.#cursor = -1;
      this.#commit();
      return;
    }

    if (this.#cursor < this.#entries.length - 1) {
      this.#entries = this.#entries.slice(0, this.#cursor + 1);
    }
    this.#entries.push({ url: nextURL });
    this.#cursor = this.#entries.length - 1;
    this.#trimToCap();
    this.#commit();
  }

  replace(url: string): void {
    if (this.#cursor === -1) {
      this.navigate(url);
      return;
    }

    const nextURL = convertURL(url);
    if (nextURL === this.#canonicalURL) {
      this.#entries = this.#entries.filter((_entry, index) => index !== this.#cursor);
      this.#cursor = -1;
      this.#commit();
      return;
    }

    if (this.#entries[this.#cursor]?.url === nextURL) return;
    this.#entries = this.#entries.map((entry, index) =>
      index === this.#cursor ? { url: nextURL } : entry,
    );
    this.#commit();
  }

  back(): void {
    if (this.#cursor === -1) return;
    this.#cursor -= 1;
    this.#commit();
  }

  forward(): void {
    if (!this.canGoForward) return;
    this.#cursor += 1;
    this.#commit();
  }

  reset(): void {
    if (this.#cursor === -1 && this.#entries.length === 0) return;
    this.#entries = [];
    this.#cursor = -1;
    this.#commit();
  }

  #hydrate(): void {
    const raw = localStorage.getItem(this.#storageKey);
    if (raw === null) return;

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isNavigationRecord(parsed)) return;
      this.#entries = parsed.entries.map((entry) => ({ url: entry.url }));
      this.#cursor = parsed.cursor;
      this.#lastWritten = parsed.lastWritten;
      this.#trimToCap();
    } catch {
      this.#entries = [];
      this.#cursor = -1;
      this.#lastWritten = 0;
    }
  }

  #commit(): void {
    this.#lastWritten = Date.now();
    try {
      localStorage.setItem(this.#storageKey, JSON.stringify(this.#record()));
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error;
    }
    this.dispatchEvent(new ChangeEvent("change"));
  }

  #record(): ArtifactNavigationRecord {
    return {
      v: 1,
      entries: this.#entries.map((entry) => ({ ...entry })),
      cursor: this.#cursor,
      lastWritten: this.#lastWritten,
    };
  }

  #trimToCap(): void {
    if (this.#entries.length <= maxEntries) return;
    const trimCount = this.#entries.length - maxEntries;
    this.#entries = this.#entries.slice(trimCount);
    this.#cursor = Math.max(-1, this.#cursor - trimCount);
  }

  get #storageKey(): string {
    return artifactNavigationStorageKey(this.#artifactId);
  }
}

export function artifactNavigationStorageKey(artifactId: string): string {
  return `${artifactNavigationStorageKeyPrefix}${artifactId}`;
}

export function pruneStaleNavigationHistory(artifactIds: Set<string>): void {
  const cutoff = Date.now() - staleHistoryAgeMs;
  const keysToDelete: string[] = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(artifactNavigationStorageKeyPrefix)) continue;

    const artifactId = key.slice(artifactNavigationStorageKeyPrefix.length);
    const raw = localStorage.getItem(key);
    if (raw === null) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      keysToDelete.push(key);
      continue;
    }

    if (!isNavigationRecord(parsed)) {
      keysToDelete.push(key);
      continue;
    }

    if (!artifactIds.has(artifactId) && parsed.lastWritten < cutoff) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    localStorage.removeItem(key);
  }
}

function isQuotaExceededError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

function isNavigationRecord(value: unknown): value is ArtifactNavigationRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ArtifactNavigationRecord>;
  if (candidate.v !== 1) return false;
  if (!Array.isArray(candidate.entries)) return false;
  const cursor = candidate.cursor;
  if (typeof cursor !== "number" || !Number.isInteger(cursor)) return false;
  if (typeof candidate.lastWritten !== "number" || !Number.isFinite(candidate.lastWritten)) {
    return false;
  }
  if (cursor < -1 || cursor >= candidate.entries.length) {
    return false;
  }
  return candidate.entries.every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Partial<ArtifactNavigationEntry>).url === "string",
  );
}

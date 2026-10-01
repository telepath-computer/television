import { DEV_VERSION, isNewerVersion, isReleaseVersion, type UpdateState } from "@telepath-computer/television-shared";

// The update channel (specs/arch/updates/update-channel.md): document shape
// validation (^channel-validation — silent-failure plumbing, not a security
// layer), the UpdateState derivation (^relay, ^relay-split), and the polling
// loop (^poll-schedule, ^poll-cache-bust, ^poll-silent-failure) with its
// dev-version gating (^dev-version-no-poll) and the TV_UPDATE_CHANNEL_URL /
// TV_UPDATE_CHANNEL_POLL_INTERVAL_MS hooks (^hook-channel-url,
// ^hook-url-implies-polling, ^hook-poll-interval). Gating reads exactly the
// own version and the URL override; the ~/.tv-developer marker suppresses
// production telemetry and is not an input here (^dev-marker-no-bypass).
// Validation stays pure and separate from polling; the poller holds its
// last-known-good document in memory only.

/** The production channel URL (product/update-notifications.md ^channel-url). */
export const PRODUCTION_UPDATE_CHANNEL_URL = "https://television.run/update-channel.json";

const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1_000;
const POLL_INTERVAL_MINUTES = 5;
/** The production polling cadence (^poll-schedule). Exported for tests. */
export const PRODUCTION_POLL_INTERVAL_MS = POLL_INTERVAL_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const JITTER_MAX_MINUTES = 1;
/** Exported for tests. */
export const POLL_JITTER_MAX_MS = JITTER_MAX_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const FETCH_TIMEOUT_MS = 10_000;

/** The published channel document — PUBLIC contract (^evolution-protocol). */
export interface UpdateChannelDocument {
  schemaVersion: number;
  version: string;
  toast: {
    markdown: string;
    prompt?: string;
    promptButtonLabel?: string;
  };
  desktop?: {
    upgradeMarkdown: string;
  };
}

/**
 * Validate a fetched channel document (^channel-validation): a typo'd manual
 * deploy must degrade to "no update", never push a broken payload. Returns
 * the NORMALIZED document — known fields only; unknown fields anywhere are
 * ignored, never rejected, and a higher schemaVersion is read, not refused
 * (^evolution-no-gate).
 */
export function parseUpdateChannelDocument(value: unknown): UpdateChannelDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.schemaVersion !== "number" || !Number.isInteger(record.schemaVersion) || record.schemaVersion < 1) return null;
  if (typeof record.version !== "string" || !isReleaseVersion(record.version)) return null;

  const toast = record.toast;
  if (!toast || typeof toast !== "object" || Array.isArray(toast)) return null;
  const toastRecord = toast as Record<string, unknown>;
  if (typeof toastRecord.markdown !== "string" || toastRecord.markdown.length === 0) return null;
  if (toastRecord.prompt !== undefined && typeof toastRecord.prompt !== "string") return null;
  if (toastRecord.promptButtonLabel !== undefined && typeof toastRecord.promptButtonLabel !== "string") return null;

  let desktop: UpdateChannelDocument["desktop"];
  if (record.desktop !== undefined) {
    if (!record.desktop || typeof record.desktop !== "object" || Array.isArray(record.desktop)) return null;
    const desktopRecord = record.desktop as Record<string, unknown>;
    if (typeof desktopRecord.upgradeMarkdown !== "string" || desktopRecord.upgradeMarkdown.length === 0) return null;
    desktop = { upgradeMarkdown: desktopRecord.upgradeMarkdown };
  }

  return {
    schemaVersion: record.schemaVersion,
    version: record.version,
    toast: {
      markdown: toastRecord.markdown,
      ...(toastRecord.prompt === undefined ? {} : { prompt: toastRecord.prompt }),
      ...(toastRecord.promptButtonLabel === undefined ? {} : { promptButtonLabel: toastRecord.promptButtonLabel }),
    },
    ...(desktop === undefined ? {} : { desktop }),
  };
}

/**
 * Derive the `update` field of server-status from the last-known-good
 * document (^relay). The toast half is decision-bearing — populated iff the
 * channel version is strictly newer than the server's, numeric-triple
 * comparison server-side so every client gets the same answer; the desktop
 * half is content only, relayed verbatim whenever present (^relay-split).
 */
export function deriveUpdateState(document: UpdateChannelDocument | null, serverVersion: string): UpdateState | null {
  if (document === null) return null;
  return {
    toast: isNewerVersion(document.version, serverVersion)
      ? {
          version: document.version,
          markdown: document.toast.markdown,
          ...(document.toast.prompt === undefined ? {} : { prompt: document.toast.prompt }),
          ...(document.toast.promptButtonLabel === undefined ? {} : { promptButtonLabel: document.toast.promptButtonLabel }),
        }
      : null,
    desktop: document.desktop === undefined ? null : { upgradeMarkdown: document.desktop.upgradeMarkdown },
  };
}

/** Minimal structural fetch — satisfied by global fetch; mocks stay simple. */
export type UpdateChannelFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface UpdateChannelPollerOptions {
  /** The server's own update-domain release version (stamp-only resolution). */
  serverVersion: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: UpdateChannelFetch;
  setTimeoutImpl?: (callback: () => void, delayMs: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
  random?: () => number;
  nowSeconds?: () => number;
  /** Fired whenever a poll adopts a different valid document (^relay). */
  onStateChange?: () => void;
}

export interface UpdateChannelPoller {
  /** Begin polling (boot fetch + schedule). A no-op when polling is gated off. */
  start(): void;
  /** Stop the timer and abort any in-flight fetch. Idempotent. */
  stop(): void;
  /** Current update state derived from the in-memory last-known-good document. */
  getState(): UpdateState | null;
}

export function createUpdateChannelPoller(options: UpdateChannelPollerOptions): UpdateChannelPoller {
  const env = options.env ?? process.env;
  const fetchImpl: UpdateChannelFetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const setTimeoutImpl = options.setTimeoutImpl ?? ((callback: () => void, delayMs: number): unknown => setTimeout(callback, delayMs));
  const clearTimeoutImpl = options.clearTimeoutImpl ?? ((handle: unknown): void => clearTimeout(handle as NodeJS.Timeout));
  const random = options.random ?? Math.random;
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / MILLISECONDS_PER_SECOND));

  const urlOverride = env.TV_UPDATE_CHANNEL_URL;
  const hasURLOverride = typeof urlOverride === "string" && urlOverride.length > 0;
  // An explicit URL is a deliberate request to poll — it supersedes the
  // 0.0.0 dev-version suppression (^hook-url-implies-polling).
  const pollingEnabled = hasURLOverride || options.serverVersion !== DEV_VERSION;
  const channelURL = hasURLOverride ? urlOverride : PRODUCTION_UPDATE_CHANNEL_URL;
  // The interval hook is honored only with the URL override — a fast cadence
  // against the production CDN would be hostile by accident (^hook-poll-interval).
  const intervalOverrideMs = hasURLOverride ? parseIntervalOverride(env.TV_UPDATE_CHANNEL_POLL_INTERVAL_MS) : null;

  let stopped = false;
  let started = false;
  let timer: unknown = null;
  let inFlight: AbortController | null = null;
  let lastKnownGood: UpdateChannelDocument | null = null;
  let lastKnownGoodKey: string | null = null;

  function cacheBustedURL(): string {
    const url = new URL(channelURL);
    url.searchParams.set("t", String(nowSeconds()));
    return url.toString();
  }

  function nextDelayMs(): number {
    if (intervalOverrideMs !== null) return intervalOverrideMs;
    return PRODUCTION_POLL_INTERVAL_MS + Math.floor(random() * POLL_JITTER_MAX_MS);
  }

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeoutImpl(() => {
      timer = null;
      void pollOnce();
    }, nextDelayMs());
  }

  function adopt(document: UpdateChannelDocument): void {
    const key = JSON.stringify(document);
    if (key === lastKnownGoodKey) return;
    lastKnownGood = document;
    lastKnownGoodKey = key;
    options.onStateChange?.();
  }

  async function pollOnce(): Promise<void> {
    const controller = new AbortController();
    inFlight = controller;
    const timeoutHandle = setTimeoutImpl(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(cacheBustedURL(), {
        headers: { "cache-control": "no-cache" },
        signal: controller.signal,
      });
      if (response.ok) {
        const document = parseUpdateChannelDocument(await response.json());
        if (document !== null) adopt(document);
      }
    } catch {
      // Silent by contract (^poll-silent-failure): the site being down is
      // never an error; last-known-good (or "no update") continues to apply.
    } finally {
      clearTimeoutImpl(timeoutHandle);
      inFlight = null;
      scheduleNext();
    }
  }

  return {
    start(): void {
      if (started || stopped || !pollingEnabled) return;
      started = true;
      void pollOnce();
    },
    stop(): void {
      stopped = true;
      if (timer !== null) {
        clearTimeoutImpl(timer);
        timer = null;
      }
      inFlight?.abort();
    },
    getState(): UpdateState | null {
      return deriveUpdateState(lastKnownGood, options.serverVersion);
    },
  };
}

function parseIntervalOverride(value: string | undefined): number | null {
  if (value === undefined || value.length === 0) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

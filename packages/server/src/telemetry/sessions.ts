import { randomBytes } from "node:crypto";

const IDLE_TIMEOUT_MINUTES = 30;
const MAX_SESSION_HOURS = 24;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MILLISECONDS_PER_SECOND = 1_000;

export const SESSION_IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
export const MAX_SESSION_DURATION_MS = MAX_SESSION_HOURS * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP_HEX_LENGTH = 12;
const BYTE_HEX_RADIX = 16;
const UUID_BYTE_COUNT = 16;
const UUID_VERSION_BYTE_INDEX = 6;
const UUID_VARIANT_BYTE_INDEX = 8;
const UUID_TIMESTAMP_LAST_BYTE_INDEX = 5;
const UUID_VERSION_7_HIGH_BITS = 0x70;
const UUID_VARIANT_RFC_9562_HIGH_BITS = 0x80;
const UUID_VERSION_LOW_MASK = 0x0f;
const UUID_VARIANT_LOW_MASK = 0x3f;
const BYTE_MASK = 0xff;
const BYTE_SHIFT = 8;
const UUID_GROUP_ONE_END = 8;
const UUID_GROUP_TWO_END = 12;
const UUID_GROUP_THREE_END = 16;
const UUID_GROUP_FOUR_END = 20;

export interface ClientSession {
  readonly clientId: string;
  readonly sessionId: string;
  readonly sessionStartMs: number;
  readonly lastActivityMs: number;
}

export interface TelemetrySessionManager {
  sessionIdFor(clientId: string | null, nowMs: number): string | null;
  get(clientId: string): ClientSession | null;
}

export function createTelemetrySessionManager(): TelemetrySessionManager {
  return new InMemoryTelemetrySessionManager();
}

export function isUUIDv7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

export function getUUIDv7TimestampMs(sessionId: string): number {
  if (!isUUIDv7(sessionId)) throw new Error(`Invalid UUIDv7: ${sessionId}`);
  return Number.parseInt(sessionId.replace(/-/g, "").slice(0, TIMESTAMP_HEX_LENGTH), BYTE_HEX_RADIX);
}

export function createUUIDv7(timestampMs: number): string {
  const bytes = randomBytes(UUID_BYTE_COUNT);
  writeTimestamp(bytes, timestampMs);
  bytes[UUID_VERSION_BYTE_INDEX] = UUID_VERSION_7_HIGH_BITS | (bytes[UUID_VERSION_BYTE_INDEX]! & UUID_VERSION_LOW_MASK);
  bytes[UUID_VARIANT_BYTE_INDEX] = UUID_VARIANT_RFC_9562_HIGH_BITS | (bytes[UUID_VARIANT_BYTE_INDEX]! & UUID_VARIANT_LOW_MASK);
  return formatUUID(bytes);
}

class InMemoryTelemetrySessionManager implements TelemetrySessionManager {
  readonly #sessions = new Map<string, ClientSession>();

  sessionIdFor(clientId: string | null, nowMs: number): string | null {
    if (!clientId) return null;

    const existing = this.#sessions.get(clientId);
    if (!existing || shouldRotate(existing, nowMs)) {
      const next = mintSession(clientId, nowMs);
      this.#sessions.set(clientId, next);
      return next.sessionId;
    }

    const updated = { ...existing, lastActivityMs: nowMs };
    this.#sessions.set(clientId, updated);
    return existing.sessionId;
  }

  get(clientId: string): ClientSession | null {
    return this.#sessions.get(clientId) ?? null;
  }
}

function mintSession(clientId: string, nowMs: number): ClientSession {
  return {
    clientId,
    sessionId: createUUIDv7(nowMs),
    sessionStartMs: nowMs,
    lastActivityMs: nowMs,
  };
}

function shouldRotate(session: ClientSession, nowMs: number): boolean {
  return nowMs - session.lastActivityMs > SESSION_IDLE_TIMEOUT_MS || nowMs - session.sessionStartMs >= MAX_SESSION_DURATION_MS;
}

function writeTimestamp(bytes: Buffer, timestampMs: number): void {
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) throw new Error(`Invalid UUIDv7 timestamp: ${timestampMs}`);
  let remaining = timestampMs;
  for (let index = UUID_TIMESTAMP_LAST_BYTE_INDEX; index >= 0; index -= 1) {
    bytes[index] = remaining & BYTE_MASK;
    remaining = Math.floor(remaining / 2 ** BYTE_SHIFT);
  }
}

function formatUUID(bytes: Buffer): string {
  const hex = [...bytes].map((byte) => byte.toString(BYTE_HEX_RADIX).padStart(2, "0")).join("");
  const first = hex.slice(0, UUID_GROUP_ONE_END);
  const second = hex.slice(UUID_GROUP_ONE_END, UUID_GROUP_TWO_END);
  const third = hex.slice(UUID_GROUP_TWO_END, UUID_GROUP_THREE_END);
  const fourth = hex.slice(UUID_GROUP_THREE_END, UUID_GROUP_FOUR_END);
  const fifth = hex.slice(UUID_GROUP_FOUR_END);
  return `${first}-${second}-${third}-${fourth}-${fifth}`;
}

import { describe, expect, it } from "vitest";
import {
  MAX_SESSION_DURATION_MS,
  SESSION_IDLE_TIMEOUT_MS,
  createTelemetrySessionManager,
  getUUIDv7TimestampMs,
  isUUIDv7,
} from "./sessions.ts";

const START_MS = 1_783_123_456_789;
const CLIENT_ID = "client-a";
const OTHER_CLIENT_ID = "client-b";
const ONE_MINUTE_MS = 60_000;

// Covers ^t-mint-uuidv7, ^t-reuse, ^t-rotate-idle, ^t-rotate-24h, ^t-reconnect, ^t-gating.
describe("telemetry session manager", () => {
  it("mints a UUIDv7 session id whose embedded timestamp equals the first activity", () => {
    const sessions = createTelemetrySessionManager();

    const sessionId = sessions.sessionIdFor(CLIENT_ID, START_MS);

    expect(sessionId).not.toBeNull();
    expect(isUUIDv7(sessionId!)).toBe(true);
    expect(getUUIDv7TimestampMs(sessionId!)).toBe(START_MS);
  });

  it("reuses a client's session inside the idle threshold", () => {
    const sessions = createTelemetrySessionManager();

    const first = sessions.sessionIdFor(CLIENT_ID, START_MS);
    const second = sessions.sessionIdFor(CLIENT_ID, START_MS + SESSION_IDLE_TIMEOUT_MS);

    expect(second).toBe(first);
  });

  it("rotates after the idle threshold is exceeded", () => {
    const sessions = createTelemetrySessionManager();

    const first = sessions.sessionIdFor(CLIENT_ID, START_MS);
    const second = sessions.sessionIdFor(CLIENT_ID, START_MS + SESSION_IDLE_TIMEOUT_MS + 1);

    expect(second).not.toBe(first);
    expect(getUUIDv7TimestampMs(second!)).toBe(START_MS + SESSION_IDLE_TIMEOUT_MS + 1);
  });

  it("rotates before a session span reaches PostHog's 24h cap", () => {
    const sessions = createTelemetrySessionManager();

    const first = sessions.sessionIdFor(CLIENT_ID, START_MS);
    let current = first;
    for (let elapsed = ONE_MINUTE_MS; elapsed < MAX_SESSION_DURATION_MS; elapsed += ONE_MINUTE_MS) {
      current = sessions.sessionIdFor(CLIENT_ID, START_MS + elapsed);
      expect(current).toBe(first);
    }

    const capped = sessions.sessionIdFor(CLIENT_ID, START_MS + MAX_SESSION_DURATION_MS);
    expect(capped).not.toBe(first);
    expect(getUUIDv7TimestampMs(capped!)).toBe(START_MS + MAX_SESSION_DURATION_MS);
  });

  it("keeps the same client session across reconnect-shaped activity", () => {
    const sessions = createTelemetrySessionManager();

    const beforeDisconnect = sessions.sessionIdFor(CLIENT_ID, START_MS);
    sessions.sessionIdFor(OTHER_CLIENT_ID, START_MS + ONE_MINUTE_MS);
    const afterReconnect = sessions.sessionIdFor(CLIENT_ID, START_MS + ONE_MINUTE_MS * 2);

    expect(afterReconnect).toBe(beforeDisconnect);
  });

  it("returns null for session-less requests without a client id", () => {
    const sessions = createTelemetrySessionManager();

    expect(sessions.sessionIdFor(null, START_MS)).toBeNull();
    expect(sessions.sessionIdFor("", START_MS)).toBeNull();
  });
});

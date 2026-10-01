import { describe, expect, it } from "vitest";
import { buildTelemetryEvent, capture } from "./capture.ts";
import type { TelemetryState } from "./identity.ts";
import { telemetryVersion, type BuiltTelemetryEvent, type TelemetryEventProperties, type TelemetryVersion } from "./types.ts";

const activeState: TelemetryState = {
  schemaVersion: 1,
  userId: "telemetry-user-1",
  optedOut: false,
  lastVersion: "0.1.170",
};

const enabledEnv = { TV_TELEMETRY_TEST: "1" };

describe("telemetry capture chokepoint", () => {
  it("does not enqueue when the suppression gate is closed", () => {
    const enqueued: BuiltTelemetryEvent[] = [];

    capture(
      { name: "server_started", properties: { server_version: telemetryVersion("0.1.170") } },
      {
        state: { ...activeState, optedOut: true },
        env: enabledEnv,
        developerHost: false,
        sink: { enqueue: (event) => enqueued.push(event) },
      },
    );

    expect(enqueued).toEqual([]);
  });

  it("builds one stamped event and hands it to the sink when enabled", () => {
    const enqueued: BuiltTelemetryEvent[] = [];

    capture(
      {
        name: "server_started",
        properties: { server_version: telemetryVersion("0.1.170") },
        personProperties: { auth_mode: "auth" },
      },
      {
        state: activeState,
        env: enabledEnv,
        developerHost: false,
        sessionId: "session-1",
        sink: { enqueue: (event) => enqueued.push(event) },
      },
    );

    expect(enqueued).toEqual([
      {
        name: "server_started",
        distinctId: "telemetry-user-1",
        properties: {
          distinct_id: "telemetry-user-1",
          $session_id: "session-1",
          $set: { auth_mode: "auth" },
          server_version: "0.1.170",
        },
      },
    ]);
  });

  it("swallows sink failures", () => {
    expect(() => capture(
      { name: "server_started" },
      {
        state: activeState,
        env: enabledEnv,
        developerHost: false,
        sink: {
          enqueue: () => {
            throw new Error("posthog unavailable");
          },
        },
      },
    )).not.toThrow();
  });
});

// proofs/arch/telemetry/index.md#^t-version-payload
it("classifies every outbound version without changing local inputs", () => {
  type VersionKey = { [K in keyof TelemetryEventProperties]-?: NonNullable<TelemetryEventProperties[K]> extends TelemetryVersion ? K : never }[keyof TelemetryEventProperties];
  const versions = {
    server_version: telemetryVersion("1.2.3-alice+private"), old_version: telemetryVersion("alice@example.test"),
    new_version: telemetryVersion("2.3.4+host"), desktop_app_version: telemetryVersion("3.4.5-personal"),
    from_version: telemetryVersion("4.5.6-private"), to_version: telemetryVersion("5.6.7+private"),
    channel_version: telemetryVersion("6.7.8-private"), required_desktop_version: telemetryVersion("7.8.9+private"),
  } satisfies Record<VersionKey, TelemetryVersion>;
  const properties = { ...versions, browser_major_version: 123 };
  const before = JSON.stringify(properties);
  const built = buildTelemetryEvent({ name: "server_started", properties, personProperties: properties }, { state: activeState });
  const expected = { server_version: "1.2.3", old_version: "0.0.0", new_version: "2.3.4", desktop_app_version: "3.4.5",
    from_version: "4.5.6", to_version: "5.6.7", channel_version: "6.7.8", required_desktop_version: "7.8.9", browser_major_version: 123 };
  expect(built.properties).toEqual({ distinct_id: activeState.userId, ...expected, $set: expected });
  expect(JSON.stringify(properties)).toBe(before);
  expect(JSON.stringify(built)).not.toMatch(/alice|private|host|personal/);
});

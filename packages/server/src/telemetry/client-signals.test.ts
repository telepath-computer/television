import { describe, expect, it } from "vitest";
import { CLIENT_SIGNAL_REGISTRY, validateClientSignal } from "./client-signals.ts";

// Contract tests for the client telemetry signal validator
// (specs/arch/telemetry/client-signals.md ^t-signal-validation): pure logic
// over test-authored messages. Acceptance rules per ^signal-validation — a
// signal is accepted iff the type is the fixed signal type, the clientId
// equals the connection's, the event is in the registry, every present
// property key is declared for that event, and every present value matches
// its pattern; any declared key may be omitted. Everything else drops to
// null.
//
// Scope note (^signal-no-ugc): the validator is lightweight belt-and-
// suspenders over the call-site design policy — the real no-UGC protection is
// that tracking call sites carry no user content by design. These tests prove
// the mechanism works (including the own-key lookups, a real correctness
// bug); they deliberately do NOT sweep adversarial payloads, because we are
// not defending against hostile clients.

const CLIENT_ID = "client-signal-contract";

// One canonical valid property set per registry event; every value matches
// that property's closed registry pattern.
const VALID_PROPERTIES: Record<string, Record<string, string>> = {
  client_autoreloaded: { from_version: "1.2.3", to_version: "1.2.4" },
  update_toast_shown: { server_version: "1.2.3", channel_version: "1.2.4" },
  update_prompt_copy_clicked: { server_version: "1.2.3", channel_version: "1.2.4" },
  desktop_upgrade_gate_shown: { desktop_app_version: "1.2.3", required_desktop_version: "1.2.4" },
  artifact_skill_prompt_copy_clicked: { artifact_skill: "calendar" },
};

function signal(event: string, properties?: unknown, overrides: Record<string, unknown> = {}): unknown {
  return {
    type: "telemetry-signal",
    clientId: CLIENT_ID,
    event,
    ...(properties === undefined ? {} : { properties }),
    ...overrides,
  };
}

describe("client signal validation (^t-signal-validation)", () => {
  it("keeps the registry in lockstep with the spec's event/property table", () => {
    expect(
      Object.fromEntries(
        Object.entries(CLIENT_SIGNAL_REGISTRY).map(([event, patterns]) => [event, Object.keys(patterns).sort()]),
      ),
    ).toEqual({
      client_autoreloaded: ["from_version", "to_version"],
      update_toast_shown: ["channel_version", "server_version"],
      update_prompt_copy_clicked: ["channel_version", "server_version"],
      desktop_upgrade_gate_shown: ["desktop_app_version", "required_desktop_version"],
      artifact_skill_prompt_copy_clicked: ["artifact_skill"],
    });
  });

  it("accepts every registry event with its full declared, pattern-matching property set", () => {
    for (const [event, properties] of Object.entries(VALID_PROPERTIES)) {
      expect(validateClientSignal(signal(event, properties), CLIENT_ID), event).toEqual({
        name: event,
        properties,
      });
    }
  });

  it("accepts each event with any declared key omitted — omission is always allowed", () => {
    for (const [event, properties] of Object.entries(VALID_PROPERTIES)) {
      for (const omitted of Object.keys(properties)) {
        const partial = Object.fromEntries(Object.entries(properties).filter(([key]) => key !== omitted));
        expect(validateClientSignal(signal(event, partial), CLIENT_ID), `${event} without ${omitted}`).toEqual({
          name: event,
          properties: partial,
        });
      }
      expect(validateClientSignal(signal(event, {}), CLIENT_ID), `${event} with no properties`).toEqual({
        name: event,
        properties: {},
      });
    }
  });

  it("rejects prototype-chain member names posing as event names — the registry check must be own-keys only", () => {
    // A plain-object registry probed with `in` (or truthy indexing) also
    // matches Object.prototype members, letting an event OUTSIDE the closed
    // vocabulary (^signal-no-ugc) through with empty properties.
    for (const name of ["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__"]) {
      expect(validateClientSignal(signal(name, {}), CLIENT_ID), name).toBeNull();
      expect(validateClientSignal(signal(name), CLIENT_ID), `${name} without properties`).toBeNull();
    }
  });

  it("rejects prototype-chain member names posing as property keys, without throwing", () => {
    // Same trap one level down: patterns["toString"] resolves to
    // Function.prototype.toString — truthy, and .test() then throws inside
    // the socket message handler.
    for (const key of ["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__"]) {
      expect(
        validateClientSignal(signal("update_toast_shown", { [key]: "1.2.3" }), CLIENT_ID),
        key,
      ).toBeNull();
    }
    // The JSON.parse shape a real socket delivers ("__proto__" as an own key
    // of the parsed object) must be rejected the same way.
    const wire = JSON.parse(
      `{"type":"telemetry-signal","clientId":"${CLIENT_ID}","event":"update_toast_shown","properties":{"__proto__":"1.2.3"}}`,
    ) as unknown;
    expect(validateClientSignal(wire, CLIENT_ID)).toBeNull();
  });

  it("rejects an unknown event name even with plausible version properties", () => {
    expect(validateClientSignal(signal("server_started", { server_version: "1.2.3" }), CLIENT_ID)).toBeNull();
    expect(validateClientSignal(signal("session_activity", {}), CLIENT_ID)).toBeNull();
    expect(validateClientSignal(signal("not_an_event", {}), CLIENT_ID)).toBeNull();
  });

  it("rejects an undeclared property key on an otherwise valid signal", () => {
    for (const [event, properties] of Object.entries(VALID_PROPERTIES)) {
      expect(
        validateClientSignal(signal(event, { ...properties, extra_key: "1.2.3" }), CLIENT_ID),
        event,
      ).toBeNull();
      // A key declared for a DIFFERENT event is still undeclared here.
      const foreignKey = event === "client_autoreloaded" ? "channel_version" : "from_version";
      expect(
        validateClientSignal(signal(event, { ...properties, [foreignKey]: "1.2.3" }), CLIENT_ID),
        `${event} + ${foreignKey}`,
      ).toBeNull();
    }
  });

  it("rejects a clientId differing from the connection's", () => {
    const message = signal("update_toast_shown", VALID_PROPERTIES.update_toast_shown);
    expect(validateClientSignal(message, "someone-else")).toBeNull();
    expect(validateClientSignal(signal("update_toast_shown", {}, { clientId: 42 }), CLIENT_ID)).toBeNull();
    expect(validateClientSignal(signal("update_toast_shown", {}, { clientId: undefined }), CLIENT_ID)).toBeNull();
  });

  it("rejects a present value that fails its pattern — representative junk only", () => {
    // Mechanism check, not a hostile-client defense (^signal-no-ugc): a
    // couple of representative non-version values prove the pattern is
    // applied at all; exhaustive payload sweeps are out of scope by design.
    expect(
      validateClientSignal(signal("update_toast_shown", { server_version: "not a version", channel_version: "1.2.3" }), CLIENT_ID),
    ).toBeNull();
    expect(validateClientSignal(signal("client_autoreloaded", { from_version: "1.2.3-beta.1" }), CLIENT_ID)).toBeNull();
    expect(
      validateClientSignal(
        signal("artifact_skill_prompt_copy_clicked", { artifact_skill: "alice-private-skill" }),
        CLIENT_ID,
      ),
    ).toBeNull();
  });

  it("rejects non-string property values, including string-coercible ones", () => {
    const NON_STRING_INT: unknown = Number("123");
    const NON_STRING_FLOAT: unknown = Number("1.23");
    for (const value of [NON_STRING_INT, NON_STRING_FLOAT, true, null, undefined, { toString: () => "1.2.3" }, ["1.2.3"]]) {
      expect(
        validateClientSignal(signal("client_autoreloaded", { from_version: value }), CLIENT_ID),
        JSON.stringify(value),
      ).toBeNull();
    }
  });

  it("rejects malformed envelopes: wrong type, missing fields, non-object shapes", () => {
    expect(validateClientSignal(null, CLIENT_ID)).toBeNull();
    expect(validateClientSignal("telemetry-signal", CLIENT_ID)).toBeNull();
    expect(validateClientSignal(Math.PI, CLIENT_ID)).toBeNull();
    expect(validateClientSignal([], CLIENT_ID)).toBeNull();
    expect(validateClientSignal({}, CLIENT_ID)).toBeNull();
    expect(
      validateClientSignal(signal("update_toast_shown", {}, { type: "telemetry-activity" }), CLIENT_ID),
    ).toBeNull();
    expect(
      validateClientSignal(signal("update_toast_shown", {}, { type: "server-status" }), CLIENT_ID),
    ).toBeNull();
    expect(validateClientSignal({ clientId: CLIENT_ID, event: "update_toast_shown" }, CLIENT_ID)).toBeNull();
    // Non-object properties payloads.
    for (const properties of ["1.2.3", Math.PI, ["1.2.3"], null]) {
      expect(
        validateClientSignal(signal("update_toast_shown", properties), CLIENT_ID),
        JSON.stringify(properties),
      ).toBeNull();
    }
  });

  it("accepts a signal whose properties field is absent — carrying nothing is never UGC", () => {
    expect(validateClientSignal(signal("update_toast_shown"), CLIENT_ID)).toEqual({
      name: "update_toast_shown",
      properties: {},
    });
  });
});

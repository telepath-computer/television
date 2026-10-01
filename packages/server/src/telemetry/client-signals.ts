import { TELEMETRY_SIGNAL_MESSAGE_TYPE, type ClientSignalEventName } from "@telepath-computer/television-shared";
import type { TelemetryEvent, TelemetryEventProperties } from "./types.ts";

// POLICY NOTE (specs/arch/telemetry/client-signals.md ^signal-no-ugc): the
// load-bearing protection against user content in telemetry is that the
// tracking call sites are DESIGNED to carry none — a policy upheld by review,
// not by this code. The validation in this file is mostly-meaningless
// lightweight belt-and-suspenders on top of that policy; it is not a security
// layer and does not defend against hostile clients, and nothing here should
// be read as implying we need strong validation of untrusted client tracking
// behavior.
//
// Every registry value matches a closed pattern. A pattern that would admit
// free text is a vocabulary-guarantee change, not a routine addition.
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;
const ARTIFACT_SKILL = /^(calendar|table|tasks|markdown)$/;

/**
 * Per-event validation registry for client telemetry signals
 * (specs/arch/telemetry/client-signals.md ^one-envelope): the ALLOWED
 * property keys per event — each optional to the validator — with every
 * present value validated by pattern. Growing the registry is a vocabulary
 * change, reviewed as such (specs/arch/telemetry/index.md).
 */
export const CLIENT_SIGNAL_REGISTRY: Record<ClientSignalEventName, Record<string, RegExp>> = {
  client_autoreloaded: { from_version: RELEASE_VERSION, to_version: RELEASE_VERSION },
  update_toast_shown: { server_version: RELEASE_VERSION, channel_version: RELEASE_VERSION },
  update_prompt_copy_clicked: { server_version: RELEASE_VERSION, channel_version: RELEASE_VERSION },
  desktop_upgrade_gate_shown: { desktop_app_version: RELEASE_VERSION, required_desktop_version: RELEASE_VERSION },
  artifact_skill_prompt_copy_clicked: { artifact_skill: ARTIFACT_SKILL },
};

/**
 * Validate a parsed client→server message as a telemetry client signal
 * (^signal-validation): accepted iff the type is the fixed signal type, the
 * clientId equals the connection's, the event is in the registry, every
 * present property key is declared for that event, and every present value is
 * a string matching its key's pattern. Any declared key may be omitted —
 * omission never carries content. Anything else returns null; callers drop
 * silently, without response or logging noise.
 *
 * Per the policy note above: this is lightweight belt-and-suspenders over the
 * call-site design policy, not enforcement.
 *
 * Returns a chokepoint-ready event: the caller forwards it through
 * `capture()` and nowhere else (^signal-forwarding).
 */
export function validateClientSignal(message: unknown, expectedClientId: string): TelemetryEvent | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const record = message as Record<string, unknown>;
  if (record.type !== TELEMETRY_SIGNAL_MESSAGE_TYPE) return null;
  if (record.clientId !== expectedClientId) return null;
  // Own-key membership only: `in` (and bare indexing) would also match
  // Object.prototype members, admitting "toString" et al. as event names —
  // outside the closed vocabulary (^signal-no-ugc).
  if (typeof record.event !== "string" || !Object.hasOwn(CLIENT_SIGNAL_REGISTRY, record.event)) return null;
  const patterns = CLIENT_SIGNAL_REGISTRY[record.event as ClientSignalEventName];

  // An absent properties field carries nothing and is accepted as empty; a
  // present-but-non-object one (null included) is malformed and drops.
  const rawProperties = record.properties === undefined ? {} : record.properties;
  if (!rawProperties || typeof rawProperties !== "object" || Array.isArray(rawProperties)) return null;

  const properties: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawProperties as Record<string, unknown>)) {
    // Own-key lookup for the same reason as the registry check above:
    // patterns["toString"] would resolve to a prototype member, not a RegExp.
    if (!Object.hasOwn(patterns, key)) return null;
    const pattern = patterns[key]!;
    if (typeof value !== "string" || !pattern.test(value)) return null;
    properties[key] = value;
  }

  return {
    name: record.event as ClientSignalEventName,
    properties: properties as TelemetryEventProperties,
  };
}

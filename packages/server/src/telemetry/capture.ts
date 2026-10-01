import { telemetryEnabled, type TelemetryEnv, type TelemetryState } from "./identity.ts";
import { classifyTelemetryVersion } from "./derivation.ts";
import type { BuiltTelemetryEvent, TelemetryEvent, TelemetryEventProperties } from "./types.ts";

export interface TelemetryCaptureSink {
  enqueue(event: BuiltTelemetryEvent): void;
}

export interface CaptureContext {
  state: TelemetryState;
  env: TelemetryEnv;
  developerHost: boolean;
  sink: TelemetryCaptureSink;
  sessionId?: string | null;
}

export function capture(event: TelemetryEvent, context: CaptureContext): void {
  if (!telemetryEnabled(context.env, context.state, context.developerHost)) return;

  try {
    context.sink.enqueue(buildTelemetryEvent(event, context));
  } catch {
    // Telemetry must never crash or block the product path.
  }
}

export function buildTelemetryEvent(event: TelemetryEvent, context: Pick<CaptureContext, "state" | "sessionId">): BuiltTelemetryEvent {
  const properties: BuiltTelemetryEvent["properties"] = {
    distinct_id: context.state.userId,
    ...classifyVersions(event.properties),
  };

  if (context.sessionId) properties.$session_id = context.sessionId;
  if (event.personProperties && Object.keys(event.personProperties).length > 0) properties.$set = classifyVersions(event.personProperties);

  return {
    name: event.name,
    distinctId: context.state.userId,
    properties,
  };
}

function classifyVersions(properties: TelemetryEventProperties = {}): TelemetryEventProperties {
  const classified = { ...properties };
  for (const key of ["server_version", "old_version", "new_version", "desktop_app_version", "from_version", "to_version", "channel_version", "required_desktop_version"] as const) {
    const value = properties[key];
    if (value !== undefined) classified[key] = classifyTelemetryVersion(value);
  }
  return classified;
}

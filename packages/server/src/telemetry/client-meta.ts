import type { IncomingMessage } from "node:http";
import { type ClientTelemetryMeta, TELEVISION_CLIENT_META_HEADER } from "@telepath-computer/television-shared";
import { deriveClientProperties } from "./derivation.ts";
import { telemetryVersion, type TelemetryEventProperties } from "./types.ts";

export { TELEVISION_CLIENT_META_HEADER };

export interface TelemetryClientContext {
  readonly clientId: string;
  readonly meta: ClientTelemetryMeta;
}

export type SessionActivityClientProperties = Pick<
  TelemetryEventProperties,
  "client_app" | "client_platform" | "browser_vendor" | "browser_major_version" | "desktop_app_version"
>;

export function parseClientTelemetryMetaHeader(value: string | undefined): TelemetryClientContext | null {
  if (!value) return null;
  try {
    return telemetryContextFromMeta(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

export function parseClientTelemetryMetaFromRequest(request: IncomingMessage): TelemetryClientContext | null {
  const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
  return telemetryContextFromMeta({
    clientId: parsed.searchParams.get("clientId"),
    userAgent: parsed.searchParams.get("userAgent"),
    clientApp: parsed.searchParams.get("clientApp"),
    desktopAppVersion: parsed.searchParams.get("desktopAppVersion") ?? undefined,
  });
}

export function deriveSessionActivityClientProperties(context: TelemetryClientContext): SessionActivityClientProperties {
  return deriveClientProperties({
    clientApp: context.meta.clientApp,
    userAgent: context.meta.userAgent,
    ...(context.meta.desktopAppVersion ? { desktopAppVersion: telemetryVersion(context.meta.desktopAppVersion) } : {}),
  });
}

function telemetryContextFromMeta(value: unknown): TelemetryClientContext | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.clientId !== "string") return null;
  const clientId = record.clientId.trim();
  if (!clientId) return null;
  if (record.clientApp !== "browser" && record.clientApp !== "desktop") return null;
  const userAgent = typeof record.userAgent === "string" ? record.userAgent : "";
  const desktopAppVersion = typeof record.desktopAppVersion === "string" && record.desktopAppVersion.length > 0
    ? record.desktopAppVersion
    : undefined;
  return {
    clientId,
    meta: {
      clientId,
      userAgent,
      clientApp: record.clientApp,
      ...(desktopAppVersion === undefined ? {} : { desktopAppVersion }),
    },
  };
}

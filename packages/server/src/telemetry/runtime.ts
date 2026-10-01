import { capture as captureTelemetry, type TelemetryCaptureSink } from "./capture.ts";
import { deriveSessionActivityClientProperties, type TelemetryClientContext } from "./client-meta.ts";
import { normalizeInstalledByAgent } from "./derivation.ts";
import { deriveBootTelemetry, loadOrMintTelemetryState, setTelemetryOptedOut, telemetryEnabled, telemetryStatus, type BootTelemetryDerivation, type TelemetryEnv, type TelemetryState, type TelemetryStatus } from "./identity.ts";
import { detectTelemetryDeveloperHost, resolvePostHogProject, resolveTelemetryDeveloperHome } from "./posthog-config.ts";
import { createTelemetrySessionManager, type TelemetrySessionManager } from "./sessions.ts";
import { createPostHogTransport, createTelemetrySink } from "./sink.ts";
import type { BoundTelemetryCapture } from "./emitters.ts";
import type { AgentType, TelemetryEvent, TelemetryPersonProperties, TelemetryVersion, ThemeSettingsProperties } from "./types.ts";

export interface TelemetryRuntimeSink extends TelemetryCaptureSink {
  shutdown?(): Promise<void>;
}

export interface CreateTelemetryRuntimeOptions {
  storagePath: string;
  version: TelemetryVersion;
  env?: TelemetryEnv;
  sink?: TelemetryRuntimeSink;
  sessions?: TelemetrySessionManager;
  nowMs?: () => number;
  dataDirCreated: boolean;
  readThemeSettings(): ThemeSettingsProperties;
  developerHost?: boolean;
}

export interface SkillInstalledTelemetryOptions {
  storagePath: string;
  version: TelemetryVersion;
  agentType: AgentType;
  installedByAgent?: string | null;
  env?: TelemetryEnv;
  sink?: TelemetryRuntimeSink;
  developerHost?: boolean;
}

export interface TelemetryRuntime {
  capture: BoundTelemetryCapture;
  boot: BootTelemetryDerivation | null;
  state: TelemetryState | null;
  enabled: boolean;
  status(): TelemetryStatus;
  disable(): Promise<TelemetryStatus>;
  enable(): Promise<TelemetryStatus>;
  observeClientRequest(clientContext?: TelemetryClientContext | null): string | null;
  recordClientActivity(clientContext?: TelemetryClientContext | null): void;
  shutdown(): Promise<void>;
}

const SKILL_INSTALL_TELEMETRY_TIMEOUT_MS = 500;

export async function emitSkillInstalledTelemetry(options: SkillInstalledTelemetryOptions): Promise<void> {
  const env = options.env ?? process.env;
  const developerHost = options.developerHost ?? detectTelemetryDeveloperHost(resolveTelemetryDeveloperHome(env));
  const project = resolvePostHogProject(env, { developerHost });
  const sink: TelemetryRuntimeSink = options.sink ?? (project ? createTelemetrySink({
    transport: createPostHogTransport({ project, timeoutMs: SKILL_INSTALL_TELEMETRY_TIMEOUT_MS }),
  }) : { enqueue() {} });
  try {
    const loaded = await loadOrMintTelemetryState(options.storagePath, { lastVersion: "" });
    captureTelemetry({
      name: "skill_installed",
      properties: {
        server_version: options.version,
        agent_type: options.agentType,
        ...normalizeInstalledByAgent(options.installedByAgent),
      },
    }, { state: loaded.state, env, sink, developerHost });
  } catch {
    // Skill-install telemetry is best-effort and must never affect installation.
  } finally {
    await bestEffortWithinTimeout(sink.shutdown?.(), SKILL_INSTALL_TELEMETRY_TIMEOUT_MS);
  }
}

async function bestEffortWithinTimeout(promise: Promise<unknown> | undefined, timeoutMs: number): Promise<void> {
  if (!promise) return;
  void promise.catch(() => {});
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    promise.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      () => {
        clearTimeout(timeout);
        resolve();
      },
    );
  });
}

export async function createTelemetryRuntime(options: CreateTelemetryRuntimeOptions): Promise<TelemetryRuntime> {
  try {
    const boot = await deriveBootTelemetry(options.storagePath, options.version, { dataDirCreated: options.dataDirCreated });
    const env = options.env ?? process.env;
    const developerHost = options.developerHost ?? detectTelemetryDeveloperHost(resolveTelemetryDeveloperHome(env));
    const project = resolvePostHogProject(env, { developerHost });
    const sink: TelemetryRuntimeSink = options.sink ?? (project ? createTelemetrySink({ project }) : { enqueue() {} });
    const sessions = options.sessions ?? createTelemetrySessionManager();
    const nowMs = options.nowMs ?? Date.now;
    let currentState = boot.state;
    let pendingPersonProperties: TelemetryPersonProperties | null = null;
    const sessionIdFor = (clientContext?: TelemetryClientContext | null): string | null => {
      return sessions.sessionIdFor(clientContext?.clientId ?? null, nowMs());
    };
    const captureWithCurrentProperties = (event: TelemetryEvent, sessionId?: string | null): void => {
      if (!telemetryEnabled(env, currentState, developerHost)) return;
      try {
        const settings = options.readThemeSettings();
        const { appearance_mode, ...themeSettings } = settings;
        const settingsForEvent = event.name === "session_activity"
          ? settings
          : event.name === "theme_changed"
            ? themeSettings
            : event.name === "appearance_mode_changed"
              ? { appearance_mode }
              : {};
        captureTelemetry({
          ...event,
          properties: { ...event.properties, ...settingsForEvent },
          personProperties: { ...pendingPersonProperties, ...event.personProperties, ...settings },
        }, { state: currentState, env, sink, sessionId, developerHost });
        pendingPersonProperties = null;
      } catch {
        // Reading telemetry settings must never affect the product path.
      }
    };
    return {
      boot,
      get state(): TelemetryState {
        return currentState;
      },
      enabled: true,
      status(): TelemetryStatus {
        return telemetryStatus(env, currentState, developerHost);
      },
      async disable(): Promise<TelemetryStatus> {
        if (!currentState.optedOut) {
          captureWithCurrentProperties({
            name: "telemetry_opted_out",
            personProperties: { telemetry_opted_out: true },
          });
          currentState = await setTelemetryOptedOut(options.storagePath, currentState, true);
        }
        return telemetryStatus(env, currentState, developerHost);
      },
      async enable(): Promise<TelemetryStatus> {
        if (currentState.optedOut) {
          currentState = await setTelemetryOptedOut(options.storagePath, currentState, false);
          pendingPersonProperties = { telemetry_opted_out: false };
        }
        return telemetryStatus(env, currentState, developerHost);
      },
      capture(event: TelemetryEvent, clientContext?: TelemetryClientContext | null): void {
        captureWithCurrentProperties(event, sessionIdFor(clientContext));
      },
      observeClientRequest(clientContext?: TelemetryClientContext | null): string | null {
        return sessionIdFor(clientContext);
      },
      recordClientActivity(clientContext?: TelemetryClientContext | null): void {
        if (!clientContext) return;
        const sessionId = sessionIdFor(clientContext);
        if (!sessionId) return;
        captureWithCurrentProperties({
          name: "session_activity",
          properties: {
            server_version: options.version,
            ...deriveSessionActivityClientProperties(clientContext),
          },
        }, sessionId);
      },
      async shutdown(): Promise<void> {
        try {
          await sink.shutdown?.();
        } catch {
          // Telemetry shutdown is best-effort and must never affect server disposal.
        }
      },
    };
  } catch {
    return disabledTelemetryRuntime();
  }
}

function disabledTelemetryRuntime(): TelemetryRuntime {
  return {
    boot: null,
    state: null,
    enabled: false,
    status(): TelemetryStatus { return telemetryStatus(process.env, null); },
    async disable(): Promise<TelemetryStatus> { return telemetryStatus(process.env, null); },
    async enable(): Promise<TelemetryStatus> { return telemetryStatus(process.env, null); },
    capture(): void {},
    observeClientRequest(): string | null { return null; },
    recordClientActivity(): void {},
    async shutdown(): Promise<void> {},
  };
}

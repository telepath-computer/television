// Symbol.dispose became native in Node 18.18; keep this first so the CLI's first workspace import runs the polyfill before classes define Symbol.dispose members.
// The published Node >=22 floor makes this ordering a robustness measure, not a requirement for supported runtimes.
import "@telepath-computer/utils/disposable-polyfill";

export { Server } from "./server.ts";
export { ServerStore, type ServerStoreOptions } from "./server-store.ts";
export type {
  ACPAgentProfile,
  TelevisionConfig,
  TelevisionConfigFile,
  TelevisionSettings,
} from "./config.ts";
export {
  buildPersistedACPEnvironment,
  buildServerURL,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  isACPCommandResolvable,
  isVitestRuntime,
  readTelevisionConfig,
  resolveACPAgentProfile,
  resolveTelevisionHome,
  TelevisionConfigError,
  updateTelevisionConfig,
} from "./config.ts";
export { resolveBindAddresses } from "./bind-addresses.ts";
export { log } from "./logger.ts";
export {
  // The single telemetry entry point producers use; the architecture requires
  // it exposed here while sink factories and enqueue stay internal.
  capture,
  deriveAgentTypeFromPath,
  emitSkillInstalledTelemetry,
  resolvePostHogProject,
  telemetryDestination,
  telemetryEnvironmentSuppressionReason,
  telemetryVersion,
  type AgentType,
  type BuiltTelemetryEvent,
  type LaunchMode,
  type SkillInstalledTelemetryOptions,
  type TelemetryCaptureSink,
  type TelemetryEnv,
} from "./telemetry/index.ts";

export { getTelemetryStatePath } from "./artifact-paths.ts";

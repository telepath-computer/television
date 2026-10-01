import type { Daemon } from "@rupertsworld/daemon";
import type {
  ACPAgentProfile,
  LaunchMode,
  readTelevisionConfig as sourceReadTelevisionConfig,
  resolveTelevisionHome as sourceResolveTelevisionHome,
  Server,
  SkillInstalledTelemetryOptions,
  TelevisionConfig as SourceTelevisionConfig,
  TelevisionConfigError as SourceTelevisionConfigError,
  TelevisionConfigFile as SourceTelevisionConfigFile,
  TelevisionSettings as SourceTelevisionSettings,
  updateTelevisionConfig as sourceUpdateTelevisionConfig,
} from "@telepath-computer/television-server";
import type { TelevisionClient } from "@telepath-computer/television-shared";
import { describe, expectTypeOf, it } from "vitest";
import type {
  CLIDaemon as SourceCLIDaemon,
  CLIDaemonOptions as SourceCLIDaemonOptions,
  CLIEnvironment as SourceCLIEnvironment,
  CLIServer as SourceCLIServer,
  CLIServerOptions as SourceCLIServerOptions,
  Writable as SourceWritable,
} from "../src/index.ts";

// This is the spec-pinned type surface from
// [[arch/cli/index.md#^cli-contract-type-drift]]. Keep these declarations
// literal rather than deriving them from the source types: equality below is
// intended to fail compilation when either side drifts.
type SpecWritable = {
  isTTY?: boolean;
  write(chunk: string | Uint8Array): unknown;
};

type SpecCLIServer = Pick<Server, "start" | "dispose" | "getBaseURL" | "getAuthToken"> & {
  getBaseURLs?: () => string[];
};

type SpecCLIServerOptions = {
  home: string;
  listen: string[];
  port: number;
  auth: boolean;
  installedByAgent?: string;
  staticDir?: string;
  canonicalDir?: string;
  bundledViewsPath?: string;
  onboardingContentPath?: string;
  bundledThemesPath?: string;
  acpProfile?: ACPAgentProfile;
  launchMode: LaunchMode;
};

type SpecCLIDaemonOptions = {
  home: string;
  env: Record<string, string>;
};

type SpecCLIDaemon = Pick<Daemon, "install" | "uninstall" | "status">;

interface SpecCLIEnvironment {
  stdout: SpecWritable;
  stderr: SpecWritable;
  createClient: (serverURL: string, token?: string) => TelevisionClient;
  createServer: (options: SpecCLIServerOptions) => SpecCLIServer;
  createDaemon: (options?: SpecCLIDaemonOptions) => SpecCLIDaemon;
  resolveStaticDir: () => string | undefined;
  resolveCanonicalDir: () => string | undefined;
  resolveBundledViewsPath: () => string | undefined;
  resolveOnboardingContentPath: () => string | undefined;
  resolveBundledThemesPath: () => string | undefined;
  resolveBundledSkillsRoot: () => string | undefined;
  resolveHomeDir: () => string;
  runSkillsInstaller: (args: string[]) => Promise<void>;
  emitSkillInstalledTelemetry: (options: SkillInstalledTelemetryOptions) => Promise<void>;
  onSignal: (signal: NodeJS.Signals, handler: () => void) => void;
}

// The server package's home and config declarations from
// [[arch/cli/index.md#Home and config resolution]], declared literally for the
// same reason.
interface SpecTelevisionConfigFile {
  port?: number;
  listen?: string[];
  auth?: boolean;
  installedByAgent?: string;
}

interface SpecTelevisionSettings {
  port: number;
  listen: string[];
  auth: boolean;
  installedByAgent?: string;
}

interface SpecTelevisionConfig {
  home: string;
  configPath: string;
  configFileExists: boolean;
  settings: SpecTelevisionSettings;
}

interface SpecTelevisionConfigError extends Error {
  readonly configPath: string;
}

type SpecResolveTelevisionHome = (input: {
  homeOption: string | undefined;
  operatingSystemHomeDir: string;
  cwd: string;
}) => string;

type SpecReadTelevisionConfig = (home: string) => SpecTelevisionConfig;

type SpecUpdateTelevisionConfig = (
  home: string,
  changes: SpecTelevisionConfigFile,
) => SpecTelevisionConfig;

describe("CLI spec-owned contract type drift", () => {
  it("keeps exported CLIEnvironment and adapter declarations exact", () => {
    expectTypeOf<SourceWritable>().toEqualTypeOf<SpecWritable>();
    expectTypeOf<SourceCLIServer>().toEqualTypeOf<SpecCLIServer>();
    expectTypeOf<SourceCLIServerOptions>().toEqualTypeOf<SpecCLIServerOptions>();
    expectTypeOf<SourceCLIDaemonOptions>().toEqualTypeOf<SpecCLIDaemonOptions>();
    expectTypeOf<SourceCLIDaemon>().toEqualTypeOf<SpecCLIDaemon>();
    expectTypeOf<SourceCLIEnvironment>().toEqualTypeOf<SpecCLIEnvironment>();
  });

  it("keeps the server package's home and config declarations exact", () => {
    expectTypeOf<SourceTelevisionConfigFile>().toEqualTypeOf<SpecTelevisionConfigFile>();
    expectTypeOf<SourceTelevisionSettings>().toEqualTypeOf<SpecTelevisionSettings>();
    expectTypeOf<SourceTelevisionConfig>().toEqualTypeOf<SpecTelevisionConfig>();
    expectTypeOf<SourceTelevisionConfigError>().toEqualTypeOf<SpecTelevisionConfigError>();
    expectTypeOf<typeof sourceResolveTelevisionHome>().toEqualTypeOf<SpecResolveTelevisionHome>();
    expectTypeOf<typeof sourceReadTelevisionConfig>().toEqualTypeOf<SpecReadTelevisionConfig>();
    expectTypeOf<typeof sourceUpdateTelevisionConfig>().toEqualTypeOf<SpecUpdateTelevisionConfig>();
  });
});

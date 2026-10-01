import { Daemon } from "@rupertsworld/daemon";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCLI } from "../../../cli/src/index.ts";

interface PersistedDaemonCLIOptions {
  home: string;
  env: Record<string, string>;
}

const fixturesDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(fixturesDir, "../../../..");
const tsxCLI = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const cliSource = path.join(repoRoot, "packages", "cli", "src", "index.ts");
const daemonName = requireTestEnvironment("TV_TEST_DAEMON_NAME");

const exitCode = await runCLI(process.argv.slice(2), {
  createDaemon: (options?: PersistedDaemonCLIOptions) => {
    return new Daemon({
      name: daemonName,
      description: "Television telemetry persisted-install acceptance fixture",
      command: process.execPath,
      args: buildPersistedServeCommand(options),
      env: {
        ...(options?.env ?? {}),
        VITEST: "",
        ...(process.env.TV_TEST_SURFACE_OWNER === undefined
          ? {}
          : { TV_TEST_SURFACE_OWNER: process.env.TV_TEST_SURFACE_OWNER }),
      },
    });
  },
});

process.exit(exitCode);

// The same home-only serve arguments production installs, run from source.
function buildPersistedServeCommand(options: PersistedDaemonCLIOptions | undefined): string[] {
  return options ? [tsxCLI, cliSource, "--home", options.home, "serve"] : [tsxCLI, cliSource, "serve"];
}

function requireTestEnvironment(name: string): string {
  const value = process.env[name];
  if (value) return value;
  throw new Error(`${name} is required by the persisted daemon acceptance driver`);
}

export type ElectronRuntimePresence =
  | { state: "absent" }
  | { state: "valid"; executablePath: string }
  | { state: "invalid"; reason: string };

export interface ElectronE2EPlan {
  failures: string[][];
  notes: string[];
  runtime: ElectronRuntimePresence;
  useXvfb: boolean;
  disableSandbox: boolean;
  platform: string;
}

export interface ElectronRuntimeInspectionOptions {
  root?: string;
  platform?: NodeJS.Platform;
  readPlistValue?: (plist: string, key: string) => string;
}

export interface ElectronE2EPlanOptions extends ElectronRuntimeInspectionOptions {
  release?: string;
  commandExists?: (command: string) => boolean;
  inspectSandbox?: (sandboxPath: string) => { uid: number; mode: number };
}

export const ELECTRON_E2E_EXECUTABLE_PATH_ENV: "TV_ELECTRON_E2E_EXECUTABLE_PATH";
export function inspectElectronRuntime(
  options?: ElectronRuntimeInspectionOptions,
): ElectronRuntimePresence;
export function getElectronE2EInvocation(
  plan: { useXvfb?: boolean },
  extraArgs?: string[],
): { command: string; args: string[] };
export function prepareElectronE2EEnv(
  env?: NodeJS.ProcessEnv,
  plan?: { disableSandbox?: boolean },
): NodeJS.ProcessEnv;
export function getElectronE2EPlan(
  env?: NodeJS.ProcessEnv,
  options?: ElectronE2EPlanOptions,
): ElectronE2EPlan;
export function printElectronE2EFailures(plan: ElectronE2EPlan): void;

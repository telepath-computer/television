export interface SurfaceOwner {
  runId: string;
  surfaceId: string;
  supervisorPid: number;
  supervisorStartTime: string;
}

export interface ProcessIdentity {
  pid: number;
  ppid: number;
  pgid: number;
  startTime: string;
  processStartedAt: string;
  executable: string;
  command: string;
  ownerToken?: string;
  state?: string;
}

export interface ListeningSocket {
  pid: number;
  address: string;
  port: number;
  command: string;
}

export interface ClassifiedOwnedProcess {
  process: ProcessIdentity;
  owner: SurfaceOwner;
  token: string;
  supervisorStatus: "live" | "stale";
}

export interface CommandResult {
  status: number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  error?: Error;
}

export type RunCommand = (command: string, args: readonly string[], options?: Record<string, unknown>) => CommandResult;

export interface ProcessLifecycleProbeResult {
  backend: "linux-procfs-ss" | "macos-ps-lsof";
  attributedProcessCount: number;
  attributedListenerCount: number;
  finalOwnerCount: number;
  childPid: number;
  childPgid: number;
  listenerURL: string;
}

export const OWNER_TOKEN_ENV: "TV_TEST_SURFACE_OWNER";
export const OWNER_TOKEN_PREFIX: "tv1.";
export function encodeOwnerToken(owner: SurfaceOwner): string;
export function decodeOwnerToken(token: unknown): SurfaceOwner | null;
export function parseLinuxProcessStat(stat: string): Pick<ProcessIdentity, "pid" | "ppid" | "pgid" | "startTime" | "state">;
export function readLinuxProcess(pid: number, options?: { procRoot?: string }): ProcessIdentity;
export function scanLinuxProcesses(options?: { procRoot?: string }): ProcessIdentity[];
export function readLinuxBootTimeMs(procRoot?: string): number;
export function readLinuxClockTicksPerSecond(options?: { runCommand?: RunCommand }): number;
export function parseSSListeners(output: string): ListeningSocket[];
export function readLinuxListeners(options?: { runCommand?: RunCommand }): ListeningSocket[];
export function macOSProcessCommand(): { command: "ps"; args: string[] };
export function macOSListenerCommand(): { command: "lsof"; args: string[] };
export function parseMacOSProcesses(output: string): ProcessIdentity[];
export function readMacOSProcesses(options?: { runCommand?: RunCommand }): ProcessIdentity[];
export function parseLsofListeners(output: string): ListeningSocket[];
export function readMacOSListeners(options?: { runCommand?: RunCommand }): ListeningSocket[];
export function classifyOwnedProcesses(processes: ProcessIdentity[]): ClassifiedOwnedProcess[];
export function processIdentityMatches(process: ProcessIdentity | null | undefined, expected: Pick<ProcessIdentity, "pid" | "startTime">): boolean;
export function revalidateOwnedProcess(expected: ProcessIdentity, current: ProcessIdentity, token: string): boolean;
export function validateProcessLifecycleHost(options: {
  platform?: NodeJS.Platform;
  procfsReadable: boolean;
  commandAvailable(command: string): boolean;
}): { backend: "linux-procfs-ss" | "macos-ps-lsof" };
export function runProcessLifecycleProbe(options?: {
  platform?: NodeJS.Platform;
  procRoot?: string;
  runCommand?: RunCommand;
  probeScript?: string;
}): ProcessLifecycleProbeResult;

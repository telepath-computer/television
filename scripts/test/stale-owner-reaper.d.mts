import type { NormalizedProcessLeak } from "./timing-events.mjs";

export interface OwnerProcessObservation {
  token: string;
  owner: { runId: string; surfaceId: string; supervisorPid: number; supervisorStartTime: string };
  supervisorStatus: "live" | "stale";
  process: { pid: number; ppid: number; pgid: number; startTime: string; processStartedAt: string; executable: string; command: string };
}

export interface StaleOwnerCleanupResult {
  staleDetected: boolean;
  cleanupConfirmed: boolean;
  liveOwners: OwnerProcessObservation[];
  processLeaks: NormalizedProcessLeak[];
  remainingStaleOwners: OwnerProcessObservation[];
  message: string;
}

export function reapStaleOwnerProcesses(options?: { termGraceMs?: number; maxRounds?: number }): Promise<StaleOwnerCleanupResult>;

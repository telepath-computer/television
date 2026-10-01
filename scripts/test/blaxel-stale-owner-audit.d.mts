export interface BlaxelStaleOwnerAuditReport {
  schemaVersion: 1;
  mode: "read-only";
  platform: "linux";
  arch: string;
  capabilities: {
    procfs: { readable: boolean; error: string | null };
    ss: { command: ["ss", "-H", "-ltnp"]; available: boolean; usable: boolean; exitCode: number | null; error: string | null };
  };
  processScan: { status: "ok" | "unreadable"; visibleProcessCount: number; inaccessibleProcessCount: number; validOwnerProcessCount: number };
  owners: Array<{
    token: string;
    owner: { runId: string; surfaceId: string; supervisorPid: number; supervisorStartTime: string };
    process: { pid: number; ppid: number; pgid: number; state: string; startTime: string; executable: string; command: string };
    supervisorStatus: "live" | "stale";
    supervisor: { pid: number; startTime: string } | null;
  }>;
}

export function buildLinuxStaleOwnerAuditInvocation(options?: { nodeCommand?: string }): { command: string; args: ["-e", string] };
export function parseLinuxStaleOwnerAuditOutput(output: unknown): BlaxelStaleOwnerAuditReport;

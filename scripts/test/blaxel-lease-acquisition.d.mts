export function excludeSandboxesByName<Sandbox extends { metadata?: { name?: string } }>(sandboxes: Sandbox[], excludedNames: string[]): Sandbox[];

export interface LeaseAcquisitionOutcome<Lease> {
  shardIndex: number;
  slot: number;
  startedAt: number;
  lease: Lease | null;
  error: unknown | null;
}

export function leaseAcquisitionFailureShards<Lease extends { sandbox?: { metadata?: { name?: string } } }>(options: {
  outcomes: Array<LeaseAcquisitionOutcome<Lease>>;
  shardTotal: number;
  pool: string;
  plan?: { planId?: string; timingProvider?: string; testedTree?: string; testedCommit?: string; shards?: Array<{ predictedDurationMs?: number; surfaces?: Array<{ files: Array<{ path: string }> }> }> } | null;
  outputDir?: string | null;
  completedAt?: string;
}): Array<Record<string, unknown>>;

export function acquireShardLeases<Lease>(options: {
  shardIndices: number[];
  maxConcurrency: number;
  acquire: (assignment: { shardIndex: number; slot: number }) => Promise<Lease | null | undefined>;
}): Promise<Array<LeaseAcquisitionOutcome<Lease>>>;

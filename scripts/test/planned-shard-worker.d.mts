export function runPlannedShard(options?: Record<string, string>, env?: NodeJS.ProcessEnv): Promise<number>;
export function validateVitestFilters(args: { surfaces: Array<{ id: string; runner: string }>; assignedBySurface: Map<string, string[]>; completeInventory: string[] }): void;
export function compareAssignedAndCollected(assigned: string[], collected: string[]): { matches: boolean; missing: string[]; extra: string[]; duplicates: string[] };

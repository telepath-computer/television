import type { SandboxInstance } from "@blaxel/core";
export function listBlaxelPoolSandboxes(options: {pool: string; arch: string; deployedOnly?: boolean}): Promise<SandboxInstance[]>;

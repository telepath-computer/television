export interface ToolchainCheckResult {
  ok: boolean;
  nodeVersion: string;
  npmVersion: string;
  nodeRange: string;
  npmRange: string;
  message?: string;
}

export function checkToolchain(options?: {
  root?: string;
  nodeVersion?: string;
  npmVersion?: string;
}): ToolchainCheckResult;

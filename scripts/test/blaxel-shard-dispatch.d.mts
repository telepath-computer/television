export interface ShardInputTransferResult {
  ok: boolean;
  error?: unknown;
  failureKind?: string;
  failureStep?: string;
  failureMessage?: string;
}

export function transferShardInputs(options: {
  write: (remotePath: string, contents: string) => Promise<unknown>;
  planRemotePath?: string | null;
  planRaw?: string | null;
  remoteScript: string;
  remoteScriptContents: string;
}): Promise<ShardInputTransferResult>;

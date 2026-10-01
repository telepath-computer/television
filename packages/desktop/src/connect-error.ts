export type ConnectResult = { ok: true; attempt: number } | { ok: false; message: string };

/** Strip Electron IPC wrapper text from invoke() rejections. */
export function connectErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Failed to connect";
  const message = error.message;
  const ipcMatch = message.match(/^Error invoking remote method '[^']+': (?:(?:Error: )+)?([\s\S]+)$/);
  return ipcMatch?.[1]?.trim() || message;
}

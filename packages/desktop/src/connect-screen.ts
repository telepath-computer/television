/** Presentation of the packaged local page; main owns saved-connection retries. */
export type ConnectScreenState =
  | { kind: "setup" }
  | { kind: "connecting"; serverURL: string }
  | { kind: "unauthorized"; serverURL: string }
  | { kind: "error"; serverURL: string; nextRetryAt: number | null };

export const GET_CONNECT_STATE_CHANNEL = "television:get-connect-state";
export const CONNECT_STATE_CHANNEL = "television:connect-state";
export const COMPLETE_CONNECT_CHANNEL = "television:complete-connect";
export const DISCONNECT_CHANNEL = "television:disconnect";

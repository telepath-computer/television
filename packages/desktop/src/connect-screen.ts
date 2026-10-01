/** Why the connect screen was opened — main process sets this before each loadFile. */
export type ConnectScreenIntent = "bootstrap" | "manual";

export const GET_CONNECT_SCREEN_INTENT_CHANNEL = "television:get-connect-screen-intent";

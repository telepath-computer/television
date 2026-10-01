export type PreflightFailureCode = "unreachable" | "not-tv-server" | "auth-required" | "auth-rejected";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 8_000;
const NOT_TV_SERVER_MESSAGE = "This URL doesn't seem to be a Television server — please check it.";

export type PreflightResult =
  | { ok: true }
  | { ok: false; code: PreflightFailureCode; message: string };

export interface PreflightOptions {
  serverURL: string;
  token: string;
  desktopAppVersion: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function unreachable(serverURL: string): PreflightResult {
  return {
    ok: false,
    code: "unreachable",
    message: `Couldn't reach ${serverURL} — is the server running?`,
  };
}

function notTVServer(): PreflightResult {
  return { ok: false, code: "not-tv-server", message: NOT_TV_SERVER_MESSAGE };
}

function isDesktopConnectCheckResponse(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  return (body as Record<string, unknown>).product === "television";
}

/** Check server reachability, auth, and Television identity before loadURL. */
export async function preflightConnection(options: PreflightOptions): Promise<PreflightResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const probeURL = new URL("/desktop/connect-check", options.serverURL);
  probeURL.searchParams.set("desktopAppVersion", options.desktopAppVersion);
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetchImpl(probeURL.toString(), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS),
    });
  } catch {
    return unreachable(options.serverURL);
  }

  if (response.status === HTTP_UNAUTHORIZED) {
    if (!options.token) {
      return { ok: false, code: "auth-required", message: "This server requires a token" };
    }
    return { ok: false, code: "auth-rejected", message: "Token rejected" };
  }

  if (response.status !== HTTP_OK) {
    return notTVServer();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return notTVServer();
  }

  if (!isDesktopConnectCheckResponse(body)) {
    return notTVServer();
  }

  return { ok: true };
}

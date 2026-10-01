import { parseConnectURL } from "@telepath-computer/television-shared";

export class ConnectURLError extends Error {
  constructor(message = "Enter a valid http or https URL") {
    super(message);
    this.name = "ConnectURLError";
  }
}

export interface ParsedDesktopConnectURL {
  serverURL: string;
  token: string | null;
}

export function parseDesktopConnectURL(input: string): ParsedDesktopConnectURL {
  const trimmed = input.trim();
  if (!trimmed) throw new ConnectURLError();

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new ConnectURLError();
  }

  // Bare host/host:port must get http:// first — `new URL("localhost:32848")`
  // treats `localhost:` as a custom scheme.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ConnectURLError();
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConnectURLError();
  }

  const parsed = parseConnectURL(url.toString());
  return parsed;
}

/** Normalize user-entered server URL for connect + persistence. */
export function normalizeConnectURL(input: string): string {
  return parseDesktopConnectURL(input).serverURL;
}

/**
 * The version the shell reports to the renderer via the `desktopAppVersion`
 * parameter: `app.getVersion()`, or — behind the compound gate of
 * TV_TEST_MODE=true plus TV_TEST_DESKTOP_APP_VERSION — the hooked value
 * (specs/arch/updates/desktop-upgrade-gate.md ^hook-shell-version; a declared
 * mock of app.getVersion() for the desktop e2e harness).
 */
export function resolveDesktopAppVersion(
  appVersion: string,
  env: { TV_TEST_MODE?: string; TV_TEST_DESKTOP_APP_VERSION?: string },
): string {
  if (env.TV_TEST_MODE === "true" && env.TV_TEST_DESKTOP_APP_VERSION) {
    return env.TV_TEST_DESKTOP_APP_VERSION;
  }
  return appVersion;
}

export function buildRemoteURL(serverURL: string, token: string, desktopAppVersion?: string): string {
  const url = new URL(serverURL);
  url.searchParams.set("mode", "electron");
  if (token) url.searchParams.set("token", token);
  if (desktopAppVersion) url.searchParams.set("desktopAppVersion", desktopAppVersion);
  return url.toString();
}

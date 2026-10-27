const TOKEN_QUERY_PARAM = "token";
const MODE_QUERY_PARAM = "mode";
const DESKTOP_APP_VERSION_QUERY_PARAM = "desktopAppVersion";
const ELECTRON_MODE = "electron";

export function resolveAuthToken(locationSearch: string = window.location.search): string | null {
  return new URLSearchParams(locationSearch).get(TOKEN_QUERY_PARAM);
}

export function isElectronMode(locationSearch: string = typeof window === "undefined" ? "" : window.location.search): boolean {
  return new URLSearchParams(locationSearch).get(MODE_QUERY_PARAM) === ELECTRON_MODE;
}

export function resolveDesktopAppVersion(locationSearch: string = typeof window === "undefined" ? "" : window.location.search): string | null {
  return new URLSearchParams(locationSearch).get(DESKTOP_APP_VERSION_QUERY_PARAM);
}

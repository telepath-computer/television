import {
  appearanceResolverScriptSource,
  installAppearanceResolver,
  type AppearanceResolverController,
} from "@telepath-computer/television-artifact/browser";
import type {
  AppearanceMode,
  ThemeColorScheme,
} from "@telepath-computer/television-shared";

export const APPEARANCE_CACHE_KEY = "television-appearance-mode";

function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === "system" || value === "light" || value === "dark";
}

function readCachedAppearance(): AppearanceMode {
  try {
    const cached = window.localStorage.getItem(APPEARANCE_CACHE_KEY);
    return isAppearanceMode(cached) ? cached : "system";
  } catch {
    return "system";
  }
}

/** Source injected as the first classic script in the shell's built head. */
export function appearanceBootstrapScriptSource(): string {
  const key = JSON.stringify(APPEARANCE_CACHE_KEY);
  const preference = `(()=>{try{const value=window.localStorage.getItem(${key});return value==="system"||value==="light"||value==="dark"?value:"system";}catch{return "system";}})()`;
  return appearanceResolverScriptSource(preference);
}

export function getAppearanceResolver(): AppearanceResolverController {
  return window.__televisionAppearanceResolver
    ?? installAppearanceResolver(readCachedAppearance());
}

export function resolveAppearanceInput(
  appearanceMode: AppearanceMode,
  activeThemeColorScheme: ThemeColorScheme | null,
): AppearanceMode {
  return activeThemeColorScheme === "light" || activeThemeColorScheme === "dark"
    ? activeThemeColorScheme
    : appearanceMode;
}

/** Apply and cache state that has been confirmed by the connected server. */
export function applyConfirmedAppearance(mode: AppearanceMode): void {
  getAppearanceResolver().setPreference(mode);
  try {
    window.localStorage.setItem(APPEARANCE_CACHE_KEY, mode);
  } catch {
    // Storage is only a first-paint optimization; confirmed state still wins.
  }
}

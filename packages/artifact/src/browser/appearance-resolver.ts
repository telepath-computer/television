export type AppearancePreference = "system" | "light" | "dark";
export type EffectiveAppearance = Exclude<AppearancePreference, "system">;

export interface AppearanceResolverController {
  setPreference(preference: AppearancePreference): void;
}

declare global {
  interface Window {
    __televisionAppearanceResolver?: AppearanceResolverController;
  }
}

/**
 * Install Television's one appearance resolver in a browser document.
 *
 * This function is deliberately self-contained: its runtime source is also
 * serialized into static HTML before styles load. Keep helper logic inside it.
 */
export function installAppearanceResolver(
  initialPreference: AppearancePreference,
  targetWindow: Window = window,
): AppearanceResolverController {
  const existing = targetWindow.__televisionAppearanceResolver;
  if (existing !== undefined) return existing;

  const query = targetWindow.matchMedia("(prefers-color-scheme: dark)");
  let preference = initialPreference;
  const isPreference = (value: unknown): value is AppearancePreference =>
    value === "system" || value === "light" || value === "dark";
  const apply = (): void => {
    const effective: EffectiveAppearance = preference === "system"
      ? query.matches ? "dark" : "light"
      : preference;
    targetWindow.document.documentElement.dataset.theme = effective;
  };
  const controller: AppearanceResolverController = {
    setPreference(nextPreference) {
      if (!isPreference(nextPreference)) return;
      preference = nextPreference;
      apply();
    },
  };

  // Publish before installing the listener so a re-entrant installation sees
  // the same controller and cannot add a competing listener.
  targetWindow.__televisionAppearanceResolver = controller;
  query.addEventListener("change", () => {
    if (preference === "system") apply();
  });
  apply();
  return controller;
}

/** Serialize the self-contained installer around a JavaScript preference expression. */
export function appearanceResolverScriptSource(
  preferenceExpression: string,
): string {
  return `(${installAppearanceResolver.toString()})(${preferenceExpression});`;
}

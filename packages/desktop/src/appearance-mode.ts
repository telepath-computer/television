export const SET_APPEARANCE_MODE_CHANNEL = "television:set-appearance-mode";

export type DesktopAppearanceMode = "system" | "light" | "dark";

export function isDesktopAppearanceMode(
  value: unknown,
): value is DesktopAppearanceMode {
  return value === "system" || value === "light" || value === "dark";
}

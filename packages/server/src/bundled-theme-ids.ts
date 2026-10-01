// Generated from specs/ui/themes/bundled.yml by scripts/bundled-theme-manifest.mjs.
export const BUNDLED_THEMES = [{"id":"aquarium","minimumVersion":"1.0.2"},{"id":"blueprint","minimumVersion":"1.0.0"},{"id":"crt-phosphor","minimumVersion":"1.0.0"},{"id":"clouds","minimumVersion":"2.1.0"},{"id":"nord","minimumVersion":"1.1.0"},{"id":"swiss","minimumVersion":"1.1.0"},{"id":"tokyo-night","minimumVersion":"1.1.0"}] as const;
export type BundledThemeID = (typeof BUNDLED_THEMES)[number]["id"];
export const BUNDLED_THEME_IDS: readonly BundledThemeID[] = BUNDLED_THEMES.map(({ id }) => id);

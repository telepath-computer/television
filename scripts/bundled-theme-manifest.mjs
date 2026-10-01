// Build-time derivation of the runtime inventory from its specification.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const defaultManifest = fileURLToPath(new URL("../specs/ui/themes/bundled.yml", import.meta.url));
const defaultOutput = fileURLToPath(new URL("../packages/server/src/bundled-theme-ids.ts", import.meta.url));

export function generateBundledThemes({ manifestPath = defaultManifest, outputPath = defaultOutput } = {}) {
  const themes = parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(themes) || themes.length === 0 || themes.some(theme =>
    theme === null || typeof theme !== "object" || Array.isArray(theme) ||
    Object.keys(theme).length !== 2 || typeof theme.id !== "string" || theme.id.length === 0 ||
    typeof theme.minimumVersion !== "string" || theme.minimumVersion.length === 0
  ) || new Set(themes.map(({ id }) => id)).size !== themes.length) {
    throw new Error("Bundled theme inventory must be a nonempty YAML sequence of unique IDs and minimumVersion strings");
  }
  const source = `// Generated from specs/ui/themes/bundled.yml by scripts/bundled-theme-manifest.mjs.
export const BUNDLED_THEMES = ${JSON.stringify(themes)} as const;
export type BundledThemeID = (typeof BUNDLED_THEMES)[number]["id"];
export const BUNDLED_THEME_IDS: readonly BundledThemeID[] = BUNDLED_THEMES.map(({ id }) => id);
`;
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== source) writeFileSync(outputPath, source);
  return themes;
}

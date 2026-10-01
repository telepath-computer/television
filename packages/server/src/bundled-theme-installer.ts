import { BUNDLED_THEMES, BUNDLED_THEME_IDS, type BundledThemeID } from "./bundled-theme-ids.ts";
import {
  cpSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { getBundledThemesStatePath } from "./artifact-paths.ts";
import {
  compareSemanticVersions,
  getThemeDir,
  getThemesDir,
  validateThemePackage,
} from "./themes.ts";

const JSON_INDENT_SPACES = 2;
const BACKUP_TIMESTAMP_LENGTH = 19;
export const BUNDLED_THEME_STATE_VERSION = 2;
export { BUNDLED_THEMES, BUNDLED_THEME_IDS, type BundledThemeID } from "./bundled-theme-ids.ts";
export const DEFAULT_BUNDLED_THEME_ID: BundledThemeID = "clouds";

export interface BundledThemeState {
  version: typeof BUNDLED_THEME_STATE_VERSION;
  installedThemeIDs: string[];
  initialThemeSelectionComplete: boolean;
}

export type BundledThemeStateRead =
  | { status: "ok"; state: BundledThemeState }
  | { status: "absent" }
  | { status: "invalid"; error: string };

export function getBundledThemeStateTempPath(storagePath: string): string {
  const statePath = getBundledThemesStatePath(storagePath);
  return path.join(path.dirname(statePath), `.${path.basename(statePath)}.tmp-${process.pid}`);
}

export function getBundledThemeCopyTempPath(storagePath: string, themeID: string): string {
  return path.join(getThemesDir(storagePath), `.${themeID}.bundled-theme.tmp-${process.pid}`);
}

export function getBundledThemeBackupTempPath(storagePath: string, themeID: string): string {
  return path.join(getThemesDir(storagePath), `.${themeID}.bundled-theme.backup-tmp-${process.pid}`);
}

function getBundledThemePreviousPath(storagePath: string, themeID: string): string {
  return path.join(getThemesDir(storagePath), `.${themeID}.bundled-theme.previous-${process.pid}`);
}

export function readBundledThemeStateFile(storagePath: string): BundledThemeStateRead {
  const statePath = getBundledThemesStatePath(storagePath);
  if (!existsSync(statePath)) return { status: "absent" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(statePath, "utf8"));
  } catch (error) {
    return { status: "invalid", error: describeError(error) };
  }

  if (isBundledThemeState(parsed)) return { status: "ok", state: parsed };
  return {
    status: "invalid",
    error: "expected version 2 bundled-theme state with unique sorted theme IDs",
  };
}

export function writeBundledThemeStateFile(storagePath: string, state: BundledThemeState): void {
  const statePath = getBundledThemesStatePath(storagePath);
  const tempPath = getBundledThemeStateTempPath(storagePath);
  try {
    writeFileSync(tempPath, `${JSON.stringify(state, null, JSON_INDENT_SPACES)}\n`);
    renameSync(tempPath, statePath);
  } catch (error) {
    try {
      rmSync(tempPath, { recursive: true, force: true });
    } catch {
      // The original state-write error is the useful failure.
    }
    throw error;
  }
}

/** Apply bundled minimums and return the durable bootstrap state. */
export function runBundledThemeInstallation(
  storagePath: string,
  bundledThemesPath: string | undefined,
): BundledThemeState | null {
  if (bundledThemesPath === undefined) return null;

  const stateRead = readBundledThemeStateFile(storagePath);
  if (stateRead.status === "invalid") {
    console.warn(
      "Bundled theme state is invalid; skipping bundled theme installation for this boot.",
      stateRead.error,
    );
    return null;
  }

  let state: BundledThemeState = stateRead.status === "ok"
    ? stateRead.state
    : {
        version: BUNDLED_THEME_STATE_VERSION,
        installedThemeIDs: [],
        initialThemeSelectionComplete: false,
      };

  const recoveryFailures = recoverInterruptedReplacements(storagePath);

  for (const { id, minimumVersion } of BUNDLED_THEMES) {
    if (recoveryFailures.has(id)) continue;

    const destinationPath = getThemeDir(storagePath, id);
    let handled = false;
    if (!pathExists(destinationPath)) {
      if (state.installedThemeIDs.includes(id)) continue;
      handled = installBundledTheme(storagePath, bundledThemesPath, id);
    } else if (installedThemeMeetsMinimum(destinationPath, id, minimumVersion)) {
      handled = true;
    } else {
      handled = replaceBundledTheme(storagePath, bundledThemesPath, id);
    }

    if (!handled || state.installedThemeIDs.includes(id)) continue;
    const nextState: BundledThemeState = {
      ...state,
      installedThemeIDs: [...state.installedThemeIDs, id]
        .sort((left, right) => left.localeCompare(right, "en")),
    };
    try {
      writeBundledThemeStateFile(storagePath, nextState);
      state = nextState;
    } catch (error) {
      console.warn(
        `Failed to record bundled theme ${JSON.stringify(id)}; it will retry on the next boot.`,
        error,
      );
    }
  }

  return state;
}

function installedThemeMeetsMinimum(
  destinationPath: string,
  themeID: BundledThemeID,
  minimumVersion: string,
): boolean {
  try {
    if (!lstatSync(destinationPath).isDirectory()) return false;
  } catch {
    return false;
  }
  const result = validateThemePackage(destinationPath, themeID);
  return result.theme !== undefined &&
    compareSemanticVersions(result.theme.version, minimumVersion) >= 0;
}

function installBundledTheme(
  storagePath: string,
  bundledThemesPath: string,
  themeID: BundledThemeID,
): boolean {
  const destinationPath = getThemeDir(storagePath, themeID);
  const tempPath = getBundledThemeCopyTempPath(storagePath, themeID);
  try {
    copyFresh(path.join(bundledThemesPath, themeID), tempPath);
    if (pathExists(destinationPath)) {
      rmSync(tempPath, { recursive: true, force: true });
      return false;
    }
    renameSync(tempPath, destinationPath);
    return true;
  } catch (error) {
    removeAfterFailure(tempPath);
    console.warn(
      `Failed to install bundled theme ${JSON.stringify(themeID)}; it will retry on the next boot.`,
      error,
    );
    return false;
  }
}

function replaceBundledTheme(
  storagePath: string,
  bundledThemesPath: string,
  themeID: BundledThemeID,
): boolean {
  const destinationPath = getThemeDir(storagePath, themeID);
  const backupTempPath = getBundledThemeBackupTempPath(storagePath, themeID);
  try {
    copyFresh(destinationPath, backupTempPath);
    renameSync(backupTempPath, unusedBackupPath(storagePath, themeID));
  } catch (error) {
    removeAfterFailure(backupTempPath);
    console.warn(
      `Failed to back up bundled theme ${JSON.stringify(themeID)}; it will retry on the next boot.`,
      error,
    );
    return false;
  }

  const replacementTempPath = getBundledThemeCopyTempPath(storagePath, themeID);
  const previousPath = getBundledThemePreviousPath(storagePath, themeID);
  let previousMoved = false;
  let replacementInstalled = false;
  try {
    copyFresh(path.join(bundledThemesPath, themeID), replacementTempPath);
    renameSync(destinationPath, previousPath);
    previousMoved = true;
    renameSync(replacementTempPath, destinationPath);
    replacementInstalled = true;
  } catch (error) {
    removeAfterFailure(replacementTempPath);
    if (previousMoved && !replacementInstalled && !pathExists(destinationPath)) {
      try {
        renameSync(previousPath, destinationPath);
      } catch (rollbackError) {
        console.warn(
          `Failed to restore bundled theme ${JSON.stringify(themeID)} after replacement failed.`,
          rollbackError,
        );
      }
    }
    console.warn(
      `Failed to replace bundled theme ${JSON.stringify(themeID)}; it will retry on the next boot.`,
      error,
    );
    return false;
  }

  try {
    rmSync(previousPath, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      `Bundled theme ${JSON.stringify(themeID)} was replaced, but its hidden prior copy could not be removed.`,
      error,
    );
  }
  return true;
}

function copyFresh(sourcePath: string, destinationPath: string): void {
  cpSync(sourcePath, destinationPath, {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
  });
}

function unusedBackupPath(storagePath: string, themeID: BundledThemeID): string {
  const initialTime = Date.now();
  for (let offsetSeconds = 0;; offsetSeconds += 1) {
    const timestamp = new Date(initialTime + offsetSeconds * 1_000)
      .toISOString()
      .slice(0, BACKUP_TIMESTAMP_LENGTH)
      .replace("T", "-")
      .replaceAll(":", "-");
    const candidate = path.join(getThemesDir(storagePath), `.${themeID}.backup.${timestamp}`);
    if (!pathExists(candidate)) return candidate;
  }
}

/** Restore any prior destination before the serving store scans themes. */
function recoverInterruptedReplacements(storagePath: string): Set<BundledThemeID> {
  const failed = new Set<BundledThemeID>();
  const themesPath = getThemesDir(storagePath);
  const entries = readdirSync(themesPath, { withFileTypes: true });

  for (const { id } of BUNDLED_THEMES) {
    const previousPrefix = `.${id}.bundled-theme.previous-`;
    const previousNames = entries
      .map(({ name }) => name)
      .filter((name) => name.startsWith(previousPrefix) && /^\d+$/.test(name.slice(previousPrefix.length)))
      .sort();
    const destinationPath = getThemeDir(storagePath, id);

    if (!pathExists(destinationPath) && previousNames.length > 0) {
      const previousPath = path.join(themesPath, previousNames[0]!);
      try {
        renameSync(previousPath, destinationPath);
      } catch (error) {
        failed.add(id);
        console.warn(
          `Failed to recover interrupted replacement of bundled theme ${JSON.stringify(id)}; it will retry on the next boot.`,
          error,
        );
      }
    }

    if (pathExists(destinationPath)) {
      for (const previousName of previousNames) {
        const previousPath = path.join(themesPath, previousName);
        if (!pathExists(previousPath)) continue;
        try {
          rmSync(previousPath, { recursive: true, force: true });
        } catch (error) {
          console.warn(
            `Failed to remove an interrupted replacement copy for bundled theme ${JSON.stringify(id)}.`,
            error,
          );
        }
      }
    }
  }

  for (const entry of entries) {
    const match = /^\.(.+)\.bundled-theme\.(?:tmp|backup-tmp)-(\d+)$/.exec(entry.name);
    if (match === null || !BUNDLED_THEME_IDS.includes(match[1] as BundledThemeID)) continue;
    if (Number(match[2]) === process.pid && !entry.isDirectory()) continue;
    try {
      rmSync(path.join(themesPath, entry.name), { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to remove bundled theme copy temporary ${JSON.stringify(entry.name)}.`, error);
    }
  }

  return failed;
}

function removeAfterFailure(candidatePath: string): void {
  try {
    rmSync(candidatePath, { recursive: true, force: true });
  } catch {
    // The original copy or replacement error is the useful failure.
  }
}

function pathExists(candidatePath: string): boolean {
  try {
    lstatSync(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function hasValidThemeIDs(value: unknown): value is string[] {
  if (!Array.isArray(value) || !value.every((themeID): themeID is string => typeof themeID === "string")) {
    return false;
  }
  const sorted = [...value].sort((left, right) => left.localeCompare(right, "en"));
  return sorted.length === new Set(sorted).size && sorted.every((themeID, index) => themeID === value[index]);
}

function isBundledThemeState(value: unknown): value is BundledThemeState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).sort().join(",") ===
      "initialThemeSelectionComplete,installedThemeIDs,version" &&
    candidate.version === BUNDLED_THEME_STATE_VERSION &&
    typeof candidate.initialThemeSelectionComplete === "boolean" &&
    hasValidThemeIDs(candidate.installedThemeIDs);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

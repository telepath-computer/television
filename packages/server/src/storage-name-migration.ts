import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import {
  getChannelsDir,
  getDisplayMigrationTempPath,
  getDisplayStatePath,
  getLegacyScreensDir,
} from "./artifact-paths.ts";

const JSON_INDENT_SPACES = 2;

function isActiveID(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isThemeName(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

/**
 * Move the legacy metadata directory to its channel-era name before ordinary
 * bootstrap creates current directories. Populated directories are never
 * copied, merged, or removed.
 */
export function migrateChannelMetadataDirectory(storagePath: string): void {
  const legacyDir = getLegacyScreensDir(storagePath);
  const currentDir = getChannelsDir(storagePath);
  const legacyExists = existsSync(legacyDir);
  const currentExists = existsSync(currentDir);

  if (!legacyExists) {
    return;
  }
  if (!currentExists) {
    renameSync(legacyDir, currentDir);
    return;
  }

  const legacyEntries = readdirSync(legacyDir);
  const currentEntries = readdirSync(currentDir);

  if (legacyEntries.length === 0) {
    // rmdirSync fails rather than deleting if an entry appears after readdir.
    rmdirSync(legacyDir);
    return;
  }
  if (currentEntries.length === 0) {
    // Same-filesystem rename is the single commit point. On supported hosts it
    // atomically replaces the existing empty directory.
    renameSync(legacyDir, currentDir);
    return;
  }

  throw new Error(
    `Cannot migrate channel metadata: both ${legacyDir} and ${currentDir} are non-empty`,
  );
}

/**
 * Rename the active-workspace field in a valid display document. Invalid
 * documents remain for the existing loader to handle.
 */
export function migrateDisplayStateField(storagePath: string): void {
  const displayPath = getDisplayStatePath(storagePath);
  if (!existsSync(displayPath)) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(displayPath, "utf8"));
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return;
  }

  const record = parsed as Record<string, unknown>;
  const hasLegacy = Object.hasOwn(record, "activeScreenID");
  const hasCurrent = Object.hasOwn(record, "activeChannelID");
  if (!hasLegacy && !hasCurrent) {
    return;
  }
  if (!Object.hasOwn(record, "activeThemeName") || !isThemeName(record.activeThemeName)) {
    return;
  }
  if (hasLegacy && !isActiveID(record.activeScreenID)) {
    return;
  }
  if (hasCurrent && !isActiveID(record.activeChannelID)) {
    return;
  }

  if (!hasLegacy) {
    return;
  }
  if (hasCurrent && record.activeScreenID !== record.activeChannelID) {
    throw new Error(
      "Display state has conflicting activeScreenID and activeChannelID values",
    );
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "activeScreenID") {
      if (!hasCurrent) {
        next.activeChannelID = value;
      }
      continue;
    }
    next[key] = value;
  }

  const temporaryPath = getDisplayMigrationTempPath(storagePath);
  writeFileSync(temporaryPath, JSON.stringify(next, null, JSON_INDENT_SPACES));
  renameSync(temporaryPath, displayPath);
}

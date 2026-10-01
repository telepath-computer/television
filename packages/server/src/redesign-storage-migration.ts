import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  validatePageLayout,
  type LayoutNode,
} from "@telepath-computer/television-shared";
import {
  getChannelsDir,
  getDisplayStatePath,
} from "./artifact-paths.ts";
import {
  backfillStoredChannelPageSizes,
  convertStoredChannelRecord,
  convertStoredDisplayRecord,
  type CurrentStoredChannelRecord,
  type CurrentStoredDisplayRecord,
  type IntermediateStoredChannelRecord,
  type LegacyStoredChannelRecord,
  type LegacyStoredDisplayRecord,
  type PreSizeStoredChannelRecord,
} from "./redesign-record-migration.ts";
import {
  migrateChannelMetadataDirectory,
  migrateDisplayStateField,
} from "./storage-name-migration.ts";

const JSON_INDENT_SPACES = 2;
const JSON_FILE_SUFFIX = ".json";

type ConvertibleChannelRecord =
  | LegacyStoredChannelRecord
  | IntermediateStoredChannelRecord
  | PreSizeStoredChannelRecord
  | CurrentStoredChannelRecord;
type ConvertibleDisplayRecord = LegacyStoredDisplayRecord | CurrentStoredDisplayRecord;

type LoadableChannelRecord = {
  id: string;
  convertible: ConvertibleChannelRecord | null;
};

/**
 * Run the redesign's one ordered, pre-serve storage migration.
 *
 * Each record replacement is atomic on its own file. Completed records are
 * already valid inputs on retry, so recovery needs neither a journal nor
 * rollback across files.
 */
export function runRedesignStorageMigration(storagePath: string): void {
  migrateChannelMetadataDirectory(storagePath);
  migrateDisplayStateField(storagePath);
  const channelIds = migrateChannelRecords(storagePath);
  migrateDisplayRecord(storagePath, channelIds);
  backfillChannelPageSizes(storagePath);
  migrateDisplayAppearanceMode(storagePath);
}

/** The same-directory temporary path used for one atomic record replacement. */
export function getRedesignRecordMigrationTempPath(recordPath: string): string {
  return path.join(path.dirname(recordPath), `.${path.basename(recordPath)}.redesign.tmp`);
}

function migrateChannelRecords(storagePath: string): string[] {
  const channelsDir = getChannelsDir(storagePath);
  if (!existsSync(channelsDir)) {
    return [];
  }

  const channelIds: string[] = [];
  for (const file of readdirSync(channelsDir).sort()) {
    if (!file.endsWith(JSON_FILE_SUFFIX)) continue;
    const recordPath = path.join(channelsDir, file);
    const parsed = readJSON(recordPath);
    const inspected = inspectChannelRecord(parsed);
    if (inspected === null) continue;

    channelIds.push(inspected.id);
    if (inspected.convertible !== null) {
      const converted = convertStoredChannelRecord(inspected.convertible);
      if (converted !== inspected.convertible) {
        writeAtomicJSON(recordPath, converted);
      }
    }
  }
  return channelIds;
}

function migrateDisplayRecord(storagePath: string, channelIds: readonly string[]): void {
  const displayPath = getDisplayStatePath(storagePath);
  if (!existsSync(displayPath)) return;

  const parsed = readJSON(displayPath);
  const record = parseConvertibleDisplayRecord(parsed);
  if (record === null) return;

  const converted = convertStoredDisplayRecord(record, channelIds);
  if (converted !== record) {
    writeAtomicJSON(displayPath, converted);
  }
}

function backfillChannelPageSizes(storagePath: string): void {
  const channelsDir = getChannelsDir(storagePath);
  if (!existsSync(channelsDir)) return;

  for (const file of readdirSync(channelsDir).sort()) {
    if (!file.endsWith(JSON_FILE_SUFFIX)) continue;
    const recordPath = path.join(channelsDir, file);
    const record = inspectPageSizeBackfillRecord(readJSON(recordPath));
    if (record === null) continue;

    const backfilled = backfillStoredChannelPageSizes(record);
    if (backfilled !== record) {
      writeAtomicJSON(recordPath, backfilled);
    }
  }
}

function migrateDisplayAppearanceMode(storagePath: string): void {
  const displayPath = getDisplayStatePath(storagePath);
  if (!existsSync(displayPath)) return;

  const record = readJSON(displayPath);
  if (!isRecord(record) || Object.hasOwn(record, "appearanceMode")) return;
  if (!isNullableString(record.focusedChannelId) ||
      !Array.isArray(record.pinnedChannelIds) ||
      !record.pinnedChannelIds.every((id) => typeof id === "string") ||
      !isThemeName(record.activeThemeName)) {
    return;
  }

  writeAtomicJSON(displayPath, { ...record, appearanceMode: "system" });
}

function writeAtomicJSON(recordPath: string, value: unknown): void {
  const temporaryPath = getRedesignRecordMigrationTempPath(recordPath);
  writeFileSync(temporaryPath, JSON.stringify(value, null, JSON_INDENT_SPACES));
  renameSync(temporaryPath, recordPath);
}

function readJSON(recordPath: string): unknown {
  const bytes = readFileSync(recordPath, "utf8");
  try {
    return JSON.parse(bytes);
  } catch {
    return null;
  }
}

function inspectChannelRecord(value: unknown): LoadableChannelRecord | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }

  if (value.layoutVersion === 2) {
    if (!isStoredPageLayout(value.layout)) return null;
    const convertible = value as ConvertibleChannelRecord;
    const converted = convertStoredChannelRecord(convertible);
    const normalized = backfillStoredChannelPageSizes(converted);
    if (!validatePageLayout(normalized.layout).valid) {
      return null;
    }
    // The current loader admits the channel but drops an unrecognized marker.
    // Preserve both that loadability and the file's no-op bytes; only the exact
    // authored legacy marker enters conversion.
    return {
      id: value.id,
      convertible: isLegacyOnboardingMarker(value.onboarding)
        ? convertible
        : null,
    };
  }

  if (Object.hasOwn(value, "layoutVersion") || !isLegacyLayout(value.layout)) {
    return null;
  }
  if (value.onboarding !== undefined && !isLegacyOnboardingMarker(value.onboarding)) {
    return null;
  }
  return { id: value.id, convertible: value as ConvertibleChannelRecord };
}

function inspectPageSizeBackfillRecord(
  value: unknown,
): PreSizeStoredChannelRecord | CurrentStoredChannelRecord | null {
  if (!isRecord(value) || typeof value.id !== "string" ||
      typeof value.name !== "string" || value.layoutVersion !== 2 ||
      !isStoredPageLayout(value.layout)) {
    return null;
  }

  const record = value as PreSizeStoredChannelRecord | CurrentStoredChannelRecord;
  const normalized = backfillStoredChannelPageSizes(record);
  return validatePageLayout(normalized.layout).valid ? record : null;
}

function isStoredPageLayout(value: unknown): value is PreSizeStoredChannelRecord["layout"] {
  return Array.isArray(value) && value.every(isRecord);
}

function parseConvertibleDisplayRecord(value: unknown): ConvertibleDisplayRecord | null {
  if (!isRecord(value) || !isThemeName(value.activeThemeName)) {
    return null;
  }

  if (Object.hasOwn(value, "activeChannelID")) {
    return isNullableString(value.activeChannelID)
      ? value as LegacyStoredDisplayRecord
      : null;
  }

  return isNullableString(value.focusedChannelId) &&
      Array.isArray(value.pinnedChannelIds) &&
      value.pinnedChannelIds.every((id) => typeof id === "string")
    ? value as CurrentStoredDisplayRecord
    : null;
}

function isLegacyLayout(value: unknown): value is LayoutNode[] {
  return Array.isArray(value) && value.every(isLegacyNode);
}

function isLegacyNode(value: unknown): value is LayoutNode {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "card":
      return typeof value.artifactID === "string" &&
        isLegacySize(value.width) &&
        isLegacySize(value.height);
    case "row":
      return typeof value.id === "string" &&
        isLegacySize(value.height) &&
        Array.isArray(value.children) &&
        value.children.every(isLegacyCard);
    case "stack":
      return typeof value.id === "string" &&
        Array.isArray(value.children) &&
        value.children.every((child) =>
          isRecord(child) && (child.type === "card" ? isLegacyCard(child) : isLegacyRow(child))
        );
    default:
      return false;
  }
}

function isLegacyCard(value: unknown): boolean {
  return isRecord(value) &&
    value.type === "card" &&
    typeof value.artifactID === "string" &&
    isLegacySize(value.width) &&
    isLegacySize(value.height);
}

function isLegacyRow(value: unknown): boolean {
  return isRecord(value) &&
    value.type === "row" &&
    typeof value.id === "string" &&
    isLegacySize(value.height) &&
    Array.isArray(value.children) &&
    value.children.every(isLegacyCard);
}

function isLegacySize(value: unknown): boolean {
  return value === "auto" || typeof value === "number";
}

function isLegacyOnboardingMarker(value: unknown): boolean {
  return isRecord(value) &&
    Object.keys(value).length === 2 &&
    typeof value.slug === "string" &&
    typeof value.order === "number";
}

function isThemeName(value: unknown): boolean {
  return typeof value === "string" || value === null;
}

function isNullableString(value: unknown): boolean {
  return typeof value === "string" || value === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

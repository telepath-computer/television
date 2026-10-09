import path from "node:path";
import type { PageSize, TabPage } from "@telepath-computer/television-shared";
import { deleteFile, rewriteFile, type ResourceStorageOperations } from "./resources/storage.ts";

/**
 * The durable record that commits a move of an artifact between channels
 * (specs/arch/layout/index.md#^ly-move). The two channels are saved
 * separately, so the record carries everything needed to complete the move
 * from either channel's stored state: the page's geometry and size travel
 * with it in case the source page is already gone.
 */
export interface MoveRecord {
  artifactID: string;
  sourceChannelID: string;
  targetChannelID: string;
  geometry: TabPage["geometry"];
  size: PageSize;
}

export function moveRecordPath(storagePath: string): string {
  return path.join(storagePath, "state", "pending-move.json");
}

/** Saves the record durably; a throw before the rename leaves no record. */
export function writeMoveRecord(storage: ResourceStorageOperations, storagePath: string, record: MoveRecord): void {
  rewriteFile(storage, moveRecordPath(storagePath), JSON.stringify(record, null, 2));
}

/** The pending record, or null when none exists. */
export function readMoveRecord(storage: ResourceStorageOperations, storagePath: string): MoveRecord | null {
  let text: string;
  try {
    text = storage.readFile(moveRecordPath(storagePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = JSON.parse(text) as Partial<MoveRecord>;
  if (
    typeof parsed.artifactID !== "string" ||
    typeof parsed.sourceChannelID !== "string" ||
    typeof parsed.targetChannelID !== "string" ||
    parsed.geometry === undefined ||
    parsed.size === undefined
  ) {
    throw new Error(`Malformed move record: ${moveRecordPath(storagePath)}`);
  }
  return parsed as MoveRecord;
}

export function removeMoveRecord(storage: ResourceStorageOperations, storagePath: string): void {
  deleteFile(storage, moveRecordPath(storagePath));
}

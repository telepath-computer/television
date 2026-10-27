import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The filesystem operations the resource layer's file writer and reads use.
 * Production uses Node's; a test may supply an adapter that records each
 * operation in order or fails a chosen one (proofs/arch/resources/index.md,
 * Test hooks).
 */
export interface ResourceStorageOperations {
  /** Creates `filePath`, which must not exist, holding `contents`. */
  writeTemporaryFile(filePath: string, contents: string): void;
  /** Flushes a file's contents to disk. */
  flushFile(filePath: string): void;
  rename(fromPath: string, toPath: string): void;
  /** Flushes a directory's entries to disk. */
  flushDirectory(directoryPath: string): void;
  deleteFile(filePath: string): void;
  /** Creates a directory, whose parent must exist. */
  createDirectory(directoryPath: string): void;
  /** Removes an empty directory. */
  removeDirectory(directoryPath: string): void;
  /** Reads a whole file as UTF-8 text. */
  readFile(filePath: string): string;
  /** A directory's entries, each with whether it is a directory. */
  readDirectory(directoryPath: string): DirectoryEntry[];
  /**
   * Whether a file or directory exists. False only when the filesystem
   * confirms that it is absent; any other failure to check throws.
   */
  exists(targetPath: string): boolean;
}

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
}

function flush(target: string, flags: string): void {
  const descriptor = openSync(target, flags);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export const nodeResourceStorageOperations: ResourceStorageOperations = {
  writeTemporaryFile(filePath, contents) {
    const descriptor = openSync(filePath, "wx");
    try {
      writeFileSync(descriptor, contents);
    } finally {
      closeSync(descriptor);
    }
  },
  flushFile: (filePath) => flush(filePath, "r+"),
  rename: (fromPath, toPath) => renameSync(fromPath, toPath),
  flushDirectory: (directoryPath) => flush(directoryPath, "r"),
  deleteFile: (filePath) => unlinkSync(filePath),
  createDirectory: (directoryPath) => mkdirSync(directoryPath),
  removeDirectory: (directoryPath) => rmdirSync(directoryPath),
  readFile: (filePath) => readFileSync(filePath, "utf8"),
  readDirectory: (directoryPath) => readdirSync(directoryPath, { withFileTypes: true }).map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() })),
  exists(targetPath) {
    try {
      statSync(targetPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  },
};

const TEMPORARY_SUFFIX_BYTES = 8;
const TEMPORARY_FILE_PATTERN = /^\..+\.tmp-[0-9a-f]{16}$/;

/** Whether a file name is one of the writer's temporary files, left behind by an interrupted rewrite. */
export function isTemporaryFileName(name: string): boolean {
  return TEMPORARY_FILE_PATTERN.test(name);
}

/** A rewrite that failed after its rename replaced the file, so either version may be on disk. */
export class UncertainWriteError extends Error {}

/**
 * Rewrites a whole file: a temporary file in the same directory, flushed to
 * disk and renamed over the original, then a flush of the directory. The
 * change is complete only when this returns (specs/arch/resources/index.md
 * ^rs-storage). A failure before the rename leaves the original in place; a
 * failure after it throws `UncertainWriteError`.
 */
export function rewriteFile(storage: ResourceStorageOperations, filePath: string, contents: string): void {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.tmp-${randomBytes(TEMPORARY_SUFFIX_BYTES).toString("hex")}`);
  let renamed = false;
  try {
    storage.writeTemporaryFile(temporaryPath, contents);
    storage.flushFile(temporaryPath);
    storage.rename(temporaryPath, filePath);
    renamed = true;
    storage.flushDirectory(directory);
  } catch (error) {
    if (renamed) {
      throw new UncertainWriteError(`the write may not have reached the disk: ${errorMessage(error)}`, { cause: error });
    }
    try {
      storage.deleteFile(temporaryPath);
    } catch {
      // The temporary file may never have been created; startup removes any left behind.
    }
    throw error;
  }
}

/**
 * Deletes a file and flushes its directory. A file that is already gone
 * counts as deleted. A failure of the flush after the deletion throws
 * `UncertainWriteError`: the file may come back after a crash.
 */
export function deleteFile(storage: ResourceStorageOperations, filePath: string): void {
  try {
    storage.deleteFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    storage.flushDirectory(path.dirname(filePath));
  } catch (error) {
    throw new UncertainWriteError(`the deletion may not have reached the disk: ${errorMessage(error)}`, { cause: error });
  }
}

/**
 * Creates a directory and any missing ancestors up to `root`, which must
 * exist, each followed by a flush of its parent, so that the new entry is
 * durable before anything is written inside it (specs/arch/resources/index.md
 * ^rs-storage). A failure of a flush after its creation throws
 * `UncertainWriteError`.
 */
export function createDirectories(storage: ResourceStorageOperations, root: string, directoryPath: string): void {
  const relative = path.relative(root, directoryPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${directoryPath} is not inside ${root}`);
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    const parent = current;
    current = path.join(current, segment);
    if (storage.exists(current)) continue;
    storage.createDirectory(current);
    try {
      storage.flushDirectory(parent);
    } catch (error) {
      throw new UncertainWriteError(`the new directory may not have reached the disk: ${errorMessage(error)}`, { cause: error });
    }
  }
}

/**
 * Removes an empty directory and flushes its parent. A failure of the flush
 * after the removal throws `UncertainWriteError`.
 */
export function removeDirectory(storage: ResourceStorageOperations, directoryPath: string): void {
  storage.removeDirectory(directoryPath);
  try {
    storage.flushDirectory(path.dirname(directoryPath));
  } catch (error) {
    throw new UncertainWriteError(`the removal may not have reached the disk: ${errorMessage(error)}`, { cause: error });
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

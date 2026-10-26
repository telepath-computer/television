import {
  cpSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { BUNDLED_ARTIFACT_TEMPLATE_IDS } from "./bundled-template-ids.ts";
import { compareSemanticVersions } from "./themes.ts";
import { getTemplatesDir, validateTemplatePackage } from "./templates.ts";

export const BUNDLED_ARTIFACT_TEMPLATES = BUNDLED_ARTIFACT_TEMPLATE_IDS.map((id) => ({ id, minimumVersion: "1.0.0" }));
export { BUNDLED_ARTIFACT_TEMPLATE_IDS } from "./bundled-template-ids.ts";

interface BundledTemplateState {
  version: 1;
  installedTemplateIDs: string[];
}

/** Filesystem operations used to observe replacement and state writes in tests. */
export interface BundledTemplateOperations {
  writeFileSync: typeof writeFileSync;
  renameSync: typeof renameSync;
  cpSync: typeof cpSync;
  rmSync: typeof rmSync;
}

const nodeOperations: BundledTemplateOperations = { writeFileSync, renameSync, cpSync, rmSync };

function exists(filename: string): boolean {
  try {
    lstatSync(filename);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function statePath(home: string): string {
  return path.join(home, "state/bundled-templates.json");
}

function readState(home: string): BundledTemplateState {
  const filename = statePath(home);
  if (!exists(filename)) return { version: 1, installedTemplateIDs: [] };
  const value: unknown = JSON.parse(readFileSync(filename, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid bundled-template state");
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(",") !== "installedTemplateIDs,version" || candidate.version !== 1 ||
    !Array.isArray(candidate.installedTemplateIDs) ||
    !candidate.installedTemplateIDs.every((id) => typeof id === "string") ||
    new Set(candidate.installedTemplateIDs).size !== candidate.installedTemplateIDs.length ||
    candidate.installedTemplateIDs.some((id, index, ids) => index > 0 && ids[index - 1].localeCompare(id, "en") > 0)) {
    throw new Error("invalid bundled-template state");
  }
  return candidate as unknown as BundledTemplateState;
}

function writeState(home: string, state: BundledTemplateState, operations: BundledTemplateOperations): void {
  const filename = statePath(home);
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.tmp-${process.pid}`);
  try {
    operations.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
    operations.renameSync(temporary, filename);
  } catch (error) {
    try { rmSync(temporary, { recursive: true, force: true }); } catch { /* Keep the original error. */ }
    throw error;
  }
}

function copyTree(source: string, destination: string, operations: BundledTemplateOperations): void {
  operations.cpSync(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
    filter(filename) {
      const entry = lstatSync(filename);
      if (!(entry.isDirectory() || entry.isFile() || entry.isSymbolicLink())) {
        throw new Error(`cannot copy unsupported entry ${filename}`);
      }
      return true;
    },
  });
}

function backupPath(templatesDir: string, id: string): string {
  const now = Date.now();
  for (let offset = 0;; offset += 1) {
    const stamp = new Date(now + offset * 1000).toISOString().slice(0, "YYYY-MM-DDTHH:mm:ss".length).replace("T", "-").replaceAll(":", "-");
    const filename = path.join(templatesDir, `.${id}.backup.${stamp}`);
    if (!exists(filename)) return filename;
  }
}

function meetsMinimum(destination: string, id: string, minimumVersion: string): boolean {
  try {
    if (!lstatSync(destination).isDirectory()) return false;
    const checked = validateTemplatePackage(destination, id);
    return checked.template !== undefined && compareSemanticVersions(checked.template.version, minimumVersion) >= 0;
  } catch {
    return false;
  }
}

/** Install bundled content only during a serving boot. */
export function runBundledTemplateInstallation(
  home: string,
  bundledTemplatesPath: string | undefined,
  overrides: Partial<BundledTemplateOperations> = {},
  inventory: readonly { id: string; minimumVersion: string }[] = BUNDLED_ARTIFACT_TEMPLATES,
): void {
  if (bundledTemplatesPath === undefined) return;
  const operations = { ...nodeOperations, ...overrides };
  let state: BundledTemplateState;
  try {
    state = readState(home);
  } catch (error) {
    console.warn("Bundled template state is invalid; skipping installation for this boot.", error);
    return;
  }
  const templatesDir = getTemplatesDir(home);
  for (const { id, minimumVersion } of inventory) {
    try {
      const destination = path.join(templatesDir, id);
      const temporary = path.join(templatesDir, `.${id}.bundled-template.tmp`);
      operations.rmSync(temporary, { recursive: true, force: true });
      if (!exists(destination) && state.installedTemplateIDs.includes(id)) continue;
      if (!meetsMinimum(destination, id, minimumVersion)) {
        if (exists(destination)) {
          const backup = backupPath(templatesDir, id);
          try {
            copyTree(destination, backup, operations);
          } catch (error) {
            try { rmSync(backup, { recursive: true, force: true }); } catch { /* Keep the copy error. */ }
            throw error;
          }
          // Remove the handled ID on disk before removing the folder.
          const unhandled: BundledTemplateState = {
            version: 1,
            installedTemplateIDs: state.installedTemplateIDs.filter((handled) => handled !== id),
          };
          writeState(home, unhandled, operations);
          state = unhandled;
          operations.rmSync(destination, { recursive: true, force: true });
        }
        // An incomplete copy must never be mistaken for a valid installed folder.
        copyTree(path.join(bundledTemplatesPath, id), temporary, operations);
        operations.renameSync(temporary, destination);
      }
      if (state.installedTemplateIDs.includes(id)) continue;
      const next: BundledTemplateState = {
        version: 1,
        installedTemplateIDs: [...state.installedTemplateIDs, id].sort((left, right) => left.localeCompare(right, "en")),
      };
      try {
        writeState(home, next, operations);
        state = next;
      } catch (error) {
        console.warn(`Failed to record bundled template ${JSON.stringify(id)}; it will retry on the next boot.`, error);
      }
    } catch (error) {
      console.warn(`Failed to handle bundled template ${JSON.stringify(id)}; it will retry on the next boot.`, error);
    }
  }
}

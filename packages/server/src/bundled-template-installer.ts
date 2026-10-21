import {
  cpSync,
  lstatSync,
  readFileSync,
  readdirSync,
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

/** Tests replace state-file writes through this interface. */
export interface BundledTemplateStateOperations {
  writeFileSync: typeof writeFileSync;
  renameSync: typeof renameSync;
}

const nodeStateOperations: BundledTemplateStateOperations = { writeFileSync, renameSync };

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

function writeState(home: string, state: BundledTemplateState, operations: BundledTemplateStateOperations): void {
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

function copyTree(source: string, destination: string): void {
  cpSync(source, destination, {
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

function restoreInterruptedReplacement(templatesDir: string, id: string): void {
  const previousPrefix = `.${id}.bundled-template.previous-`;
  const previous = readdirSync(templatesDir)
    .filter((name) => name.startsWith(previousPrefix) && /^\d+$/.test(name.slice(previousPrefix.length)))
    .sort();
  const destination = path.join(templatesDir, id);
  const paired = previous.map((name) => ({
    prior: path.join(templatesDir, name),
    staged: path.join(templatesDir, `.${id}.bundled-template.tmp-${name.slice(previousPrefix.length)}`),
  })).filter(({ staged }) => exists(staged));
  if (!exists(destination) && paired.length) renameSync(paired[0]!.prior, destination);
  for (const { prior, staged } of paired) {
    rmSync(prior, { recursive: true, force: true });
    rmSync(staged, { recursive: true, force: true });
  }
}

function installOrReplace(source: string, destination: string, id: string): boolean {
  const templatesDir = path.dirname(destination);
  const previous = path.join(templatesDir, `.${id}.bundled-template.previous-${process.pid}`);
  const temporary = path.join(templatesDir, `.${id}.bundled-template.tmp-${process.pid}`);
  const backupTemporary = path.join(templatesDir, `.${id}.bundled-template.backup-tmp-${process.pid}`);
  try {
    rmSync(temporary, { recursive: true, force: true });
    rmSync(backupTemporary, { recursive: true, force: true });
    if (exists(destination)) {
      copyTree(destination, backupTemporary);
      renameSync(backupTemporary, backupPath(templatesDir, id));
    }
    copyTree(source, temporary);
    if (exists(destination)) renameSync(destination, previous);
    try {
      renameSync(temporary, destination);
    } catch (error) {
      if (exists(previous) && !exists(destination)) renameSync(previous, destination);
      throw error;
    }
    if (exists(previous)) {
      try {
        rmSync(previous, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Bundled template ${JSON.stringify(id)} was replaced, but its hidden prior copy could not be removed.`, error);
      }
    }
    return true;
  } catch (error) {
    // If both destination renames failed, the complete staged copy marks the
    // hidden prior folder for recovery on the next serving boot.
    if (!exists(previous) || exists(destination)) {
      try { rmSync(temporary, { recursive: true, force: true }); } catch { /* Keep the original failure. */ }
    }
    try { rmSync(backupTemporary, { recursive: true, force: true }); } catch { /* Keep the original failure. */ }
    console.warn(`Failed to install bundled template ${JSON.stringify(id)}; it will retry on the next boot.`, error);
    return false;
  }
}

/** Install bundled content only during a serving boot. */
export function runBundledTemplateInstallation(
  home: string,
  bundledTemplatesPath: string | undefined,
  stateOperations: BundledTemplateStateOperations = nodeStateOperations,
): void {
  if (bundledTemplatesPath === undefined) return;
  let state: BundledTemplateState;
  try {
    state = readState(home);
  } catch (error) {
    console.warn("Bundled template state is invalid; skipping installation for this boot.", error);
    return;
  }
  const templatesDir = getTemplatesDir(home);
  for (const { id, minimumVersion } of BUNDLED_ARTIFACT_TEMPLATES) {
    try {
      restoreInterruptedReplacement(templatesDir, id);
      const destination = path.join(templatesDir, id);
      if (!exists(destination) && state.installedTemplateIDs.includes(id)) continue;
      if (!meetsMinimum(destination, id, minimumVersion) &&
        !installOrReplace(path.join(bundledTemplatesPath, id), destination, id)) continue;
      if (state.installedTemplateIDs.includes(id)) continue;
      const next: BundledTemplateState = {
        version: 1,
        installedTemplateIDs: [...state.installedTemplateIDs, id].sort((left, right) => left.localeCompare(right, "en")),
      };
      try {
        writeState(home, next, stateOperations);
        state = next;
      } catch (error) {
        console.warn(`Failed to record bundled template ${JSON.stringify(id)}; it will retry on the next boot.`, error);
      }
    } catch (error) {
      console.warn(`Failed to handle bundled template ${JSON.stringify(id)}; it will retry on the next boot.`, error);
    }
  }
}

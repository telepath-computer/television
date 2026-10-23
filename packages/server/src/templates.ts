import {
  accessSync,
  constants,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { isExternalArtifactURL } from "@telepath-computer/television-artifact";
import { compileTemplateSchema, templateSchemaHint } from "./template-schema.ts";
import type { ArtifactDisplayOptions, AppTemplate, ArtifactTemplateScan, JSONSchema } from "@telepath-computer/television-shared";
import { isSemanticVersion } from "./themes.ts";

const MAX_SLUG_LENGTH = 60;
const SUFFIX_RADIX = 36;
const SUFFIX_LENGTH = 5;

export function getTemplatesDir(storagePath: string): string {
  return path.join(storagePath, "templates");
}

export class TemplateCreationError extends Error {}

export function templateFolderName(title: string, suffix: string): string {
  let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (slug.length > MAX_SLUG_LENGTH) {
    slug = slug.slice(0, MAX_SLUG_LENGTH);
    const lastHyphen = slug.lastIndexOf("-");
    if (lastHyphen !== -1) slug = slug.slice(0, lastHyphen);
    slug = slug.replace(/-$/, "");
  }
  return `${slug || "artifact"}-${suffix}`;
}

export function randomTemplateSuffix(): string {
  return randomInt(SUFFIX_RADIX ** SUFFIX_LENGTH).toString(SUFFIX_RADIX).padStart(SUFFIX_LENGTH, "0");
}

export function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function relinkCopiedTemplateSymlinks(templateFolder: string, copyFolder: string): void {
  const templateRoots = [path.resolve(templateFolder), realpathSync(templateFolder)];
  const visit = (relativePath: string): void => {
    const copied = path.join(copyFolder, relativePath);
    const entry = lstatSync(copied);
    if (entry.isDirectory()) {
      for (const child of readdirSync(copied)) visit(path.join(relativePath, child));
      return;
    }
    if (!entry.isSymbolicLink()) return;
    const source = path.join(templateFolder, relativePath);
    const target = path.resolve(path.dirname(source), readlinkSync(source));
    const templateRoot = templateRoots.find((root) => isContainedPath(root, target));
    if (!templateRoot) return;
    const insideCopy = path.join(copyFolder, path.relative(templateRoot, target));
    const relativeTarget = path.relative(path.dirname(copied), insideCopy) || ".";
    if (readlinkSync(copied) === relativeTarget) return;
    rmSync(copied);
    symlinkSync(relativeTarget, copied);
  };
  for (const entry of readdirSync(copyFolder)) visit(entry);
}

function readableFile(filename: string): boolean {
  try {
    if (!statSync(filename).isFile()) return false;
    accessSync(filename, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function readableTemplateThumbnail(folder: string): string | null {
  try {
    const root = realpathSync(folder);
    const image = realpathSync(path.join(folder, "thumbnail.png"));
    return isContainedPath(root, image) && readableFile(image) ? image : null;
  } catch {
    return null;
  }
}

export function validateTemplatePackage(folder: string, id: string): { template?: AppTemplate; errors: string[] } {
  const errors: string[] = [];
  let manifest: Record<string, unknown> | undefined;
  let display: ArtifactDisplayOptions | undefined;
  let url: string | undefined;
  let dataSchema: JSONSchema | undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(folder, "manifest.json"), "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      manifest = parsed as Record<string, unknown>;
    } else {
      errors.push("manifest.json must contain an object");
    }
  } catch {
    errors.push("cannot read or parse manifest.json");
  }

  if (manifest !== undefined) {
    if (typeof manifest.name !== "string" || manifest.name.trim() === "") errors.push("manifest name must be non-empty");
    if (typeof manifest.description !== "string" || manifest.description.trim() === "") errors.push("manifest description must be non-empty");
    if (typeof manifest.version !== "string" || !isSemanticVersion(manifest.version)) {
      errors.push("manifest version must be a valid Semantic Version");
    }
    if (Object.hasOwn(manifest, "display")) {
      const candidate = manifest.display;
      if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
        errors.push("manifest display must be an object");
      } else {
        const fields = candidate as Record<string, unknown>;
        display = {};
        for (const key of ["width", "height"] as const) {
          if (!Object.hasOwn(fields, key)) continue;
          const value = fields[key];
          if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
            errors.push(`manifest display.${key} must be a finite, positive number`);
          } else {
            display[key] = value;
          }
        }
        for (const key of ["fullScreen", "transparent"] as const) {
          if (!Object.hasOwn(fields, key)) continue;
          const value = fields[key];
          if (typeof value !== "boolean") errors.push(`manifest display.${key} must be a boolean`);
          else display[key] = value;
        }
      }
    }
  }
  if (manifest && Object.hasOwn(manifest, "url")) {
    if (typeof manifest.url !== "string" || !isExternalArtifactURL(manifest.url.trim())) {
      errors.push("manifest url must be an absolute HTTP(S) URL");
    } else url = manifest.url.trim();
    if (Object.hasOwn(manifest, "dataSchema")) errors.push("URL templates cannot declare dataSchema");
  } else {
    if (!readableFile(path.join(folder, "index.html"))) errors.push("index.html must be a readable file");
    if (manifest && Object.hasOwn(manifest, "dataSchema")) {
      try {
        const candidate = manifest.dataSchema;
        if (typeof candidate !== "boolean" && (!candidate || typeof candidate !== "object" || Array.isArray(candidate))) {
          throw new Error("must be a boolean or schema object");
        }
        compileTemplateSchema(candidate as JSONSchema);
        dataSchema = candidate as JSONSchema;
      } catch (error) {
        errors.push(`dataSchema ${error instanceof Error ? error.message : String(error)}. ${templateSchemaHint(id)}`);
      }
    }
  }

  return errors.length === 0 && manifest !== undefined
    ? { template: {
        id,
        name: manifest.name as string,
        description: manifest.description as string,
        version: manifest.version as string,
        ...(display !== undefined ? { display } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(dataSchema !== undefined ? { dataSchema } : {}),
        hasIcon: false,
        path: folder,
      }, errors: [] }
    : { errors };
}

export function scanTemplatesDirectory(templatesDir: string): ArtifactTemplateScan {
  let entries;
  try {
    entries = readdirSync(templatesDir, { withFileTypes: true });
  } catch {
    return { templates: [], errors: [{ folder: null, error: "cannot read templates directory" }], watching: false };
  }

  const result: ArtifactTemplateScan = { templates: [], errors: [], watching: false };
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const checked = validateTemplatePackage(path.join(templatesDir, entry.name), entry.name);
    if (checked.template) result.templates.push(checked.template);
    else result.errors.push({ folder: entry.name, error: checked.errors.join("; ") });
  }
  result.templates.sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en"));
  result.errors.sort((a, b) => (a.folder ?? "").localeCompare(b.folder ?? "", "en"));
  return result;
}

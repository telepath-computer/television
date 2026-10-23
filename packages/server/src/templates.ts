import {
  accessSync,
  constants,
  closeSync,
  openSync,
  readSync,
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
import type { ArtifactDisplayOptions, AppTemplate, ArtifactTemplateIcon, ArtifactTemplateScan, JSONSchema } from "@telepath-computer/television-shared";
import { isSemanticVersion } from "./themes.ts";

const MAX_SLUG_LENGTH = 60;
const SUFFIX_RADIX = 36;
const SUFFIX_LENGTH = 5;
const ICON_TARGET_SIZE = 40;
const ICON_RANK = { scalable: 0, sufficient: 1, undersized: 2, unsized: 3 } as const;
const PNG_HEADER_LENGTH = 24;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_CHUNK_TYPE_OFFSET = 12;
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;

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

type IconType = "image/svg+xml" | "image/png";

function iconPath(folder: string, src: string): string | undefined {
  if (!src || path.isAbsolute(src) || /^[a-z][a-z0-9+.-]*:/i.test(src)) return;
  try {
    const file = realpathSync(path.resolve(folder, src));
    if (isContainedPath(realpathSync(folder), file) && readableFile(file)) return file;
  } catch { /* Missing icons are optional. */ }
}

function usableIcons(folder: string, input: unknown): ArtifactTemplateIcon[] {
  if (!Array.isArray(input)) return [];
  const icons: ArtifactTemplateIcon[] = [];
  for (const candidate of input as unknown[]) {
    if (!candidate || typeof candidate !== "object") continue;
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.src !== "string" || !iconPath(folder, entry.src)) continue;
    let type = typeof entry.type === "string" ? entry.type.trim() : "";
    if (!type) {
      const extension = path.extname(entry.src).toLowerCase();
      type = extension === ".svg" ? "image/svg+xml" : extension === ".png" ? "image/png" : "";
    }
    if (type !== "image/svg+xml" && type !== "image/png") continue;
    const purpose = typeof entry.purpose === "string" ? entry.purpose.trim() : undefined;
    if (purpose !== undefined && !purpose.split(/\s+/).includes("any")) continue;
    const sizes = typeof entry.sizes === "string" ? entry.sizes.split(/\s+/).filter((size: string) =>
      size === "any" || /^[1-9]\d*x[1-9]\d*$/.test(size)).join(" ") : "";
    icons.push({ src: entry.src, type, ...(sizes ? { sizes } : {}), ...(purpose !== undefined ? { purpose } : {}) });
  }
  return icons;
}

function pngSize(file: string): number | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(file, "r");
    const bytes = Buffer.alloc(PNG_HEADER_LENGTH);
    const length = readSync(descriptor, bytes, 0, bytes.length, 0);
    if (length === PNG_HEADER_LENGTH && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) &&
        bytes.toString("ascii", PNG_CHUNK_TYPE_OFFSET, PNG_WIDTH_OFFSET) === "IHDR") {
      const size = Math.min(bytes.readUInt32BE(PNG_WIDTH_OFFSET), bytes.readUInt32BE(PNG_HEIGHT_OFFSET));
      if (size > 0) return size;
    }
  } catch { /* A disappearing image is ranked as unsized. */ }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

/** Select a readable local icon, checking containment again at delivery. */
export function selectTemplateIcon(template: Pick<AppTemplate, "path" | "icons">): { path: string; contentType: IconType } | undefined {
  let selected: { path: string; contentType: IconType } | undefined;
  let bestRank: [number, number] = [Infinity, Infinity];
  for (const icon of usableIcons(template.path, template.icons)) {
    const file = iconPath(template.path, icon.src);
    if (!file) continue;
    const sizes = icon.sizes?.split(" ") ?? [];
    let rank: [number, number];
    if (icon.type === "image/svg+xml" || sizes.includes("any")) rank = [ICON_RANK.scalable, 0];
    else {
      const dimensions = sizes.map((size) => Math.min(...size.split("x").map(Number)));
      const sufficient = dimensions.filter((size) => size >= ICON_TARGET_SIZE);
      const size = sufficient.length ? Math.min(...sufficient) : dimensions.length ? Math.max(...dimensions) : pngSize(file);
      // Sufficient PNGs rank first, then undersized PNGs, then unreadable sizes.
      rank = size === undefined ? [ICON_RANK.unsized, 0] : size >= ICON_TARGET_SIZE ? [ICON_RANK.sufficient, size] : [ICON_RANK.undersized, -size];
    }
    if (!selected || rank[0] < bestRank[0] || (rank[0] === bestRank[0] && rank[1] < bestRank[1])) {
      selected = { path: file, contentType: icon.type as IconType };
      bestRank = rank;
    }
  }
  return selected;
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

  const icons = usableIcons(folder, manifest?.icons);
  return errors.length === 0 && manifest !== undefined
    ? { template: {
        id,
        name: manifest.name as string,
        description: manifest.description as string,
        version: manifest.version as string,
        ...(display !== undefined ? { display } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(dataSchema !== undefined ? { dataSchema } : {}),
        ...(icons.length ? { icons } : {}),
        hasIcon: icons.length > 0,
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

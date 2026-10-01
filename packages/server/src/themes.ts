import type express from "express";
import type {
  InstalledTheme,
  ThemeColorScheme,
  ThemeManifest,
  ThemeRegistrySnapshot,
} from "@telepath-computer/television-shared";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";

const ETAG_DIGEST_LENGTH = 16;
const HTTP_NO_CONTENT_STATUS = 204;
const HTTP_NOT_FOUND_STATUS = 404;
const HTTP_NOT_MODIFIED_STATUS = 304;
const THEME_MANIFEST_FILE = "manifest.json";
const THEME_ENTRY_FILE = "theme.css";
type ThemeScriptDeclaration = keyof Pick<
  ThemeManifest,
  "enableMainJS" | "enableIframeBackgroundJS" | "enableIframeOverlayJS"
>;
const THEME_SCRIPT_ENTRIES = [
  { declaration: "enableMainJS", filename: "main.js", requiresConsent: true },
  {
    declaration: "enableIframeBackgroundJS",
    filename: "iframe-background.js",
    requiresConsent: false,
  },
  {
    declaration: "enableIframeOverlayJS",
    filename: "iframe-overlay.js",
    requiresConsent: false,
  },
] as const satisfies readonly {
  declaration: ThemeScriptDeclaration;
  filename: string;
  requiresConsent: boolean;
}[];
const THEME_AUTHORING_CONTEXT_FILE = "README.md";

type ThemeScriptEntry = typeof THEME_SCRIPT_ENTRIES[number];
type ThemeScriptFilename = ThemeScriptEntry["filename"];

const SEMVER_NUMERIC_IDENTIFIER = "(?:0|[1-9]\\d*)";
const SEMVER_NON_NUMERIC_IDENTIFIER = "(?:\\d*[A-Za-z-][0-9A-Za-z-]*)";
const SEMVER_PRERELEASE_IDENTIFIER = `(?:${SEMVER_NUMERIC_IDENTIFIER}|${SEMVER_NON_NUMERIC_IDENTIFIER})`;
const SEMVER_BUILD_IDENTIFIER = "[0-9A-Za-z-]+";
const SEMVER_PATTERN = new RegExp(
  `^${SEMVER_NUMERIC_IDENTIFIER}\\.${SEMVER_NUMERIC_IDENTIFIER}\\.${SEMVER_NUMERIC_IDENTIFIER}` +
  `(?:-${SEMVER_PRERELEASE_IDENTIFIER}(?:\\.${SEMVER_PRERELEASE_IDENTIFIER})*)?` +
  `(?:\\+${SEMVER_BUILD_IDENTIFIER}(?:\\.${SEMVER_BUILD_IDENTIFIER})*)?$`,
);

interface ParsedSemanticVersion {
  core: readonly [bigint, bigint, bigint];
  prerelease: readonly string[] | null;
}

export function isSemanticVersion(value: string): boolean {
  return SEMVER_PATTERN.test(value);
}

/** Compare two validated Semantic Versions using SemVer 2.0.0 precedence. */
export function compareSemanticVersions(left: string, right: string): number {
  const leftVersion = parseSemanticVersion(left);
  const rightVersion = parseSemanticVersion(right);
  if (leftVersion === null || rightVersion === null) {
    throw new Error("Semantic Version comparison requires two valid versions");
  }

  for (let index = 0; index < leftVersion.core.length; index += 1) {
    const leftPart = leftVersion.core[index]!;
    const rightPart = rightVersion.core[index]!;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }

  if (leftVersion.prerelease === null) return rightVersion.prerelease === null ? 0 : 1;
  if (rightVersion.prerelease === null) return -1;
  const identifierCount = Math.max(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length,
  );
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index];
    const rightIdentifier = rightVersion.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return BigInt(leftIdentifier) < BigInt(rightIdentifier) ? -1 : 1;
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

function parseSemanticVersion(value: string): ParsedSemanticVersion | null {
  if (!isSemanticVersion(value)) return null;
  const withoutBuild = value.split("+", 1)[0]!;
  const prereleaseSeparator = withoutBuild.indexOf("-");
  const coreText = prereleaseSeparator === -1
    ? withoutBuild
    : withoutBuild.slice(0, prereleaseSeparator);
  const prerelease = prereleaseSeparator === -1
    ? null
    : withoutBuild.slice(prereleaseSeparator + 1).split(".");
  const [major, minor, patch] = coreText.split(".").map((part) => BigInt(part));
  return {
    core: [major!, minor!, patch!],
    prerelease,
  };
}

// ---------------------------------------------------------------------------
// Paths and validation
// ---------------------------------------------------------------------------

export function getThemesDir(storagePath: string): string {
  return path.join(storagePath, "themes");
}

export function getThemeDir(storagePath: string, themeID: string): string {
  return path.join(getThemesDir(storagePath), themeID);
}

export function getThemeEntryPath(storagePath: string, themeID: string): string {
  return path.join(getThemeDir(storagePath, themeID), THEME_ENTRY_FILE);
}

export interface ThemePackageValidationResult {
  theme?: InstalledTheme;
  errors: string[];
}

function normalizeThemeColorScheme(value: unknown): ThemeColorScheme | null {
  if (typeof value !== "string") return null;
  const words = new Set(value.trim().toLowerCase().split(/\s+/));
  if (words.size === 1 && words.has("light")) return "light";
  if (words.size === 1 && words.has("dark")) return "dark";
  if (words.size === 2 && words.has("light") && words.has("dark")) {
    return "light dark";
  }
  return null;
}

/** Validate one candidate package without including filesystem paths in errors. */
export function validateThemePackage(themeDir: string, themeID: string): ThemePackageValidationResult {
  const errors: string[] = [];
  let manifest: ThemeManifest | undefined;
  let parsed: unknown;

  try {
    const raw = readFileSync(path.join(themeDir, THEME_MANIFEST_FILE), "utf8");
    try {
      parsed = JSON.parse(raw);
    } catch {
      errors.push(`cannot parse ${THEME_MANIFEST_FILE}`);
    }
  } catch {
    errors.push(`cannot read ${THEME_MANIFEST_FILE}`);
  }

  if (parsed !== undefined) {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      errors.push(`${THEME_MANIFEST_FILE} must contain a JSON object`);
    } else {
      const candidate = parsed as Record<string, unknown>;
      const nameValid = typeof candidate.name === "string" && candidate.name.trim().length > 0;
      if (!nameValid) {
        errors.push("manifest must have a non-empty name");
      }

      const versionValid = typeof candidate.version === "string" && isSemanticVersion(candidate.version);
      if (!versionValid) {
        errors.push("manifest version must be a valid Semantic Version");
      }

      const colorScheme = normalizeThemeColorScheme(candidate.colorScheme);
      if (colorScheme === null) {
        errors.push(
          "manifest colorScheme must be one of: light, dark, light dark",
        );
      }

      const authoredForAppVersion = typeof candidate.authoredForAppVersion === "string" &&
        isSemanticVersion(candidate.authoredForAppVersion)
        ? candidate.authoredForAppVersion
        : undefined;
      const javascriptDeclarations: Partial<
        Pick<ThemeManifest, ThemeScriptDeclaration>
      > = {};
      let javascriptDeclarationsValid = true;
      for (const { declaration, filename } of THEME_SCRIPT_ENTRIES) {
        if (!Object.hasOwn(candidate, declaration)) continue;
        if (typeof candidate[declaration] !== "boolean") {
          errors.push(`manifest ${declaration} must be a boolean`);
          javascriptDeclarationsValid = false;
          continue;
        }
        javascriptDeclarations[declaration] = candidate[declaration];
        validateReadableRegularFile(themeDir, filename, errors);
      }

      if (
        nameValid && versionValid && colorScheme !== null &&
        javascriptDeclarationsValid
      ) {
        manifest = {
          name: candidate.name as string,
          version: candidate.version as string,
          colorScheme,
          ...(authoredForAppVersion === undefined ? {} : { authoredForAppVersion }),
          ...javascriptDeclarations,
        };
      }
    }
  }

  validateReadableRegularFile(themeDir, THEME_ENTRY_FILE, errors);

  return errors.length === 0 && manifest !== undefined
    ? { theme: { id: themeID, ...manifest }, errors: [] }
    : { errors };
}

function validateReadableRegularFile(
  themeDir: string,
  filename: string,
  errors: string[],
): void {
  try {
    const entryPath = path.join(themeDir, filename);
    if (!statSync(entryPath).isFile()) {
      errors.push(`${filename} must be a readable regular file`);
    } else {
      accessSync(entryPath, constants.R_OK);
    }
  } catch {
    errors.push(`${filename} must be a readable regular file`);
  }
}

export function scanThemesDirectory(themesDir: string): ThemeRegistrySnapshot {
  let entries;
  try {
    entries = readdirSync(themesDir, { withFileTypes: true });
  } catch {
    return {
      themes: [],
      errors: [{ folder: null, error: "cannot read themes directory" }],
    };
  }

  const themes: InstalledTheme[] = [];
  const errors: ThemeRegistrySnapshot["errors"] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const result = validateThemePackage(path.join(themesDir, entry.name), entry.name);
    if (result.theme !== undefined) {
      themes.push(result.theme);
    } else {
      errors.push({ folder: entry.name, error: result.errors.join("; ") });
    }
  }

  themes.sort((left, right) =>
    left.name.localeCompare(right.name, "en") || left.id.localeCompare(right.id, "en")
  );
  errors.sort((left, right) => (left.folder ?? "").localeCompare(right.folder ?? "", "en"));
  return { themes, errors };
}

// ---------------------------------------------------------------------------
// Public active-package delivery
// ---------------------------------------------------------------------------

interface ThemeDeliveryStore {
  readonly storagePath: string;
  getActiveThemeName(): string | null;
  getThemeRegistry(): ThemeRegistrySnapshot;
  hasThemeJavaScriptConsent(themeID: string): boolean;
}

/**
 * Serve files from the one active package at the stable `/theme/*` mount.
 * CSS bytes and URLs are never rewritten. The cached registry determines
 * whether a selected theme ID is a package; request handling never rescans it.
 */
export function serveActiveTheme(store: ThemeDeliveryStore): express.RequestHandler {
  return (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(HTTP_NO_CONTENT_STATUS).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    res.setHeader("Cache-Control", "no-cache");

    const relativePath = requestedThemePath(req.path);
    if (relativePath === null) {
      res.sendStatus(HTTP_NOT_FOUND_STATUS);
      return;
    }

    const activeThemeID = store.getActiveThemeName();
    const theme = activeThemeID === null
      ? undefined
      : store.getThemeRegistry().themes.find((candidate) => candidate.id === activeThemeID);
    if (theme === undefined) {
      sendMissingThemeResponse(relativePath, res);
      return;
    }

    const scriptEntry = getThemeScriptEntry(relativePath);
    if (
      scriptEntry !== undefined &&
      (
        theme[scriptEntry.declaration] !== true ||
        (scriptEntry.requiresConsent && !store.hasThemeJavaScriptConsent(theme.id))
      )
    ) {
      sendEmptyThemeEntryResponse(scriptEntry.filename, theme, res);
      return;
    }

    try {
      const themesRoot = realpathSync(getThemesDir(store.storagePath));
      const packageRoot = realpathSync(getThemeDir(store.storagePath, theme.id));
      if (!isContainedPath(themesRoot, packageRoot)) {
        sendMissingThemeResponse(relativePath, res, theme);
        return;
      }
      if (scriptEntry === undefined) {
        const entryPath = realpathSync(path.join(packageRoot, THEME_ENTRY_FILE));
        if (!isContainedPath(packageRoot, entryPath) || !statSync(entryPath).isFile()) {
          sendMissingThemeResponse(relativePath, res, theme);
          return;
        }
      }

      const candidate = path.resolve(packageRoot, relativePath);
      if (
        !isContainedPath(packageRoot, candidate) ||
        isThemeAuthoringContextPath(packageRoot, candidate)
      ) {
        res.sendStatus(HTTP_NOT_FOUND_STATUS);
        return;
      }
      const realCandidate = realpathSync(candidate);
      if (!isContainedPath(packageRoot, realCandidate)) {
        res.sendStatus(HTTP_NOT_FOUND_STATUS);
        return;
      }
      if (!statSync(realCandidate).isFile()) {
        sendMissingThemeResponse(relativePath, res, theme);
        return;
      }

      const bytes = readFileSync(realCandidate);
      const etag = themeETag(theme.id, theme.version, bytes);
      res.type(path.extname(relativePath));
      res.setHeader("ETag", etag);
      if (matchesIfNoneMatch(req.headers["if-none-match"], etag)) {
        res.status(HTTP_NOT_MODIFIED_STATUS).end();
        return;
      }
      res.send(bytes);
    } catch {
      sendMissingThemeResponse(relativePath, res, theme);
    }
  };
}

function requestedThemePath(requestPath: string): string | null {
  try {
    const decoded = decodeURIComponent(requestPath).replace(/^\/+/, "");
    if (decoded === "" || decoded.includes("\0") || path.isAbsolute(decoded)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function isContainedPath(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function isThemeAuthoringContextPath(packageRoot: string, candidate: string): boolean {
  return path.relative(packageRoot, candidate).toLowerCase() ===
    THEME_AUTHORING_CONTEXT_FILE.toLowerCase();
}

function isThemeEntryPath(relativePath: string, filename: string): boolean {
  return path.normalize(relativePath) === filename;
}

function getThemeScriptEntry(relativePath: string): ThemeScriptEntry | undefined {
  return THEME_SCRIPT_ENTRIES.find(({ filename }) =>
    isThemeEntryPath(relativePath, filename)
  );
}

function sendMissingThemeResponse(
  relativePath: string,
  res: express.Response,
  theme?: InstalledTheme,
): void {
  if (isThemeEntryPath(relativePath, THEME_ENTRY_FILE)) {
    sendEmptyThemeEntryResponse(THEME_ENTRY_FILE, theme, res);
    return;
  }
  const scriptEntry = getThemeScriptEntry(relativePath);
  if (scriptEntry !== undefined) {
    sendEmptyThemeEntryResponse(scriptEntry.filename, theme, res);
    return;
  }
  res.sendStatus(HTTP_NOT_FOUND_STATUS);
}

function sendEmptyThemeEntryResponse(
  filename: typeof THEME_ENTRY_FILE | ThemeScriptFilename,
  theme: InstalledTheme | undefined,
  res: express.Response,
): void {
  const bytes = Buffer.alloc(0);
  const etag = themeETag(theme?.id ?? "default", theme?.version ?? "internal", bytes);
  res.type(filename === THEME_ENTRY_FILE ? "text/css" : "text/javascript");
  res.setHeader("ETag", etag);
  res.send(bytes);
}

function themeETag(themeID: string, version: string, bytes: Buffer): string {
  const digest = createHash("sha256")
    .update(themeID)
    .update("\0")
    .update(version)
    .update("\0")
    .update(bytes)
    .digest("hex")
    .slice(0, ETAG_DIGEST_LENGTH);
  return `W/"theme-${digest}"`;
}

function matchesIfNoneMatch(
  header: string | string[] | undefined,
  etag: string,
): boolean {
  if (header === undefined) return false;
  const values = Array.isArray(header) ? header : [header];
  return values.some((value) =>
    value
      .split(",")
      .map((candidate) => candidate.trim())
      .some((candidate) => candidate === "*" || candidate === etag)
  );
}

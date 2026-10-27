import { ulid } from "ulid";
import { z } from "zod";

export const ARTIFACT_KINDS = ["path", "url"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const ARTIFACT_PATH_EXTENSIONS = [".md", ".markdown", ".htm", ".html"] as const;
export const MARKDOWN_PATH_EXTENSIONS = [".md", ".markdown"] as const;
export const HTML_PATH_EXTENSIONS = [".htm", ".html"] as const;

export function isArtifactKind(value: string): value is ArtifactKind {
  return ARTIFACT_KINDS.includes(value as ArtifactKind);
}

export function hasTrailingSeparator(value: string): boolean {
  if (value.length === 0) return false;
  const last = value.at(-1);
  return last === "/" || last === "\\";
}

export function stripTrailingSeparators(value: string): string {
  let end = value.length;
  // Keep at least one character so a root path like "/" survives intact.
  while (end > 1 && (value[end - 1] === "/" || value[end - 1] === "\\")) {
    end -= 1;
  }
  // Windows drive roots keep one separator: bare "C:" resolves to the
  // drive's current directory, not the drive root.
  if (end === 2 && end < value.length && /^[A-Za-z]:$/.test(value.slice(0, 2))) {
    end += 1;
  }
  return value.slice(0, end);
}

export function artifactBasename(value: string): string {
  const slash = value.lastIndexOf("/");
  const backslash = value.lastIndexOf("\\");
  return value.slice(Math.max(slash, backslash) + 1);
}

export function lowerArtifactBasename(value: string): string {
  return artifactBasename(value).toLowerCase();
}

function basenameHasExtension(value: string, extensions: readonly string[]): boolean {
  const basename = lowerArtifactBasename(value);
  return extensions.some((extension) => basename.endsWith(extension));
}

export function isMarkdownPath(value: string): boolean {
  return !hasTrailingSeparator(value) && basenameHasExtension(value, MARKDOWN_PATH_EXTENSIONS);
}

export function isHtmlPath(value: string): boolean {
  return !hasTrailingSeparator(value) && basenameHasExtension(value, HTML_PATH_EXTENSIONS);
}

export function isAllowedArtifactFilePath(value: string): boolean {
  return !hasTrailingSeparator(value) && basenameHasExtension(value, ARTIFACT_PATH_EXTENSIONS);
}

export function isExternalArtifactURL(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export function isTvArtifact(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return /^\/artifact\/[0-9A-Za-z]{26}(\/|$)/.test(pathname);
  } catch {
    return false;
  }
}

// Artifact ID branding is deferred to TV-252; Slice 1 keeps DTO ids as strings.
export interface PathArtifact {
  readonly id: string;
  readonly kind: "path";
  readonly title: string;
  readonly path: string;
  /** The resource ID of the artifact's own store, from its first write (specs/arch/resources/index.md#^rs-artifact-record). */
  readonly store?: string;
  /** The artifact's share link (specs/arch/resources/index.md#^rs-artifact-record). */
  readonly share?: ArtifactShareLink;
}

/** A share link: its share ID and the level it gives. */
export interface ArtifactShareLink {
  readonly id: string;
  readonly access: "read" | "read-write";
}

export interface UrlArtifact {
  readonly id: string;
  readonly kind: "url";
  readonly title: string;
  readonly url: string;
}

export type Artifact = PathArtifact | UrlArtifact;

export const PathArtifactSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("path"),
  title: z.string(),
  path: z.string(),
  store: z.string().optional(),
  share: z.object({
    id: z.string().min(1),
    access: z.enum(["read", "read-write"]),
  }).strict().optional(),
}).strict();

export const UrlArtifactSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("url"),
  title: z.string(),
  url: z.string().refine(isExternalArtifactURL, { message: "url must be an http(s) URL" }),
}).strict();

export const ArtifactSchema = z.discriminatedUnion("kind", [PathArtifactSchema, UrlArtifactSchema]);

type Assert<T extends true> = T;
type _ArtifactSchemaMatchesArtifact = Assert<
  z.infer<typeof ArtifactSchema> extends Artifact
    ? (Artifact extends z.infer<typeof ArtifactSchema> ? true : false)
    : false
>;

/**
 * A new artifact ID: a ULID, whose 80 random bits come from the platform's
 * cryptographic random source (specs/product/artifacts.md#^af-artifact-id).
 */
export function generateArtifactID(): string {
  return ulid();
}

export function createArtifact(input: {
  id?: string;
  kind: "path";
  title: string;
  path: string;
} | {
  id?: string;
  kind: "url";
  title: string;
  url: string;
}): Artifact {
  return ArtifactSchema.parse({ id: input.id ?? generateArtifactID(), ...input });
}

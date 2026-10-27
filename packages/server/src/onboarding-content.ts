// Onboarding content tree: config schema, slug rules, validation, and
// artifact source resolution. Spec: specs/arch/onboarding/content.md.
//
// Two validation entry points, deliberately separate:
// - `loadOnboardingConfig` is schema-only. The runtime installer uses it plus
//   lazy per-channel source resolution, so a missing source file fails only the
//   channel that needs it (specs/arch/onboarding/installer.md#^lazy-source-resolution).
// - `validateOnboardingContentTree` is the full build-time check: schema plus
//   source existence, source-shape, and unreferenced-content checks
//   (specs/arch/onboarding/content.md#^build-validation). It takes the
//   content-tree root as an explicit input so tests can run the real entry
//   point over fixture trees.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  validatePageLayout,
  type TabPage,
} from "@telepath-computer/television-shared";
import {
  checkJsonLimits,
  validateJsonValue,
  type JSONValue,
} from "@telepath-computer/television-shared/resources";

export const ONBOARDING_CONFIG_FILENAME = "onboarding-channels.json";
export const ONBOARDING_CONFIG_VERSION = 3;

export type ChannelSlug = string;
export type ArtifactSlug = string;

export interface OnboardingArtifactConfig {
  slug: ArtifactSlug; // resolves to <slug>.html, <slug>.md, or <slug>/index.html in the channel folder
  title: string;
  size?: TabPage["size"];
  geometry?: TabPage["geometry"];
  store?: OnboardingStoreConfig; // the starting value the installer writes to this artifact's store
}

/** The starting value an artifact declares for its store (specs/arch/onboarding/content.md#^onboarding-store-config). */
export interface OnboardingStoreConfig {
  value: JSONValue; // the store's starting value
  /** A calendar date, YYYY-MM-DD: the installer moves the value's dates from it to the installation day. */
  shiftDatesFrom?: string;
}

const STORE_DECLARATION_FIELDS = ["value", "shiftDatesFrom"] as const;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `value` is a real calendar date written as YYYY-MM-DD. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !CALENDAR_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export interface OnboardingChannelConfig {
  slug: ChannelSlug; // must equal the channel's folder name
  name: string;
  artifacts: OnboardingArtifactConfig[]; // array order = initial tab-page order
}

const ONBOARDING_COPY_NAME_PREFIX = "television-onboarding";

/**
 * The deterministic name an installed artifact's copied content takes; the
 * artifact itself gets a generated ID. The slug rules ban `--` inside slugs,
 * keeping this mapping injective
 * (specs/arch/onboarding/installer.md#^artifact-ids).
 */
export function onboardingCopyName(channelSlug: ChannelSlug, artifactSlug: ArtifactSlug): string {
  return `${ONBOARDING_COPY_NAME_PREFIX}--${channelSlug}--${artifactSlug}`;
}

export interface OnboardingConfig {
  version: typeof ONBOARDING_CONFIG_VERSION;
  focusChannel: ChannelSlug;
  channels: OnboardingChannelConfig[]; // array order = channel order (install order)
}

// Onboarding identifiers use lowercase ASCII letters, digits, and dashes. The
// additional `--` ban keeps the slug-pair → copy-name join injective
// (specs/arch/onboarding/content.md#^slug-rules).
export const ONBOARDING_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isValidOnboardingSlug(slug: string): boolean {
  return ONBOARDING_SLUG_PATTERN.test(slug) && !slug.includes("--");
}

export type OnboardingConfigLoadResult = {
  config?: OnboardingConfig;
  errors: string[];
};

export type OnboardingValidationResult = {
  valid: boolean;
  errors: string[];
};

export type OnboardingArtifactSource = {
  kind: "file" | "directory";
  path: string;
};

export type OnboardingArtifactSourceResult =
  | { ok: true; source: OnboardingArtifactSource }
  | { ok: false; error: string };

/**
 * Schema-only validation: reads and parses `onboarding-channels.json` under
 * `contentRoot` and checks config shape and slug rules. Does not
 * require artifact source files to exist and does not reject unreferenced
 * content on disk.
 */
export function loadOnboardingConfig(contentRoot: string): OnboardingConfigLoadResult {
  const configPath = path.join(contentRoot, ONBOARDING_CONFIG_FILENAME);
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (error) {
    return { errors: [`cannot read ${ONBOARDING_CONFIG_FILENAME}: ${describeError(error)}`] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { errors: [`failed to parse ${ONBOARDING_CONFIG_FILENAME}: ${describeError(error)}`] };
  }

  const errors = validateConfigSchema(parsed);
  if (errors.length > 0) {
    return { errors };
  }
  return { config: parsed as OnboardingConfig, errors: [] };
}

/**
 * Full build-time validation: schema validation plus channel-folder existence,
 * artifact source existence and shape, and unreferenced-content checks. Any
 * entry not referenced by the config — including dot-prefixed files such as
 * `.DS_Store` — fails validation: orphaned content in the shipped bundle is
 * always a mistake.
 */
export function validateOnboardingContentTree(contentRoot: string): OnboardingValidationResult {
  const { config, errors: schemaErrors } = loadOnboardingConfig(contentRoot);
  if (!config) {
    return { valid: false, errors: schemaErrors };
  }

  const errors: string[] = [];

  for (const channel of config.channels) {
    const channelDir = path.join(contentRoot, channel.slug);
    if (!isDirectory(channelDir)) {
      errors.push(`channel "${channel.slug}" has no matching folder in the content tree`);
      continue;
    }
    for (const artifact of channel.artifacts) {
      const resolved = resolveOnboardingArtifactSource(contentRoot, channel.slug, artifact.slug);
      if (!resolved.ok) {
        errors.push(resolved.error);
      }
    }
    errors.push(...findUnreferencedChannelEntries(channelDir, channel));
  }

  errors.push(...findUnreferencedRootEntries(contentRoot, config));

  return { valid: errors.length === 0, errors };
}

/**
 * Resolves a configured artifact to its source: `<slug>.html` or `<slug>.md`
 * (single-file artifact) or `<slug>/` containing a root `index.html`
 * (directory artifact). Exactly one shape must exist; any two or more present
 * are ambiguous.
 */
export function resolveOnboardingArtifactSource(
  contentRoot: string,
  channelSlug: ChannelSlug,
  artifactSlug: ArtifactSlug,
): OnboardingArtifactSourceResult {
  const label = `artifact "${artifactSlug}" in channel "${channelSlug}"`;
  const channelDir = path.join(contentRoot, channelSlug);
  const shapes: Array<{ kind: "file" | "directory"; path: string; display: string }> = [];
  for (const extension of [".html", ".md"]) {
    const candidate = path.join(channelDir, `${artifactSlug}${extension}`);
    if (isFile(candidate)) {
      shapes.push({ kind: "file", path: candidate, display: `${artifactSlug}${extension}` });
    }
  }
  const dirPath = path.join(channelDir, artifactSlug);
  if (isDirectory(dirPath)) {
    shapes.push({ kind: "directory", path: dirPath, display: `${artifactSlug}/` });
  }

  if (shapes.length > 1) {
    return {
      ok: false,
      error: `${label} is ambiguous: more than one source shape exists (${shapes.map((shape) => shape.display).join(", ")})`,
    };
  }
  const shape = shapes[0];
  if (shape === undefined) {
    return {
      ok: false,
      error: `${label} has no source: expected ${artifactSlug}.html, ${artifactSlug}.md, or ${artifactSlug}/`,
    };
  }
  if (shape.kind === "directory" && !isFile(path.join(shape.path, "index.html"))) {
    return { ok: false, error: `${label} is a directory artifact missing index.html at its root` };
  }
  return { ok: true, source: { kind: shape.kind, path: shape.path } };
}

function validateConfigSchema(parsed: unknown): string[] {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [`${ONBOARDING_CONFIG_FILENAME} must be a JSON object`];
  }
  const config = parsed as Record<string, unknown>;
  const errors: string[] = [];

  if (config.version !== ONBOARDING_CONFIG_VERSION) {
    errors.push(`config version must be ${ONBOARDING_CONFIG_VERSION}, got ${JSON.stringify(config.version)}`);
  }
  if (typeof config.focusChannel !== "string") {
    errors.push("focusChannel must be a channel slug string");
  }
  if (!Array.isArray(config.channels) || config.channels.length === 0) {
    errors.push("channels must be a non-empty array");
    return errors;
  }

  const channelSlugs = new Set<string>();
  for (const [index, rawChannel] of config.channels.entries()) {
    errors.push(...validateChannelSchema(rawChannel, index, channelSlugs));
  }

  if (typeof config.focusChannel === "string" && !channelSlugs.has(config.focusChannel)) {
    errors.push(`focusChannel "${config.focusChannel}" does not name a configured channel`);
  }

  return errors;
}

function validateChannelSchema(
  rawChannel: unknown,
  index: number,
  channelSlugs: Set<string>,
): string[] {
  if (typeof rawChannel !== "object" || rawChannel === null) {
    return [`channels[${index}] must be an object`];
  }
  const channel = rawChannel as Record<string, unknown>;
  const errors: string[] = [];
  const slugLabel = typeof channel.slug === "string" ? `"${channel.slug}"` : `at index ${index}`;

  if (typeof channel.slug !== "string" || !isValidOnboardingSlug(channel.slug)) {
    errors.push(
      `channel ${slugLabel} has an invalid slug: must match ${ONBOARDING_SLUG_PATTERN} with no "--"`,
    );
  } else if (channelSlugs.has(channel.slug)) {
    errors.push(`duplicate channel slug "${channel.slug}"`);
  } else {
    channelSlugs.add(channel.slug);
  }

  if (typeof channel.name !== "string" || channel.name.trim().length === 0) {
    errors.push(`channel ${slugLabel} must have a non-empty name`);
  }

  if (!Array.isArray(channel.artifacts) || channel.artifacts.length === 0) {
    errors.push(`channel ${slugLabel} must have a non-empty artifacts array`);
    return errors;
  }

  const artifactSlugs = new Set<string>();
  for (const [artifactIndex, rawArtifact] of channel.artifacts.entries()) {
    errors.push(...validateArtifactSchema(rawArtifact, slugLabel, artifactIndex, artifactSlugs));
  }

  return errors;
}

function validateArtifactSchema(
  rawArtifact: unknown,
  channelLabel: string,
  index: number,
  artifactSlugs: Set<string>,
): string[] {
  if (typeof rawArtifact !== "object" || rawArtifact === null) {
    return [`artifact at index ${index} in channel ${channelLabel} must be an object`];
  }
  const artifact = rawArtifact as Record<string, unknown>;
  const errors: string[] = [];
  const slugLabel = typeof artifact.slug === "string" ? `"${artifact.slug}"` : `at index ${index}`;
  const label = `artifact ${slugLabel} in channel ${channelLabel}`;

  for (const key of Object.keys(artifact)) {
    if (key !== "slug" && key !== "title" && key !== "geometry" && key !== "size" && key !== "store") {
      errors.push(`${label} has unknown field: ${key}`);
    }
  }

  if (typeof artifact.slug !== "string" || !isValidOnboardingSlug(artifact.slug)) {
    errors.push(`${label} has an invalid slug: must match ${ONBOARDING_SLUG_PATTERN} with no "--"`);
  } else if (artifactSlugs.has(artifact.slug)) {
    errors.push(`duplicate artifact slug "${artifact.slug}" in channel ${channelLabel}`);
  } else {
    artifactSlugs.add(artifact.slug);
  }

  if (typeof artifact.title !== "string" || artifact.title.trim().length === 0) {
    errors.push(`${label} must have a non-empty title`);
  }

  if (artifact.geometry !== undefined || artifact.size !== undefined) {
    const layoutValidation = validatePageLayout([
      {
        artifactIds: ["onboarding-config-artifact"],
        geometry: "geometry" in artifact ? artifact.geometry : DEFAULT_PAGE_GEOMETRY,
        size: "size" in artifact ? artifact.size : DEFAULT_PAGE_SIZE,
      },
    ]);
    errors.push(
      ...layoutValidation.errors.map((error) =>
        error.replace(/^Page 0\b/, label)
      ),
    );
  }

  if (artifact.store !== undefined) {
    errors.push(...validateStoreDeclaration(artifact.store, label));
  }

  return errors;
}

/**
 * A store declaration: exact keys, a starting value that obeys the JSON
 * store's value rules and limits, and `shiftDatesFrom` as a calendar date
 * (specs/arch/onboarding/content.md#^onboarding-store-config).
 */
function validateStoreDeclaration(raw: unknown, artifactLabel: string): string[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return [`${artifactLabel} store must be an object holding the store's starting value`];
  }
  const declaration = raw as Record<string, unknown>;
  const label = `${artifactLabel} store`;
  const errors: string[] = [];
  for (const key of Object.keys(declaration)) {
    if (!(STORE_DECLARATION_FIELDS as readonly string[]).includes(key)) errors.push(`${label} has unknown field: ${key}`);
  }
  if (!("value" in declaration)) {
    errors.push(`${label} is missing value`);
  } else {
    const value: unknown = declaration.value;
    const valueError = refusal(() => {
      validateJsonValue(value);
      checkJsonLimits(value);
    });
    if (valueError !== undefined) errors.push(`${label} has a starting value the JSON store refuses: ${valueError}`);
  }
  if ("shiftDatesFrom" in declaration && !isCalendarDate(declaration.shiftDatesFrom)) {
    errors.push(`${label} has shiftDatesFrom ${JSON.stringify(declaration.shiftDatesFrom)}; it must be a calendar date written as YYYY-MM-DD`);
  }
  return errors;
}

/** The message of the error `check` throws, or undefined when it passes. */
function refusal(check: () => void): string | undefined {
  try {
    check();
    return undefined;
  } catch (error) {
    return describeError(error);
  }
}

function findUnreferencedRootEntries(contentRoot: string, config: OnboardingConfig): string[] {
  const configuredChannels = new Set(config.channels.map((channel) => channel.slug));
  const errors: string[] = [];
  for (const entry of readdirSync(contentRoot)) {
    const entryPath = path.join(contentRoot, entry);
    if (isDirectory(entryPath)) {
      if (!configuredChannels.has(entry)) {
        errors.push(`unreferenced channel folder "${entry}" in the content tree`);
      }
      continue;
    }
    // README.md at the tree root is the one allowed unreferenced file:
    // authoring documentation (the content replacement contract) travels
    // with the content (specs/arch/onboarding/content.md#^build-validation).
    if (entry !== ONBOARDING_CONFIG_FILENAME && entry !== "README.md") {
      errors.push(`unreferenced file "${entry}" at the content tree root`);
    }
  }
  return errors;
}

function findUnreferencedChannelEntries(channelDir: string, channel: OnboardingChannelConfig): string[] {
  const referenced = new Set<string>();
  for (const artifact of channel.artifacts) {
    referenced.add(`${artifact.slug}.html`); // single-file artifact
    referenced.add(`${artifact.slug}.md`); // single-file artifact
    referenced.add(artifact.slug); // directory artifact
  }
  const errors: string[] = [];
  for (const entry of readdirSync(channelDir)) {
    if (!referenced.has(entry)) {
      errors.push(`unreferenced entry "${entry}" in channel folder "${channel.slug}"`);
    }
  }
  return errors;
}

function isFile(candidate: string): boolean {
  return existsSync(candidate) && statSync(candidate).isFile();
}

function isDirectory(candidate: string): boolean {
  return existsSync(candidate) && statSync(candidate).isDirectory();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

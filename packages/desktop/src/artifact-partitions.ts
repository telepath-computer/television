import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// The partitions artifact webviews use, their record and their reaper
// (specs/arch/desktop/artifact-partitions.md).

const ARTIFACT_REQUEST_PREFIX = "tv-artifact:";
const URL_ARTIFACT_REQUEST = "tv-url-artifact";
const PERSIST_PREFIX = "persist:";
const ARTIFACT_PARTITION_PREFIX = "persist:artifact-";
export const URL_ARTIFACT_PARTITION = "persist:url-artifacts";
export const FALLBACK_PARTITION = "persist:webview-fallback";
const KEY_HEX_DIGITS = 32;
const RECORD_FILE = "artifact-partitions.json";
const REAP_INTERVAL_MS = 3_600_000;
const HTTP_OK = 200;
const PROXY_PATH = /^\/artifact\/[^/]+(\/|$)/;
const REFERRER_POLICY = "strict-origin-when-cross-origin";

export type ArtifactWebviewPartition =
  | { kind: "artifact"; partition: string; origin: string; artifactID: string }
  | { kind: "url"; partition: string }
  | { kind: "fallback"; partition: string };

function httpOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * The partition for a webview that asks for `requested` while the window
 * shows `windowURL`, or null when the main process refuses the webview
 * (specs/arch/desktop/artifact-partitions.md#^dp-attach).
 */
export function partitionForWebview(requested: string | undefined, windowURL: string): ArtifactWebviewPartition | null {
  if (requested === undefined || requested === "") return { kind: "fallback", partition: FALLBACK_PARTITION };
  if (requested === URL_ARTIFACT_REQUEST) return { kind: "url", partition: URL_ARTIFACT_PARTITION };
  if (!requested.startsWith(ARTIFACT_REQUEST_PREFIX)) return null;
  const artifactID = requested.slice(ARTIFACT_REQUEST_PREFIX.length);
  const origin = httpOrigin(windowURL);
  if (artifactID === "" || origin === null) return null;
  const key = createHash("sha256").update(`${origin}\n${artifactID}`, "utf8").digest("hex").slice(0, KEY_HEX_DIGITS);
  return { kind: "artifact", partition: `${ARTIFACT_PARTITION_PREFIX}${key}`, origin, artifactID };
}

function isSandboxOnlyPolicy(value: string): boolean {
  const directives = value.split(";").map((directive) => directive.trim()).filter((directive) => directive !== "");
  return directives.length === 1 && directives[0]!.split(/\s+/)[0]!.toLowerCase() === "sandbox";
}

/**
 * The headers an artifact proxy response gets in the artifact and
 * URL-artifact partitions: without the sandbox header, and with a referrer
 * policy that sends other sites only the server's origin. Undefined leaves the
 * response as it is (specs/arch/artifact-frame/isolation.md#^iso-desktop-header).
 */
export function rewriteArtifactProxyHeaders(
  url: string,
  headers: Record<string, string[]>,
): Record<string, string[]> | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  if (!PROXY_PATH.test(pathname)) return undefined;
  const names = Object.keys(headers);
  if (!names.some((name) => name.toLowerCase() === "x-tv-version")) return undefined;

  const rewritten: Record<string, string[]> = {};
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower === "referrer-policy") continue;
    const values = lower === "content-security-policy"
      ? headers[name]!.filter((value) => !isSandboxOnlyPolicy(value))
      : headers[name]!;
    if (values.length > 0) rewritten[name] = values;
  }
  rewritten["Referrer-Policy"] = [REFERRER_POLICY];
  return rewritten;
}

export type ArtifactPartitionRecord = {
  version: 1;
  // By the served interface's origin, then by partition name without
  // `persist:`: the ID of the artifact the partition belongs to.
  servers: Record<string, Record<string, string>>;
};

/** The file operations the record uses; tests may record them. */
export interface PartitionRecordFS {
  readFileSync(file: string, encoding: "utf8"): string;
  writeFileSync(file: string, content: string, encoding: "utf8"): void;
  renameSync(from: string, to: string): void;
}

const NODE_FILES: PartitionRecordFS = { readFileSync, writeFileSync, renameSync };

function emptyRecord(): ArtifactPartitionRecord {
  return { version: 1, servers: {} };
}

function isStringMap(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is ArtifactPartitionRecord {
  if (typeof value !== "object" || value === null) return false;
  const { version, servers } = value as Partial<ArtifactPartitionRecord>;
  return version === 1 && typeof servers === "object" && servers !== null && !Array.isArray(servers) &&
    Object.values(servers).every(isStringMap);
}

/** A missing, unreadable or malformed record reads as empty. */
export function readPartitionRecord(userData: string, files: PartitionRecordFS = NODE_FILES): ArtifactPartitionRecord {
  try {
    const parsed: unknown = JSON.parse(files.readFileSync(path.join(userData, RECORD_FILE), "utf8"));
    return isRecord(parsed) ? parsed : emptyRecord();
  } catch {
    return emptyRecord();
  }
}

function writePartitionRecord(userData: string, record: ArtifactPartitionRecord, files: PartitionRecordFS): void {
  const file = path.join(userData, RECORD_FILE);
  const temporary = `${file}.tmp`;
  files.writeFileSync(temporary, JSON.stringify(record, null, 2), "utf8");
  files.renameSync(temporary, file);
}

function recordName(partition: string): string {
  return partition.startsWith(PERSIST_PREFIX) ? partition.slice(PERSIST_PREFIX.length) : partition;
}

/** Adds an artifact partition to the record, writing nothing when it is there already. */
export function recordArtifactPartition(
  userData: string,
  origin: string,
  partition: string,
  artifactID: string,
  files: PartitionRecordFS = NODE_FILES,
): void {
  const record = readPartitionRecord(userData, files);
  const name = recordName(partition);
  const server = record.servers[origin] ?? {};
  if (server[name] === artifactID) return;
  record.servers[origin] = { ...server, [name]: artifactID };
  writePartitionRecord(userData, record, files);
}

function listedArtifactIDs(body: unknown): Set<string> | null {
  const artifacts = (body as { artifacts?: unknown } | null)?.artifacts;
  if (!Array.isArray(artifacts)) return null;
  const ids = new Set<string>();
  for (const artifact of artifacts) {
    const id = (artifact as { id?: unknown } | null)?.id;
    if (typeof artifact !== "object" || artifact === null || typeof id !== "string") return null;
    ids.add(id);
  }
  return ids;
}

export interface ReaperConnection {
  serverURL: string;
  token: string;
}

export interface ArtifactPartitionReaperOptions {
  userData: string;
  /** Whether Electron has opened the partition, by its full name, since the app started. */
  isOpened(partition: string): boolean;
  fetch?: typeof fetch;
  removeDirectory?(directory: string): void;
  files?: PartitionRecordFS;
}

/**
 * Deletes the connected server's artifact partitions whose artifacts the
 * server no longer lists (specs/arch/desktop/artifact-partitions.md#^dp-reaper).
 */
export class ArtifactPartitionReaper {
  readonly #options: ArtifactPartitionReaperOptions;
  #timer: ReturnType<typeof setInterval> | null = null;
  #running: Promise<void> | null = null;
  #abort: AbortController | null = null;
  // Each stop starts a new generation; a reaping of an earlier one changes nothing.
  #generation = 0;

  constructor(options: ArtifactPartitionReaperOptions) {
    this.#options = options;
  }

  /** The server's page finished loading: reap now, and every hour while it stays loaded. */
  pageLoaded(connection: ReaperConnection): Promise<void> {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = setInterval(() => void this.#reap(connection), REAP_INTERVAL_MS);
    return this.#reap(connection);
  }

  /** The window left the server's page: no further reaping, and none in flight. */
  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    this.#abort?.abort();
    this.#abort = null;
    this.#running = null;
    this.#generation += 1;
  }

  #reap(connection: ReaperConnection): Promise<void> {
    if (this.#running !== null) return this.#running;
    const generation = this.#generation;
    const running = this.#reapOnce(connection, generation).finally(() => {
      if (this.#running === running) this.#running = null;
    });
    this.#running = running;
    return running;
  }

  async #reapOnce(connection: ReaperConnection, generation: number): Promise<void> {
    const { userData, files = NODE_FILES } = this.#options;
    const origin = httpOrigin(connection.serverURL);
    if (origin === null) return;
    const taken = { ...readPartitionRecord(userData, files).servers[origin] };
    const abort = new AbortController();
    this.#abort = abort;
    let listed: Set<string> | null;
    try {
      const response = await (this.#options.fetch ?? fetch)(`${origin}/artifacts`, {
        headers: connection.token ? { Authorization: `Bearer ${connection.token}` } : {},
        signal: abort.signal,
      });
      listed = response.status === HTTP_OK ? listedArtifactIDs(await response.json()) : null;
    } catch {
      listed = null;
    }
    if (generation !== this.#generation || listed === null) return;
    this.#deleteAbsent(origin, taken, listed);
  }

  // One synchronous turn: no webview can attach between the opened check and
  // the removal, and the record is read afresh so entries added during the
  // request survive.
  #deleteAbsent(origin: string, taken: Record<string, string>, listed: Set<string>): void {
    const { userData, isOpened, files = NODE_FILES } = this.#options;
    const removeDirectory = this.#options.removeDirectory ??
      ((directory: string) => rmSync(directory, { recursive: true, force: true }));
    const removed: string[] = [];
    for (const [name, artifactID] of Object.entries(taken)) {
      if (listed.has(artifactID) || isOpened(`${PERSIST_PREFIX}${name}`)) continue;
      try {
        removeDirectory(path.join(userData, "Partitions", name));
        removed.push(name);
      } catch {
        // The entry stays, so a later reaping tries again.
      }
    }
    if (removed.length === 0) return;
    const record = readPartitionRecord(userData, files);
    const server = record.servers[origin];
    if (server === undefined) return;
    for (const name of removed) delete server[name];
    if (Object.keys(server).length === 0) delete record.servers[origin];
    writePartitionRecord(userData, record, files);
  }
}

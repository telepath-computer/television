import { statSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type { AppTemplate, ArtifactTemplateScan } from "@telepath-computer/television-shared";
import { defaultWatchContentFile, type ContentWatcher, type WatchContentFile } from "./file-watcher.ts";
import { scanTemplatesDirectory, selectTemplateIcon } from "./templates.ts";

const SCAN_DEBOUNCE_MS = 75;

interface TemplateCacheOptions {
  scan?: typeof scanTemplatesDirectory;
  watch?: WatchContentFile;
}

function iconSignature(template: AppTemplate): string | undefined {
  const icon = selectTemplateIcon(template);
  if (!icon) return;
  try {
    const { size, mtimeMs } = statSync(icon.path);
    return JSON.stringify([icon.path, size, mtimeMs]);
  } catch { /* The next scan will reflect a disappearing icon. */ }
}

/** Serving-home scan and observation. Scans are synchronous, so publication follows read order. */
export class TemplateCache {
  #snapshot: ArtifactTemplateScan = { templates: [], errors: [], watching: false };
  #iconSignatures = new Map<string, string | undefined>();
  #watching = false;
  #watcher: ContentWatcher | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;
  #watchVersion = 0;
  readonly #scan: typeof scanTemplatesDirectory;
  readonly #watch: WatchContentFile;
  readonly #directory: string;
  readonly #publish: (scan: ArtifactTemplateScan, invalidatedIDs: string[]) => void;

  constructor(
    directory: string,
    publish: (scan: ArtifactTemplateScan, invalidatedIDs: string[]) => void,
    options: TemplateCacheOptions = {},
  ) {
    this.#directory = directory;
    this.#publish = publish;
    this.#scan = options.scan ?? scanTemplatesDirectory;
    this.#watch = options.watch ?? defaultWatchContentFile;
    this.#startWatching();
    // Observation precedes the read. A notification during the read queues another scan.
    this.#refresh();
  }

  getSnapshot(): ArtifactTemplateScan { return this.#snapshot; }

  get(fresh = false): ArtifactTemplateScan {
    if (!this.#disposed && (fresh || !this.#snapshot.watching)) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
      if (!this.#watcher) this.#startWatching();
      this.#refresh();
    }
    return this.#snapshot;
  }

  #refresh(): void {
    if (this.#disposed) return;
    const previous = this.#snapshot;
    const next = { ...this.#scan(this.#directory), watching: this.#watching };
    const before = new Map(previous.templates.map(template => [template.id, template]));
    const after = new Map(next.templates.map(template => [template.id, template]));
    const signatures = new Map(next.templates.map(template => [template.id, iconSignature(template)]));
    const invalidatedIDs = [...new Set([...before.keys(), ...after.keys()])].filter(id =>
      !isDeepStrictEqual(before.get(id), after.get(id)) || this.#iconSignatures.get(id) !== signatures.get(id));
    this.#snapshot = next;
    this.#iconSignatures = signatures;
    if (invalidatedIDs.length || !isDeepStrictEqual(previous, next)) this.#publish(next, invalidatedIDs);
  }

  readonly #schedule = (): void => {
    if (this.#disposed) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { this.#timer = undefined; this.#refresh(); }, SCAN_DEBOUNCE_MS);
  };

  #unavailable(error: Error): void {
    if (this.#disposed) return;
    this.#watching = false;
    console.warn(`Failed to watch templates: ${this.#directory}`, error);
    if (this.#snapshot.watching) {
      this.#snapshot = { ...this.#snapshot, watching: false };
      this.#publish(this.#snapshot, []);
    }
  }

  #startWatching(): void {
    const version = ++this.#watchVersion;
    const current = () => !this.#disposed && version === this.#watchVersion;
    let dead = false;
    try {
      const watcher = this.#watch(this.#directory, () => { if (current()) this.#schedule(); }, {
        recursive: true,
        onWatcherDead: () => {
          if (!current()) return;
          dead = true;
          this.#unavailable(new Error("templates directory unavailable"));
          this.#schedule();
        },
        onWatcherRearmed: () => {
          if (!current()) return;
          this.#watching = true;
          this.#schedule();
        },
      });
      this.#watcher = watcher;
      this.#watching = !dead;
      watcher.on("error", (error) => {
        if (!current()) return;
        this.#watchVersion++;
        watcher.close();
        this.#watcher = null;
        this.#unavailable(error);
      });
    } catch (error) {
      this.#watchVersion++;
      this.#unavailable(error instanceof Error ? error : new Error(String(error)));
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    clearTimeout(this.#timer);
    this.#watcher?.close();
    this.#watcher = null;
  }
}

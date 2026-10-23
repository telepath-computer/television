import type { ArtifactTemplateScan } from "@telepath-computer/television-shared";
import { defaultWatchContentFile, type ContentWatcher, type WatchContentFile } from "./file-watcher.ts";
import { scanTemplatesDirectory } from "./templates.ts";

const SCAN_DEBOUNCE_MS = 75;

interface TemplateCacheOptions {
  scan?: typeof scanTemplatesDirectory;
  watch?: WatchContentFile;
}

/** Serving-home scan and observation. Scans are synchronous, so publication follows read order. */
export class TemplateCache {
  #snapshot: ArtifactTemplateScan = { templates: [], errors: [], watching: false };
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
    this.#snapshot = { ...this.#scan(this.#directory), watching: this.#snapshot.watching };
    this.#publish(this.#snapshot, [...new Set([...previous.templates, ...this.#snapshot.templates].map(({ id }) => id))]);
  }

  readonly #schedule = (): void => {
    if (this.#disposed) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { this.#timer = undefined; this.#refresh(); }, SCAN_DEBOUNCE_MS);
  };

  #unavailable(error: Error): void {
    if (this.#disposed) return;
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
          this.#snapshot = { ...this.#snapshot, watching: true };
          this.#schedule();
        },
      });
      this.#watcher = watcher;
      this.#snapshot = { ...this.#snapshot, watching: !dead };
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

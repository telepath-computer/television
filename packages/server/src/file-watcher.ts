import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import path from "node:path";

export interface ContentWatcher {
  close(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface WatchContentFileOptions {
  recursive?: boolean;
  onWatcherDead?: () => void;
  onWatcherRearmed?: () => void;
  rearmIntervalMs?: number;
}

export type WatchContentFile = (
  contentPath: string,
  onChange: () => void,
  options?: WatchContentFileOptions,
) => ContentWatcher;

const DEFAULT_REARM_INTERVAL_MS = 250;

function isMissingWatchRootError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "ENOENT";
}

class ReArmingContentWatcher extends EventEmitter implements ContentWatcher {
  readonly #dir: string;
  readonly #watchedBasename: string;
  readonly #watchRootBasename: string;
  readonly #onChange: () => void;
  readonly #options: WatchContentFileOptions;
  readonly #recursive: boolean;
  #watcher: fs.FSWatcher | null = null;
  #ancestorWatchers: fs.FSWatcher[] = [];
  #closed = false;
  #dead = false;
  #rearmTimer: ReturnType<typeof setTimeout> | null = null;
  #rootEventImmediate: ReturnType<typeof setImmediate> | null = null;
  #recursiveRefreshImmediate: ReturnType<typeof setImmediate> | null = null;

  constructor(contentPath: string, onChange: () => void, options: WatchContentFileOptions = {}) {
    super();
    this.#recursive = options.recursive === true;
    this.#dir = this.#recursive ? contentPath : path.dirname(contentPath);
    this.#watchedBasename = path.basename(contentPath);
    this.#watchRootBasename = path.basename(path.normalize(this.#dir));
    this.#onChange = onChange;
    this.#options = options;
    try {
      this.#attach();
    } catch (error) {
      if (!isMissingWatchRootError(error)) {
        throw error;
      }
      this.#markDead();
    }
  }

  close(): void {
    this.#closed = true;
    if (this.#rearmTimer) {
      clearTimeout(this.#rearmTimer);
      this.#rearmTimer = null;
    }
    if (this.#rootEventImmediate) {
      clearImmediate(this.#rootEventImmediate);
      this.#rootEventImmediate = null;
    }
    if (this.#recursiveRefreshImmediate) {
      clearImmediate(this.#recursiveRefreshImmediate);
      this.#recursiveRefreshImmediate = null;
    }
    this.#closeActiveWatchers();
  }

  #attach(): void {
    const watcher = fs.watch(this.#dir, { recursive: this.#recursive }, (_event, filename) => {
      const relativePath = filename?.toString();
      const isWatchRootEvent =
        relativePath === undefined || relativePath === "" || relativePath === this.#watchRootBasename;

      if (this.#recursive) {
        if (isWatchRootEvent) {
          this.#handleWatchRootEvent();
        } else {
          this.#onChange();
          this.#scheduleRecursiveRefresh();
        }
        return;
      }

      if (relativePath === this.#watchedBasename) {
        this.#onChange();
        return;
      }
      if (isWatchRootEvent) {
        this.#handleWatchRootEvent();
      }
    });
    watcher.on("error", (error) => {
      if (this.#isWatchRootPresent()) {
        this.emit("error", error);
        return;
      }
      this.#markDead();
    });

    const ancestorWatchers: fs.FSWatcher[] = [];
    for (const ancestorDir of this.#ancestorDirs()) {
      const ancestorBasename = path.basename(path.normalize(ancestorDir));
      try {
        const ancestorWatcher = fs.watch(ancestorDir, (_event, filename) => {
          const basename = filename?.toString();
          if (basename === undefined || basename === "" || basename === ancestorBasename) {
            this.#handleWatchRootEvent();
          }
        });
        ancestorWatcher.on("error", (error) => {
          if (this.#isWatchRootPresent()) {
            this.emit("error", error);
            return;
          }
          this.#markDead();
        });
        ancestorWatchers.push(ancestorWatcher);
      } catch {
        // Ancestor watches are best-effort: unreadable-but-traversable
        // ancestors can still contain readable artifacts. Keep the primary
        // content watch alive and degrade only that ancestor-move signal.
      }
    }

    this.#watcher = watcher;
    this.#ancestorWatchers = ancestorWatchers;
    this.#dead = false;
  }

  #scheduleRecursiveRefresh(): void {
    if (this.#recursiveRefreshImmediate) return;
    this.#recursiveRefreshImmediate = setImmediate(() => {
      this.#recursiveRefreshImmediate = null;
      if (this.#closed) return;
      if (!this.#isWatchRootPresent()) {
        this.#markDead();
        return;
      }

      // Linux recursive fs.watch can keep following the replaced inode after
      // an atomic rename-over and miss a later delete of the replacement.
      // Reattach once per delivery turn so the native tree watch includes the
      // directory's current entries without allocating per-directory handles.
      this.#closeActiveWatchers();
      try {
        this.#attach();
      } catch (error) {
        if (this.#isWatchRootPresent()) {
          this.emit("error", error as Error);
          return;
        }
        this.#markDead();
      }
    });
  }

  #handleWatchRootEvent(): void {
    if (this.#rootEventImmediate) return;
    this.#rootEventImmediate = setImmediate(() => {
      this.#rootEventImmediate = null;
      this.#handleWatchRootEventDeferred();
    });
  }

  #handleWatchRootEventDeferred(): void {
    if (this.#closed) return;
    if (!this.#isWatchRootPresent()) {
      this.#markDead();
      return;
    }

    // A watch-root-shaped rename event can mean the directory disappeared and
    // was recreated before this handler could stat it. The old fs.watch handle
    // may now be attached to a dead inode, so reattach even when the path is
    // currently present. Defer the close/reattach until after the current
    // fs.watch delivery turn so multiple handles sharing one inotify watch
    // descriptor can all observe the root event before any handle mutates it.
    this.#closeActiveWatchers();
    try {
      this.#attach();
      this.#onChange();
    } catch {
      this.#markDead();
    }
  }

  #ancestorDirs(): string[] {
    const ancestors: string[] = [];
    let current = path.dirname(this.#dir);
    while (current !== path.dirname(current)) {
      ancestors.push(current);
      current = path.dirname(current);
    }
    return ancestors;
  }

  #closeActiveWatchers(): void {
    this.#watcher?.close();
    this.#watcher = null;
    for (const watcher of this.#ancestorWatchers) {
      watcher.close();
    }
    this.#ancestorWatchers = [];
  }

  #isWatchRootPresent(): boolean {
    try {
      return fs.statSync(this.#dir).isDirectory();
    } catch {
      return false;
    }
  }

  #markDead(): void {
    if (this.#closed || this.#dead) return;
    this.#dead = true;
    this.#closeActiveWatchers();
    this.#options.onWatcherDead?.();
    this.#scheduleRearm();
  }

  #scheduleRearm(): void {
    if (this.#closed || this.#rearmTimer) return;
    this.#rearmTimer = setTimeout(() => {
      this.#rearmTimer = null;
      this.#tryRearm();
    }, this.#options.rearmIntervalMs ?? DEFAULT_REARM_INTERVAL_MS);
  }

  #tryRearm(): void {
    if (this.#closed) return;
    if (!this.#isWatchRootPresent()) {
      this.#scheduleRearm();
      return;
    }
    try {
      this.#attach();
      this.#options.onWatcherRearmed?.();
      this.#onChange();
    } catch (error) {
      if (this.#isWatchRootPresent()) {
        this.emit("error", error as Error);
        return;
      }
      this.#scheduleRearm();
    }
  }
}

export const defaultWatchContentFile: WatchContentFile = (contentPath, onChange, options) => {
  return new ReArmingContentWatcher(contentPath, onChange, options);
};

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

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : undefined;
}

// A root path that does not exist, or that is a file rather than a folder, is a missing root.
function isMissingWatchRootError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

type NativeWatchListener = (eventType: string, filename: string | Buffer | null) => void;

interface NativeWatcher {
  close(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
}

// Node builds recursive fs.watch from one watcher per directory, in JavaScript, everywhere but macOS and Windows.
// From Node 24.22 that code throws ENOTDIR outside any handler, ending the process, when a watched directory is
// replaced by a file before its own events are delivered. Plain directory watches never stat on delivery, so on
// those platforms this module builds the same per-directory tree itself.
const BUILDS_DIRECTORY_TREE = process.platform !== "darwin" && process.platform !== "win32";

/**
 * Watches `root` and every directory below it with plain, non-recursive watches, and each symbolic link's target
 * without descending into it. Root events keep the names the native watch reports; descendant events are reported
 * as their path below the root. The tree is fixed at construction: the content watcher reattaches it after every
 * descendant change, which picks up new directories. A root failure throws as fs.watch does; a descendant that
 * vanished while the tree was built is skipped, and any other descendant failure is emitted as an error.
 */
class DirectoryTreeWatcher extends EventEmitter implements NativeWatcher {
  readonly #watchers: fs.FSWatcher[] = [];
  #closed = false;

  constructor(root: string, listener: NativeWatchListener) {
    super();
    try {
      this.#addDirectory(root, null, listener);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close(): void {
    this.#closed = true;
    for (const watcher of this.#watchers.splice(0)) watcher.close();
  }

  #watch(target: string, relative: string | null, listener: NativeWatchListener): boolean {
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(target, (eventType, filename) => {
        if (this.#closed) return;
        const name = filename?.toString() ?? "";
        listener(eventType, relative === null ? name : path.join(relative, name));
      });
    } catch (error) {
      if (relative === null) throw error;
      this.#descendantFailed(error);
      return false;
    }
    watcher.on("error", (error) => {
      if (!this.#closed) this.emit("error", error);
    });
    this.#watchers.push(watcher);
    return true;
  }

  #addDirectory(directory: string, relative: string | null, listener: NativeWatchListener): void {
    if (!this.#watch(directory, relative, listener)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (relative === null) throw error;
      this.#descendantFailed(error);
      return;
    }
    for (const entry of entries) {
      const childRelative = relative === null ? entry.name : path.join(relative, entry.name);
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) this.#addDirectory(child, childRelative, listener);
      else if (entry.isSymbolicLink()) this.#watch(child, childRelative, listener);
    }
  }

  #descendantFailed(error: unknown): void {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return;
    // Listeners attach after construction, so report on the next turn, as fs.watch reports its runtime errors.
    process.nextTick(() => {
      if (!this.#closed) this.emit("error", error instanceof Error ? error : new Error(String(error)));
    });
  }
}

function watchNative(directory: string, recursive: boolean, listener: NativeWatchListener): NativeWatcher {
  if (recursive && BUILDS_DIRECTORY_TREE) return new DirectoryTreeWatcher(directory, listener);
  return fs.watch(directory, { recursive }, listener);
}

class ReArmingContentWatcher extends EventEmitter implements ContentWatcher {
  readonly #dir: string;
  readonly #watchedBasename: string;
  readonly #watchRootBasename: string;
  readonly #onChange: () => void;
  readonly #options: WatchContentFileOptions;
  readonly #recursive: boolean;
  #watcher: NativeWatcher | null = null;
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
    const watcher = watchNative(this.#dir, this.#recursive, (_event, filename) => {
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

      // A recursive watch can keep following the replaced inode after an
      // atomic rename-over and miss a later delete of the replacement, and a
      // built directory tree does not grow by itself. Reattach once per
      // delivery turn so the watch covers the directory's current entries.
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

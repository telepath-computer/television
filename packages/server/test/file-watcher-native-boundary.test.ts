import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const watchControl = vi.hoisted(() => ({
  watch: vi.fn(),
}));

// proofs/arch/artifact-frame/reload-navigation.md#^rn-ac-shared-watcher-native
// This contract replaces only fs.watch with controllable handles. Kernel event
// and error generation remain forfeited to the real-filesystem watcher tests.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    watch: watchControl.watch,
  };
});

import { defaultWatchContentFile } from "../src/file-watcher.ts";

type NativeListener = (
  eventType: "change" | "rename",
  filename: string | Buffer | null,
) => void;

class ControllableFSWatcher extends EventEmitter {
  closeCalls = 0;

  close(): void {
    this.closeCalls += 1;
  }
}

interface WatchCall {
  readonly watchedPath: string;
  readonly options: { recursive?: boolean } | undefined;
  readonly listener: NativeListener;
  readonly watcher: ControllableFSWatcher;
}

const dirs: string[] = [];
const calls: WatchCall[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "television-native-watch-"));
  dirs.push(dir);
  return dir;
}

function flushImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  calls.length = 0;
  watchControl.watch.mockReset();
  watchControl.watch.mockImplementation((
    watchedPath: string,
    optionsOrListener: { recursive?: boolean } | NativeListener,
    maybeListener?: NativeListener,
  ) => {
    const options = typeof optionsOrListener === "function"
      ? undefined
      : optionsOrListener;
    const listener = typeof optionsOrListener === "function"
      ? optionsOrListener
      : maybeListener;
    if (!listener) throw new Error("fs.watch listener is required");

    const watcher = new ControllableFSWatcher();
    calls.push({ watchedPath: String(watchedPath), options, listener, watcher });
    return watcher;
  });
});

afterEach(() => {
  watchControl.watch.mockReset();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("shared content watcher native boundary (^rn-ac-shared-watcher-native)", () => {
  it("watches a file through its non-recursive parent and filters the exact basename", () => {
    const dir = tempDir();
    const filePath = path.join(dir, "theme.css");
    writeFileSync(filePath, ":root {}\n", "utf8");
    const onChange = vi.fn();

    const contentWatcher = defaultWatchContentFile(filePath, onChange);
    const primary = calls[0]!;

    expect(primary.watchedPath).toBe(dir);
    expect(primary.options).toEqual({ recursive: false });

    primary.listener("change", "other.css");
    expect(onChange).not.toHaveBeenCalled();
    primary.listener("change", "theme.css");
    expect(onChange).toHaveBeenCalledTimes(1);

    contentWatcher.close();
  });

  it("uses one unfiltered recursive root watch without allocating descendant watchers", async () => {
    const root = tempDir();
    mkdirSync(path.join(root, "nested", "deep"), { recursive: true });
    const onChange = vi.fn();

    const contentWatcher = defaultWatchContentFile(root, onChange, { recursive: true });
    const initialCalls = [...calls];
    const primary = initialCalls[0]!;

    expect(primary.watchedPath).toBe(root);
    expect(primary.options).toEqual({ recursive: true });
    expect(initialCalls.filter((call) => call.options?.recursive === true)).toEqual([primary]);
    expect(initialCalls.slice(1).every((call) => !call.watchedPath.startsWith(`${root}${path.sep}`))).toBe(true);

    primary.listener("change", path.join("nested", "deep", "palette.css"));
    expect(onChange).toHaveBeenCalledTimes(1);

    contentWatcher.close();
    contentWatcher.close();
    await flushImmediate();

    expect(calls).toHaveLength(initialCalls.length);
    expect(initialCalls.every((call) => call.watcher.closeCalls === 1)).toBe(true);
  });

  it("forwards present-root errors and cancels root-event work on repeated close", async () => {
    const root = tempDir();
    const onChange = vi.fn();
    const onError = vi.fn();
    const contentWatcher = defaultWatchContentFile(root, onChange, { recursive: true });
    contentWatcher.on("error", onError);
    const initialCalls = [...calls];
    const primary = initialCalls[0]!;
    const error = new Error("synthetic native watcher error");

    primary.watcher.emit("error", error);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);

    primary.listener("rename", path.basename(root));
    contentWatcher.close();
    contentWatcher.close();
    await flushImmediate();

    expect(onChange).not.toHaveBeenCalled();
    expect(calls).toHaveLength(initialCalls.length);
    expect(initialCalls.every((call) => call.watcher.closeCalls === 1)).toBe(true);
  });
});

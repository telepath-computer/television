import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ArtifactTemplateScan } from "@telepath-computer/television-shared";
import type { WatchContentFileOptions } from "../src/file-watcher.ts";
import { TemplateCache } from "../src/template-cache.ts";
import { scanTemplatesDirectory } from "../src/templates.ts";

const caches: TemplateCache[] = [];
afterEach(() => { caches.splice(0).forEach((cache) => cache.dispose()); vi.useRealTimers(); vi.restoreAllMocks(); });
function scan(...ids: string[]): ArtifactTemplateScan {
  return { templates: ids.map((id) => ({ id, name: id, description: "Page", version: "1.0.0", path: `/templates/${id}`, hasIcon: true })), errors: [], watching: false };
}
function fixture(initial = scan("one")) {
  vi.useFakeTimers();
  const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
  let change = () => {};
  let options: WatchContentFileOptions = {};
  const read = vi.fn(() => initial);
  const publish = vi.fn();
  const watch = vi.fn((_path: string, onChange: () => void, opts?: WatchContentFileOptions) => {
    change = onChange; options = opts!; return watcher;
  });
  return { watcher, read, publish, watch, change: () => change(), dead: () => options.onWatcherDead?.(), rearm: () => options.onWatcherRearmed?.() };
}

describe("watched template cache (^templates-t-cache-order)", () => {
  it("watches before the initial scan and folds intervening edits and bursts into a current full scan", () => {
    const f = fixture();
    f.read.mockImplementationOnce(() => { expect(f.watch).toHaveBeenCalled(); f.change(); return scan("old"); });
    const cache = new TemplateCache("/templates", f.publish, { scan: f.read, watch: f.watch });
    caches.push(cache);
    expect(cache.get().templates[0]?.id).toBe("old");
    f.read.mockReturnValue(scan("new"));
    f.change(); f.change(); f.change();
    vi.runOnlyPendingTimers();
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(cache.get()).toEqual({ ...scan("new"), watching: true });
    expect(f.publish).toHaveBeenLastCalledWith(cache.get(), ["old", "new"]);
    expect(f.watch).toHaveBeenCalledWith("/templates", expect.any(Function), expect.objectContaining({ recursive: true }));
  });

  it("fresh scans cancel queued work and publish only changed records", () => {
    const f = fixture();
    const cache = new TemplateCache("/templates", f.publish, { scan: f.read, watch: f.watch });
    caches.push(cache);
    f.change();
    f.read.mockReturnValue(scan("two"));
    cache.get(true);
    vi.runOnlyPendingTimers();
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(cache.get().templates[0]?.id).toBe("two");
    expect(f.publish).toHaveBeenLastCalledWith(cache.get(), ["one", "two"]);
    f.publish.mockClear();
    cache.get(true);
    expect(f.publish).not.toHaveBeenCalled();
    f.read.mockReturnValue({ ...scan("two"), templates: [{ ...scan("two").templates[0]!, name: "Renamed" }] });
    cache.get(true);
    expect(f.publish).toHaveBeenLastCalledWith(cache.get(), ["two"]);
    cache.dispose();
    f.change(); f.rearm();
    vi.runOnlyPendingTimers();
    expect(f.read).toHaveBeenCalledTimes(4);
    expect(f.watcher.close).toHaveBeenCalledTimes(1);
  });

  it("publishes nothing for unchanged fresh scans and announces only the changed selected icon", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tv-template-signatures-"));
    try {
      for (const id of ["one", "two"]) {
        const folder = path.join(directory, id);
        mkdirSync(folder);
        writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ name: id, description: "Page", version: "1.0.0", url: "https://example.com", icons: [{ src: "icon.svg" }] }));
        writeFileSync(path.join(folder, "icon.svg"), "<svg/>");
      }
      const f = fixture();
      const cache = new TemplateCache(directory, f.publish, { watch: f.watch });
      caches.push(cache);
      const initial = cache.get();
      expect(initial).toEqual({ ...scanTemplatesDirectory(directory), watching: true });
      f.publish.mockClear();
      writeFileSync(path.join(directory, "one", "support.css"), "body {}");
      expect(cache.get(true)).toEqual(initial);
      expect(f.publish).not.toHaveBeenCalled();

      const filename = path.join(directory, "one", "icon.svg");
      const original = statSync(filename);
      const modified = new Date(original.mtimeMs + 2000);
      utimesSync(filename, modified, modified);
      cache.get(true);
      expect(f.publish).toHaveBeenCalledExactlyOnceWith(initial, ["one"]);
      f.publish.mockClear();
      writeFileSync(filename, "<svg>changed size</svg>");
      utimesSync(filename, modified, modified);
      cache.get(true);
      expect(f.publish).toHaveBeenCalledExactlyOnceWith(initial, ["one"]);
      f.publish.mockClear();
      cache.get(true);
      expect(f.publish).not.toHaveBeenCalled();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("publishes scan errors and watcher recovery without invalidating unchanged icons", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fixture();
    const cache = new TemplateCache("/templates", f.publish, { scan: f.read, watch: f.watch });
    caches.push(cache);
    f.publish.mockClear();
    f.read.mockReturnValue({ ...scan("one"), errors: [{ folder: "broken", error: "invalid manifest" }] });
    cache.get(true);
    expect(f.publish).toHaveBeenCalledExactlyOnceWith(cache.get(), []);
    f.dead();
    expect(f.publish).toHaveBeenLastCalledWith(expect.objectContaining({ watching: false }), []);
    f.publish.mockClear();
    f.rearm();
    vi.runOnlyPendingTimers();
    expect(f.publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ watching: true }), []);
  });

  it("warns and publishes failure, scans on fallback reads, and publishes full recovery", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fixture();
    f.watch.mockImplementationOnce(() => { throw new Error("watch unavailable"); });
    const cache = new TemplateCache("/templates", f.publish, { scan: f.read, watch: f.watch });
    caches.push(cache);
    expect(cache.getSnapshot().watching).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("templates"), expect.any(Error));
    expect(f.publish).toHaveBeenLastCalledWith(expect.objectContaining({ watching: false }), ["one"]);
    // A fresh/default fallback read attempts observation again, then scans.
    f.read.mockReturnValue(scan("two"));
    expect(cache.get()).toEqual({ ...scan("two"), watching: true });
    expect(f.publish).toHaveBeenLastCalledWith(cache.getSnapshot(), ["one", "two"]);
    f.watcher.emit("error", new Error("runtime failure"));
    expect(f.watcher.close).toHaveBeenCalledTimes(1);
    expect(f.publish).toHaveBeenLastCalledWith(expect.objectContaining({ watching: false }), []);
    f.watch.mockImplementation(() => { throw new Error("still unavailable"); });
    f.read.mockReturnValue(scan("three"));
    expect(cache.get()).toEqual({ ...scan("three"), watching: false });
    expect(f.read).toHaveBeenCalledTimes(3);
  });

  it("retains missing-root observation and scans on rearm", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fixture();
    const cache = new TemplateCache("/templates", f.publish, { scan: f.read, watch: f.watch });
    caches.push(cache);
    f.dead();
    expect(cache.getSnapshot().watching).toBe(false);
    expect(f.watcher.close).not.toHaveBeenCalled();
    f.read.mockReturnValue(scan("restored"));
    f.rearm(); f.change();
    vi.runOnlyPendingTimers();
    expect(f.publish).toHaveBeenLastCalledWith({ ...scan("restored"), watching: true }, ["one", "restored"]);
  });

  it("ignores callbacks from a failed watcher after observation has been replaced", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fixture();
    const cache = new TemplateCache("/templates", f.publish, { scan: f.read, watch: f.watch });
    caches.push(cache);
    const oldChange = f.watch.mock.calls[0]![1];
    const oldOptions = f.watch.mock.calls[0]![2]!;
    f.watcher.emit("error", new Error("failed"));
    cache.get(true);
    const published = f.publish.mock.calls.length;
    oldOptions.onWatcherDead?.(); oldOptions.onWatcherRearmed?.(); oldChange();
    vi.runOnlyPendingTimers();
    expect(f.publish).toHaveBeenCalledTimes(published);
    expect(cache.getSnapshot().watching).toBe(true);
  });

});

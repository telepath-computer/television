import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServingStore } from "../../../test/helpers/serving-store.ts";

function tempDir(prefix = "television-store-views-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("fixed markdown view lookup", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty registry and no view paths without bundledViewsPath", () => {
    const storagePath = tempDir("television-view-storage-");
    dirs.push(storagePath);
    const store = createServingStore(storagePath);

    expect(store.getViews()).toEqual([]);
    expect(store.getViewPath("anything")).toBeNull();
  });

  it("returns an empty registry and no view path when bundledViewsPath is missing on disk", () => {
    const storagePath = tempDir("television-view-storage-");
    const missingViewsRoot = path.join(tempDir("television-view-dist-parent-"), "missing");
    dirs.push(storagePath, path.dirname(missingViewsRoot));
    const store = createServingStore(storagePath, { bundledViewsPath: missingViewsRoot });

    expect(store.getViews()).toEqual([]);
    expect(store.getViewPath("markdown")).toBeNull();
  });

  it("ignores pre-existing storagePath/views content", () => {
    const storagePath = tempDir("television-view-storage-");
    const viewsRoot = tempDir("television-view-dist-");
    dirs.push(storagePath, viewsRoot);
    const bundledMarkdownDir = path.join(viewsRoot, "markdown");
    const storageMarkdownDir = path.join(storagePath, "views", "markdown");
    mkdirSync(bundledMarkdownDir, { recursive: true });
    mkdirSync(storageMarkdownDir, { recursive: true });
    writeFileSync(path.join(bundledMarkdownDir, "index.html"), "<!doctype html><title>Bundled</title>");
    writeFileSync(path.join(storageMarkdownDir, "index.html"), "<!doctype html><title>Override</title>");
    const store = createServingStore(storagePath, { bundledViewsPath: viewsRoot });

    expect(store.getViews()).toEqual([]);
    expect(store.getViewPath("markdown")).toBe(bundledMarkdownDir);
    expect(store.getViewPath("custom")).toBeNull();
  });

  it("loads only the fixed markdown asset path from bundled views", () => {
    const storagePath = tempDir("television-view-storage-");
    const viewsRoot = tempDir("television-view-dist-");
    dirs.push(storagePath, viewsRoot);
    const markdownDir = path.join(viewsRoot, "markdown");
    mkdirSync(markdownDir, { recursive: true });
    writeFileSync(path.join(markdownDir, "index.html"), "<!doctype html>");
    const store = createServingStore(storagePath, { bundledViewsPath: viewsRoot });

    expect(store.getViews()).toEqual([]);
    expect(existsSync(path.join(storagePath, "views"))).toBe(false);
    expect(store.getViewPath("markdown")).toBe(markdownDir);
    expect(store.getViewPath("other")).toBeNull();
  });
});
